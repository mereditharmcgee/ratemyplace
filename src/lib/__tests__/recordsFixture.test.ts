import { describe, expect, it } from 'vitest';
import { RECORDS_FIXTURE, runRecordsFixture, type FixtureCheck, type FixtureResult } from '../records/fixture';
import { sourcesForCity } from '../records/jurisdictions';
import { SAM_RESOURCE_ID } from '../records/seed/sam';
import { ASSESSOR_YEARS, type AssessorYear } from '../records/sources/boston/assessor';
import { RENTSMART_RESOURCE_ID } from '../records/sources/boston/rentsmart';
import { LEGACY_311_RESOURCES, NEW_311_RESOURCE_ID } from '../records/sources/boston/serviceRequests';
import type { FetchLike } from '../records/types';

/** A fetch that answers every CKAN call with an empty result set. */
const emptyFetch: FetchLike = async () =>
  new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });

/** Every Boston adapter runs for the fixture, so this is the arity both accountings add up to. */
const BOSTON_SOURCE_COUNT = sourcesForCity('Boston').length;

/** Resource id by source label, so a test can single a source out without hardcoding one. */
const SOURCE_ID_BY_LABEL = new Map(sourcesForCity('Boston').map((source) => [source.label, source.id]));

function sourceId(label: string): string {
  const id = SOURCE_ID_BY_LABEL.get(label);
  if (!id) throw new Error(`no Boston source labelled ${label}`);
  return id;
}

const F = RECORDS_FIXTURE;

const PARCEL_CHECK = `parcel resolves to ${F.parcelId}, not a condominium`;
const PARCEL_CHECK_RENTSMART = 'RentSmart answers the parcel query';
const RECENT_CHECK = 'RentSmart has a row from the last 60 days with a ten-digit parcel';
const OWNER_CHECK = `${F.assessment.fiscalYear} owner matches /${F.assessment.owner.source}/`;
const MAIL_CHECK = `${F.assessment.fiscalYear} mail: no addressee, street ${F.assessment.mailStreet}`;
const COMBINED_MAIL_CHECK = `${F.combinedMail.fiscalYear} combined mail address parses to ${F.combinedMail.street}, ${F.combinedMail.city}, ${F.combinedMail.state} ${F.combinedMail.zip}`;
const LAND_USE_CHECK = `${F.assessment.fiscalYear} landUse is ${F.assessment.landUse} (${F.assessment.landUseDescription})`;
const YEARS_CHECK = `${F.assessment.fiscalYear} yearBuilt is ${F.assessment.yearBuilt} and yearRemodel is ${F.assessment.yearRemodel}`;
const TOTAL_VALUE_CHECK = `${F.assessment.fiscalYear} totalValue is ${F.assessment.totalValue}`;
const DOLLAR_TOTAL_CHECK = `${F.dollarFormatted.fiscalYear} totalValue is ${F.dollarFormatted.totalValue} (dollar-formatted year)`;
const YEAR_COUNT_CHECK = `${ASSESSOR_YEARS.length} assessment years present, each with a non-null totalValue`;
const PERMITS_CHECK = `permits: between ${F.permits.min} and ${F.permits.max}, including ${F.permits.knownPermit}`;
const VIOLATIONS_CHECK = `ISD violations: at most ${F.maxViolations}`;
const ENFORCEMENT_CASES_CHECK = `enforcement: all ${F.enforcement.knownCases.length} known cases present, at most ${F.enforcement.maxCases} distinct cases`;
const ENFORCEMENT_DATE_CHECK = `enforcement: ${F.enforcement.datedCase} statusDate starts with ${F.enforcement.datedCaseStatusDate}`;
const ENFORCEMENT_CONTACT_CHECK = `enforcement: every known case has contactAddress ${F.enforcement.contactAddress} and samId ${F.samId}`;
const SR = F.serviceRequests;
const TOTAL_311_CHECK = `311 total >= ${SR.minTotal}`;
const HOUSING_CHECK = `311 housing rows opened ${SR.housing.fromYear}-${SR.housing.toYear} between ${SR.housing.min} and ${SR.housing.max}`;
const EVERY_YEAR_CHECK = `311 rows opened in every year ${SR.everyYear.fromYear}-${SR.everyYear.toYear} whose file has rows`;
const NEW_311_CHECK = `311 new-system rows >= ${SR.minNew}`;
const EMPTIED_CHECK = `311 files emptied since the counts were recorded: at most ${SR.maxEmptiedFiles}`;
const SAM_CHECK = `SAM primary point for the fixture: id ${F.samId}, ${F.neighborhood}, ZIP ${F.zip}, inside Boston`;

/** Every check, in the order the fixture records them. Every building value in a label comes from RECORDS_FIXTURE. */
const EXPECTED_LABELS = [
  PARCEL_CHECK,
  OWNER_CHECK,
  MAIL_CHECK,
  COMBINED_MAIL_CHECK,
  LAND_USE_CHECK,
  YEARS_CHECK,
  TOTAL_VALUE_CHECK,
  DOLLAR_TOTAL_CHECK,
  YEAR_COUNT_CHECK,
  PERMITS_CHECK,
  VIOLATIONS_CHECK,
  ENFORCEMENT_CASES_CHECK,
  ENFORCEMENT_DATE_CHECK,
  ENFORCEMENT_CONTACT_CHECK,
  TOTAL_311_CHECK,
  HOUSING_CHECK,
  EVERY_YEAR_CHECK,
  NEW_311_CHECK,
  EMPTIED_CHECK,
  PARCEL_CHECK_RENTSMART,
  RECENT_CHECK,
  SAM_CHECK,
];

describe('runRecordsFixture', () => {
  it('names the fixture building', () => {
    expect(RECORDS_FIXTURE.parcelId).toBe('1703554000');
    expect(RECORDS_FIXTURE.address).toBe('2262-2266 Dorchester Ave, Boston, MA 02124');
    expect(RECORDS_FIXTURE.zip).toBe('02124');
    expect(RECORDS_FIXTURE.samId).toBe('48562');
  });

  it('returns one check per assertion and counts failures without throwing', async () => {
    const result = await runRecordsFixture(emptyFetch);
    // Every check is recorded even when its source has nothing, so two runs compare label for label.
    expect(result.checks.map((c) => c.label)).toEqual(EXPECTED_LABELS);
    // Empty responses fail every check but five. The ISD violations check is a ceiling, at most
    // a few rows, and zero rows sits under it. Every 311 file answers the empty-file probe with
    // no rows here: the notices name all seventeen, the 311 total and housing floors give back
    // everything recorded, never going below zero, and the every-year and new-system checks skip
    // every file. So many emptied files at once is no single reload, and the emptied-files check
    // fails, so a city-wide 311 wipe still pauses the fill. Every other check needs a parcel id, a
    // row or a count at or above a floor, and an empty city has none.
    const passing = [VIOLATIONS_CHECK, TOTAL_311_CHECK, HOUSING_CHECK, EVERY_YEAR_CHECK, NEW_311_CHECK];
    expect(failedLabels(result)).toEqual(EXPECTED_LABELS.filter((label) => !passing.includes(label)));
    expect(failedLabels(result)).toContain(EMPTIED_CHECK);
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toContain('floor lowered by 200 to 0 for ');
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toContain('floor lowered by 60 to 0 for ');
    expect(result.notices).toHaveLength(LEGACY_311_RESOURCES.length + 1);
    expect(result.failures).toBeGreaterThan(0);
    expect(result.checks.find((c) => c.label === PARCEL_CHECK)?.ok).toBe(false);
    expect(result.parcelId).toBeNull();
    expect(result.condominium).toBe(false);
    // Every source is accounted for exactly once: it either threw or reported a row count.
    // With no parcel id the six assessor sources throw, so the rest are what ran.
    expect(result.sourceErrors.length + Object.keys(result.rowsBySource).length).toBe(BOSTON_SOURCE_COUNT);
    for (const err of result.sourceErrors) expect(result.rowsBySource[err.label]).toBeUndefined();
    expect(Object.values(result.rowsBySource).every((n) => n === 0)).toBe(true);
  });

  it('records every other source when one throws, in source-list order however the answers arrive', async () => {
    const throwing = sourceId('Approved Building Permits');
    const slow = sourceId('311 Service Requests');
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        // Every call yields, and 311 comes back last: the sources run concurrently, so the
        // recorded order has to be the source list's, not the order the answers arrived in.
        await new Promise((resolve) => setTimeout(resolve, url.includes(slow) ? 10 : 1));
        if (url.includes(throwing)) throw new Error('permits down');
        return new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });
      } finally {
        inFlight -= 1;
      }
    };

    const result = await runRecordsFixture(fetchImpl, { sleep: async () => {} });

    // The sources are in flight together, not one after another: the daily breaker should not
    // spend eleven sequential timeouts finding out that data.boston.gov is down.
    expect(maxInFlight).toBeGreaterThan(1);

    expect(result.sourceErrors.find((e) => e.label === 'Approved Building Permits')?.message).toContain(
      'permits down',
    );
    expect(result.checks.find((c) => c.label === PERMITS_CHECK)?.detail).toContain(
      '"Approved Building Permits" source failed to fetch',
    );
    // The one that threw is absent; every other source that could run without a parcel id
    // still recorded its count, and they are in source-list order.
    expect(Object.keys(result.rowsBySource)).toEqual([
      'Building and Property Violations',
      'Public Works Code Enforcement',
      '311 Service Requests',
      'RentSmart',
    ]);
    expect(result.sourceErrors.length + Object.keys(result.rowsBySource).length).toBe(BOSTON_SOURCE_COUNT);
  });

  it('reports a source that throws as a failed check, not an exception', async () => {
    const throwingFetch: FetchLike = async () => {
      throw new Error('boom');
    };
    // The injected no-op sleep skips the SAM fetch's 1s + 4s retry backoff. The retry is
    // wanted in production — a blip at data.boston.gov must not trip the scheduler's
    // breaker — so it is stubbed here rather than given up.
    const result = await runRecordsFixture(throwingFetch, { sleep: async () => {} });
    // RentSmart is the one source that never reaches fetch without a parcel id: it returns
    // an empty result instead of throwing. The other ten all report the fetch failure.
    expect(result.sourceErrors).toHaveLength(BOSTON_SOURCE_COUNT - 1);
    expect(Object.keys(result.rowsBySource)).toEqual(['RentSmart']);
    expect(result.checksFailed).toBeGreaterThan(0);
    expect(result.failures).toBe(result.checksFailed + result.sourceErrors.length);
    expect(result.checks.map((c) => c.label)).toEqual(EXPECTED_LABELS);
    expect(result.checks.find((c) => c.label === PARCEL_CHECK)?.detail).toContain('parcel resolution failed');
    expect(result.checks.find((c) => c.label === VIOLATIONS_CHECK)?.detail).toContain(
      '"Building and Property Violations" source failed to fetch',
    );
    expect(result.checks.find((c) => c.label.startsWith('SAM primary point'))?.detail).toContain('SAM fetch failed');
  });
});

