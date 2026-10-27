import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import { ownerRowFromAssessment, type OwnerRow } from '../records/ownerOfRecord';
import { ownersTableExists } from '../records/owners';
import {
  OWNER_GATE_SQL,
  OWNER_LINK_SQL,
  OWNER_LIST_PAGE_SIZE,
  OWNER_LIST_ROWS_SQL,
  OWNER_SPELLING_SQL,
  loadOwnerList,
  ownerListHref,
  ownerOfRecordHref,
  ownerSearchSql,
  searchOwnerNames,
} from '../records/ownerList';
import { getBuildingRecords } from '../records/query';
import { ledgerModel } from '../records/ledger';
import { ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import { ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { NEW_311_RESOURCE_ID } from '../records/sources/boston/serviceRequests';
import type { AssessmentPayload, RecordsDb, RecordsPreparedStatement } from '../records/types';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';

const suite = sqliteAvailable ? describe : describe.skip;

const ADMIN_ID = 'admin-owners';
const FY2025_RESOURCE_ID = ASSESSOR_YEARS[1].resourceId;
const NOW = new Date('2026-10-27T12:00:00Z');
const MIGRATION = readFileSync(join(process.cwd(), 'migrations', '0034_building_owners.sql'), 'utf8');

async function createDb(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  await db.prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)').bind(ADMIN_ID, 'admin@example.com').run();
  return db;
}

/** The database as it stood before migration 0034 ran. */
async function createDbWithoutOwners(): Promise<TestD1Database> {
  const db = await createDb();
  db.exec('DROP TABLE building_owners');
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

/** A synthetic FY row as CKAN returns it; only the columns `assessmentFromRow` reads. */
function assessorRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PID: '0100001000',
    OWNER: 'EXAMPLE HOLDINGS LLC',
    LU: 'R3',
    LU_DESC: 'THREE-FAM DWELLING',
    YR_BUILT: '1910',
    RES_UNITS: '3',
    TOTAL_VALUE: '900000',
    MAIL_ADDRESSEE: null,
    MAIL_STREET_ADDRESS: 'PO BOX 1',
    MAIL_CITY: 'BOSTON',
    MAIL_STATE: 'MA',
    MAIL_ZIP_CODE: '02134',
    ...overrides,
  };
}

function payload(overrides: Partial<AssessmentPayload> = {}): AssessmentPayload {
  return {
    fiscalYear: 'FY2026', parcelId: '0100001000', owner: 'EXAMPLE HOLDINGS LLC', mailAddressee: null, mailStreet: null, mailCity: null,
    mailState: null, mailZip: null, landUse: 'R3', landUseDescription: 'THREE-FAM DWELLING', yearBuilt: null, yearRemodel: null,
    grossArea: null, livingArea: null, residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null,
    buildingValue: null, condominium: false, ...overrides,
  };
}

async function insertOwnerRow(db: TestD1Database, row: OwnerRow, updatedAt = 1_000): Promise<void> {
  await db
    .prepare(
      'INSERT INTO building_owners (building_id, fiscal_year, parcel_id, owner, owner_key, is_entity, residential, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(row.buildingId, row.fiscalYear, row.parcelId, row.owner, row.ownerKey, row.isEntity, row.residential, updatedAt)
    .run();
}

/** A building and its owner row, as a pull would leave them. Returns the building id. */
async function addOwnedBuilding(
  db: TestD1Database,
  id: string,
  address: string,
  assessment: Partial<AssessmentPayload> = {},
): Promise<string> {
  const p = payload(assessment);
  await insertBuilding(db, { id, address, parcel_id: p.parcelId, zip_code: '02134' });
  const row = ownerRowFromAssessment(id, p);
  if (row) await insertOwnerRow(db, row);
  return id;
}

async function ownerRowOf(db: TestD1Database, buildingId: string) {
  return db
    .prepare('SELECT fiscal_year, parcel_id, owner, owner_key, is_entity, residential FROM building_owners WHERE building_id = ?')
    .bind(buildingId)
    .first<{ fiscal_year: string; parcel_id: string | null; owner: string; owner_key: string; is_entity: number; residential: number }>();
}

async function plan(db: TestD1Database, sql: string, ...binds: unknown[]): Promise<string> {
  const rows = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...(binds as never[])).all<{ detail: string }>();
  return rows.results.map((row) => row.detail).join('\n');
}

