import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  ENCLOSING_RANGE_WINDOW,
  MAX_RANGE_NUMBERS,
  addressMatchUncertainty,
  buildIdentity,
  expandHouseNumbers,
  houseNumberTokenMatches,
  leadingToken,
} from '../records/identity';
import { addressLikeClauses, rangeAddressClause, rangeNumberClause } from '../records/ckan';
import { recordsMatchUncertainty } from '../records/matchConfidence';
import { ledgerModel } from '../records/ledger';
import { PANEL_COPY, UNCERTAIN_MATCH_SUBCOUNT, uncertainMatchCopy } from '../records/display';
import { violationsSource, VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import { enforcementSource, ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { NEW_311_RESOURCE_ID, serviceRequestsSource, LEGACY_311_RESOURCES } from '../records/sources/boston/serviceRequests';
import { permitsSource, PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { ASSESSOR_YEARS, assessorSource } from '../records/sources/boston/assessor';
import type { BuildingRecordsView, SourceStatus } from '../records/query';
import type { AssessmentPayload, BuildingIdentity, ServiceRequestPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { getBuildingRecords } from '../records/query';

/**
 * Range addresses and city records filed under ranges (October 2026). A range address matches
 * every same-parity house number between its endpoints, and a city record filed as a range
 * attaches to any building whose number falls inside it. Where a building's numbers could not
 * all be searched, the panel says the match is uncertain instead of "none on record".
 */

function identity(address: string, overrides: { zip?: string | null; parcel?: string | null } = {}): BuildingIdentity {
  return buildIdentity({
    id: 'b-test',
    address,
    city: 'Boston',
    state: 'MA',
    zip_code: overrides.zip === undefined ? '02135' : overrides.zip,
    parcel_id: overrides.parcel ?? null,
    sam_id: null,
  });
}

describe('expandHouseNumbers', () => {
  it('lists every same-parity number between a range’s endpoints, ascending', () => {
    expect(expandHouseNumbers(['31', '39'], ['31', '39']).matchNumbers).toEqual(['31', '33', '35', '37', '39']);
  });

  it('orders a range the assessor wrote high to low', () => {
    const out = expandHouseNumbers(['252', '240'], ['252', '240']);
    expect(out.matchNumbers).toEqual(['240', '242', '244', '246', '248', '250', '252']);
    expect(out.span).toEqual({ low: 240, high: 252 });
  });

  it('leaves a single number as written and gives it a one-number span', () => {
    const out = expandHouseNumbers(['503'], ['503']);
    expect(out.matchNumbers).toEqual(['503']);
    expect(out.span).toEqual({ low: 503, high: 503 });
    expect(out.matchUncertainty).toBeNull();
  });

  it('leaves a lettered range as written and does not call it uncertain', () => {
    const out = expandHouseNumbers(['100', '100A'], ['100', '100A']);
    expect(out.matchNumbers).toEqual(['100', '100A']);
    expect(out.matchUncertainty).toBeNull();
  });

  it('marks a range with one odd and one even end as mixed parity and does not expand it', () => {
    const out = expandHouseNumbers(['10', '15'], ['10', '15']);
    expect(out.matchNumbers).toEqual(['10', '15']);
    expect(out.matchUncertainty).toBe('mixed_parity');
    expect(out.enclosingLows).toEqual([]);
    expect(out.enclosingHighs).toEqual([]);
  });

  it(`expands a range of exactly ${MAX_RANGE_NUMBERS} numbers and marks a wider one wide_range`, () => {
    const atCap = String(10 + (MAX_RANGE_NUMBERS - 1) * 2);
    expect(expandHouseNumbers(['10', atCap], ['10', atCap]).matchNumbers).toHaveLength(MAX_RANGE_NUMBERS);
    const overCap = String(10 + MAX_RANGE_NUMBERS * 2);
    const wide = expandHouseNumbers(['10', overCap], ['10', overCap]);
    expect(wide.matchNumbers).toEqual(['10', overCap]);
    expect(wide.matchUncertainty).toBe('wide_range');
  });

  it('lists where an enclosing city range would start and end, same parity, nearest first, never below 1', () => {
    const out = expandHouseNumbers(['503'], ['503']);
    expect(out.enclosingLows[0]).toBe('501');
    expect(out.enclosingHighs[0]).toBe('505');
    expect(out.enclosingLows).toHaveLength(ENCLOSING_RANGE_WINDOW / 2);
    expect(out.enclosingHighs.at(-1)).toBe(String(503 + ENCLOSING_RANGE_WINDOW));
    expect(expandHouseNumbers(['5'], ['5']).enclosingLows).toEqual(['3', '1']);
  });
});

describe('buildIdentity range fields', () => {
  it('keeps the as-written numbers for parcel resolution and adds the expanded list for the feeds', () => {
    const id = identity('31-39 Example Rd');
    expect(id.numbers).toEqual(['31', '39']);
    expect(id.matchNumbers).toEqual(['31', '33', '35', '37', '39']);
    expect(id.rangeForm).toBe('31-39');
    expect(id.span).toEqual({ low: 31, high: 39 });
    expect(id.matchUncertainty).toBeNull();
  });

  it('leaves the as-written LIKE forms unchanged, so existing matches are not disturbed', () => {
    const id = identity('31-39 Example Rd');
    expect(id.addressFormsShort).toEqual(['31 EXAMPLE RD', '39 EXAMPLE RD', '31-39 EXAMPLE RD']);
    expect(addressLikeClauses('location', id)).toHaveLength(6);
  });

  it('counts a lettered single number by its digits for the span', () => {
    const id = identity('12A Example Rd');
    expect(id.numbers).toEqual(['12A', '12']);
    expect(id.matchNumbers).toEqual(['12A', '12']);
    expect(id.span).toEqual({ low: 12, high: 12 });
  });
});

describe('houseNumberTokenMatches', () => {
  const single = identity('503 Sample Ave');
  const range = identity('240-252 Test St');

  it('keeps a plain or lettered number: only the exact-number patterns can find those', () => {
    expect(houseNumberTokenMatches('503', single)).toBe(true);
    expect(houseNumberTokenMatches('503A', single)).toBe(true);
    expect(houseNumberTokenMatches(null, single)).toBe(true);
  });

  it('keeps a city range that contains the address on the same side of the street', () => {
    expect(houseNumberTokenMatches('501-507', single)).toBe(true);
    expect(houseNumberTokenMatches('503-505', single)).toBe(true);
  });

  it('drops a city range that starts below the address and ends below it', () => {
    expect(houseNumberTokenMatches('495-501', single)).toBe(false);
  });

  it('drops a city range on the other side of the street', () => {
    expect(houseNumberTokenMatches('502-506', single)).toBe(false);
  });

  it('keeps the address’s own range as written and any range overlapping it', () => {
    expect(houseNumberTokenMatches('240-252', range)).toBe(true);
    expect(houseNumberTokenMatches('244-246', range)).toBe(true);
    expect(houseNumberTokenMatches('230-240', range)).toBe(true);
    expect(houseNumberTokenMatches('230-238', range)).toBe(false);
  });

  it('keeps a number-dash-letter token only when its number is one of the address’s', () => {
    expect(houseNumberTokenMatches('503-A', single)).toBe(true);
    expect(houseNumberTokenMatches('501-A', single)).toBe(false);
  });

  it('reads the leading token of a free-text location', () => {
    expect(leadingToken('501-507 Sample Ave  Boston  MA  02101')).toBe('501-507');
    expect(leadingToken('   ')).toBeNull();
    expect(leadingToken(null)).toBeNull();
  });
});

describe('rangeAddressClause and rangeNumberClause', () => {
  it('builds one regex for every number of a range, any sub-range starting on one, and every street spelling', () => {
    const clause = rangeAddressClause('location', identity('31-39 Example Rd'), { enclosing: false });
    expect(clause).toBe(`upper("location") ~ '^((31|33|35|37|39)(-[0-9]+[A-Z]?)?) (EXAMPLE RD|EXAMPLE ROAD)'`);
  });

  it('adds the enclosing range starts when asked', () => {
    const clause = rangeAddressClause('location', identity('503 Sample Ave'), { enclosing: true });
    expect(clause).toContain(`^((503)(-[0-9]+[A-Z]?)?|(501|499|`);
    expect(clause).toContain(`)-[0-9]+[A-Z]?) (SAMPLE AV|SAMPLE AVE|SAMPLE AVENUE)'`);
  });

  it('never writes a backslash, and skips a street spelling that is not plain text', () => {
    const id = { ...identity('10 Example Rd'), streetForms: ['EXAMPLE RD', 'EXAMPLE (RD)'] };
    const clause = rangeAddressClause('location', id, { enclosing: true });
    expect(clause).not.toContain('\\');
    expect(clause).not.toContain('(RD)');
    expect(rangeAddressClause('location', { ...id, streetForms: ['A|B'] }, { enclosing: true })).toBeNull();
  });

  it('doubles an apostrophe in a street name through sqlLiteral', () => {
    const clause = rangeAddressClause('location', identity("10 O'Example St"), { enclosing: false });
    expect(clause).toContain("O''EXAMPLE ST");
  });

  it('refuses an unsafe column name', () => {
    expect(() => rangeAddressClause('location; drop', identity('10 Example Rd'), { enclosing: false })).toThrow();
    expect(() => rangeNumberClause('Street"', identity('10 Example Rd'), { enclosing: false })).toThrow();
  });

  it('matches a number-only column on ranges that start on or below the address', () => {
    expect(rangeNumberClause('street_number', identity('31-35 Example Rd'), { enclosing: false })).toBe(
      `upper("street_number") ~ '^(31|33|35)[A-Z]?-'`,
    );
    expect(rangeNumberClause('street_number', identity('5 Example Rd'), { enclosing: true })).toBe(
      `upper("street_number") ~ '^(5|3|1)[A-Z]?-'`,
    );
  });
});

describe('violation feeds on range addresses', () => {
  it('match every number of the range on both columns, plus a stored range enclosing it', async () => {
    const fetchImpl = fixtureFetch([]);
    const result = await violationsSource.run(identity('31-35 Example Rd'), fetchImpl);
    expect(result.query).toContain(`"violation_stno" IN ('31','33','35')`);
    expect(result.query).toContain(`"violation_sthigh" IN ('31','33','35')`);
    expect(result.query).toContain(`("violation_stno" IN ('29','27',`);
    expect(result.query).toContain(`AND "violation_sthigh" IN ('37','39',`);
  });

  it('find a single number inside a stored range ("501"/"507" for 503)', async () => {
    const fetchImpl = fixtureFetch([
      {
        resourceId: ENFORCEMENT_RESOURCE_ID,
        records: [
          { case_no: 'CE1', code: 'X', status: 'Closed', status_dttm: '2012-01-01', violation_stno: '501', violation_sthigh: '507', violation_street: 'Sample', violation_suffix: 'AV' },
        ],
      },
    ]);
    const result = await enforcementSource.run(identity('503 Sample Ave'), fetchImpl);
    expect(result.query).toContain(`"violation_stno" IN ('501',`);
    expect(result.query).toContain(`"violation_sthigh" IN ('505','507',`);
    expect(result.rows).toHaveLength(1);
  });

  it('send no enclosing arm for a mixed-parity range', async () => {
    const result = await violationsSource.run(identity('10-15 Example Rd'), fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [] }]));
    expect(result.query).toContain(`("violation_stno" IN ('10','15') OR "violation_sthigh" IN ('10','15'))`);
  });
});

describe('311 on range addresses', () => {
  const legacyId = LEGACY_311_RESOURCES[0].resourceId;

  it('adds the regex arm to every legacy query and the range arm to the new-system query', async () => {
    const result = await serviceRequestsSource.run(identity('31-35 Example Rd'), fixtureFetch([]));
    const queries: string[] = JSON.parse(result.query);
    const legacy = queries.find((q) => q.includes(legacyId))!;
    expect(legacy).toContain(`upper("location") LIKE '31-35 EXAMPLE RD%' ESCAPE '!'`);
    expect(legacy).toContain(`upper("location") ~ '^((31|33|35)(-[0-9]+[A-Z]?)?|(29|27|`);
    const fresh = queries.find((q) => q.includes(NEW_311_RESOURCE_ID))!;
    expect(fresh).toContain(`(upper("street_number") IN ('31','33','35','31-35') OR upper("street_number") ~ '^(31|33|35|29|27|`);
    expect(fresh).toContain('"street_number"');
  });

  it('keeps a legacy request filed under an enclosing range and drops one that ends below the address', async () => {
    const fetchImpl = fixtureFetch([
      {
        resourceId: legacyId,
        records: [
          { case_enquiry_id: '1', open_dt: '2025-01-02', reason: 'Housing', type: 'Heat', location: '501-507 Sample Ave  Boston  MA  02135' },
          { case_enquiry_id: '2', open_dt: '2025-01-03', reason: 'Housing', type: 'Heat', location: '495-501 Sample Ave  Boston  MA  02135' },
          { case_enquiry_id: '3', open_dt: '2025-01-04', reason: 'Housing', type: 'Heat', location: '503 Sample Ave  Boston  MA  02135' },
        ],
      },
    ]);
    const result = await serviceRequestsSource.run(identity('503 Sample Ave'), fetchImpl);
    expect(result.rows.map((r) => r.sourceKey).sort()).toEqual(['1', '3']);
  });

  it('applies the same check to a new-system request by its street number', async () => {
    const fetchImpl = fixtureFetch([
      {
        resourceId: NEW_311_RESOURCE_ID,
        records: [
          { case_id: 'BCS-1', open_date: '2025-02-01', assigned_department: 'Inspectional Services', street_number: '501-507', full_address: '501-507 Sample Ave' },
          { case_id: 'BCS-2', open_date: '2025-02-02', assigned_department: 'Inspectional Services', street_number: '491-499', full_address: '491-499 Sample Ave' },
        ],
      },
    ]);
    const result = await serviceRequestsSource.run(identity('503 Sample Ave'), fetchImpl);
    const payloads = result.rows.map((r) => r.payload as ServiceRequestPayload);
    expect(payloads.map((p) => p.caseId)).toEqual(['BCS-1']);
    expect(Object.keys(payloads[0])).not.toContain('street_number');
  });
});

describe('permits on range addresses', () => {
  it('add the middle numbers but not ranges that start below the address', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: [] }]);
    const result = await permitsSource.run(identity('31-35 Example Rd'), fetchImpl);
    expect(result.query).toContain(`upper("address") ~ '^((31|33|35)(-[0-9]+[A-Z]?)?) (EXAMPLE RD|EXAMPLE ROAD)'`);
    expect(result.query).not.toContain('(29|');
  });
});

