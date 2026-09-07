import { describe, it, expect } from 'vitest';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import type { AssessmentPayload } from '../records/types';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { RENTSMART_RESOURCE_ID } from '../records/sources/boston/rentsmart';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import enforcementLanark from './helpers/records/enforcement-lanark.json';
import rentsmartLanark from './helpers/records/rentsmart-lanark.json';
import permitsPositive from './helpers/records/permits-positive.json';

const suite = sqliteAvailable ? describe : describe.skip;

/** FY2025's assessor resource, kept literal so a change to ASSESSOR_YEARS surfaces here. */
const FY2025_RESOURCE_ID = '6b7e460e-33f6-4e61-80bc-1bef2e73ac54';

/** Every Boston source: six assessor years, permits, violations, enforcement, 311, RentSmart. */
const BOSTON_SOURCE_COUNT = 11;

const ADMIN_ID = 'admin-1';

/**
 * record_pulls.triggered_by is a foreign key to users(id), and node:sqlite (like D1)
 * enforces it, so the admin who triggers a pull has to exist.
 */
async function createDbWithAdmin(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  await db.prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)').bind(ADMIN_ID, 'admin@example.com').run();
  return db;
}

async function loadBuilding(db: TestD1Database, id: string): Promise<BuildingRowForIdentity> {
  const row = await db
    .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
    .bind(id)
    .first<BuildingRowForIdentity>();
  if (!row) throw new Error(`test building ${id} was not inserted`);
  return row;
}

async function recordCounts(db: TestD1Database, buildingId: string): Promise<Record<string, number>> {
  const rows = await db
    .prepare('SELECT kind, count(*) AS n FROM building_records WHERE building_id = ? GROUP BY kind ORDER BY kind')
    .bind(buildingId)
    .all<{ kind: string; n: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.kind, r.n]));
}

async function recordKeys(db: TestD1Database, buildingId: string): Promise<Array<{ kind: string; source_key: string }>> {
  const rows = await db
    .prepare('SELECT kind, source_key FROM building_records WHERE building_id = ? ORDER BY kind, source_key')
    .bind(buildingId)
    .all<{ kind: string; source_key: string }>();
  return rows.results;
}