suite('migration 0034', () => {
  it('creates building_owners and its owner key index, and re-running it changes nothing', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '12 Example Rd');
    db.exec(MIGRATION);
    db.exec(MIGRATION);

    const objects = await db
      .prepare("SELECT type, name FROM sqlite_master WHERE tbl_name = 'building_owners' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY type, name")
      .all<{ type: string; name: string }>();
    expect(objects.results).toEqual([
      { type: 'index', name: 'idx_building_owners_key' },
      { type: 'table', name: 'building_owners' },
    ]);
    const columns = await db.prepare("SELECT name FROM pragma_index_info('idx_building_owners_key') ORDER BY seqno").all<{ name: string }>();
    expect(columns.results.map((c) => c.name)).toEqual(['owner_key', 'residential', 'parcel_id', 'is_entity']);
    // The row written before the re-run is still there.
    expect(await ownerRowOf(db, 'b-1')).not.toBeNull();
  });

  it('is additive only and never touches buildings, so sitemap dates cannot move', async () => {
    const statements = MIGRATION.split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .replace(/ON DELETE CASCADE/g, '');
    expect(statements).not.toMatch(/\bALTER\s+TABLE\b|\bDROP\b|\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
    expect(statements.match(/CREATE (TABLE|INDEX) IF NOT EXISTS/g)).toHaveLength(2);

    const db = await createDb();
    await insertBuilding(db, { id: 'b-1', address: '12 Example Rd' });
    await db.prepare('UPDATE buildings SET updated_at = 1234 WHERE id = ?').bind('b-1').run();
    const before = await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'buildings'").first<{ sql: string }>();
    db.exec(MIGRATION);
    const after = await db.prepare("SELECT sql FROM sqlite_master WHERE name = 'buildings'").first<{ sql: string }>();
    expect(after).toEqual(before);
    const stamp = await db.prepare('SELECT updated_at FROM buildings WHERE id = ?').bind('b-1').first<{ updated_at: number }>();
    expect(stamp?.updated_at).toBe(1234);
  });

  it('drops a building owner row with its building', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '12 Example Rd');
    await db.prepare('DELETE FROM buildings WHERE id = ?').bind('b-1').run();
    expect(await ownerRowOf(db, 'b-1')).toBeNull();
  });

  it('refuses an is_entity or residential flag that is not 0 or 1', async () => {
    const db = await createDb();
    await insertBuilding(db, { id: 'b-1', address: '12 Example Rd' });
    await expect(
      db
        .prepare("INSERT INTO building_owners (building_id, fiscal_year, owner, owner_key, is_entity, residential) VALUES ('b-1', 'FY2026', 'X', 'X', 2, 0)")
        .run(),
    ).rejects.toThrow(/CHECK/);
  });
});