/** 06:00 UTC on 2026-11-14, the planner's hour. Sixty days back is 2026-09-15. */
const PLAN_TIME_MS = Date.UTC(2026, 10, 14, 6);
const WINDOW_START = '2026-09-15';

type CkanRow = Record<string, string | number | null>;

function ckanAnswer(records: CkanRow[]): Response {
  return new Response(JSON.stringify({ success: true, result: { records } }), { status: 200 });
}

function ckanFailure(status: number, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { message } }), { status });
}

/** A recent RentSmart row in the shape the city returns. The parcel id is made up and is no real parcel. */
const RECENT_ROW: CkanRow = { date: '2026-10-28 00:00:00+00', parcel: '1407253000' };

const runOptions = { sleep: async (): Promise<void> => {}, clockMs: () => PLAN_TIME_MS };

function checkNamed(result: FixtureResult, label: string): FixtureCheck | undefined {
  return result.checks.find((c) => c.label === label);
}

// --- A city that answers with the fixture's recorded values ---

/** One answer for a source: rows, or a whole response for a failure. */
type Answer = CkanRow[] | (() => Response);

interface CityAnswers {
  /** What the address resolves to: the whole-building parcel, another parcel id, or only condominium unit rows. */
  resolution: 'parcel' | 'condominium' | { otherParcel: string };
  /** The parcel's row for one fiscal year (or several rows), or null for a year that has no row for it. */
  assessor: (year: AssessorYear) => CkanRow | CkanRow[] | null;
  permits: Answer;
  violations: Answer;
  enforcement: Answer;
  legacy311: (year: number) => CkanRow[];
  new311: Answer;
  /**
   * Whether a whole 311 file (a legacy year, or the new system) answers the fixture's one-row
   * probe with a row: true or false, or a function returning a failed response.
   */
  file311: (file: number | 'new') => boolean | (() => Response);
  sam: Answer;
}

const ENFORCEMENT_ID = sourceId('Public Works Code Enforcement');
const PERMITS_ID = sourceId('Approved Building Permits');
const VIOLATIONS_ID = sourceId('Building and Property Violations');

/**
 * The assessor row for one fiscal year, in that year's own column names and money format:
 * FY2021 writes '$16,721,900.00', the others '15,918,600', and FY2023 has one combined mail
 * column the adapter splits.
 */
function assessorRow(year: AssessorYear): CkanRow {
  const total =
    year.fiscalYear === F.dollarFormatted.fiscalYear
      ? `$${F.dollarFormatted.totalValue.toLocaleString('en-US')}.00`
      : F.assessment.totalValue.toLocaleString('en-US');
  const row: CkanRow = {
    PID: F.parcelId,
    OWNER: 'BOSTON HOUSING AUTHORITY',
    LU: F.assessment.landUse,
    LU_DESC: F.assessment.landUseDescription,
    YR_BUILT: String(F.assessment.yearBuilt),
    YR_REMODEL: String(F.assessment.yearRemodel),
    TOTAL_VALUE: total,
  };
  const mail = F.combinedMail;
  const c = year.columns;
  if (c.mailCombined) row[c.mailCombined] = `${mail.street}, ${mail.city}, ${mail.state} ${mail.zip}`;
  if (c.mailAddressee) row[c.mailAddressee] = null;
  if (c.mailStreet) row[c.mailStreet] = F.assessment.mailStreet;
  if (c.mailCity) row[c.mailCity] = mail.city;
  if (c.mailState) row[c.mailState] = mail.state;
  if (c.mailZip) row[c.mailZip] = mail.zip;
  return row;
}

/** The permit count the fixture expects at the floor, one of them the known permit. */
const PERMIT_ROWS: CkanRow[] = Array.from({ length: F.permits.min }, (_, i) => ({
  permitnumber: i === 0 ? F.permits.knownPermit : `TEST${String(i).padStart(4, '0')}`,
  address: '2262-2266 Dorchester AV',
}));

function enforcementRow(caseNumber: string, contact: string, statusDate: string): CkanRow {
  return {
    case_no: caseNumber,
    code: '16-1',
    status: 'Closed',
    status_dttm: statusDate,
    violation_stno: '2262',
    violation_sthigh: '2266',
    violation_street: 'Dorchester',
    violation_suffix: 'AV',
    contact_addr1: contact,
    sam_id: F.samId,
  };
}

const ENFORCEMENT_ROWS: CkanRow[] = F.enforcement.knownCases.map((caseNumber) =>
  enforcementRow(
    caseNumber,
    F.enforcement.contactAddress,
    caseNumber === F.enforcement.datedCase ? `${F.enforcement.datedCaseStatusDate} 11:44:00` : '2024-04-01 00:00:00',
  ),
);

/** The legacy 311 years whose files the city's 2026-09-18 reload left empty, as on 2026-11-15. */
const CITY_EMPTY_YEARS: readonly number[] = [2011, 2014];

/** The probe the fixture sends each 311 file, to learn whether the whole file has any row. */
const PROBE = 'SELECT "_id" FROM ';

/** What the fixture recorded each legacy 311 file holding for the building, by year. */
const RECORDED_ROWS: Readonly<Partial<Record<number, number>>> = SR.recorded.legacyRows;
const RECORDED_HOUSING: Readonly<Partial<Record<number, number>>> = SR.recorded.legacyHousing;

/**
 * Housing rows the city held for the building outside the housing window on 2026-11-15. The
 * fixture never reads these, but a band that counted them would, so the test city keeps them.
 */
const HOUSING_OUTSIDE_WINDOW_BY_YEAR: Readonly<Partial<Record<number, number>>> = { 2026: 4, 2025: 7 };

/**
 * What a reloaded 2014 file holds for the building in these tests. Nobody knows the real count
 * until the city reloads the file, so this sits among the other years' counts.
 */
const RELOADED_2014 = { rows: 15, housing: 5 };

/**
 * The building's legacy rows for one year in the shape the city held on 2026-11-15: each file's
 * recorded row count, its recorded housing rows first and the rest sanitation. That is 212 legacy
 * rows, 69 of them housing inside the housing window, and with the one new-system row the 213
 * the floors were set against. So a test that loses a large year meets the floors exactly as the
 * live check would, and an unadjusted floor fails it. The `emptyYears` answer with no rows, and a
 * reloaded 2014 holds `RELOADED_2014`.
 */
function legacy311Rows(year: number, emptyYears: readonly number[] = CITY_EMPTY_YEARS): CkanRow[] {
  if (emptyYears.includes(year)) return [];
  const reloaded = year === 2014;
  const count = reloaded ? RELOADED_2014.rows : (RECORDED_ROWS[year] ?? 0);
  const housing = reloaded ? RELOADED_2014.housing : (RECORDED_HOUSING[year] ?? HOUSING_OUTSIDE_WINDOW_BY_YEAR[year] ?? 0);
  return Array.from({ length: count }, (_, i) => ({
    case_enquiry_id: `${year}${String(i).padStart(4, '0')}`,
    open_dt: `${year}-06-01 09:00:00`,
    reason: i < housing ? 'Housing' : 'Sanitation',
    type: 'Test',
    location: '2262 Dorchester Ave  Dorchester  MA  02124',
  }));
}

const NEW_311_ROWS: CkanRow[] = [
  {
    case_id: 'BCS-TEST0001',
    open_date: '2026-10-01 10:00:00',
    assigned_department: 'Parks & Recreation',
    street_number: '2262',
    full_address: '2262 Dorchester Ave, Boston, MA 02124',
  },
];

/** Every 311 row the recorded city holds for the building, legacy and new. */
function cityTotal(emptyYears: readonly number[] = CITY_EMPTY_YEARS, newRows: number = NEW_311_ROWS.length): number {
  return LEGACY_311_RESOURCES.reduce((n, r) => n + legacy311Rows(r.year, emptyYears).length, 0) + newRows;
}

/** The 311 rows of the recorded city, 213 as on 2026-11-15. */
const CITY_311_ROWS = cityTotal();

/** The housing window's years that hold this building's rows in a city with these `emptyYears`. */
function housingYears(emptyYears: readonly number[] = CITY_EMPTY_YEARS): number[] {
  return Array.from({ length: SR.housing.toYear - SR.housing.fromYear + 1 }, (_, i) => SR.housing.fromYear + i).filter(
    (year) => legacy311Rows(year, emptyYears).length > 0,
  );
}

/** Housing rows the recorded city has outside the housing window (2025's and 2026's), which the band never counts. */
const HOUSING_OUTSIDE_WINDOW = LEGACY_311_RESOURCES.filter((r) => r.year < SR.housing.fromYear || r.year > SR.housing.toYear).reduce(
  (n, r) => n + legacy311Rows(r.year).filter((row) => row.reason === 'Housing').length,
  0,
);

/**
 * The recorded city with exactly `count` housing rows opened inside the housing window, spread
 * over its years. Only the reasons change, so the total and every year's rows stay as they are.
 */
function legacy311WithHousing(count: number, emptyYears: readonly number[] = CITY_EMPTY_YEARS): (year: number) => CkanRow[] {
  const years = housingYears(emptyYears);
  return (year) => {
    const rows = legacy311Rows(year, emptyYears);
    const index = years.indexOf(year);
    if (index < 0) return rows;
    const share = Math.floor(count / years.length) + (index < count % years.length ? 1 : 0);
    if (share > rows.length) throw new Error(`${count} housing rows do not fit in ${years.length} years of ${rows.length}`);
    return rows.map((row, i) => ({ ...row, reason: i < share ? 'Housing' : 'Sanitation' }));
  };
}

/** The year the total tests trim: one of the two largest, whose 23 sanitation rows leave room. */
const TRIM_YEAR = 2017;

/**
 * The recorded city cut to `total` 311 rows, counting `newRows` new-system rows, by dropping
 * sanitation rows from `TRIM_YEAR`. Every year keeps rows and the housing count stays as
 * recorded, so only the total moves.
 */