describe('the current-year assessor row carries the parcel’s own numbers and ZIP', () => {
  const row = {
    PID: '0100000001', OWNER: 'EXAMPLE OWNER LLC', LU: 'A', LU_DESC: 'APARTMENT', YR_BUILT: '1900', YR_REMODEL: null,
    GROSS_AREA: '100', LIVING_AREA: '90', RES_UNITS: '6', COM_UNITS: null, TOTAL_VALUE: '1,000', LAND_VALUE: '500', BLDG_VALUE: '500',
    ST_NUM: '211', ST_NUM2: '219', ZIP_CODE: '02135',
  };

  it('selects ST_NUM, ST_NUM2 and ZIP_CODE for the current year only', async () => {
    const current = ASSESSOR_YEARS[0];
    const older = ASSESSOR_YEARS[1];
    const id = identity('211 Example Rd', { parcel: '0100000001' });
    const fetchImpl = fixtureFetch([{ resourceId: current.resourceId, records: [row] }, { resourceId: older.resourceId, records: [row] }]);
    const now = await assessorSource(current).run(id, fetchImpl);
    const before = await assessorSource(older).run(id, fetchImpl);
    expect(now.query).toContain('"ST_NUM","ST_NUM2","ZIP_CODE"');
    expect(before.query).not.toContain('ST_NUM');
    const payload = now.rows[0].payload as AssessmentPayload;
    expect(payload).toMatchObject({ parcelStreetNumber: '211', parcelStreetNumberHigh: '219', parcelZip: '02135' });
    expect(before.rows[0].payload).not.toHaveProperty('parcelStreetNumber');
  });
});