suite('the pull writes the owner row with the assessor rows', () => {
  async function pulledBuilding(
    db: TestD1Database,
    routes: Parameters<typeof fixtureFetch>[0],
    id = 'b-pulled',
    parcel: string | null = '0100001000',
  ) {
    await insertBuilding(db, { id, address: '12 Example Rd, Boston, MA 02134', zip_code: '02134', parcel_id: parcel });
    const building = await loadBuilding(db, id);
    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: fixtureFetch(routes) });
    return { id, summary };
  }

  it('stores the current year owner, its key and both flags', async () => {
    const db = await createDb();
    const { id } = await pulledBuilding(db, [
      { resourceId: FY2026_RESOURCE_ID, records: [assessorRow({ OWNER: 'Example Holdings, L.L.C.' })] },
      { resourceId: FY2025_RESOURCE_ID, records: [assessorRow({ OWNER: 'OLDER OWNER LLC' })] },
    ]);
    expect(await ownerRowOf(db, id)).toEqual({
      fiscal_year: 'FY2026',
      parcel_id: '0100001000',
      owner: 'Example Holdings, L.L.C.',
      owner_key: 'EXAMPLE HOLDINGS LLC',
      is_entity: 1,
      residential: 1,
    });
  });

  it('falls back to the newest year that has a row, and moves up when a newer year arrives', async () => {
    const db = await createDb();
    const { id } = await pulledBuilding(db, [{ resourceId: FY2025_RESOURCE_ID, records: [assessorRow({ OWNER: 'EARLIER OWNER LLC', LU: 'C' })] }]);
    expect(await ownerRowOf(db, id)).toMatchObject({ fiscal_year: 'FY2025', owner_key: 'EARLIER OWNER LLC', residential: 0 });

    const building = await loadBuilding(db, id);
    await pullBuildingRecords(db, building, {
      triggeredBy: ADMIN_ID,
      fetchImpl: fixtureFetch([
        { resourceId: FY2026_RESOURCE_ID, records: [assessorRow({ OWNER: 'LATER OWNER LLC' })] },
        { resourceId: FY2025_RESOURCE_ID, records: [assessorRow({ OWNER: 'EARLIER OWNER LLC' })] },
      ]),
    });
    expect(await ownerRowOf(db, id)).toMatchObject({ fiscal_year: 'FY2026', owner_key: 'LATER OWNER LLC' });
  });

  it('keeps the row the panel shows: the newest stored year, whichever order the years run in', async () => {
    const db = await createDb();
    const { id } = await pulledBuilding(db, [
      { resourceId: FY2026_RESOURCE_ID, records: [assessorRow({ OWNER: 'CURRENT OWNER LLC' })] },
      { resourceId: FY2025_RESOURCE_ID, records: [assessorRow({ OWNER: 'PREVIOUS OWNER LLC' })] },
    ]);
    const view = await getBuildingRecords(db, id);
    const stored = await ownerRowOf(db, id);
    expect(stored?.owner).toBe(view?.assessments[0].owner);
    expect(stored?.fiscal_year).toBe(view?.assessments[0].fiscalYear);
  });

  it('stores no owner for a condominium address and clears one stored before', async () => {
    const db = await createDb();
    await insertBuilding(db, { id: 'b-condo', address: '55 Example Rd, Boston, MA 02134', zip_code: '02134' });
    await insertOwnerRow(db, ownerRowFromAssessment('b-condo', payload({ owner: 'EXAMPLE HOLDINGS LLC' }))!);
    const building = await loadBuilding(db, 'b-condo');
    const summary = await pullBuildingRecords(db, building, {
      triggeredBy: ADMIN_ID,
      fetchImpl: fixtureFetch([
        { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'NOT IN', records: [] },
        { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'count(*)', records: [{ n: 3 }] },
      ]),
    });
    expect(summary.condominium).toBe(true);
    expect(await ownerRowOf(db, 'b-condo')).toBeNull();
  });

  it('stores nothing for a blank owner', async () => {
    const db = await createDb();
    const { id } = await pulledBuilding(db, [{ resourceId: FY2026_RESOURCE_ID, records: [assessorRow({ OWNER: '   ' })] }]);
    expect(await ownerRowOf(db, id)).toBeNull();
  });

  it('rolls the owner row back with the assessor rows when the write fails', async () => {
    const db = await createDb();
    await insertBuilding(db, { id: 'b-fail', address: '12 Example Rd, Boston, MA 02134', zip_code: '02134', parcel_id: '0100001000' });
    await pullBuildingRecords(db, await loadBuilding(db, 'b-fail'), {
      triggeredBy: ADMIN_ID,
      fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [assessorRow({ OWNER: 'BEFORE OWNER LLC' })] }]),
    });
    expect(await ownerRowOf(db, 'b-fail')).toMatchObject({ owner: 'BEFORE OWNER LLC' });

    // Rejects any batch that carries an owner insert, as a locked D1 would.
    const sqlOf = new WeakMap<object, string>();
    const failing: RecordsDb = {
      prepare(sql: string): RecordsPreparedStatement {
        const statement = db.prepare(sql) as unknown as RecordsPreparedStatement;
        sqlOf.set(statement, sql);
        return statement;
      },
      async batch(statements) {
        if (statements.some((s) => (sqlOf.get(s) ?? '').includes('INTO building_owners'))) throw new Error('D1_ERROR: database is locked');
        return db.batch(statements as never);
      },
    };
    const building = await loadBuilding(db, 'b-fail');
    const summary = await pullBuildingRecords(failing, building, {
      triggeredBy: ADMIN_ID,
      fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [assessorRow({ OWNER: 'AFTER OWNER LLC' })] }]),
    });

    expect(summary.sources.find((s) => s.label === 'Property Assessment FY2026')).toMatchObject({ status: 'error' });
    // The year's rows and its owner row both stayed as the earlier pull left them.
    expect(await ownerRowOf(db, 'b-fail')).toMatchObject({ owner: 'BEFORE OWNER LLC' });
    const view = await getBuildingRecords(db, 'b-fail');
    expect(view?.assessments.map((a) => a.owner)).toEqual(['BEFORE OWNER LLC']);
  });

  it('works exactly as before when migration 0034 has not run', async () => {
    const db = await createDbWithoutOwners();
    expect(await ownersTableExists(db)).toBe(false);
    const { summary } = await pulledBuilding(db, [{ resourceId: FY2026_RESOURCE_ID, records: [assessorRow()] }]);
    expect(summary.sources.filter((s) => s.status === 'error')).toEqual([]);
    expect(summary.sources.find((s) => s.label === 'Property Assessment FY2026')).toMatchObject({ status: 'ok', rowCount: 1 });
  });

  it('drops an owner row read from a fiscal year that rolled off the assessor list', async () => {
    const db = await createDb();
    await insertBuilding(db, { id: 'b-old', address: '12 Example Rd, Boston, MA 02134', zip_code: '02134', parcel_id: '0100001000' });
    await insertOwnerRow(db, ownerRowFromAssessment('b-old', payload({ fiscalYear: 'FY2019' }))!);
    const building = await loadBuilding(db, 'b-old');
    // Every assessor year fails, so no year's batch touches the row; only the rollover can.
    await pullBuildingRecords(db, building, {
      triggeredBy: ADMIN_ID,
      fetchImpl: fixtureFetch(ASSESSOR_YEARS.map((year) => ({ resourceId: year.resourceId, errorStatus: 500 }))),
    });
    expect(await ownerRowOf(db, 'b-old')).toBeNull();
  });
});