function legacy311WithTotal(
  total: number,
  emptyYears: readonly number[] = CITY_EMPTY_YEARS,
  newRows: number = NEW_311_ROWS.length,
): (year: number) => CkanRow[] {
  const drop = cityTotal(emptyYears, newRows) - total;
  return (year) => {
    const rows = legacy311Rows(year, emptyYears);
    if (year !== TRIM_YEAR) return rows;
    const housing = rows.filter((row) => row.reason === 'Housing').length;
    if (drop < 0 || rows.length - drop < Math.max(housing, 1)) throw new Error(`cannot cut the city to ${total} rows from ${TRIM_YEAR}`);
    return rows.slice(0, rows.length - drop);
  };
}

/** Whether a 311 file has rows in the recorded city with these legacy `emptyYears` and, when `newEmpty`, an empty new-system file. */
function filesWithRows(emptyYears: readonly number[], newEmpty = false): (file: number | 'new') => boolean {
  return (file) => (file === 'new' ? !newEmpty : !emptyYears.includes(file));
}

/** A unit row with a lower SAM id ahead of the primary row: the primary row must still win. */
const SAM_ROWS: CkanRow[] = [
  { SAM_ADDRESS_ID: '48000', RELATIONSHIP_TYPE: '2', PARCEL_ID: F.parcelId, MAILING_NEIGHBORHOOD: F.neighborhood, ZIP_CODE: F.zip, POINT_X: '-71.0671', POINT_Y: '42.2729', UNIT: '1' },
  { SAM_ADDRESS_ID: F.samId, RELATIONSHIP_TYPE: '1', PARCEL_ID: F.parcelId, MAILING_NEIGHBORHOOD: F.neighborhood, ZIP_CODE: F.zip, POINT_X: '-71.0671', POINT_Y: '42.2729', UNIT: null },
];

function respond(answer: Answer): Response {
  return typeof answer === 'function' ? answer() : ckanAnswer(answer);
}

/**
 * Routes each source's query by resource id to rows shaped like the city's, built from the
 * fixture's recorded values. `overrides` replaces one source's answer.
 */
function cityFetch(overrides: Partial<CityAnswers> = {}): FetchLike {
  const answers: CityAnswers = {
    resolution: 'parcel',
    assessor: assessorRow,
    permits: PERMIT_ROWS,
    violations: [],
    enforcement: ENFORCEMENT_ROWS,
    legacy311: (year) => legacy311Rows(year),
    new311: NEW_311_ROWS,
    file311: filesWithRows(CITY_EMPTY_YEARS),
    sam: SAM_ROWS,
    ...overrides,
  };
  return async (input) => {
    const url = new URL(String(input));
    const sql = url.searchParams.get('sql');
    // The SAM fetch is the one datastore_search call; everything else is SQL.
    if (sql === null) return url.searchParams.get('resource_id') === SAM_RESOURCE_ID ? respond(answers.sam) : ckanAnswer([]);
    if (sql.startsWith('SELECT "PID" FROM')) {
      const resolution = answers.resolution;
      if (resolution === 'condominium') return ckanAnswer([]);
      return ckanAnswer([{ PID: resolution === 'parcel' ? F.parcelId : resolution.otherParcel }]);
    }
    // Asked only when no whole-building parcel matched: the address's condominium unit rows.
    if (sql.startsWith('SELECT count(*) AS n FROM')) return ckanAnswer([{ n: answers.resolution === 'condominium' ? 12 : 0 }]);
    if (sql.startsWith(PROBE)) {
      const file = LEGACY_311_RESOURCES.find((r) => sql.includes(r.resourceId));
      const hasRows = answers.file311(file ? file.year : 'new');
      return typeof hasRows === 'function' ? hasRows() : ckanAnswer(hasRows ? [{ _id: 1 }] : []);
    }
    const year = ASSESSOR_YEARS.find((y) => sql.includes(`"${y.resourceId}"`));
    if (year) {
      const row = answers.assessor(year);
      return ckanAnswer(row === null ? [] : Array.isArray(row) ? row : [row]);
    }
    if (sql.includes(PERMITS_ID)) return respond(answers.permits);
    if (sql.includes(VIOLATIONS_ID)) return respond(answers.violations);
    if (sql.includes(ENFORCEMENT_ID)) return respond(answers.enforcement);
    const legacy = LEGACY_311_RESOURCES.find((r) => sql.includes(r.resourceId));
    if (legacy) return ckanAnswer(answers.legacy311(legacy.year));
    if (sql.includes(NEW_311_RESOURCE_ID)) return respond(answers.new311);
    if (sql.includes(RENTSMART_RESOURCE_ID)) return ckanAnswer(sql.includes('WHERE "date" >=') ? [RECENT_ROW] : []);
    return ckanAnswer([]);
  };
}

function failedLabels(result: FixtureResult): string[] {
  return result.checks.filter((c) => !c.ok).map((c) => c.label);
}

/** One change to one fiscal year's assessor row. Null means that year has no row for the parcel. */
type AssessorEdit = (row: CkanRow, year: AssessorYear) => CkanRow | null;

/** Replaces the combined mail column, in a year that has one. */
function withCombinedMail(text: string): AssessorEdit {
  return (row, year) => (year.columns.mailCombined ? { ...row, [year.columns.mailCombined]: text } : row);
}

const PINNED_YEARS: readonly string[] = [F.assessment.fiscalYear, F.combinedMail.fiscalYear, F.dollarFormatted.fiscalYear];

/** The newest assessor year that no single-year check reads, so only the year count sees it. */
const UNPINNED_YEAR = ASSESSOR_YEARS.find((y) => !PINNED_YEARS.includes(y.fiscalYear))?.fiscalYear ?? 'none';

const MAIL = F.combinedMail;

/**
 * Each row changes one value in one year and names the one check that should fail. A
 * check that compares several values gets a row per value, so dropping any one comparison
 * from fixture.ts turns a row green.
 */
const ASSESSOR_EDITS: Array<[string, string, AssessorEdit, string]> = [
  ['the owner is someone else', F.assessment.fiscalYear, (row) => ({ ...row, OWNER: 'SOMEONE ELSE LLC' }), OWNER_CHECK],
  [
    'the mail street is another street',
    F.assessment.fiscalYear,
    (row, year) => (year.columns.mailStreet ? { ...row, [year.columns.mailStreet]: '1 EXAMPLE ST' } : row),
    MAIL_CHECK,
  ],
  ['the combined mail column has no state or ZIP tail', MAIL.fiscalYear, withCombinedMail(MAIL.street), COMBINED_MAIL_CHECK],
  ['the combined mail column names another street', MAIL.fiscalYear, withCombinedMail(`1 EXAMPLE ST, ${MAIL.city}, ${MAIL.state} ${MAIL.zip}`), COMBINED_MAIL_CHECK],
  ['the combined mail column names another city', MAIL.fiscalYear, withCombinedMail(`${MAIL.street}, ELSEWHERE, ${MAIL.state} ${MAIL.zip}`), COMBINED_MAIL_CHECK],
  ['the combined mail column names another state', MAIL.fiscalYear, withCombinedMail(`${MAIL.street}, ${MAIL.city}, ZZ ${MAIL.zip}`), COMBINED_MAIL_CHECK],
  ['the combined mail column names another ZIP', MAIL.fiscalYear, withCombinedMail(`${MAIL.street}, ${MAIL.city}, ${MAIL.state} 00000`), COMBINED_MAIL_CHECK],
  ['the land use code changes', F.assessment.fiscalYear, (row) => ({ ...row, LU: 'R1' }), LAND_USE_CHECK],
  ['the land use description changes', F.assessment.fiscalYear, (row) => ({ ...row, LU_DESC: 'OTHER DESCRIPTION' }), LAND_USE_CHECK],
  ['yearBuilt is off by one', F.assessment.fiscalYear, (row) => ({ ...row, YR_BUILT: String(F.assessment.yearBuilt + 1) }), YEARS_CHECK],
  ['yearRemodel is off by one', F.assessment.fiscalYear, (row) => ({ ...row, YR_REMODEL: String(F.assessment.yearRemodel + 1) }), YEARS_CHECK],
  [
    `the ${F.assessment.fiscalYear} total is off by one`,
    F.assessment.fiscalYear,
    (row) => ({ ...row, TOTAL_VALUE: (F.assessment.totalValue + 1).toLocaleString('en-US') }),
    TOTAL_VALUE_CHECK,
  ],
  [
    `the ${F.dollarFormatted.fiscalYear} dollar-formatted total is off by one`,
    F.dollarFormatted.fiscalYear,
    (row) => ({ ...row, TOTAL_VALUE: `$${(F.dollarFormatted.totalValue + 1).toLocaleString('en-US')}.00` }),
    DOLLAR_TOTAL_CHECK,
  ],
  [`${UNPINNED_YEAR} answers with no row`, UNPINNED_YEAR, () => null, YEAR_COUNT_CHECK],
  [`${UNPINNED_YEAR} has no totalValue`, UNPINNED_YEAR, (row) => ({ ...row, TOTAL_VALUE: null }), YEAR_COUNT_CHECK],
];