async function pullRowCount(db: TestD1Database, buildingId: string): Promise<number> {
  const row = await db
    .prepare('SELECT count(*) AS n FROM record_pulls WHERE building_id = ?')
    .bind(buildingId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

suite('pullBuildingRecords', () => {
  it('resolves a parcel, stores every source result, and learns the sam id', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    const building = await loadBuilding(db, buildingId);
    const fetchImpl = fixtureFetch([
      // The resolver and the FY2026 year query hit the same resource with different SQL.
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'NOT IN', records: lanark2026 },
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: '"PID" IN', records: lanark2026 },
      { resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementLanark },
      { resourceId: RENTSMART_RESOURCE_ID, records: rentsmartLanark },
    ]);

    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(summary.buildingId).toBe(buildingId);
    expect(summary.jurisdiction).toBe('boston');
    expect(summary.parcelId).toBe('2102098000');
    expect(summary.condominium).toBe(false);
    expect(summary.sources).toHaveLength(BOSTON_SOURCE_COUNT);

    const byLabel = (label: string) => summary.sources.find((s) => s.label === label);
    expect(byLabel('Property Assessment FY2026')).toMatchObject({ status: 'ok', rowCount: 1 });
    expect(byLabel('Property Assessment FY2025')).toMatchObject({ status: 'empty', rowCount: 0 });
    expect(byLabel('Public Works Code Enforcement')).toMatchObject({ status: 'ok', rowCount: 3 });
    expect(byLabel('Building and Property Violations')).toMatchObject({ status: 'empty', rowCount: 0 });
    expect(byLabel('RentSmart')).toMatchObject({ status: 'ok', rowCount: 4 });
    expect(byLabel('311 Service Requests')).toMatchObject({ status: 'empty', rowCount: 0 });

    const stored = await db
      .prepare('SELECT parcel_id, sam_id FROM buildings WHERE id = ?')
      .bind(buildingId)
      .first<{ parcel_id: string | null; sam_id: string | null }>();
    expect(stored).toEqual({ parcel_id: '2102098000', sam_id: '83763' });

    const pulls = await db
      .prepare('SELECT source_label, query, status, triggered_by FROM record_pulls WHERE building_id = ?')
      .bind(buildingId)
      .all<{ source_label: string; query: string; status: string; triggered_by: string | null }>();
    expect(pulls.results).toHaveLength(BOSTON_SOURCE_COUNT);
    expect(pulls.results.every((p) => p.triggered_by === ADMIN_ID)).toBe(true);
    const enforcementPull = pulls.results.find((p) => p.source_label === 'Public Works Code Enforcement');
    expect(enforcementPull?.query).toContain('LANARK');

    expect(await recordCounts(db, buildingId)).toEqual({ assessment: 1, enforcement_ticket: 3, rentsmart: 4 });
  });

  it('replaces rows on re-pull without one fiscal year clearing another', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db, { parcel_id: '2102098000' });
    const building = await loadBuilding(db, buildingId);

    const firstFetch = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
      { resourceId: FY2025_RESOURCE_ID, sqlIncludes: '"PID" IN', records: lanark2026 },
      { resourceId: PERMITS_RESOURCE_ID, records: permitsPositive },
    ]);
    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: firstFetch });
    expect(await recordKeys(db, buildingId)).toEqual([
      { kind: 'assessment', source_key: 'FY2025' },
      { kind: 'assessment', source_key: 'FY2026' },
      { kind: 'permit', source_key: 'A1000569' },
      { kind: 'permit', source_key: 'E123' },
    ]);

    // FY2025 now returns nothing, and permits returns one of its two rows.
    const secondFetch = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
      { resourceId: PERMITS_RESOURCE_ID, records: [permitsPositive[0]] },
    ]);
    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: secondFetch });

    expect(await recordKeys(db, buildingId)).toEqual([
      { kind: 'assessment', source_key: 'FY2026' },
      { kind: 'permit', source_key: 'A1000569' },
    ]);
    expect(await pullRowCount(db, buildingId)).toBe(BOSTON_SOURCE_COUNT * 2);
  });

  it('keeps prior rows when a source fails and still runs the sources after it', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db, { parcel_id: '2102098000' });
    const building = await loadBuilding(db, buildingId);

    const firstFetch = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
      { resourceId: PERMITS_RESOURCE_ID, records: permitsPositive },
    ]);
    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: firstFetch });
    expect((await recordCounts(db, buildingId)).permit).toBe(2);

    const secondFetch = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
      { resourceId: PERMITS_RESOURCE_ID, errorStatus: 503, errorMessage: 'upstream unavailable' },
    ]);
    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: secondFetch });

    const permits = summary.sources.find((s) => s.label === 'Approved Building Permits');
    expect(permits?.status).toBe('error');
    expect(permits?.error).toMatch(/503/);
    // RentSmart runs after permits, so an error above it must not stop the loop.
    expect(summary.sources.find((s) => s.label === 'RentSmart')).toMatchObject({ status: 'empty', rowCount: 0 });
    expect((await recordCounts(db, buildingId)).permit).toBe(2);

    const errorPull = await db
      .prepare("SELECT row_count, error_message FROM record_pulls WHERE building_id = ? AND source_id = ? AND status = 'error'")
      .bind(buildingId, PERMITS_RESOURCE_ID)
      .first<{ row_count: number; error_message: string }>();
    expect(errorPull?.row_count).toBe(0);
    expect(errorPull?.error_message).toMatch(/503/);
  });

  it('records a condominium address as a flag, not a parcel', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db, { id: 'bldg-condo', address: '55 Lanark Rd, Boston, MA 02135' });
    const building = await loadBuilding(db, buildingId);
    const fetchImpl = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'NOT IN', records: [] },
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'count(*)', records: [{ n: 3 }] },
    ]);

    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(summary.parcelId).toBeNull();
    expect(summary.condominium).toBe(true);
    expect(summary.sources.find((s) => s.label === 'Property Assessment FY2025')).toMatchObject({ status: 'empty', rowCount: 0 });

    const stored = await db.prepare('SELECT parcel_id FROM buildings WHERE id = ?').bind(buildingId).first<{ parcel_id: string | null }>();
    expect(stored?.parcel_id).toBeNull();

    const records = await db
      .prepare('SELECT kind, source_key, payload FROM building_records WHERE building_id = ?')
      .bind(buildingId)
      .all<{ kind: string; source_key: string; payload: string }>();
    expect(records.results).toHaveLength(1);
    expect(records.results[0]).toMatchObject({ kind: 'assessment', source_key: 'FY2026' });
    const payload = JSON.parse(records.results[0].payload) as AssessmentPayload;
    expect(payload.condominium).toBe(true);
    expect(payload.owner).toBeNull();
  });

  it('fails every source with one message when the address matches several parcels', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    const building = await loadBuilding(db, buildingId);
    const fetchImpl = fixtureFetch([
      {
        resourceId: FY2026_RESOURCE_ID,
        sqlIncludes: 'NOT IN',
        records: [
          { ...lanark2026[0], PID: '2102098000' },
          { ...lanark2026[0], PID: '2102099000' },
        ],
      },
    ]);

    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(summary.parcelId).toBeNull();
    expect(summary.sources).toHaveLength(BOSTON_SOURCE_COUNT);
    expect(summary.sources.every((s) => s.status === 'error')).toBe(true);
    expect(summary.sources[0].error).toMatch(/2 parcels match/);
    expect(await recordCounts(db, buildingId)).toEqual({});
    expect(await pullRowCount(db, buildingId)).toBe(BOSTON_SOURCE_COUNT);
  });

  it('does nothing for a city with no jurisdiction', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db, {
      id: 'bldg-newhaven',
      address: '12 Chapel St, New Haven, CT',
      city: 'New Haven',
      zip_code: '06510',
    });
    const building = await loadBuilding(db, buildingId);
    const fetchImpl = fixtureFetch([]);

    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(summary).toEqual({ buildingId, jurisdiction: 'none', parcelId: null, condominium: false, sources: [] });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(await pullRowCount(db, buildingId)).toBe(0);
  });

  it('stamps the correction id on every pull row', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db, { parcel_id: '2102098000' });
    const building = await loadBuilding(db, buildingId);
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]);

    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, correctionId: 'corr-9', fetchImpl });

    const pulls = await db
      .prepare('SELECT correction_id FROM record_pulls WHERE building_id = ?')
      .bind(buildingId)
      .all<{ correction_id: string | null }>();
    expect(pulls.results).toHaveLength(BOSTON_SOURCE_COUNT);
    expect(pulls.results.every((p) => p.correction_id === 'corr-9')).toBe(true);
  });

  it('reports an unparseable address as a resolution error instead of throwing', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db, { id: 'bldg-noaddr', address: 'Lanark Road' });
    const building = await loadBuilding(db, buildingId);
    const fetchImpl = fixtureFetch([]);

    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(summary.sources).toHaveLength(BOSTON_SOURCE_COUNT);
    expect(summary.sources.every((s) => s.status === 'error')).toBe(true);
    expect(summary.sources[0].error).toMatch(/parse/i);
    expect(fetchImpl.calls).toHaveLength(0);
    expect(await pullRowCount(db, buildingId)).toBe(BOSTON_SOURCE_COUNT);
    expect(await recordCounts(db, buildingId)).toEqual({});
  });
});