suite('the owner link on the records panel', () => {
  const entity = { owner: 'EXAMPLE HOLDINGS LLC', condominium: false };
  const person = { owner: 'DOE JANE', condominium: false };

  it('links an entity owner to its list', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '12 Example Rd');
    expect(await ownerOfRecordHref(db, 'b-1', entity)).toBe('/owner-of-record?name=EXAMPLE+HOLDINGS+LLC');
    expect(ownerListHref('EXAMPLE HOLDINGS LLC', 2)).toBe('/owner-of-record?name=EXAMPLE+HOLDINGS+LLC&page=2');
  });

  it('links a person only at two or more distinct residential parcels', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '12 Example Rd', { owner: 'DOE JANE', parcelId: '0100000001' });
    expect(await ownerOfRecordHref(db, 'b-1', person)).toBeNull();

    // A second page for the same parcel (a duplicate building row) is still one parcel.
    await addOwnedBuilding(db, 'b-1-twin', '12 Example Road', { owner: 'DOE JANE', parcelId: '0100000001' });
    expect(await ownerOfRecordHref(db, 'b-1', person)).toBeNull();

    // A commercial parcel does not count toward the person rule.
    await addOwnedBuilding(db, 'b-shop', '3 Sample St', { owner: 'DOE JANE', parcelId: '0100000002', landUse: 'C', landUseDescription: 'COMMERCIAL' });
    expect(await ownerOfRecordHref(db, 'b-1', person)).toBeNull();

    await addOwnedBuilding(db, 'b-2', '14 Example Rd', { owner: 'DOE JANE', parcelId: '0100000003' });
    expect(await ownerOfRecordHref(db, 'b-1', person)).toBe('/owner-of-record?name=DOE+JANE');
  });

  it('never links a condominium, a blank owner, or a building without its own owner row', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '12 Example Rd');
    await insertBuilding(db, { id: 'b-none', address: '16 Example Rd' });
    expect(await ownerOfRecordHref(db, 'b-1', { ...entity, condominium: true })).toBeNull();
    expect(await ownerOfRecordHref(db, 'b-1', { owner: null, condominium: false })).toBeNull();
    expect(await ownerOfRecordHref(db, 'b-1', null)).toBeNull();
    expect(await ownerOfRecordHref(db, 'b-none', entity)).toBeNull();
    // A stored row under a different name than the panel shows is not this owner's list.
    expect(await ownerOfRecordHref(db, 'b-1', { owner: 'OTHER HOLDINGS LLC', condominium: false })).toBeNull();
  });

  it('stays plain text, without throwing, before the migration and while the table is empty', async () => {
    expect(await ownerOfRecordHref(await createDbWithoutOwners(), 'b-1', entity)).toBeNull();
    const empty = await createDb();
    await insertBuilding(empty, { id: 'b-1', address: '12 Example Rd' });
    expect(await ownerOfRecordHref(empty, 'b-1', entity)).toBeNull();
  });
});