describe('runRecordsFixture building checks', () => {
  it('passes every check when the city answers with the recorded values', async () => {
    const result = await runRecordsFixture(cityFetch(), runOptions);
    expect(result.checks.map((c) => c.label)).toEqual(EXPECTED_LABELS);
    expect(failedLabels(result)).toEqual([]);
    expect(result.failures).toBe(0);
    expect(result.sourceErrors).toEqual([]);
    expect(result.parcelId).toBe(F.parcelId);
    expect(result.rowsBySource['Approved Building Permits']).toBe(F.permits.min);
    expect(result.rowsBySource['311 Service Requests']).toBe(213);
    // The city as it stood on 2026-11-15: two empty legacy files, named as notices, and the one
    // inside the every-year window skipped rather than failed. Both held nothing when the counts
    // were recorded, so neither floor is lowered for them.
    expect(result.notices.map((n) => n.label)).toEqual(['311 2014 file has no rows', '311 2011 file has no rows']);
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe(
      'got rows in every year asked for, 213 rows in all; skipped 2014, whose file has no rows',
    );
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toBe('got 213 rows');
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(`got 69 in those years, ${69 + HOUSING_OUTSIDE_WINDOW} housing rows out of 213 in all`);
    expect(checkNamed(result, EMPTIED_CHECK)?.detail).toBe("none of the files that held the building's rows is empty");
    // Only the skipped 2014 is an excuse worth printing on a passing line.
    expect(result.checks.filter((c) => c.note !== undefined).map((c) => [c.label, c.note])).toEqual([
      [EVERY_YEAR_CHECK, 'skipped 2014, whose file has no rows'],
    ]);
  });

  it('sets the 311 floors against the counts it recorded', () => {
    // The test city is the recorded counts, so the floors are as tight here as they are live.
    const recordedTotal = Object.values(RECORDED_ROWS).reduce((n: number, c) => n + (c ?? 0), 0) + SR.recorded.newSystemRows;
    const recordedHousing = Object.values(RECORDED_HOUSING).reduce((n: number, c) => n + (c ?? 0), 0);
    expect(recordedTotal).toBe(CITY_311_ROWS);
    expect(recordedTotal).toBeGreaterThanOrEqual(SR.minTotal);
    expect(recordedHousing).toBeGreaterThanOrEqual(SR.housing.min);
    expect(recordedHousing).toBeLessThanOrEqual(SR.housing.max);
    // Every legacy file the adapter queries has a recorded count, 0 for the two the city emptied.
    expect(Object.keys(RECORDED_ROWS).map(Number).sort()).toEqual(LEGACY_311_RESOURCES.map((r) => r.year).sort());
    for (const year of CITY_EMPTY_YEARS) expect(RECORDED_ROWS[year]).toBe(0);
    // The largest year alone is more than the total's headroom, so the floor has to follow the probe.
    expect(CITY_311_ROWS - Math.max(...Object.values(RECORDED_ROWS).map((c) => c ?? 0))).toBeLessThan(SR.minTotal);
  });

  it('fails the permit check above the ceiling or without the known permit', async () => {
    const tooMany = Array.from({ length: F.permits.max + 1 }, (_, i) => ({ permitnumber: i === 0 ? F.permits.knownPermit : `TEST${i}` }));
    const over = await runRecordsFixture(cityFetch({ permits: tooMany }), runOptions);
    expect(failedLabels(over)).toEqual([PERMITS_CHECK]);
    expect(checkNamed(over, PERMITS_CHECK)?.detail).toBe(`got ${F.permits.max + 1} rows, ${F.permits.knownPermit} present`);

    const withoutKnown = PERMIT_ROWS.map((row, i) => (i === 0 ? { ...row, permitnumber: 'TEST9999' } : row));
    const missing = await runRecordsFixture(cityFetch({ permits: withoutKnown }), runOptions);
    expect(failedLabels(missing)).toEqual([PERMITS_CHECK]);
    expect(checkNamed(missing, PERMITS_CHECK)?.detail).toBe(`got ${F.permits.min} rows, ${F.permits.knownPermit} absent`);
  });

  it('fails the permit check one row under its floor, with the known permit still there', async () => {
    const result = await runRecordsFixture(cityFetch({ permits: PERMIT_ROWS.slice(0, F.permits.min - 1) }), runOptions);
    expect(failedLabels(result)).toEqual([PERMITS_CHECK]);
    expect(checkNamed(result, PERMITS_CHECK)?.detail).toBe(`got ${F.permits.min - 1} rows, ${F.permits.knownPermit} present`);
  });

  it('passes the permit check at its ceiling', async () => {
    // The recorded city sits at the floor, so the floor's own edge is the all-pass test above.
    const atCeiling = Array.from({ length: F.permits.max }, (_, i) => ({ ...PERMIT_ROWS[0], permitnumber: i === 0 ? F.permits.knownPermit : `TEST${i}` }));
    const result = await runRecordsFixture(cityFetch({ permits: atCeiling }), runOptions);
    expect(failedLabels(result)).toEqual([]);
    expect(checkNamed(result, PERMITS_CHECK)?.detail).toBe(`got ${F.permits.max} rows, ${F.permits.knownPermit} present`);
  });

  it('allows a few ISD violations and fails past the ceiling', async () => {
    const violation = (i: number): CkanRow => ({ case_no: `V${i}`, code: '1', status_dttm: '2026-01-01 00:00:00', violation_stno: '2262', violation_street: 'Dorchester' });
    const few = await runRecordsFixture(cityFetch({ violations: Array.from({ length: F.maxViolations }, (_, i) => violation(i)) }), runOptions);
    expect(failedLabels(few)).toEqual([]);

    const many = await runRecordsFixture(cityFetch({ violations: Array.from({ length: F.maxViolations + 1 }, (_, i) => violation(i)) }), runOptions);
    expect(failedLabels(many)).toEqual([VIOLATIONS_CHECK]);
    expect(checkNamed(many, VIOLATIONS_CHECK)?.detail).toBe(`got ${F.maxViolations + 1} rows`);
  });

  it('reads contact and SAM values for the known enforcement cases only, and never prints a new one', async () => {
    const newTicket = enforcementRow('CE999999', '1 EXAMPLE ST', '2026-10-01 00:00:00');
    const result = await runRecordsFixture(cityFetch({ enforcement: [...ENFORCEMENT_ROWS, newTicket] }), runOptions);
    expect(failedLabels(result)).toEqual([]);
    expect(JSON.stringify(result.checks)).not.toContain('1 EXAMPLE ST');
  });

  it.each([
    ['passes at the ceiling', F.enforcement.maxCases, true],
    ['fails one case over it', F.enforcement.maxCases + 1, false],
  ] as Array<[string, number, boolean]>)('the enforcement case count %s', async (_edge, cases, passes) => {
    // The four known cases and enough other cases at the building to reach the count. A street
    // predicate that matched the whole avenue would return hundreds.
    const others = Array.from({ length: cases - ENFORCEMENT_ROWS.length }, (_, i) =>
      enforcementRow(`CE9${String(i).padStart(5, '0')}`, '1 EXAMPLE ST', '2026-10-01 00:00:00'),
    );
    const result = await runRecordsFixture(cityFetch({ enforcement: [...ENFORCEMENT_ROWS, ...others] }), runOptions);
    expect(failedLabels(result)).toEqual(passes ? [] : [ENFORCEMENT_CASES_CHECK]);
    expect(checkNamed(result, ENFORCEMENT_CASES_CHECK)?.detail).toBe(`got ${cases} distinct cases in ${cases} rows`);
  });

  it('fails the case check when a known enforcement case goes missing', async () => {
    const [, ...rest] = ENFORCEMENT_ROWS;
    const result = await runRecordsFixture(cityFetch({ enforcement: rest }), runOptions);
    const missingCase = F.enforcement.knownCases[0];
    // The dated case is the first known case, so its date check fails with it.
    expect(failedLabels(result)).toEqual([ENFORCEMENT_CASES_CHECK, ENFORCEMENT_DATE_CHECK, ENFORCEMENT_CONTACT_CHECK]);
    expect(checkNamed(result, ENFORCEMENT_CASES_CHECK)?.detail).toContain(`missing ${missingCase}`);
  });

  it('fails the date check when the dated enforcement case carries another status date', async () => {
    // One day later, so a check that compared only the year or the month would still pass.
    const nextDay = new Date(Date.parse(`${F.enforcement.datedCaseStatusDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const moved = `${nextDay} 11:44:00`;
    const rows = ENFORCEMENT_ROWS.map((row) => (row.case_no === F.enforcement.datedCase ? { ...row, status_dttm: moved } : row));
    const result = await runRecordsFixture(cityFetch({ enforcement: rows }), runOptions);
    expect(failedLabels(result)).toEqual([ENFORCEMENT_DATE_CHECK]);
    expect(checkNamed(result, ENFORCEMENT_DATE_CHECK)?.detail).toBe(`got statusDates=${JSON.stringify([moved])}`);
  });

  it.each([
    ['contactAddress', { contact_addr1: '1 EXAMPLE ST' }, '1 EXAMPLE ST', F.samId],
    ['samId', { sam_id: '00000' }, F.enforcement.contactAddress, '00000'],
  ] as Array<[string, CkanRow, string, string]>)(
    'fails the contact check when one known enforcement case has another %s',
    async (_field, change, contact, samId) => {
      // One case of the four, so a check that asked whether any case matched would still pass.
      const changed = F.enforcement.knownCases[F.enforcement.knownCases.length - 1];
      const rows = ENFORCEMENT_ROWS.map((row) => (row.case_no === changed ? { ...row, ...change } : row));
      const result = await runRecordsFixture(cityFetch({ enforcement: rows }), runOptions);
      expect(failedLabels(result)).toEqual([ENFORCEMENT_CONTACT_CHECK]);
      expect(checkNamed(result, ENFORCEMENT_CONTACT_CHECK)?.detail).toContain(JSON.stringify([changed, contact, samId]));
    },
  );

  it('says the enforcement source threw in every enforcement check it fails', async () => {
    const result = await runRecordsFixture(cityFetch({ enforcement: () => ckanFailure(500, 'enforcement down') }), runOptions);
    expect(failedLabels(result)).toEqual([ENFORCEMENT_CASES_CHECK, ENFORCEMENT_DATE_CHECK, ENFORCEMENT_CONTACT_CHECK]);
    for (const label of [ENFORCEMENT_CASES_CHECK, ENFORCEMENT_DATE_CHECK, ENFORCEMENT_CONTACT_CHECK]) {
      expect(checkNamed(result, label)?.detail).toContain('"Public Works Code Enforcement" source failed to fetch');
    }
    expect(result.sourceErrors.map((e) => e.label)).toEqual(['Public Works Code Enforcement']);
  });

  it('names the year the building has no rows in while that year\'s file still has rows, though the total still passes', async () => {
    // One of the smallest years, 11 rows, so the total and the housing band stay above their floors.
    const lost = 2022;
    const result = await runRecordsFixture(
      cityFetch({ legacy311: (year) => (year === lost ? [] : legacy311Rows(year)) }),
      runOptions,
    );
    expect(failedLabels(result)).toEqual([EVERY_YEAR_CHECK]);
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe(`no rows opened in ${lost}; skipped 2014, whose file has no rows`);
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toBe(`got ${CITY_311_ROWS - 11} rows`);
  });

  it.each([
    // The largest year: 29 rows, so the total alone would fall to 184.
    [2016, 29, 4],
    // The year the city's own reload could plausibly empty next and that holds the most housing rows.
    [2019, 18, 8],
  ])('skips %i once the city empties its whole file, lowers both floors by what it held, and notes the file', async (emptied, rows, housing) => {
    const emptyYears = [...CITY_EMPTY_YEARS, emptied];
    const result = await runRecordsFixture(
      cityFetch({ legacy311: (year) => legacy311Rows(year, emptyYears), file311: filesWithRows(emptyYears) }),
      runOptions,
    );
    // Against the unadjusted floor this total fails: the floor has to follow the probe.
    expect(CITY_311_ROWS - rows).toBeLessThan(SR.minTotal);
    expect(failedLabels(result)).toEqual([]);
    expect(result.failures).toBe(0);
    expect(result.notices.map((n) => n.label)).toEqual(
      [`311 ${emptied} file has no rows`, '311 2014 file has no rows', '311 2011 file has no rows'],
    );
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toBe(
      `got ${CITY_311_ROWS - rows} rows; floor lowered by ${rows} to ${SR.minTotal - rows} for ${emptied}, whose file has no rows`,
    );
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(
      `got ${69 - housing} in those years, ${69 - housing + HOUSING_OUTSIDE_WINDOW} housing rows out of ${CITY_311_ROWS - rows} in all; ` +
        `floor lowered by ${housing} to ${SR.housing.min - housing} for ${emptied}, whose file has no rows`,
    );
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe(
      `got rows in every year asked for, ${CITY_311_ROWS - rows} rows in all; skipped 2014, ${emptied}, whose files have no rows`,
    );
    expect(checkNamed(result, EMPTIED_CHECK)?.detail).toBe(`1 of the files that held the building's rows has none: ${emptied}`);
    // The same words ride on each passing check as its note, for `npm run records:check` to print.
    expect(checkNamed(result, TOTAL_311_CHECK)?.note).toBe(`floor lowered by ${rows} to ${SR.minTotal - rows} for ${emptied}, whose file has no rows`);
    expect(checkNamed(result, HOUSING_CHECK)?.note).toBe(`floor lowered by ${housing} to ${SR.housing.min - housing} for ${emptied}, whose file has no rows`);
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.note).toBe(`skipped 2014, ${emptied}, whose files have no rows`);
    expect(checkNamed(result, EMPTIED_CHECK)?.note).toBe(checkNamed(result, EMPTIED_CHECK)?.detail);
    expect(checkNamed(result, NEW_311_CHECK)?.note).toBeUndefined();
  });

  it('lowers both floors by what two emptied files held between them', async () => {
    // 2012 and 2013 hold 23 rows and 13 housing rows: either floor alone would fail.
    const emptyYears = [...CITY_EMPTY_YEARS, 2012, 2013];
    const result = await runRecordsFixture(
      cityFetch({ legacy311: (year) => legacy311Rows(year, emptyYears), file311: filesWithRows(emptyYears) }),
      runOptions,
    );
    expect(failedLabels(result)).toEqual([]);
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toBe(
      `got ${CITY_311_ROWS - 23} rows; floor lowered by 23 to ${SR.minTotal - 23} for 2013 (11), 2012 (12), whose files have no rows`,
    );
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(
      `got 56 in those years, ${56 + HOUSING_OUTSIDE_WINDOW} housing rows out of ${CITY_311_ROWS - 23} in all; ` +
        `floor lowered by 13 to ${SR.housing.min - 13} for 2013 (6), 2012 (7), whose files have no rows`,
    );
    // Two emptied files is the most the fill rides out.
    expect(SR.maxEmptiedFiles).toBe(2);
    expect(checkNamed(result, EMPTIED_CHECK)?.detail).toBe("2 of the files that held the building's rows have none: 2013, 2012");
  });

  it.each([
    ['a third legacy file', [2012, 2013, 2015], false, '2015, 2013, 2012'],
    ['the new-system file as the third', [2012, 2013], true, '2013, 2012, new-system'],
  ] as Array<[string, number[], boolean, string]>)(
    'fails only the emptied-files check once %s empties, though every other 311 check excuses it',
    async (_what, years, newEmpty, names) => {
      const emptyYears = [...CITY_EMPTY_YEARS, ...years];
      const result = await runRecordsFixture(
        cityFetch({
          legacy311: (year) => legacy311Rows(year, emptyYears),
          new311: newEmpty ? [] : NEW_311_ROWS,
          file311: filesWithRows(emptyYears, newEmpty),
        }),
        runOptions,
      );
      expect(failedLabels(result)).toEqual([EMPTIED_CHECK]);
      expect(result.failures).toBe(1);
      expect(checkNamed(result, EMPTIED_CHECK)?.detail).toBe(
        `3 of the files that held the building's rows have none: ${names}; more than 2 at once is a wipe or a move to new resource ids, not one reload`,
      );
    },
  );

  it('fails only the emptied-files check when every 311 file is empty, with both floors at zero and no lower', async () => {
    // A city-wide wipe, or 311 moved to new resource ids with the old ones left empty. Every other
    // 311 check excuses every file, and every pull meanwhile replaces stored 311 rows with none,
    // so this one check is what pauses the fill and sends the email.
    const result = await runRecordsFixture(
      cityFetch({ legacy311: () => [], new311: [], file311: () => false }),
      runOptions,
    );
    expect(failedLabels(result)).toEqual([EMPTIED_CHECK]);
    // 213 recorded rows against a floor of 200, and 69 housing rows against 60: each cut stops at the floor.
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toMatch(/^got 0 rows; floor lowered by 200 to 0 for 2026 \(5\), /);
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toMatch(/^got 0 in those years, 0 housing rows out of 0 in all; floor lowered by 60 to 0 for 2024 \(6\), /);
    expect(checkNamed(result, EMPTIED_CHECK)?.detail).toMatch(/^15 of the files that held the building's rows have none: 2026, 2025, .*, 2012, new-system; /);
  });

  it('lowers no floor for a file the empty-file check could not reach, so the same shortfall fails', async () => {
    // The same lost rows as the two-file test above, but the probe never reached those files, so
    // nobody knows the city emptied them: an unknown is not an excuse.
    const lost = [2012, 2013];
    const result = await runRecordsFixture(
      cityFetch({
        legacy311: (year) => legacy311Rows(year, [...CITY_EMPTY_YEARS, ...lost]),
        file311: (file) => (typeof file === 'number' && lost.includes(file) ? () => ckanFailure(500, 'upstream unavailable') : filesWithRows(CITY_EMPTY_YEARS)(file)),
      }),
      runOptions,
    );
    expect(failedLabels(result)).toEqual([TOTAL_311_CHECK, HOUSING_CHECK, EVERY_YEAR_CHECK]);
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toBe(`got ${CITY_311_ROWS - 23} rows`);
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(`got 56 in those years, ${56 + HOUSING_OUTSIDE_WINDOW} housing rows out of ${CITY_311_ROWS - 23} in all`);
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe(
      'no rows opened in 2012, 2013; the empty-file check could not reach 2012, 2013; skipped 2014, whose file has no rows',
    );
  });

  it.each([
    ['passes at the lowered floor', 0, true],
    ['fails one row under it', 1, false],
  ] as Array<[string, number, boolean]>)('with 2016 emptied, the 311 total %s', async (_edge, under, passes) => {
    // The floor drops by exactly the 29 rows 2016 held, not by more.
    const emptyYears = [...CITY_EMPTY_YEARS, 2016];
    const total = SR.minTotal - 29 - under;
    const result = await runRecordsFixture(
      cityFetch({ legacy311: legacy311WithTotal(total, emptyYears), file311: filesWithRows(emptyYears) }),
      runOptions,
    );
    expect(result.rowsBySource['311 Service Requests']).toBe(total);
    expect(failedLabels(result)).toEqual(passes ? [] : [TOTAL_311_CHECK]);
  });

  it.each([
    ['passes at the lowered floor', 0, true],
    ['fails one row under it', 1, false],
  ] as Array<[string, number, boolean]>)('with 2012 and 2013 emptied, the housing band %s', async (_edge, under, passes) => {
    // The floor drops by exactly the 13 housing rows those two years held, not by more.
    const emptyYears = [...CITY_EMPTY_YEARS, 2012, 2013];
    const count = SR.housing.min - 13 - under;
    const result = await runRecordsFixture(
      cityFetch({ legacy311: legacy311WithHousing(count, emptyYears), file311: filesWithRows(emptyYears) }),
      runOptions,
    );
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toMatch(new RegExp(`^got ${count} in those years`));
    expect(failedLabels(result)).toEqual(passes ? [] : [HOUSING_CHECK]);
  });

  it.each([
    ['passes at the ceiling', 0, true],
    ['fails one row over it', 1, false],
  ] as Array<[string, number, boolean]>)('with 2012 and 2013 emptied, the housing ceiling stays put and %s', async (_edge, over, passes) => {
    // Only the floor follows the probe. Emptying two files that held housing rows never lowers the ceiling.
    const emptyYears = [...CITY_EMPTY_YEARS, 2012, 2013];
    const count = SR.housing.max + over;
    const result = await runRecordsFixture(
      cityFetch({ legacy311: legacy311WithHousing(count, emptyYears), file311: filesWithRows(emptyYears) }),
      runOptions,
    );
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toMatch(new RegExp(`^got ${count} in those years`));
    expect(failedLabels(result)).toEqual(passes ? [] : [HOUSING_CHECK]);
  });

  it('skips the new-system check and lowers the total floor when the whole new-system file is empty', async () => {
    // The city sits exactly at the total floor with its one new-system row, then loses that file,
    // so the total passes only because the floor gives back the row the file held.
    const result = await runRecordsFixture(
      cityFetch({ legacy311: legacy311WithTotal(SR.minTotal), new311: [], file311: filesWithRows(CITY_EMPTY_YEARS, true) }),
      runOptions,
    );
    expect(failedLabels(result)).toEqual([]);
    expect(result.notices.map((n) => n.label)).toEqual(['311 2014 file has no rows', '311 2011 file has no rows', '311 new-system file has no rows']);
    expect(checkNamed(result, NEW_311_CHECK)?.detail).toBe('got 0 new-system rows; skipped, because the new-system file has no rows');
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toBe(
      `got ${SR.minTotal - 1} rows; floor lowered by 1 to ${SR.minTotal - 1} for new-system, whose file has no rows`,
    );
    // The new-system file held no housing rows inside the window, so the housing floor stays put.
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(
      `got 69 in those years, ${69 + HOUSING_OUTSIDE_WINDOW} housing rows out of ${SR.minTotal - 1} in all`,
    );
    expect(checkNamed(result, HOUSING_CHECK)?.note).toBeUndefined();
    expect(checkNamed(result, NEW_311_CHECK)?.note).toBe('skipped, because the new-system file has no rows');

    const under = await runRecordsFixture(
      cityFetch({ legacy311: legacy311WithTotal(SR.minTotal - 1), new311: [], file311: filesWithRows(CITY_EMPTY_YEARS, true) }),
      runOptions,
    );
    expect(failedLabels(under)).toEqual([TOTAL_311_CHECK]);
  });

  it('holds the building to the new-system check when the empty-file check could not reach that file', async () => {
    const result = await runRecordsFixture(
      cityFetch({ new311: [], file311: (file) => (file === 'new' ? () => ckanFailure(500, 'upstream unavailable') : filesWithRows(CITY_EMPTY_YEARS)(file)) }),
      runOptions,
    );
    expect(failedLabels(result)).toEqual([NEW_311_CHECK]);
    expect(checkNamed(result, NEW_311_CHECK)?.detail).toBe('got 0 new-system rows; the empty-file check could not reach the new-system file');
    expect(checkNamed(result, TOTAL_311_CHECK)?.detail).toBe(`got ${CITY_311_ROWS - 1} rows`);
  });

  it('asks a file again once after a failed probe, and counts it checked when the second try answers', async () => {
    const probes: string[] = [];
    const pauses: number[] = [];
    let tries2014 = 0;
    const city = cityFetch({
      // 2014's file is empty, and its first probe fails: without the second try the every-year
      // check could not excuse 2014 and would fail for the morning.
      file311: (file) => {
        if (file !== 2014) return filesWithRows(CITY_EMPTY_YEARS)(file);
        tries2014 += 1;
        return tries2014 === 1 ? () => ckanFailure(502, 'bad gateway') : false;
      },
    });
    const fetchImpl: FetchLike = async (input, init) => {
      const sql = new URL(String(input)).searchParams.get('sql') ?? '';
      if (sql.startsWith(PROBE)) probes.push(sql);
      return city(input, init);
    };
    const result = await runRecordsFixture(fetchImpl, {
      ...runOptions,
      sleep: async (ms) => {
        pauses.push(ms);
      },
    });
    expect(failedLabels(result)).toEqual([]);
    expect(result.notices.map((n) => n.label)).toEqual(['311 2014 file has no rows', '311 2011 file has no rows']);
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe('got rows in every year asked for, 213 rows in all; skipped 2014, whose file has no rows');
    // The second try goes out a second later and before the next file, so the probe stays one
    // request at a time.
    const ids = [...LEGACY_311_RESOURCES.map((r) => r.resourceId), NEW_311_RESOURCE_ID];
    const id2014 = LEGACY_311_RESOURCES.find((r) => r.year === 2014)?.resourceId;
    expect(probes).toEqual(ids.flatMap((id) => (id === id2014 ? [id, id] : [id])).map((id) => `SELECT "_id" FROM "${id}" LIMIT 1`));
    expect(pauses).toEqual([1000]);
  });

  it('counts a file unchecked only when both tries fail', async () => {
    let tries2014 = 0;
    const result = await runRecordsFixture(
      cityFetch({
        file311: (file) => {
          if (file !== 2014) return filesWithRows(CITY_EMPTY_YEARS)(file);
          tries2014 += 1;
          return () => ckanFailure(502, 'bad gateway');
        },
      }),
      runOptions,
    );
    expect(tries2014).toBe(2);
    expect(failedLabels(result)).toEqual([EVERY_YEAR_CHECK]);
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe('no rows opened in 2014; the empty-file check could not reach 2014');
    expect(result.notices.map((n) => n.label)).toEqual(['311 2011 file has no rows', '311 empty-file check incomplete']);
    expect(result.notices[1].detail).toBe('could not check 2014: HTTP 502: {"message":"bad gateway"}');
  });

  it('stops retrying once two files in a row fail both tries, so a city that is down costs one try per file', async () => {
    const probes: string[] = [];
    const pauses: number[] = [];
    const city = cityFetch({ file311: () => () => ckanFailure(504, 'gateway timeout') });
    const fetchImpl: FetchLike = async (input, init) => {
      const sql = new URL(String(input)).searchParams.get('sql') ?? '';
      if (sql.startsWith(PROBE)) probes.push(sql);
      return city(input, init);
    };
    const result = await runRecordsFixture(fetchImpl, { ...runOptions, sleep: async (ms) => { pauses.push(ms); } });
    const files = LEGACY_311_RESOURCES.length + 1;
    // Two tries for each of the first two files, then one for each of the other fifteen.
    expect(probes).toHaveLength(2 * 2 + (files - 2));
    expect(pauses).toEqual([1000, 1000]);
    expect(result.notices.map((n) => n.label)).toEqual(['311 empty-file check incomplete']);
  });

  it('asks twice again once a file answers after a run of failures', async () => {
    const tries = new Map<number | 'new', number>();
    const down = [2026, 2025, 2024];
    const result = await runRecordsFixture(
      cityFetch({
        file311: (file) => {
          const n = (tries.get(file) ?? 0) + 1;
          tries.set(file, n);
          if (typeof file === 'number' && down.includes(file)) return () => ckanFailure(504, 'gateway timeout');
          // 2022 blips once: by then 2023 has answered, so the second try is back and catches it.
          if (file === 2022 && n === 1) return () => ckanFailure(502, 'bad gateway');
          return filesWithRows(CITY_EMPTY_YEARS)(file);
        },
      }),
      runOptions,
    );
    expect([2026, 2025, 2024, 2023, 2022].map((year) => tries.get(year))).toEqual([2, 2, 1, 1, 2]);
    expect(result.notices.find((n) => n.label === '311 empty-file check incomplete')?.detail).toContain('could not check 2026, 2025, 2024:');
  });

  it('checks 2014 again once the city reloads its file', async () => {
    const reloaded = (file: number | 'new'): boolean => file === 'new' || file !== 2011;

    const withRows = await runRecordsFixture(
      cityFetch({ legacy311: (year) => legacy311Rows(year, [2011]), file311: reloaded }),
      runOptions,
    );
    expect(failedLabels(withRows)).toEqual([]);
    expect(withRows.notices.map((n) => n.label)).toEqual(['311 2011 file has no rows']);
    expect(checkNamed(withRows, EVERY_YEAR_CHECK)?.detail).toBe(`got rows in every year asked for, ${CITY_311_ROWS + RELOADED_2014.rows} rows in all`);

    // The file is back but this building's 2014 rows are not: the query lost them.
    const withoutRows = await runRecordsFixture(cityFetch({ file311: reloaded }), runOptions);
    expect(failedLabels(withoutRows)).toEqual([EVERY_YEAR_CHECK]);
    expect(checkNamed(withoutRows, EVERY_YEAR_CHECK)?.detail).toBe('no rows opened in 2014');
  });

  it('holds a year the empty-file check could not reach, and says so', async () => {
    // 2014 is empty for the building and unknown for the city; 2019 is unknown for the city but
    // has the building's rows, so only 2014 fails.
    const unreachable = [2014, 2019];
    const result = await runRecordsFixture(
      cityFetch({
        file311: (file) =>
          typeof file === 'number' && unreachable.includes(file)
            ? () => ckanFailure(500, 'upstream unavailable')
            : file === 'new' || !CITY_EMPTY_YEARS.includes(file),
      }),
      runOptions,
    );
    expect(failedLabels(result)).toEqual([EVERY_YEAR_CHECK]);
    expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe('no rows opened in 2014; the empty-file check could not reach 2014');
    expect(result.notices.map((n) => n.label)).toEqual(['311 2011 file has no rows', '311 empty-file check incomplete']);
    expect(result.notices[1].detail).toContain('2019, 2014');
  });

  it.each([SR.everyYear.fromYear, SR.everyYear.toYear])(
    'holds %i, an edge of the every-year window, to the check',
    async (lost) => {
      // Both edge years are small (12 and 7 rows), so the total and the housing band still pass.
      const result = await runRecordsFixture(
        cityFetch({ legacy311: (year) => (year === lost ? [] : legacy311Rows(year)) }),
        runOptions,
      );
      expect(failedLabels(result)).toEqual([EVERY_YEAR_CHECK]);
      expect(checkNamed(result, EVERY_YEAR_CHECK)?.detail).toBe(`no rows opened in ${lost}; skipped 2014, whose file has no rows`);
    },
  );

  it.each([
    // The file for the year before the window is back, but nothing in it is this building's.
    [
      SR.everyYear.fromYear - 1,
      {
        file311: (file: number | 'new') => file === 'new' || file === SR.everyYear.fromYear - 1 || !CITY_EMPTY_YEARS.includes(file),
      },
    ],
    // The file for the year after the window still has rows, but this building's were all opened a year earlier.
    [
      SR.everyYear.toYear + 1,
      {
        legacy311: (year: number) =>
          year === SR.everyYear.toYear + 1
            ? legacy311Rows(year).map((row) => ({ ...row, open_dt: `${SR.everyYear.toYear}-06-01 09:00:00` }))
            : legacy311Rows(year),
      },
    ],
  ] as Array<[number, Partial<CityAnswers>]>)('never asks for %i, just outside the every-year window', async (_outside, change) => {
    const result = await runRecordsFixture(cityFetch(change), runOptions);
    expect(failedLabels(result)).toEqual([]);
    expect(result.rowsBySource['311 Service Requests']).toBe(CITY_311_ROWS);
  });

  it('says the 311 source threw in every 311 check it fails', async () => {
    // The empty-file probe still finds rows in every file but 2011 and 2014, so the every-year
    // check holds the building to each year and fails on all of them.
    const result = await runRecordsFixture(cityFetch({ new311: () => ckanFailure(500, '311 down') }), runOptions);
    expect(failedLabels(result)).toEqual([TOTAL_311_CHECK, HOUSING_CHECK, EVERY_YEAR_CHECK, NEW_311_CHECK]);
    for (const label of [TOTAL_311_CHECK, HOUSING_CHECK, EVERY_YEAR_CHECK, NEW_311_CHECK]) {
      expect(checkNamed(result, label)?.detail).toContain('"311 Service Requests" source failed to fetch');
    }
    expect(result.sourceErrors.map((e) => e.label)).toEqual(['311 Service Requests']);
  });

  it('fails the housing band when other reasons are counted as housing', async () => {
    const allHousing = (year: number): CkanRow[] => legacy311Rows(year).map((row) => ({ ...row, reason: 'Housing' }));
    const result = await runRecordsFixture(cityFetch({ legacy311: allHousing }), runOptions);
    const housingCheck = result.checks.find((c) => c.label.startsWith('311 housing rows'));
    expect(housingCheck?.ok).toBe(false);
    expect(failedLabels(result)).toEqual([housingCheck?.label]);
  });

  it('fails the housing band below its floor when no 311 row has a housing reason', async () => {
    const noHousing = (year: number): CkanRow[] => legacy311Rows(year).map((row) => ({ ...row, reason: 'Sanitation' }));
    const result = await runRecordsFixture(cityFetch({ legacy311: noHousing }), runOptions);
    expect(failedLabels(result)).toEqual([HOUSING_CHECK]);
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(`got 0 in those years, 0 housing rows out of ${CITY_311_ROWS} in all`);
  });

  it.each([
    ['fails one row under its floor', SR.housing.min - 1, false],
    ['passes at its floor', SR.housing.min, true],
    ['passes at its ceiling', SR.housing.max, true],
    ['fails one row over its ceiling', SR.housing.max + 1, false],
  ] as Array<[string, number, boolean]>)('the housing band %s', async (_edge, count, passes) => {
    const result = await runRecordsFixture(cityFetch({ legacy311: legacy311WithHousing(count) }), runOptions);
    expect(failedLabels(result)).toEqual(passes ? [] : [HOUSING_CHECK]);
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(
      `got ${count} in those years, ${count + HOUSING_OUTSIDE_WINDOW} housing rows out of ${CITY_311_ROWS} in all`,
    );
  });

  it('never counts a housing row opened just outside the housing window', async () => {
    // At the ceiling, with the housing rows of 2025 and 2026 and a reloaded 2011 file of housing
    // rows for this building: a band that counted any of those years would go over.
    const before = SR.housing.fromYear - 1;
    const housingBefore = legacy311Rows(SR.housing.fromYear).map((row, i) => ({
      ...row,
      case_enquiry_id: `${before}${String(i).padStart(4, '0')}`,
      open_dt: `${before}-06-01 09:00:00`,
      reason: 'Housing',
    }));
    const atCeiling = legacy311WithHousing(SR.housing.max);
    const result = await runRecordsFixture(
      cityFetch({
        legacy311: (year) => (year === before ? housingBefore : atCeiling(year)),
        file311: (file) => file === 'new' || file === before || !CITY_EMPTY_YEARS.includes(file),
      }),
      runOptions,
    );
    expect(HOUSING_OUTSIDE_WINDOW).toBeGreaterThan(0);
    expect(failedLabels(result)).toEqual([]);
    expect(checkNamed(result, HOUSING_CHECK)?.detail).toBe(
      `got ${SR.housing.max} in those years, ${SR.housing.max + HOUSING_OUTSIDE_WINDOW + housingBefore.length} housing rows out of ${CITY_311_ROWS + housingBefore.length} in all`,
    );
  });

  it('passes the 311 total at its floor and fails it one row under, with every year still present', async () => {
    // Only sanitation rows are dropped, from one large year, so every year keeps rows and the
    // housing band stays as recorded: the total moves and nothing else.
    const cityWithTotal = (total: number): FetchLike => cityFetch({ legacy311: legacy311WithTotal(total) });

    const atFloor = await runRecordsFixture(cityWithTotal(SR.minTotal), runOptions);
    expect(atFloor.rowsBySource['311 Service Requests']).toBe(SR.minTotal);
    expect(failedLabels(atFloor)).toEqual([]);

    const under = await runRecordsFixture(cityWithTotal(SR.minTotal - 1), runOptions);
    expect(under.rowsBySource['311 Service Requests']).toBe(SR.minTotal - 1);
    expect(failedLabels(under)).toEqual([TOTAL_311_CHECK]);
    expect(checkNamed(under, TOTAL_311_CHECK)?.detail).toBe(`got ${SR.minTotal - 1} rows`);
  });

  it('fails the new-system check when the new 311 feed has no row for the building', async () => {
    // The legacy years still answer, so the total and every-year checks hold.
    const result = await runRecordsFixture(cityFetch({ new311: [] }), runOptions);
    expect(failedLabels(result)).toEqual([NEW_311_CHECK]);
    expect(checkNamed(result, NEW_311_CHECK)?.detail).toBe('got 0 new-system rows');
  });

  it('fails the mail check when an addressee appears, without quoting it', async () => {
    const withAddressee = (year: AssessorYear): CkanRow => {
      const row = assessorRow(year);
      if (year.fiscalYear === F.assessment.fiscalYear && year.columns.mailAddressee) row[year.columns.mailAddressee] = 'C/O SOMEONE';
      return row;
    };
    const result = await runRecordsFixture(cityFetch({ assessor: withAddressee }), runOptions);
    expect(failedLabels(result)).toEqual([MAIL_CHECK]);
    expect(checkNamed(result, MAIL_CHECK)?.detail).toBe(`got addressee present, mailStreet=${JSON.stringify(F.assessment.mailStreet)}`);
    expect(JSON.stringify(result.checks)).not.toContain('SOMEONE');
  });

  it.each(ASSESSOR_EDITS)('fails only that assessor check when %s', async (_what, fiscalYear, edit, label) => {
    const assessor = (year: AssessorYear): CkanRow | null => {
      const row = assessorRow(year);
      return year.fiscalYear === fiscalYear ? edit(row, year) : row;
    };
    const result = await runRecordsFixture(cityFetch({ assessor }), runOptions);
    expect(failedLabels(result)).toEqual([label]);
    expect(result.sourceErrors).toEqual([]);
  });

  it('fails the SAM check when only a unit row comes back', async () => {
    const result = await runRecordsFixture(cityFetch({ sam: SAM_ROWS.slice(0, 1) }), runOptions);
    expect(failedLabels(result)).toEqual([EXPECTED_LABELS[EXPECTED_LABELS.length - 1]]);
  });

  /**
   * Each row changes one value on every SAM row. The neighborhood, the ZIP and the northern
   * edge reach the fixture's own comparison: the primary point still wins and is printed. The
   * other three edges are also the edges of the SAM index's Boston box, which drops the point
   * before the fixture sees it, so those rows pin the outcome rather than the fixture's bound.
   */
  it.each([
    ['another neighborhood', { MAILING_NEIGHBORHOOD: 'Roxbury' }, true],
    ['another ZIP', { ZIP_CODE: '02125' }, true],
    ['a latitude on the northern bound', { POINT_Y: '42.4' }, true],
    ['a latitude on the southern bound', { POINT_Y: '42.2' }, false],
    ['a longitude on the western bound', { POINT_X: '-71.2' }, false],
    ['a longitude on the eastern bound', { POINT_X: '-70.9' }, false],
  ] as Array<[string, CkanRow, boolean]>)('fails only the SAM check when the point has %s', async (_what, change, kept) => {
    const result = await runRecordsFixture(cityFetch({ sam: SAM_ROWS.map((row) => ({ ...row, ...change })) }), runOptions);
    expect(failedLabels(result)).toEqual([SAM_CHECK]);
    const detail = checkNamed(result, SAM_CHECK)?.detail;
    if (kept) expect(detail).toContain(`"samId":"${F.samId}"`);
    else expect(detail).toBe(`got null from ${SAM_ROWS.length} SAM rows`);
  });

  it('fails only the parcel check when the address resolves to another ten-digit parcel', async () => {
    // Ward 99 does not exist, so this parcel id is nobody's. Every other source in the test city
    // answers by resource, not by parcel, so the parcel comparison is the one thing that can fail.
    const other = '9999999999';
    const result = await runRecordsFixture(cityFetch({ resolution: { otherParcel: other } }), runOptions);
    expect(result.parcelId).toBe(other);
    expect(failedLabels(result)).toEqual([PARCEL_CHECK]);
    expect(checkNamed(result, PARCEL_CHECK)?.detail).toBe(`got parcelId=${other} condominium=false`);
  });

  it('fails the parcel check when the address resolves only to condominium units', async () => {
    const result = await runRecordsFixture(cityFetch({ resolution: 'condominium' }), runOptions);
    expect(result.condominium).toBe(true);
    expect(result.parcelId).toBeNull();
    expect(checkNamed(result, PARCEL_CHECK)?.detail).toBe('got parcelId=null condominium=true');
    // A condominium is an answer, not an error: the current assessor year reports it and the
    // older years and RentSmart skip, so no source throws.
    expect(result.sourceErrors).toEqual([]);
    // With no whole-building parcel, every assessor check and the RentSmart parcel check fail
    // too. The address-keyed sources and SAM, which is filtered by the recorded parcel, still pass.
    expect(failedLabels(result)).toEqual([
      PARCEL_CHECK,
      OWNER_CHECK,
      MAIL_CHECK,
      COMBINED_MAIL_CHECK,
      LAND_USE_CHECK,
      YEARS_CHECK,
      TOTAL_VALUE_CHECK,
      DOLLAR_TOTAL_CHECK,
      YEAR_COUNT_CHECK,
      PARCEL_CHECK_RENTSMART,
    ]);
  });

  it('counts one assessment per year when the city answers a year with two rows for the parcel', async () => {
    // A parcel with two buildings answers a row per building. The adapter keeps the first and
    // stamps the year itself, so the row count and the distinct-year count cannot drift apart
    // through anything the city sends; this is the one answer that would separate them.
    const assessor = (year: AssessorYear): CkanRow[] =>
      year.fiscalYear === UNPINNED_YEAR ? [assessorRow(year), assessorRow(year)] : [assessorRow(year)];
    const result = await runRecordsFixture(cityFetch({ assessor }), runOptions);
    expect(failedLabels(result)).toEqual([]);
    expect(checkNamed(result, YEAR_COUNT_CHECK)?.detail).toBe(
      `got ${ASSESSOR_YEARS.length} rows across years [${ASSESSOR_YEARS.map((y) => y.fiscalYear).sort().join(', ')}]`,
    );
  });
});

interface RentSmartAnswers {
  /** The adapter's own query, `WHERE "parcel" IN (...)`. */
  parcel: () => Response;
  /** The fixture's city-wide query on the same resource, `WHERE "date" >= ...`. */
  recent: () => Response;
}

/**
 * Resolves the fixture parcel, then routes the two RentSmart queries to `answers`. Every other
 * call gets an empty result, so only the RentSmart checks are under test. Each RentSmart SQL
 * statement is recorded in `seen`.
 */
function rentSmartFetch(answers: RentSmartAnswers, seen: string[] = []): FetchLike {
  return async (input) => {
    const sql = new URL(String(input)).searchParams.get('sql') ?? '';
    if (sql.startsWith('SELECT "PID"')) return ckanAnswer([{ PID: RECORDS_FIXTURE.parcelId }]);
    if (sql.includes(RENTSMART_RESOURCE_ID)) {
      seen.push(sql);
      if (sql.includes('WHERE "parcel" IN')) return answers.parcel();
      if (sql.includes('WHERE "date" >=')) return answers.recent();
    }
    return ckanAnswer([]);
  };
}

function rentSmartChecks(result: FixtureResult): FixtureCheck[] {
  return result.checks.filter((c) => c.label.startsWith('RentSmart'));
}

describe('runRecordsFixture RentSmart checks', () => {
  it('passes when the fixture parcel has no rows but the source answers and has recent rows', async () => {
    // A RentSmart reload can drop any parcel's rows while the source still answers, so a rule
    // that one parcel has rows would pause the fill for nothing.
    const seen: string[] = [];
    const result = await runRecordsFixture(
      rentSmartFetch({ parcel: () => ckanAnswer([]), recent: () => ckanAnswer([RECENT_ROW]) }, seen),
      runOptions,
    );

    expect(rentSmartChecks(result).map((c) => [c.label, c.ok])).toEqual([
      [PARCEL_CHECK_RENTSMART, true],
      [RECENT_CHECK, true],
    ]);
    expect(checkNamed(result, PARCEL_CHECK_RENTSMART)?.detail).toBe(`got 0 rows for parcel ${RECORDS_FIXTURE.parcelId}`);
    expect(result.rowsBySource.RentSmart).toBe(0);
    expect(result.sourceErrors.find((e) => e.label === 'RentSmart')).toBeUndefined();

    // Both queries go to the same resource. The city-wide one asks for rows from the window's
    // first day on, quoted the way the adapter quotes its parcel ids.
    const recentSql = seen.find((sql) => sql.includes('WHERE "date" >='));
    expect(recentSql).toContain(`FROM "${RENTSMART_RESOURCE_ID}"`);
    expect(recentSql).toContain(`"date" >= '${WINDOW_START}'`);
    expect(seen.some((sql) => sql.includes(`"parcel" IN ('${RECORDS_FIXTURE.parcelId}')`))).toBe(true);
  });

  it('still passes when the fixture parcel has rows', async () => {
    const result = await runRecordsFixture(
      rentSmartFetch({
        parcel: () => ckanAnswer([{ _id: 7, date: '2026-07-01 00:00:00+00', violation_type: 'Housing Complaints', parcel: RECORDS_FIXTURE.parcelId }]),
        recent: () => ckanAnswer([RECENT_ROW]),
      }),
      runOptions,
    );
    expect(rentSmartChecks(result).every((c) => c.ok)).toBe(true);
    expect(result.rowsBySource.RentSmart).toBe(1);
  });

  it('fails when the parcel query throws, even with recent rows city-wide', async () => {
    const result = await runRecordsFixture(
      rentSmartFetch({ parcel: () => ckanFailure(500, 'parcel query broke'), recent: () => ckanAnswer([RECENT_ROW]) }),
      runOptions,
    );
    const parcelCheck = checkNamed(result, PARCEL_CHECK_RENTSMART);
    expect(parcelCheck?.ok).toBe(false);
    expect(parcelCheck?.detail).toContain('"RentSmart" source failed to fetch');
    expect(result.sourceErrors.find((e) => e.label === 'RentSmart')?.message).toContain('parcel query broke');
    expect(result.rowsBySource.RentSmart).toBeUndefined();
    expect(result.failures).toBeGreaterThan(0);
  });

  it('fails the parcel check when there is no parcel to query', async () => {
    // With no parcel the adapter returns no rows without asking the city. That is not an answer.
    const result = await runRecordsFixture(emptyFetch, runOptions);
    const parcelCheck = checkNamed(result, PARCEL_CHECK_RENTSMART);
    expect(parcelCheck?.ok).toBe(false);
    expect(parcelCheck?.detail).toBe('no parcel id, so the parcel query never ran');
  });

  it.each([
    ['returns no rows', [], `no rows dated on or after ${WINDOW_START}`],
    [
      'returns a row older than the window',
      [{ date: '2026-09-14 00:00:00+00', parcel: '1407253000' }],
      `newest row dated 2026-09-14 00:00:00+00, parcel 1407253000 (window starts ${WINDOW_START})`,
    ],
    [
      'returns a row whose parcel is not ten digits',
      [{ date: '2026-10-28 00:00:00+00', parcel: '1407253000_' }],
      `newest row dated 2026-10-28 00:00:00+00, parcel 1407253000_ (window starts ${WINDOW_START})`,
    ],
    [
      'returns a row with no date',
      [{ date: null, parcel: '1407253000' }],
      `newest row dated none, parcel 1407253000 (window starts ${WINDOW_START})`,
    ],
  ] as Array<[string, CkanRow[], string]>)('fails when the city-wide query %s', async (_case, rows, detail) => {
    const result = await runRecordsFixture(
      rentSmartFetch({ parcel: () => ckanAnswer([]), recent: () => ckanAnswer(rows) }),
      runOptions,
    );
    expect(checkNamed(result, PARCEL_CHECK_RENTSMART)?.ok).toBe(true);
    const recentCheck = checkNamed(result, RECENT_CHECK);
    expect(recentCheck?.ok).toBe(false);
    expect(recentCheck?.detail).toBe(detail);
  });

  it('fails when the city-wide query throws, and counts that failure once', async () => {
    const result = await runRecordsFixture(
      rentSmartFetch({ parcel: () => ckanAnswer([]), recent: () => ckanFailure(502, 'portal down') }),
      runOptions,
    );
    const recentCheck = checkNamed(result, RECENT_CHECK);
    expect(recentCheck?.ok).toBe(false);
    expect(recentCheck?.detail).toContain('RentSmart recent-rows query failed');
    expect(recentCheck?.detail).toContain('portal down');
    // The parcel query answered, so RentSmart is not a source that threw: the failed check is
    // the one place this failure is counted, as with the SAM check.
    expect(result.sourceErrors.find((e) => e.label === 'RentSmart')).toBeUndefined();
    expect(result.rowsBySource.RentSmart).toBe(0);
  });
});

/**
 * The city's 2026-09-18 reload left the 2011 and 2014 legacy 311 files empty: same ids, schema
 * intact, zero rows. An empty file fails no query, so no check noticed. The fixture now asks each
 * 311 file for one row and reports an empty one as a notice. A notice is never a failure: a
 * failed check pauses the fill every morning, and the fill should not wait on a reload only the
 * city can do. The 311 checks read the same probe to skip an empty file or lower a floor by what
 * it held (see the building checks above). Only the emptied-files check fails on the probe, and
 * only once more files are empty than one reload explains.
 */
describe('runRecordsFixture 311 empty-file notices', () => {
  function legacyId(year: number): string {
    const resource = LEGACY_311_RESOURCES.find((r) => r.year === year);
    if (!resource) throw new Error(`no legacy 311 resource for ${year}`);
    return resource.resourceId;
  }

  /** Resolves the parcel and answers each 311 probe with one row, except the `empty` ids (none) and `failing` ids (HTTP 500). */
  function probeFetch(options: { empty?: string[]; failing?: string[] } = {}, probes: string[] = []): FetchLike {
    return async (input) => {
      const sql = new URL(String(input)).searchParams.get('sql') ?? '';
      if (sql.startsWith('SELECT "PID"')) return ckanAnswer([{ PID: F.parcelId }]);
      if (sql.startsWith(PROBE)) {
        probes.push(sql);
        if (options.failing?.some((id) => sql.includes(id))) return ckanFailure(500, 'upstream unavailable');
        return ckanAnswer(options.empty?.some((id) => sql.includes(id)) ? [] : [{ _id: 1 }]);
      }
      return ckanAnswer([]);
    };
  }

  it('has no notices when every 311 file answers with a row', async () => {
    const result = await runRecordsFixture(probeFetch(), runOptions);
    expect(result.notices).toEqual([]);
  });

  it('notes each legacy 311 file that answers with no rows, newest first', async () => {
    const result = await runRecordsFixture(probeFetch({ empty: [legacyId(2011), legacyId(2014)] }), runOptions);
    expect(result.notices.map((n) => n.label)).toEqual(['311 2014 file has no rows', '311 2011 file has no rows']);
    expect(result.notices[0].detail).toContain(legacyId(2014));
    expect(result.notices[0].detail).toContain('lacks 2014');
    // An empty file is not always the city's to reload: 311 moved to new ids is ours to repoint.
    expect(result.notices[0].detail).toContain('may have moved it to a new resource id the adapter has to be pointed at');
  });

  it('notes an empty new-system file the same way', async () => {
    const result = await runRecordsFixture(probeFetch({ empty: [NEW_311_RESOURCE_ID] }), runOptions);
    expect(result.notices.map((n) => n.label)).toEqual(['311 new-system file has no rows']);
    expect(result.notices[0].detail).toContain(NEW_311_RESOURCE_ID);
  });

  it('never counts a notice as a failure', async () => {
    const clean = await runRecordsFixture(probeFetch(), runOptions);
    const empty = await runRecordsFixture(probeFetch({ empty: [legacyId(2011), legacyId(2014)] }), runOptions);
    expect(empty.failures).toBe(clean.failures);
    expect(empty.checksFailed).toBe(clean.checksFailed);
    expect(empty.checks.map((c) => c.label)).toEqual(clean.checks.map((c) => c.label));
    expect(empty.sourceErrors).toEqual(clean.sourceErrors);
  });

  it('says in one notice which files it could not check, and adds no failure', async () => {
    // A city that holds the building's rows in every file the probe cannot reach, so an unknown
    // file costs nothing: 2020, 2019, 2018 and the new system have the building's rows, and 2011
    // is outside every check's window. Four unreached files that held rows, three of them legacy
    // files, are more than the emptied-file cap allows, so this also pins that an unreached file
    // counts toward no limit. The probe still finds 2014 empty and says so.
    const unreachable: Array<number | 'new'> = [2020, 2019, 2018, 2011, 'new'];
    const result = await runRecordsFixture(
      cityFetch({
        file311: (file) => (unreachable.includes(file) ? () => ckanFailure(500, 'upstream unavailable') : filesWithRows(CITY_EMPTY_YEARS)(file)),
      }),
      runOptions,
    );
    expect(result.notices.map((n) => n.label)).toEqual(['311 2014 file has no rows', '311 empty-file check incomplete']);
    expect(result.notices[1].detail).toContain('could not check 2020, 2019, 2018, 2011, new-system');
    expect(result.notices[1].detail).toContain('HTTP 500');
    expect(checkNamed(result, EMPTIED_CHECK)?.detail).toBe("none of the files that held the building's rows is empty");
    expect(failedLabels(result)).toEqual([]);
    expect(result.failures).toBe(0);
  });

  it('asks each of the seventeen 311 files for one row, one file at a time', async () => {
    const probes: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const answer = probeFetch({}, probes);
    const fetchImpl: FetchLike = async (input, init) => {
      const probing = (new URL(String(input)).searchParams.get('sql') ?? '').startsWith(PROBE);
      if (!probing) return answer(input, init);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await answer(input, init);
      } finally {
        inFlight -= 1;
      }
    };
    await runRecordsFixture(fetchImpl, runOptions);
    const ids = [...LEGACY_311_RESOURCES.map((r) => r.resourceId), NEW_311_RESOURCE_ID];
    expect(probes).toEqual(ids.map((id) => `SELECT "_id" FROM "${id}" LIMIT 1`));
    expect(maxInFlight).toBe(1);
  });
});