describe('recordsMatchUncertainty', () => {
  const parcel = (low: string | null, high: string | null, zip: string | null = '02135') => ({
    parcelStreetNumber: low,
    parcelStreetNumberHigh: high,
    parcelZip: zip,
  });

  it('is null when the address covers the parcel and the ZIPs agree', () => {
    expect(recordsMatchUncertainty({ address: '31-39 Example Rd', zip: '02135', current: parcel('31', '39') })).toBeNull();
    expect(recordsMatchUncertainty({ address: '10 Example Rd', zip: '02135', current: parcel('10', null) })).toBeNull();
  });

  it('reads the address’s own reasons first', () => {
    expect(recordsMatchUncertainty({ address: '10-15 Example Rd', zip: '02135', current: null })).toBe('mixed_parity');
    expect(recordsMatchUncertainty({ address: '10-200 Example Rd', zip: '02135', current: null })).toBe('wide_range');
  });

  it('says parcel_wider when the parcel covers numbers the address does not', () => {
    expect(recordsMatchUncertainty({ address: '211 Example Rd', zip: '02135', current: parcel('211', '219') })).toBe('parcel_wider');
    expect(recordsMatchUncertainty({ address: '36 Example Rd', zip: '02135', current: parcel('40', '36') })).toBe('parcel_wider');
  });

  it('says zip_differs when the page and the parcel disagree on the ZIP, reading a ZIP that lost its zero', () => {
    expect(recordsMatchUncertainty({ address: '501 Sample Ave', zip: '02199', current: parcel('501', null, '2101') })).toBe('zip_differs');
    expect(recordsMatchUncertainty({ address: '501 Sample Ave', zip: '02101', current: parcel('501', null, '2101') })).toBeNull();
  });

  it('names the ZIP before a wider parcel, since a wrong ZIP can hide every number', () => {
    expect(recordsMatchUncertainty({ address: '501 Sample Ave', zip: '02199', current: parcel('501', '507', '02101') })).toBe('zip_differs');
  });

  it('errs toward null when there is nothing stored to compare', () => {
    expect(recordsMatchUncertainty({ address: null, zip: null, current: null })).toBeNull();
    expect(recordsMatchUncertainty({ address: '211 Example Rd', zip: '02135', current: parcel(null, null, null) })).toBeNull();
    expect(recordsMatchUncertainty({ address: 'Example Rd', zip: '02135', current: parcel('1', '9') })).toBeNull();
  });

  it('matches the address reason buildIdentity gives', () => {
    expect(addressMatchUncertainty('10-200 Example Rd')).toBe(identity('10-200 Example Rd').matchUncertainty);
    expect(addressMatchUncertainty('31-39 Example Rd')).toBeNull();
  });
});