suite('the owner of record list', () => {
  /** A building with one stored record of each counted kind, so its ledger has real counts. */
  async function addRecords(db: TestD1Database, buildingId: string): Promise<void> {
    for (const source of [PERMITS_RESOURCE_ID, VIOLATIONS_RESOURCE_ID, ENFORCEMENT_RESOURCE_ID, NEW_311_RESOURCE_ID]) {
      await insertPull(db, buildingId, source);
    }
    const request = (caseId: string, type: string) => ({
      caseId, system: 'new', openedAt: '2025-01-05', closedAt: null, status: 'Open', closureReason: null, title: null, subject: null,
      reason: null, type, location: null, source: null, classification: 'housing',
    });
    const violation = (caseNumber: string, code: string) => ({
      caseNumber, code, value: null, description: 'Example code line', status: 'Closed', statusDate: '2024-03-01', address: null,
      contactAddress: null, samId: null,
    });
    const rows: Array<[string, string, string, unknown]> = [
      [NEW_311_RESOURCE_ID, 'service_request', 'r1', request('r1', 'Heat - Excessive Insufficient')],
      [NEW_311_RESOURCE_ID, 'service_request', 'r2', request('r2', 'Heat - Excessive Insufficient')],
      [NEW_311_RESOURCE_ID, 'service_request', 'r3', request('r3', 'Electrical')],
      [NEW_311_RESOURCE_ID, 'service_request', 'r4', request('r4', 'Improper Storage of Trash (Barrels)')],
      // One ISD case with two code lines counts once, as on the panel.
      [VIOLATIONS_RESOURCE_ID, 'violation', 'v1', violation('V100', 'A1')],
      [VIOLATIONS_RESOURCE_ID, 'violation', 'v2', violation('V100', 'A2')],
      [ENFORCEMENT_RESOURCE_ID, 'enforcement_ticket', 't1', { ...violation('C1', 'T1'), ticketNumber: 'T-1' }],
      [PERMITS_RESOURCE_ID, 'permit', 'p1', {
        permitNumber: 'P1', workType: null, permitType: 'Electrical', description: null, comments: null, applicant: null,
        declaredValuation: null, totalFees: null, issuedDate: '2023-05-01', expirationDate: null, status: 'Closed',
        occupancyType: null, address: null,
      }],
    ];
    for (const [source, kind, key, value] of rows) {
      await db
        .prepare('INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(`${buildingId}-${key}`, buildingId, `${buildingId}-${source}-ok`, kind, key, JSON.stringify(value))
        .run();
    }
  }

  it('lists every building under the exact owner name, by street and then house number', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-10', '10 Example Rd', { parcelId: '0100000010' });
    await addOwnedBuilding(db, 'b-2', '2 Example Rd', { parcelId: '0100000002', owner: 'Example Holdings, L.L.C.' });
    await addOwnedBuilding(db, 'b-5', '5 Sample St', { parcelId: '0100000005' });
    await addOwnedBuilding(db, 'b-other', '7 Example Rd', { parcelId: '0100000007', owner: 'EXAMPLE HOLDING LLC' });
    await addOwnedBuilding(db, 'b-condo', '9 Example Rd', { parcelId: null, owner: null, condominium: true });

    const result = await loadOwnerList(db, 'example holdings, l.l.c.', 1, NOW);
    if (!result.found) throw new Error('expected a list');
    expect(result.key).toBe('EXAMPLE HOLDINGS LLC');
    expect(result.total).toBe(3);
    expect(result.buildings.map((b) => b.address)).toEqual(['2 Example Rd', '10 Example Rd', '5 Sample St']);
    // The heading takes the spelling most rows carry; each row keeps its own.
    expect(result.owner).toBe('EXAMPLE HOLDINGS LLC');
    expect(result.buildings[0].owner).toBe('Example Holdings, L.L.C.');
    expect(result.buildings.every((b) => b.fiscalYear === 'FY2026')).toBe(true);
  });

  it('shows each building the counts its own panel shows, in the three groups', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-records', '12 Example Rd', { parcelId: '0100000012' });
    await addOwnedBuilding(db, 'b-bare', '14 Example Rd', { parcelId: '0100000014' });
    await addRecords(db, 'b-records');
    await insertPull(db, 'b-bare', FY2026_RESOURCE_ID);

    const result = await loadOwnerList(db, 'EXAMPLE HOLDINGS LLC', 1, NOW);
    if (!result.found) throw new Error('expected a list');
    const withRecords = result.buildings.find((b) => b.id === 'b-records')!;
    const panel = ledgerModel((await getBuildingRecords(db, 'b-records'))!, NOW);
    expect(withRecords.counts).toEqual({
      pulled: true,
      living: panel.living.count,
      isdCases: panel.violations.count,
      buildingRequests: panel.buildingRequests.count,
      permits: panel.permits.count,
      publicWorksTickets: panel.enforcement.count,
      upkeepRequests: panel.upkeepRequests.count,
    });
    expect(withRecords.counts).toMatchObject({ living: '2', isdCases: '1', buildingRequests: '1', permits: '1', publicWorksTickets: '1', upkeepRequests: '1' });
    // Only the assessor pulled: no city feed to count yet.
    expect(result.buildings.find((b) => b.id === 'b-bare')!.counts.pulled).toBe(false);
  });

  it('applies the person rule to a typed name, not only to the link', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-home', '12 Example Rd', { owner: 'DOE JANE', parcelId: '0100000001' });
    expect(await loadOwnerList(db, 'Doe, Jane', 1, NOW)).toEqual({ found: false });
    await addOwnedBuilding(db, 'b-second', '14 Example Rd', { owner: 'DOE JANE', parcelId: '0100000002' });
    expect(await loadOwnerList(db, 'Doe, Jane', 1, NOW)).toMatchObject({ found: true, total: 2 });
  });

  it('finds nothing for a blank, overlong or unknown name, before the migration, or with an empty table', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '12 Example Rd');
    expect(await loadOwnerList(db, null, 1, NOW)).toEqual({ found: false });
    expect(await loadOwnerList(db, ' ., ', 1, NOW)).toEqual({ found: false });
    expect(await loadOwnerList(db, `EXAMPLE ${'X'.repeat(300)} LLC`, 1, NOW)).toEqual({ found: false });
    expect(await loadOwnerList(db, 'NOBODY HOLDINGS LLC', 1, NOW)).toEqual({ found: false });
    expect(await loadOwnerList(await createDbWithoutOwners(), 'EXAMPLE HOLDINGS LLC', 1, NOW)).toEqual({ found: false });
    expect(await loadOwnerList(await createDb(), 'EXAMPLE HOLDINGS LLC', 1, NOW)).toEqual({ found: false });
  });

  it('pages without overlap and clamps a page past the end', async () => {
    const db = await createDb();
    const total = OWNER_LIST_PAGE_SIZE + 5;
    for (let i = 1; i <= total; i++) {
      await addOwnedBuilding(db, `b-${i}`, `${i} Example Rd`, { parcelId: String(100000000 + i).padStart(10, '0') });
    }
    const first = await loadOwnerList(db, 'EXAMPLE HOLDINGS LLC', 1, NOW);
    const second = await loadOwnerList(db, 'EXAMPLE HOLDINGS LLC', 2, NOW);
    const past = await loadOwnerList(db, 'EXAMPLE HOLDINGS LLC', 99, NOW);
    const nonsense = await loadOwnerList(db, 'EXAMPLE HOLDINGS LLC', Number.NaN, NOW);
    if (!first.found || !second.found || !past.found || !nonsense.found) throw new Error('expected lists');
    expect(first).toMatchObject({ page: 1, pageCount: 2, total });
    expect(first.buildings).toHaveLength(OWNER_LIST_PAGE_SIZE);
    expect(second.buildings).toHaveLength(5);
    const ids = [...first.buildings, ...second.buildings].map((b) => b.id);
    expect(new Set(ids).size).toBe(total);
    expect(first.buildings[0].address).toBe('1 Example Rd');
    expect(second.buildings[4].address).toBe(`${total} Example Rd`);
    expect(past.page).toBe(2);
    expect(nonsense.page).toBe(1);
  });
});

