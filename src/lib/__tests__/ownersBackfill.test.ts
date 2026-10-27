import { describe, expect, it } from 'vitest';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import {
  MAX_STATEMENTS_PER_FILE,
  ROWS_PER_STATEMENT,
  newestAssessmentsSql,
  ownerInsertStatement,
  ownerRollbackStatement,
  ownersBackfillFiles,
  planOwnersBackfill,
  type StoredOwnerAssessment,
} from '../records/seed/ownersBackfill';
import { ownerRowFromAssessment, type OwnerRow } from '../records/ownerOfRecord';
import { ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import type { AssessmentPayload } from '../records/types';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';

const suite = sqliteAvailable ? describe : describe.skip;

const READ_AT = 1_800_000_000;

function payload(overrides: Partial<AssessmentPayload> = {}): AssessmentPayload {
  return {
    fiscalYear: 'FY2026', parcelId: '0100001000', owner: 'EXAMPLE HOLDINGS LLC', mailAddressee: null, mailStreet: null, mailCity: null,
    mailState: null, mailZip: null, landUse: 'R3', landUseDescription: 'THREE-FAM DWELLING', yearBuilt: null, yearRemodel: null,
    grossArea: null, livingArea: null, residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null,
    buildingValue: null, condominium: false, ...overrides,
  };
}

/** A building with stored assessor rows, one per payload, written at `createdAt`. */
async function storeAssessments(db: TestD1Database, id: string, payloads: AssessmentPayload[], createdAt = READ_AT - 100): Promise<void> {
  await insertBuilding(db, { id, address: `${id} Example Rd` });
  for (const p of payloads) {
    const year = ASSESSOR_YEARS.find((y) => y.fiscalYear === p.fiscalYear) ?? ASSESSOR_YEARS[0];
    await insertPull(db, id, year.resourceId);
    await db
      .prepare('INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(`${id}-${p.fiscalYear}`, id, `${id}-${year.resourceId}-ok`, 'assessment', p.fiscalYear, JSON.stringify(p), createdAt)
      .run();
  }
}

async function readAll(db: TestD1Database, page = 5000): Promise<StoredOwnerAssessment[]> {
  const rows: StoredOwnerAssessment[] = [];
  let after = '';
  for (;;) {
    const batch = await db.prepare(newestAssessmentsSql(after, page)).all<StoredOwnerAssessment>();
    rows.push(...batch.results);
    if (batch.results.length < page) return rows;
    after = batch.results[batch.results.length - 1].building_id;
  }
}

async function owners(db: TestD1Database) {
  const rows = await db
    .prepare('SELECT building_id, fiscal_year, owner, owner_key, is_entity, residential, updated_at FROM building_owners ORDER BY building_id')
    .all<{ building_id: string; fiscal_year: string; owner: string; owner_key: string; is_entity: number; residential: number; updated_at: number }>();
  return rows.results;
}

function apply(db: TestD1Database, files: Map<string, string>): void {
  for (const [name, content] of files) if (/^owners-\d{3}\.sql$/.test(name)) db.exec(content);
}

suite('owners backfill read', () => {
  it('reads each building newest stored assessor row, in id order, a page at a time', async () => {
    const db = createRecordsTestDb();
    await storeAssessments(db, 'b-a', [payload({ fiscalYear: 'FY2025', owner: 'OLD OWNER LLC' }), payload({ owner: 'NEW OWNER LLC' })]);
    await storeAssessments(db, 'b-b', [payload({ fiscalYear: 'FY2024', owner: 'ONLY OWNER LLC', landUse: 'C', landUseDescription: 'COMMERCIAL' })]);
    await storeAssessments(db, 'b-c', [payload({ owner: null, parcelId: null, condominium: true, landUse: null, landUseDescription: null })]);
    await insertBuilding(db, { id: 'b-none', address: '1 Sample St' });

    const rows = await readAll(db, 2);
    expect(rows.map((r) => [r.building_id, r.fiscal_year, r.owner])).toEqual([
      ['b-a', 'FY2026', 'NEW OWNER LLC'],
      ['b-b', 'FY2024', 'ONLY OWNER LLC'],
      ['b-c', 'FY2026', null],
    ]);
    expect(rows[2].condominium).toBe(1);
    expect(rows[1]).toMatchObject({ land_use: 'C', land_use_description: 'COMMERCIAL', parcel_id: '0100001000' });
  });

  it('refuses a page size that is not a positive integer', () => {
    expect(() => newestAssessmentsSql('', 0)).toThrow();
    expect(() => newestAssessmentsSql('', 1.5)).toThrow();
  });
});

describe('planOwnersBackfill', () => {
  const stored = (overrides: Partial<StoredOwnerAssessment>): StoredOwnerAssessment => ({
    building_id: 'b-1', fiscal_year: 'FY2026', owner: 'EXAMPLE HOLDINGS LLC', condominium: 0, parcel_id: '0100001000',
    land_use: 'R3', land_use_description: 'THREE-FAM DWELLING', ...overrides,
  });

  it('builds the same row the pull would, and skips condominiums and blank owners', () => {
    const plan = planOwnersBackfill([
      stored({ building_id: 'b-1', owner: 'Example Holdings, L.L.C.' }),
      stored({ building_id: 'b-2', owner: null, condominium: 1, parcel_id: null }),
      stored({ building_id: 'b-3', owner: '  ' }),
      stored({ building_id: 'b-4', owner: 'DOE JANE', land_use: 'C', land_use_description: 'COMMERCIAL' }),
    ]);
    expect(plan.read).toBe(4);
    expect(plan.skippedCondominium).toBe(1);
    expect(plan.skippedBlankOwner).toBe(1);
    expect(plan.rows).toEqual([
      ownerRowFromAssessment('b-1', payload({ owner: 'Example Holdings, L.L.C.' })),
      ownerRowFromAssessment('b-4', payload({ owner: 'DOE JANE', landUse: 'C', landUseDescription: 'COMMERCIAL' })),
    ]);
    expect(plan.rows[1]).toMatchObject({ isEntity: 0, residential: 0 });
  });
});

suite('owners backfill SQL', () => {
  async function planned(db: TestD1Database) {
    return planOwnersBackfill(await readAll(db));
  }

  it('writes every owner row and is a no-op when applied again', async () => {
    const db = createRecordsTestDb();
    await storeAssessments(db, 'b-1', [payload({ owner: 'EXAMPLE HOLDINGS LLC' })]);
    await storeAssessments(db, 'b-2', [payload({ owner: 'DOE JANE', parcelId: '0100002000' })]);
    const files = ownersBackfillFiles(await planned(db), { readAt: READ_AT, target: '--local', dir: '.cache/owners-backfill/local-1', database: 'ratemyplace-db' });

    apply(db, files);
    const first = await owners(db);
    expect(first.map((r) => [r.building_id, r.owner_key, r.updated_at])).toEqual([
      ['b-1', 'EXAMPLE HOLDINGS LLC', READ_AT],
      ['b-2', 'DOE JANE', READ_AT],
    ]);
    apply(db, files);
    expect(await owners(db)).toEqual(first);
  });

  it('leaves a row the pull wrote after the read, and skips a building re-pulled after the read', async () => {
    const db = createRecordsTestDb();
    await storeAssessments(db, 'b-newer-row', [payload({ owner: 'READ OWNER LLC' })]);
    await storeAssessments(db, 'b-repulled', [payload({ owner: 'READ OWNER LLC', parcelId: '0100002000' })]);
    await storeAssessments(db, 'b-older-row', [payload({ owner: 'READ OWNER LLC', parcelId: '0100003000' })]);
    const files = ownersBackfillFiles(await planned(db), { readAt: READ_AT, target: '--local', dir: 'd', database: 'ratemyplace-db' });

    // After the read: a pull wrote one building's owner row; another building was re-pulled and
    // now stores a condominium (no owner row); a third has a row a pull wrote before the read.
    const insert = 'INSERT INTO building_owners (building_id, fiscal_year, parcel_id, owner, owner_key, is_entity, residential, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)';
    await db.prepare(insert).bind('b-newer-row', 'FY2026', '0100001000', 'PULLED OWNER LLC', 'PULLED OWNER LLC', READ_AT + 60).run();
    await db.prepare('UPDATE building_records SET created_at = ? WHERE building_id = ?').bind(READ_AT + 30, 'b-repulled').run();
    await db.prepare(insert).bind('b-older-row', 'FY2026', '0100003000', 'STALE OWNER LLC', 'STALE OWNER LLC', READ_AT - 60).run();

    apply(db, files);
    const rows = await owners(db);
    expect(rows.map((r) => [r.building_id, r.owner_key])).toEqual([
      ['b-newer-row', 'PULLED OWNER LLC'],
      ['b-older-row', 'READ OWNER LLC'],
    ]);
  });

  it('skips a building deleted after the read instead of failing the statement', async () => {
    const db = createRecordsTestDb();
    await storeAssessments(db, 'b-1', [payload()]);
    await storeAssessments(db, 'b-gone', [payload({ parcelId: '0100002000' })]);
    const files = ownersBackfillFiles(await planned(db), { readAt: READ_AT, target: '--local', dir: 'd', database: 'ratemyplace-db' });
    await db.prepare('DELETE FROM buildings WHERE id = ?').bind('b-gone').run();
    apply(db, files);
    expect((await owners(db)).map((r) => r.building_id)).toEqual(['b-1']);
  });

  it('rolls back exactly the rows it wrote', async () => {
    const db = createRecordsTestDb();
    await storeAssessments(db, 'b-1', [payload()]);
    await storeAssessments(db, 'b-pulled', [payload({ parcelId: '0100002000' })], READ_AT + 30);
    const files = ownersBackfillFiles(await planned(db), { readAt: READ_AT, target: '--local', dir: 'd', database: 'ratemyplace-db' });
    await db
      .prepare("INSERT INTO building_owners (building_id, fiscal_year, parcel_id, owner, owner_key, is_entity, residential, updated_at) VALUES ('b-pulled', 'FY2026', '0100002000', 'X LLC', 'X LLC', 1, 1, ?)")
      .bind(READ_AT + 60)
      .run();
    apply(db, files);
    db.exec(files.get('rollback.sql')!);
    expect((await owners(db)).map((r) => r.building_id)).toEqual(['b-pulled']);
    expect(ownerRollbackStatement(READ_AT)).toBe(`DELETE FROM building_owners WHERE updated_at = ${READ_AT};`);
  });

  it('agrees with the pull about every column', async () => {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO users (id, email, is_admin) VALUES ('admin', 'a@example.com', 1)").run();
    await insertBuilding(db, { id: 'b-pulled', address: '12 Example Rd, Boston, MA 02134', zip_code: '02134', parcel_id: '0100001000' });
    const building = await db
      .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
      .bind('b-pulled')
      .first<BuildingRowForIdentity>();
    await pullBuildingRecords(db, building!, {
      triggeredBy: 'admin',
      fetchImpl: fixtureFetch([
        { resourceId: FY2026_RESOURCE_ID, records: [{ PID: '0100001000', OWNER: 'Example Realty, L.P.', LU: 'A', LU_DESC: 'APT 7-30 UNITS' }] },
      ]),
    });
    const [fromPull] = await owners(db);
    const plan = await planned(db);
    expect(plan.rows).toHaveLength(1);
    const row: OwnerRow = plan.rows[0];
    const { updated_at: _written, ...pulled } = fromPull;
    expect(pulled).toEqual({
      building_id: row.buildingId,
      fiscal_year: row.fiscalYear,
      owner: row.owner,
      owner_key: row.ownerKey,
      is_entity: row.isEntity,
      residential: row.residential,
    });
    expect(pulled).toMatchObject({ owner_key: 'EXAMPLE REALTY LP', is_entity: 1, residential: 1 });
  });
});

describe('ownersBackfillFiles', () => {
  const row = (i: number, owner = 'EXAMPLE HOLDINGS LLC'): OwnerRow =>
    ownerRowFromAssessment(`b-${i}`, payload({ owner, parcelId: String(i).padStart(10, '0') }))!;

  it('writes nothing for a plan with no rows', () => {
    expect(ownersBackfillFiles({ read: 3, rows: [], skippedCondominium: 3, skippedBlankOwner: 0 }, { readAt: READ_AT, target: '--remote', dir: 'd', database: 'db' }).size).toBe(0);
  });

  it('packs rows into statements and statements into files, with a rollback and a summary', () => {
    const rows = Array.from({ length: ROWS_PER_STATEMENT * 2 + 5 }, (_, i) => row(i));
    const files = ownersBackfillFiles({ read: rows.length, rows, skippedCondominium: 0, skippedBlankOwner: 0 }, {
      readAt: READ_AT,
      target: '--remote',
      dir: '.cache/owners-backfill/remote-1800000000',
      database: 'ratemyplace-db',
    });
    expect([...files.keys()]).toEqual(['owners-001.sql', 'rollback.sql', 'summary.txt']);
    expect(files.get('owners-001.sql')!.trim().split('\n')).toHaveLength(3);
    expect(MAX_STATEMENTS_PER_FILE).toBe(999);
    const summary = files.get('summary.txt')!;
    expect(summary).toContain('Generated only: nothing in this directory has been applied.');
    expect(summary).toContain('npx wrangler d1 execute ratemyplace-db --remote --file .cache/owners-backfill/remote-1800000000/owners-001.sql');
    expect(summary).toContain('--file .cache/owners-backfill/remote-1800000000/rollback.sql');
  });

  it('names entity owners in the summary and never a person', () => {
    const rows = [row(1), row(2), row(3, 'DOE JANE'), row(4, 'DOE JANE'), row(5, 'ROE RICHARD')];
    const summary = ownersBackfillFiles({ read: 5, rows, skippedCondominium: 0, skippedBlankOwner: 0 }, { readAt: READ_AT, target: '--remote', dir: 'd', database: 'db' }).get('summary.txt')!;
    expect(summary).toContain('2  EXAMPLE HOLDINGS LLC');
    expect(summary).toContain('person names with 2+ residential parcels (link): 1');
    expect(summary).toContain('person names below that (never link): 1');
    expect(summary).not.toContain('DOE JANE');
    expect(summary).not.toContain('ROE RICHARD');
  });

  it('quotes every value as a literal', () => {
    const statement = ownerInsertStatement([row(1, "O'EXAMPLE HOLDINGS LLC")], READ_AT);
    expect(statement).toContain("'O''EXAMPLE HOLDINGS LLC'");
    expect(() => ownerInsertStatement([], READ_AT)).toThrow();
  });
});