describe('the ledger under an uncertain match', () => {
  function status(sourceId: string): SourceStatus {
    return { sourceId, label: 'Source', pageUrl: null, status: 'empty', retrievedAt: 1_770_000_000, errorMessage: null };
  }

  function view(overrides: Partial<BuildingRecordsView>): BuildingRecordsView {
    return {
      pulledAt: 1_770_000_000,
      sources: {
        [NEW_311_RESOURCE_ID]: status(NEW_311_RESOURCE_ID),
        [PERMITS_RESOURCE_ID]: status(PERMITS_RESOURCE_ID),
        [ENFORCEMENT_RESOURCE_ID]: status(ENFORCEMENT_RESOURCE_ID),
        [VIOLATIONS_RESOURCE_ID]: status(VIOLATIONS_RESOURCE_ID),
      },
      assessments: [],
      permits: [],
      violations: [],
      enforcement: [],
      serviceRequests: [],
      rentsmart: [],
      invalidKinds: [],
      corrections: [],
      ...overrides,
    };
  }

  const NOW = new Date('2026-10-27T12:00:00Z');

  it('replaces "none on record" on the address-keyed sources, never on permits', () => {
    const ledger = ledgerModel(view({ matchUncertainty: 'zip_differs' }), NOW);
    for (const section of [
      ledger.living,
      ledger.buildingRequests,
      ledger.upkeepRequests,
      ledger.enforcement,
      ledger.violations,
    ]) {
      expect(section.count).toBe('0');
      expect(section.subCount).toBe(UNCERTAIN_MATCH_SUBCOUNT);
      expect(section.matchNote).toBe(uncertainMatchCopy('zip_differs'));
    }
    expect(ledger.permits.subCount).toBe('none on record');
    expect(ledger.permits.matchNote).toBeNull();
  });

  it('words each 311 group on its own: a group with requests keeps its count, an empty one does not claim none', () => {
    const heat: ServiceRequestPayload = {
      caseId: 'R1', system: 'new', openedAt: '2025-01-02', closedAt: null, status: 'Closed', closureReason: null,
      title: null, subject: 'Inspectional Services', reason: 'Housing', type: 'Heat - Excessive  Insufficient',
      location: null, source: null, classification: 'housing',
    };
    const ledger = ledgerModel(view({ matchUncertainty: 'mixed_parity', serviceRequests: [heat] }), NOW);
    expect(ledger.living.count).toBe('1');
    expect(ledger.living.subCount).toBe('all closed');
    expect(ledger.living.matchNote).toBeNull();
    for (const section of [ledger.buildingRequests, ledger.upkeepRequests]) {
      expect(section.count).toBe('0');
      expect(section.subCount).toBe(UNCERTAIN_MATCH_SUBCOUNT);
      expect(section.matchNote).toBe(uncertainMatchCopy('mixed_parity'));
    }
  });

  it('leaves a section with records alone', () => {
    const violation = {
      caseNumber: 'V1', code: null, value: null, description: null, status: 'Closed', statusDate: '2012-01-01',
      address: null, contactAddress: null, samId: null,
    };
    const ledger = ledgerModel(view({ matchUncertainty: 'parcel_wider', violations: [violation] }), NOW);
    expect(ledger.violations.subCount).toBe('all closed');
    expect(ledger.violations.matchNote).toBeNull();
  });

  it('says "none on record" as before when nothing is uncertain', () => {
    const ledger = ledgerModel(view({ matchUncertainty: null }), NOW);
    expect(ledger.violations.subCount).toBe('none on record');
    expect(ledger.violations.matchNote).toBeNull();
    expect(ledgerModel(view({}), NOW).enforcement.matchNote).toBeNull();
  });

  it('shows a dash, not an uncertain zero, for a source never pulled', () => {
    const ledger = ledgerModel(view({ sources: {}, matchUncertainty: 'wide_range' }), NOW);
    expect(ledger.violations.count).toBe('—');
    expect(ledger.violations.subCount).toBe('');
    expect(ledger.violations.matchNote).toBeNull();
  });
});

