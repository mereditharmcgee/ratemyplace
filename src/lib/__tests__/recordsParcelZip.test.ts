import { describe, it, expect } from 'vitest';
import { buildIdentity, recordZips } from '../records/identity';
import { zipEqualsClause } from '../records/ckan';
import { pullBuildingRecords } from '../records/pull';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { ENFORCEMENT_RESOURCE_ID, enforcementSource } from '../records/sources/boston/enforcement';
import { LEGACY_311_RESOURCES, NEW_311_RESOURCE_ID, serviceRequestsSource } from '../records/sources/boston/serviceRequests';
import { VIOLATIONS_RESOURCE_ID, violationsSource } from '../records/sources/boston/violations';
import type { BuildingRowForIdentity } from '../records/identity';
import type { AssessmentPayload, BuildingIdentity, RecordsDb, RecordsPreparedStatement } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

/**
 * The 311 and violation-feed ZIP filters accept the current-year parcel's ZIP beside the page's
 * (October 2026). A building page whose ZIP disagrees with the assessor's otherwise lost every
 * record the city filed under the parcel's ZIP. Matching only: the building row is never changed.
 * Synthetic addresses, ZIPs and owners throughout.
 */

const PAGE_ZIP = '02199';
const PARCEL_ZIP = '02101';

function identity(overrides: { zip?: string | null; parcelZip?: string | null } = {}): BuildingIdentity {
  const built = buildIdentity({
    id: 'b-zip',
    address: '12 Example Rd',
    city: 'Boston',
    state: 'MA',
    zip_code: overrides.zip === undefined ? PAGE_ZIP : overrides.zip,
    parcel_id: '0100000012',
    sam_id: null,
  });
  return { ...built, parcelZip: overrides.parcelZip ?? null };
}

describe('recordZips', () => {
  it('is the page ZIP alone until the pull has read a parcel ZIP', () => {
    expect(buildIdentity({ id: 'b', address: '12 Example Rd', city: 'Boston', state: 'MA', zip_code: PAGE_ZIP, parcel_id: null, sam_id: null }).parcelZip).toBeNull();
    expect(recordZips(identity())).toEqual([PAGE_ZIP]);
  });

  it('adds the parcel ZIP when it differs, page ZIP first', () => {
    expect(recordZips(identity({ parcelZip: PARCEL_ZIP }))).toEqual([PAGE_ZIP, PARCEL_ZIP]);
  });

  it('lists a ZIP once when the page and the parcel agree', () => {
    expect(recordZips(identity({ parcelZip: PAGE_ZIP }))).toEqual([PAGE_ZIP]);
  });

  it('never narrows a page that has no usable ZIP to the parcel’s', () => {
    expect(recordZips(identity({ zip: null, parcelZip: PARCEL_ZIP }))).toEqual([]);
    expect(recordZips(identity({ zip: '2199', parcelZip: PARCEL_ZIP }))).toEqual([]);
  });

  it('drops anything that is not five digits', () => {
    expect(recordZips(identity({ parcelZip: "02101' OR '1'='1" }))).toEqual([PAGE_ZIP]);
    expect(recordZips(identity({ parcelZip: '02101-1234' }))).toEqual([PAGE_ZIP]);
  });
});

describe('zipEqualsClause', () => {
  it('writes one ZIP as an equality, exactly as the feeds were queried before', () => {
    expect(zipEqualsClause('violation_zip', ['02199'])).toBe(`"violation_zip" = '02199'`);
  });

  it('writes several ZIPs as an IN list', () => {
    expect(zipEqualsClause('zip_code', ['02199', '02101'])).toBe(`"zip_code" IN ('02199','02101')`);
  });

  it('refuses an unsafe column, an empty list, or a value that is not five digits', () => {
    expect(() => zipEqualsClause('zip"; DROP', ['02199'])).toThrow();
    expect(() => zipEqualsClause('zip_code', [])).toThrow();
    expect(() => zipEqualsClause('zip_code', ["02199'"])).toThrow();
  });
});

