import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { getBuildingRecords, validatePayload } from '../records/query';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { ENFORCEMENT_PAGE_URL, ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import enforcementLanark from './helpers/records/enforcement-lanark.json';

const suite = sqliteAvailable ? describe : describe.skip;

const ADMIN_ID = 'admin-1';

/** record_pulls.triggered_by is a foreign key to users(id); node:sqlite enforces it. */
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

interface PullRowOverrides {
  id?: string;
  buildingId: string;
  sourceId?: string;
  sourceLabel?: string;
  status?: 'ok' | 'empty' | 'error';
  retrievedAt?: number;
  errorMessage?: string | null;
}

/** Hand-inserts a record_pulls row without going through pullBuildingRecords, for tests that need exact control over status/retrieved_at. */
async function insertPullRow(db: TestD1Database, overrides: PullRowOverrides): Promise<string> {
  const id = overrides.id ?? randomUUID();
  await db
    .prepare(
      'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, retrieved_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      overrides.buildingId,
      'boston',
      overrides.sourceId ?? 'test-source',
      overrides.sourceLabel ?? 'Test Source',
      'test query',
      overrides.status ?? 'ok',
      0,
      overrides.errorMessage ?? null,
      null,
      null,
      overrides.retrievedAt ?? Math.floor(Date.now() / 1000),
    )
    .run();
  return id;
}

async function insertBuildingRecord(
  db: TestD1Database,
  args: { buildingId: string; pullId: string; kind: string; sourceKey: string; payload?: unknown; rawPayload?: string },
): Promise<void> {
  const payload = args.rawPayload ?? JSON.stringify(args.payload);
  await db
    .prepare('INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(randomUUID(), args.buildingId, args.pullId, args.kind, args.sourceKey, payload, null)
    .run();
}

async function insertCorrection(
  db: TestD1Database,
  args: {
    buildingId: string;
    recordKind?: string | null;
    status?: string;
    resolution?: string | null;
    resolutionNotes?: string | null;
    resolvedAt?: number | null;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO record_corrections (id, building_id, record_kind, claim, contact_email, status, resolution, resolution_notes, resolved_by, resolved_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      randomUUID(),
      args.buildingId,
      args.recordKind ?? null,
      'This value looks wrong.',
      null,
      args.status ?? 'resolved',
      args.resolution ?? null,
      args.resolutionNotes ?? null,
      null,
      args.resolvedAt ?? null,
    )
    .run();
}

suite('getBuildingRecords', () => {
  it('returns null for a building that has never been pulled', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);

    expect(await getBuildingRecords(db, buildingId)).toBeNull();
  });

  it('reads back a real pull with an assessment and enforcement rows', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    const building = await loadBuilding(db, buildingId);
    const fetchImpl = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'NOT IN', records: lanark2026 },
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: '"PID" IN', records: lanark2026 },
      { resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementLanark },
    ]);
    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    const view = await getBuildingRecords(db, buildingId);

    expect(view).not.toBeNull();
    expect(view!.assessments).toHaveLength(1);
    expect(view!.assessments[0].fiscalYear).toBe('FY2026');
    expect(view!.enforcement).toHaveLength(3);
    expect(view!.permits).toEqual([]);
    expect(view!.serviceRequests).toEqual([]);
    expect(view!.pulledAt).toBeGreaterThan(0);
    expect(view!.sources[FY2026_RESOURCE_ID]).toMatchObject({ label: 'Property Assessment FY2026', status: 'ok' });
    expect(view!.sources[ENFORCEMENT_RESOURCE_ID]).toMatchObject({ status: 'ok', pageUrl: ENFORCEMENT_PAGE_URL });
    expect(view!.invalidKinds).toEqual([]);
    expect(view!.corrections).toEqual([]);
  });

  it('marks a kind invalid when its stored payload fails validation, and skips just that row', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    const pullId = await insertPullRow(db, { buildingId, sourceId: PERMITS_RESOURCE_ID, sourceLabel: 'Approved Building Permits' });
    await insertBuildingRecord(db, { buildingId, pullId, kind: 'permit', sourceKey: 'bad-1', payload: { nope: true } });
    await insertBuildingRecord(db, {
      buildingId,
      pullId,
      kind: 'permit',
      sourceKey: 'good-1',
      payload: { permitNumber: 'P-OK', issuedDate: '2020-01-01' },
    });

    const view = await getBuildingRecords(db, buildingId);

    expect(view).not.toBeNull();
    expect(view!.permits).toHaveLength(1);
    expect(view!.permits[0].permitNumber).toBe('P-OK');
    expect(view!.invalidKinds).toEqual(['permit']);
  });

  it('marks a kind invalid when its stored payload is not parseable JSON', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    const pullId = await insertPullRow(db, { buildingId, sourceId: PERMITS_RESOURCE_ID, sourceLabel: 'Approved Building Permits' });
    await insertBuildingRecord(db, { buildingId, pullId, kind: 'permit', sourceKey: 'torn-1', rawPayload: '{not json' });

    const view = await getBuildingRecords(db, buildingId);

    expect(view).not.toBeNull();
    expect(view!.permits).toEqual([]);
    expect(view!.invalidKinds).toEqual(['permit']);
  });

  it('breaks a tie on issued date with the permit number, whatever order the rows came back in', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    const pullId = await insertPullRow(db, { buildingId, sourceId: PERMITS_RESOURCE_ID, sourceLabel: 'Approved Building Permits' });
    await insertBuildingRecord(db, {
      buildingId,
      pullId,
      kind: 'permit',
      sourceKey: 'z-first',
      payload: { permitNumber: 'B-2', issuedDate: '2021-05-05' },
    });
    await insertBuildingRecord(db, {
      buildingId,
      pullId,
      kind: 'permit',
      sourceKey: 'a-second',
      payload: { permitNumber: 'A-1', issuedDate: '2021-05-05' },
    });

    const view = await getBuildingRecords(db, buildingId);

    expect(view!.permits.map((p) => p.permitNumber)).toEqual(['A-1', 'B-2']);
  });

  it('surfaces only resolved source_mismatch_noted corrections that carry notes', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    await insertPullRow(db, { buildingId });
    await insertCorrection(db, {
      buildingId,
      recordKind: 'permit',
      status: 'resolved',
      resolution: 'source_mismatch_noted',
      resolutionNotes: 'Note A',
      resolvedAt: 1000,
    });
    await insertCorrection(db, {
      buildingId,
      recordKind: 'violation',
      status: 'resolved',
      resolution: 'repulled_unchanged',
      resolutionNotes: 'Note B',
      resolvedAt: 2000,
    });

    const view = await getBuildingRecords(db, buildingId);

    expect(view).not.toBeNull();
    expect(view!.corrections).toEqual([{ recordKind: 'permit', resolvedAt: 1000, notes: 'Note A' }]);
  });

  it('uses the latest pull per source when a source has been pulled more than once', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    await insertPullRow(db, {
      buildingId,
      sourceId: 'shared-source',
      sourceLabel: 'Shared Source',
      status: 'error',
      retrievedAt: 100,
      errorMessage: 'boom',
    });
    await insertPullRow(db, {
      buildingId,
      sourceId: 'shared-source',
      sourceLabel: 'Shared Source',
      status: 'ok',
      retrievedAt: 200,
    });

    const view = await getBuildingRecords(db, buildingId);

    expect(view).not.toBeNull();
    expect(view!.sources['shared-source']).toMatchObject({ status: 'ok', retrievedAt: 200, errorMessage: null });
    expect(view!.pulledAt).toBe(200);
  });

  describe('validatePayload', () => {
    it('accepts a valid assessment payload', () => {
      expect(validatePayload('assessment', { fiscalYear: 'FY2026', condominium: false })).not.toBeNull();
    });

    it('rejects an assessment payload whose condominium flag is not a boolean', () => {
      expect(validatePayload('assessment', { fiscalYear: 'FY2026', condominium: 'yes' })).toBeNull();
    });

    it('rejects a permit payload missing permitNumber', () => {
      expect(validatePayload('permit', { nope: true })).toBeNull();
    });

    it('accepts a valid permit payload', () => {
      expect(validatePayload('permit', { permitNumber: 'P1', issuedDate: '2020-01-01', declaredValuation: 1000 })).not.toBeNull();
    });

    it('rejects a permit payload whose declared valuation is not a number', () => {
      expect(validatePayload('permit', { permitNumber: 'P1', declaredValuation: 'abc' })).toBeNull();
    });

    it('rejects a permit payload whose issued date is not a string', () => {
      expect(validatePayload('permit', { permitNumber: 'P1', issuedDate: 5 })).toBeNull();
    });

    it('rejects an assessment payload whose total value is not a finite number', () => {
      expect(validatePayload('assessment', { fiscalYear: 'FY2026', condominium: false, totalValue: '600000' })).toBeNull();
      expect(validatePayload('assessment', { fiscalYear: 'FY2026', condominium: false, totalValue: Number.NaN })).toBeNull();
    });

    it('rejects a service_request payload whose system is not one of the two feeds', () => {
      expect(validatePayload('service_request', { caseId: 'C1', system: 'other', classification: 'housing' })).toBeNull();
    });

    it('accepts a valid service_request payload', () => {
      expect(validatePayload('service_request', { caseId: 'C1', system: 'legacy', classification: 'housing' })).not.toBeNull();
    });

    it('rejects a service_request payload with a bad classification', () => {
      expect(validatePayload('service_request', { caseId: 'C1', system: 'legacy', classification: 'urgent' })).toBeNull();
    });

    it('rejects violation/enforcement_ticket/rentsmart payloads missing their required key', () => {
      expect(validatePayload('violation', { code: '1' })).toBeNull();
      expect(validatePayload('enforcement_ticket', { code: '1' })).toBeNull();
      expect(validatePayload('rentsmart', { date: '2020-01-01' })).toBeNull();
    });

    it('rejects non-object values', () => {
      expect(validatePayload('rentsmart', null)).toBeNull();
      expect(validatePayload('rentsmart', 'nope')).toBeNull();
      expect(validatePayload('rentsmart', [1, 2, 3])).toBeNull();
    });
  });
});