describe('uncertain-match copy', () => {
  it('is registered for the banned-words scan', () => {
    expect(PANEL_COPY.UNCERTAIN_MATCH_SUBCOUNT).toBe(UNCERTAIN_MATCH_SUBCOUNT);
    expect(Object.keys(PANEL_COPY).filter((k) => k.startsWith('uncertainMatchCopy()'))).toHaveLength(4);
  });

  it('is short and plain: no em dashes, no exclamation points', () => {
    for (const reason of ['wide_range', 'mixed_parity', 'parcel_wider', 'zip_differs'] as const) {
      const copy = uncertainMatchCopy(reason);
      expect(copy).not.toMatch(/[—!]/);
      expect(copy.startsWith('City records could not be matched to this address with confidence.')).toBe(true);
    }
  });
});

const sqliteSuite = sqliteAvailable ? describe : describe.skip;

sqliteSuite('getBuildingRecords reports an uncertain match from stored data only', () => {
  async function seed(db: TestD1Database, address: string, zip: string, payload: Partial<AssessmentPayload>): Promise<string> {
    const buildingId = await insertBuilding(db, { id: 'bldg-range', address, zip_code: zip });
    const pullId = randomUUID();
    await db
      .prepare(
        'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, retrieved_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(pullId, buildingId, 'boston', ASSESSOR_YEARS[0].resourceId, 'Property Assessment FY2026', 'q', 'ok', 1, null, null, null, 1_770_000_000)
      .run();
    const assessment: AssessmentPayload = {
      fiscalYear: 'FY2026', parcelId: '0100000001', owner: null, mailAddressee: null, mailStreet: null, mailCity: null,
      mailState: null, mailZip: null, landUse: 'A', landUseDescription: null, yearBuilt: null, yearRemodel: null,
      grossArea: null, livingArea: null, residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null,
      buildingValue: null, condominium: false, ...payload,
    };
    await db
      .prepare('INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(randomUUID(), buildingId, pullId, 'assessment', 'FY2026', JSON.stringify(assessment), null)
      .run();
    return buildingId;
  }

  it('reads zip_differs from the page ZIP and the stored parcel ZIP', async () => {
    const db = createRecordsTestDb();
    const id = await seed(db, '501 Sample Ave', '02199', { parcelStreetNumber: '501', parcelZip: '02101' });
    expect((await getBuildingRecords(db, id))!.matchUncertainty).toBe('zip_differs');
  });

  it('reads nothing from an assessment stored before the parcel numbers were captured', async () => {
    const db = createRecordsTestDb();
    const id = await seed(db, '211 Example Rd', '02135', {});
    expect((await getBuildingRecords(db, id))!.matchUncertainty).toBeNull();
  });
});

describe('query size stays under the endpoint URL limit', () => {
  // data.boston.gov answered HTTP 414 at about 8.8 KB of URL and 200 at 4.5 KB (2026-10-27).
  const URL_BUDGET = 8000;

  it('for the widest range that still expands, on a street with three suffix spellings, in every source', async () => {
    const highest = 1000 + (MAX_RANGE_NUMBERS - 1) * 2;
    const id = identity(`1000-${highest} Example Avenue`);
    expect(id.matchNumbers).toHaveLength(MAX_RANGE_NUMBERS);
    const sqls: string[] = [];
    sqls.push(...(JSON.parse((await serviceRequestsSource.run(id, fixtureFetch([]))).query) as string[]));
    sqls.push((await violationsSource.run(id, fixtureFetch([]))).query);
    sqls.push((await enforcementSource.run(id, fixtureFetch([]))).query);
    sqls.push((await permitsSource.run({ ...id, parcelNumeric: '100000001' }, fixtureFetch([]))).query);
    const longest = Math.max(...sqls.map((sql) => `https://data.boston.gov/api/3/action/datastore_search_sql?sql=${encodeURIComponent(sql)}`.length));
    expect(longest).toBeLessThan(URL_BUDGET);
  });
});