suite('owner names in landlord search', () => {
  it('finds entity owners by part of the name, most buildings first', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '1 Example Rd', { parcelId: '0100000001', owner: 'EXAMPLE HOLDINGS LLC' });
    await addOwnedBuilding(db, 'b-2', '2 Example Rd', { parcelId: '0100000002', owner: 'Example Holdings, L.L.C.' });
    await addOwnedBuilding(db, 'b-3', '3 Example Rd', { parcelId: '0100000003', owner: 'EXAMPLE PROPERTIES TRUST' });
    await addOwnedBuilding(db, 'b-4', '4 Sample St', { parcelId: '0100000004', owner: 'SAMPLE REALTY LP' });

    const result = await searchOwnerNames(db, 'example');
    expect(result.total).toBe(2);
    expect(result.matches).toEqual([
      { key: 'EXAMPLE HOLDINGS LLC', owner: 'EXAMPLE HOLDINGS LLC', buildings: 2 },
      { key: 'EXAMPLE PROPERTIES TRUST', owner: 'EXAMPLE PROPERTIES TRUST', buildings: 1 },
    ]);
    expect((await searchOwnerNames(db, 'Example Holdings, L.L.C.')).matches.map((m) => m.key)).toEqual(['EXAMPLE HOLDINGS LLC']);
    expect((await searchOwnerNames(db, 'example', 1)).matches).toHaveLength(1);
  });

  it('never returns a person below the parcel count, even by full name', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-home', '12 Example Rd', { owner: 'DOE JANE', parcelId: '0100000001' });
    await addOwnedBuilding(db, 'b-1', '1 Sample St', { owner: 'ROE RICHARD', parcelId: '0100000002' });
    await addOwnedBuilding(db, 'b-2', '2 Sample St', { owner: 'ROE RICHARD', parcelId: '0100000003' });
    expect(await searchOwnerNames(db, 'DOE JANE')).toEqual({ matches: [], total: 0 });
    expect((await searchOwnerNames(db, 'roe')).matches).toEqual([{ key: 'ROE RICHARD', owner: 'ROE RICHARD', buildings: 2 }]);
  });

  it('reads LIKE wildcards in the typed name literally', async () => {
    const db = await createDb();
    await addOwnedBuilding(db, 'b-1', '1 Example Rd');
    expect((await searchOwnerNames(db, '%')).matches).toEqual([]);
    expect((await searchOwnerNames(db, '_')).matches).toEqual([]);
  });

  it('matches a name too long for a D1 LIKE by the exact name', async () => {
    const db = await createDb();
    const long = 'THE EXAMPLE NEIGHBORHOOD HOUSING DEVELOPMENT CORPORATION OF BOSTON';
    await addOwnedBuilding(db, 'b-1', '1 Example Rd', { owner: long });
    expect((await searchOwnerNames(db, long)).matches.map((m) => m.key)).toEqual([long]);
  });

  it('answers empty, without throwing, before the migration and with an empty table', async () => {
    expect(await searchOwnerNames(await createDbWithoutOwners(), 'example')).toEqual({ matches: [], total: 0 });
    expect(await searchOwnerNames(await createDb(), 'example')).toEqual({ matches: [], total: 0 });
  });
});