describe('the address-keyed feeds accept the parcel ZIP', () => {
  const legacyId = LEGACY_311_RESOURCES[0].resourceId;

  it('311 legacy and new-system queries take both ZIPs', async () => {
    const result = await serviceRequestsSource.run(identity({ parcelZip: PARCEL_ZIP }), fixtureFetch([]));
    const queries: string[] = JSON.parse(result.query);
    expect(queries.find((q) => q.includes(legacyId))).toContain(`("location_zipcode" IS NULL OR "location_zipcode" IN ('02199','02101'))`);
    expect(queries.find((q) => q.includes(NEW_311_RESOURCE_ID))).toContain(`("zip_code" IS NULL OR "zip_code" IN ('02199','02101'))`);
  });

  it('ISD violations and Public Works tickets take both ZIPs', async () => {
    for (const source of [violationsSource, enforcementSource]) {
      const result = await source.run(identity({ parcelZip: PARCEL_ZIP }), fixtureFetch([]));
      expect(result.query).toContain(`("violation_zip" IS NULL OR "violation_zip" = '' OR "violation_zip" IN ('02199','02101'))`);
    }
  });

  it('send the same query as before when there is no parcel ZIP or it matches the page', async () => {
    for (const parcelZip of [null, PAGE_ZIP]) {
      const violations = await violationsSource.run(identity({ parcelZip }), fixtureFetch([]));
      expect(violations.query).toContain(`("violation_zip" IS NULL OR "violation_zip" = '' OR "violation_zip" = '02199')`);
      const requests: string[] = JSON.parse((await serviceRequestsSource.run(identity({ parcelZip }), fixtureFetch([]))).query);
      expect(requests.find((q) => q.includes(legacyId))).toContain(`("location_zipcode" IS NULL OR "location_zipcode" = '02199')`);
      expect(requests.find((q) => q.includes(NEW_311_RESOURCE_ID))).toContain(`("zip_code" IS NULL OR "zip_code" = '02199')`);
    }
  });

  it('stay unnarrowed by ZIP when the page has none, even with a parcel ZIP', async () => {
    const result = await violationsSource.run(identity({ zip: null, parcelZip: PARCEL_ZIP }), fixtureFetch([]));
    expect(result.query).not.toContain('violation_zip');
    const requests: string[] = JSON.parse((await serviceRequestsSource.run(identity({ zip: null, parcelZip: PARCEL_ZIP }), fixtureFetch([]))).query);
    expect(requests.every((q) => !q.includes('zipcode') && !q.includes('"zip_code"'))).toBe(true);
  });
});

const suite = sqliteAvailable ? describe : describe.skip;