suite('owner lookups use the owner key index', () => {
  it('answers the person rule and the link from the index alone', async () => {
    const db = await createDb();
    const gate = await plan(db, OWNER_GATE_SQL, 'EXAMPLE HOLDINGS LLC');
    expect(gate).toMatch(/SEARCH building_owners USING COVERING INDEX idx_building_owners_key \(owner_key=\?\)/);

    const link = await plan(db, OWNER_LINK_SQL, 'b-1');
    expect(link).toMatch(/SEARCH bo USING INDEX sqlite_autoindex_building_owners_1 \(building_id=\?\)/);
    expect(link).toMatch(/SEARCH o USING COVERING INDEX idx_building_owners_key \(owner_key=\? AND residential=\?\)/);
  });

  it('seeks the list and its heading by owner key, joining buildings by primary key', async () => {
    const db = await createDb();
    const rows = await plan(db, OWNER_LIST_ROWS_SQL, 'EXAMPLE HOLDINGS LLC', 20, 0);
    expect(rows).toMatch(/SEARCH bo USING INDEX idx_building_owners_key \(owner_key=\?\)/);
    expect(rows).toMatch(/SEARCH b USING INDEX sqlite_autoindex_buildings_1 \(id=\?\)/);
    expect(rows).not.toMatch(/SCAN (bo|building_owners)\b(?! USING)/);

    const spelling = await plan(db, OWNER_SPELLING_SQL, 'EXAMPLE HOLDINGS LLC');
    expect(spelling).toMatch(/SEARCH building_owners USING INDEX idx_building_owners_key \(owner_key=\?\)/);
  });

  it('matches names in landlord search against the index, never the whole table', async () => {
    const db = await createDb();
    const like = await plan(db, ownerSearchSql(true), '%EXAMPLE%', 2, 10);
    expect(like).toMatch(/SCAN building_owners USING (COVERING )?INDEX idx_building_owners_key/);
    expect(like).not.toMatch(/USE TEMP B-TREE FOR GROUP BY/);

    const exact = await plan(db, ownerSearchSql(false), 'EXAMPLE HOLDINGS LLC', 2, 10);
    expect(exact).toMatch(/SEARCH building_owners USING (COVERING )?INDEX idx_building_owners_key \(owner_key=\?\)/);
  });
});