suite('pullBuildingRecords reads the parcel ZIP before the address-keyed feeds run', () => {
  const ADMIN_ID = 'admin-zip';
  const BUILDING_ID = 'bldg-zip';

  function assessorRow(zip: string | null): Record<string, string | null> {
    return {
      PID: '0100000012', OWNER: 'EXAMPLE HOLDINGS LLC', LU: 'A', LU_DESC: 'APARTMENT', YR_BUILT: '1910', YR_REMODEL: null,
      GROSS_AREA: '9000', LIVING_AREA: '8000', RES_UNITS: '6', COM_UNITS: null, TOTAL_VALUE: '2,000,000', LAND_VALUE: '500,000',
      BLDG_VALUE: '1,500,000', MAIL_ADDRESSEE: null, MAIL_STREET_ADDRESS: '1 EXAMPLE SQ', MAIL_CITY: 'BOSTON', MAIL_STATE: 'MA',
      MAIL_ZIP_CODE: '02101', ST_NUM: '12', ST_NUM2: null, ZIP_CODE: zip,
    };
  }

  /** Records the city filed under the parcel's ZIP. Each route answers only a query that accepts it. */
  const BOTH_ZIPS = `IN ('02199','02101')`;
  const parcelZipRoutes = [
    {
      resourceId: VIOLATIONS_RESOURCE_ID,
      sqlIncludes: `"violation_zip" ${BOTH_ZIPS}`,
      records: [{ case_no: 'V1', code: 'X', status: 'Closed', status_dttm: '2012-01-01', violation_stno: '12', violation_street: 'Example', violation_suffix: 'RD' }],
    },
    {
      resourceId: NEW_311_RESOURCE_ID,
      sqlIncludes: `"zip_code" ${BOTH_ZIPS}`,
      records: [{ case_id: 'BCS-1', open_date: '2025-02-01', assigned_department: 'Inspectional Services', street_number: '12', full_address: '12 Example Rd' }],
    },
  ];

  async function setUp(): Promise<{ db: TestD1Database; building: BuildingRowForIdentity }> {
    const db = createRecordsTestDb();
    await db.prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)').bind(ADMIN_ID, 'admin@example.com').run();
    await insertBuilding(db, { id: BUILDING_ID, address: '12 Example Rd', zip_code: PAGE_ZIP, parcel_id: '0100000012' });
    const building = await db
      .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
      .bind(BUILDING_ID)
      .first<BuildingRowForIdentity>();
    return { db, building: building! };
  }

  /** The SQL a source's latest pull stored as provenance; 311 stores a JSON array of its queries, joined here. */
  async function storedQuery(db: TestD1Database, sourceId: string): Promise<string> {
    const row = await db
      .prepare('SELECT query FROM record_pulls WHERE building_id = ? AND source_id = ? ORDER BY rowid DESC LIMIT 1')
      .bind(BUILDING_ID, sourceId)
      .first<{ query: string }>();
    const query = row?.query ?? '';
    return query.startsWith('[') ? (JSON.parse(query) as string[]).join('\n') : query;
  }

  async function kinds(db: TestD1Database): Promise<Record<string, number>> {
    const rows = await db
      .prepare('SELECT kind, count(*) AS n FROM building_records WHERE building_id = ? GROUP BY kind')
      .bind(BUILDING_ID)
      .all<{ kind: string; n: number }>();
    return Object.fromEntries(rows.results.map((r) => [r.kind, r.n]));
  }

  it('attaches records filed under the parcel ZIP, read from an assessor ZIP that lost its leading zero', async () => {
    const { db, building } = await setUp();
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [assessorRow('2101')] }, ...parcelZipRoutes]);

    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    for (const sourceId of [NEW_311_RESOURCE_ID, VIOLATIONS_RESOURCE_ID, ENFORCEMENT_RESOURCE_ID]) {
      expect(await storedQuery(db, sourceId)).toContain(BOTH_ZIPS);
    }
    expect(await kinds(db)).toMatchObject({ violation: 1, service_request: 1 });

    // The building row keeps its own ZIP; the stored assessment keeps the city's value as recorded.
    const stored = await db.prepare('SELECT zip_code FROM buildings WHERE id = ?').bind(BUILDING_ID).first<{ zip_code: string }>();
    expect(stored?.zip_code).toBe(PAGE_ZIP);
    const assessment = await db
      .prepare("SELECT payload FROM building_records WHERE building_id = ? AND kind = 'assessment' AND source_key = 'FY2026'")
      .bind(BUILDING_ID)
      .first<{ payload: string }>();
    expect((JSON.parse(assessment!.payload) as AssessmentPayload).parcelZip).toBe('2101');
  });

  it('queries the page ZIP alone when the parcel agrees with it', async () => {
    const { db, building } = await setUp();
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [assessorRow(PAGE_ZIP)] }, ...parcelZipRoutes]);

    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).toContain(`"violation_zip" = '02199'`);
    expect(await storedQuery(db, NEW_311_RESOURCE_ID)).toContain(`"zip_code" = '02199'`);
    expect(await kinds(db)).not.toHaveProperty('violation');
    expect(await kinds(db)).not.toHaveProperty('service_request');
  });

  it('falls back to the page ZIP alone when the current-year assessor fails and nothing is stored yet', async () => {
    const { db, building } = await setUp();
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, errorStatus: 503, errorMessage: 'upstream unavailable' }, ...parcelZipRoutes]);

    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(summary.sources.find((s) => s.label === 'Property Assessment FY2026')?.status).toBe('error');
    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).toContain(`"violation_zip" = '02199'`);
    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).not.toContain(`'02101'`);
  });

  const ASSESSOR_UNAVAILABLE = { resourceId: FY2026_RESOURCE_ID, errorStatus: 503, errorMessage: 'upstream unavailable' };

  function currentYear(zip: string | null) {
    return { resourceId: FY2026_RESOURCE_ID, records: [assessorRow(zip)] };
  }

  async function storedParcelZip(db: TestD1Database): Promise<string | null | undefined> {
    const row = await db
      .prepare("SELECT payload FROM building_records WHERE building_id = ? AND kind = 'assessment' AND source_key = 'FY2026'")
      .bind(BUILDING_ID)
      .first<{ payload: string }>();
    return row ? (JSON.parse(row.payload) as AssessmentPayload).parcelZip : undefined;
  }

  /** Wraps the test db so `batch` rejects, as a locked D1 would, for the current-year assessor's write only. */
  function failCurrentYearWrites(db: TestD1Database): RecordsDb {
    const bound = new WeakMap<RecordsPreparedStatement, unknown[]>();
    return {
      prepare(sql: string): RecordsPreparedStatement {
        const inner = db.prepare(sql);
        const statement: RecordsPreparedStatement = {
          bind(...values: unknown[]) {
            inner.bind(...(values as never[]));
            bound.set(statement, values);
            return statement;
          },
          first: <T,>() => inner.first<T>(),
          all: <T,>() => inner.all<T>(),
          run: () => inner.run(),
        };
        return statement;
      },
      async batch(statements: RecordsPreparedStatement[]): Promise<unknown> {
        if (statements.some((s) => bound.get(s)?.includes(FY2026_RESOURCE_ID))) throw new Error('D1_ERROR: database is locked');
        return db.batch(statements as never);
      },
    };
  }

  it('keeps searching the stored parcel ZIP when the current-year assessor fails on a later pull', async () => {
    const { db, building } = await setUp();
    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: fixtureFetch([currentYear('02101'), ...parcelZipRoutes]) });
    expect(await kinds(db)).toMatchObject({ violation: 1, service_request: 1 });

    const summary = await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: fixtureFetch([ASSESSOR_UNAVAILABLE, ...parcelZipRoutes]) });

    expect(summary.sources.find((s) => s.label === 'Property Assessment FY2026')?.status).toBe('error');
    for (const sourceId of [NEW_311_RESOURCE_ID, VIOLATIONS_RESOURCE_ID, ENFORCEMENT_RESOURCE_ID]) {
      expect(await storedQuery(db, sourceId)).toContain(BOTH_ZIPS);
    }
    // The records attached under the parcel ZIP on the first pull are still there.
    expect(await kinds(db)).toMatchObject({ violation: 1, service_request: 1 });
    expect(await storedParcelZip(db)).toBe('02101');
  });

  it('lets a freshly stored current-year row replace the stored parcel ZIP, or clear it', async () => {
    const { db, building } = await setUp();
    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: fixtureFetch([currentYear('02101'), ...parcelZipRoutes]) });

    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: fixtureFetch([currentYear('02108'), ...parcelZipRoutes]) });
    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).toContain(`"violation_zip" IN ('02199','02108')`);

    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: fixtureFetch([currentYear(null), ...parcelZipRoutes]) });
    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).toContain(`"violation_zip" = '02199')`);
    expect(await storedParcelZip(db)).toBeNull();
  });

  it('uses the fresh parcel ZIP when the current-year write fails and nothing is stored yet', async () => {
    const { db, building } = await setUp();
    const fetchImpl = fixtureFetch([currentYear('02101'), ...parcelZipRoutes]);

    const summary = await pullBuildingRecords(failCurrentYearWrites(db), building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(summary.sources.find((s) => s.label === 'Property Assessment FY2026')?.status).toBe('error');
    expect(await storedParcelZip(db)).toBeUndefined();
    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).toContain(BOTH_ZIPS);
    expect(await kinds(db)).toMatchObject({ violation: 1, service_request: 1 });
  });

  it('keeps the stored parcel ZIP when a later current-year write fails, so the stored row matches what was searched', async () => {
    const { db, building } = await setUp();
    await pullBuildingRecords(db, building, { triggeredBy: ADMIN_ID, fetchImpl: fixtureFetch([currentYear('02101'), ...parcelZipRoutes]) });

    const fetchImpl = fixtureFetch([currentYear('02108'), ...parcelZipRoutes]);
    await pullBuildingRecords(failCurrentYearWrites(db), building, { triggeredBy: ADMIN_ID, fetchImpl });

    expect(await storedParcelZip(db)).toBe('02101');
    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).toContain(BOTH_ZIPS);
    expect(await storedQuery(db, VIOLATIONS_RESOURCE_ID)).not.toContain(`'02108'`);
    expect(await kinds(db)).toMatchObject({ violation: 1, service_request: 1 });
  });
});
