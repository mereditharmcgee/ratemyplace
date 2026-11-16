import { FETCH_TIMEOUT_MS, ckanSql, fetchAllRows, sqlLiteral, textOrNull } from './ckan';
import { buildIdentity } from './identity';
import { sourcesForCity } from './jurisdictions';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel } from './seed/sam';
import type { SamRow } from './seed/types';
import { ASSESSOR_YEARS, resolveParcel } from './sources/boston/assessor';
import { RENTSMART_RESOURCE_ID } from './sources/boston/rentsmart';
import { LEGACY_311_RESOURCES, NEW_311_RESOURCE_ID } from './sources/boston/serviceRequests';
import type {
  AssessmentPayload,
  BuildingIdentity,
  EnforcementTicketPayload,
  FetchLike,
  PermitPayload,
  RecordRow,
  ServiceRequestPayload,
} from './types';

export interface FixtureCheck {
  label: string;
  ok: boolean;
  detail: string;
  /**
   * What the 311 empty-file probe excused for this check that morning: a lowered floor, the files
   * a check skipped, or the files counted as emptied. Set only on a 311 check that excused
   * something, and also part of `detail`. The alert email shows a failed check's detail and the
   * admin panel only its label, and neither shows a passing check, so `npm run records:check`
   * prints this on a passing line. Counts, years and file names only.
   */
  note?: string;
}

/**
 * Something the fixture saw that a human should know about but that must never pause the fill.
 * Notices are not checks: they are never counted in `checksFailed` or `failures`, which is the
 * only number the breaker reads.
 */
export interface FixtureNotice {
  label: string;
  detail: string;
}

export interface FixtureOptions {
  /** Per-request timeout for the direct SAM fetch; defaults to `FETCH_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injected so tests exercise the SAM and 311 probe retries without waiting out the pauses. */
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch; defaults to `Date.now`. Injected so tests pin the RentSmart window. */
  clockMs?: () => number;
}

export interface FixtureResult {
  checks: FixtureCheck[];
  /** Checks that came back not-ok. Reported separately from `failures` so a caller can say "N checks failed, M sources threw". */
  checksFailed: number;
  /** `checksFailed` plus `sourceErrors.length` — the one number that decides pass/fail. */
  failures: number;
  /** Sources whose run() threw, by label. A thrown source is a failure in its own right. */
  sourceErrors: Array<{ label: string; message: string }>;
  /** Row count per source label, for the sources that ran. A source that threw is absent, not zero. */
  rowsBySource: Record<string, number>;
  /** Report-only findings, such as a 311 file the city left empty. Never part of `failures`. */
  notices: FixtureNotice[];
  parcelId: string | null;
  condominium: boolean;
}

/**
 * 2262-2266 Dorchester Ave, Dorchester: a Boston Housing Authority apartment building, and the
 * one address every Boston adapter is verified against live. The owner is a public body, so
 * nothing the checks compare or print names a private person or company. Every building value
 * in a check label comes from here. The values were recorded from data.boston.gov on 2026-11-15.
 *
 * The assessor checks read closed fiscal-year snapshots, so a later sale or renovation lands
 * in later years and leaves them alone.
 */
export const RECORDS_FIXTURE = {
  address: '2262-2266 Dorchester Ave, Boston, MA 02124',
  zip: '02124',
  parcelId: '1703554000',
  samId: '48562',
  neighborhood: 'Dorchester',
  assessment: {
    fiscalYear: 'FY2026',
    /** A prefix, because the city writes the authority as both BOSTON HOUSING AUTHORITY and BOSTON HOUSING AUTH. */
    owner: /^BOSTON HOUSING AUTH/,
    /** The authority's mail goes to the building itself, with no addressee line. */
    mailStreet: '2262 DORCHESTER AVE',
    landUse: 'E',
    landUseDescription: 'BOS HOUSING AUTHOR',
    yearBuilt: 1972,
    yearRemodel: 2011,
    totalValue: 15918600,
  },
  /** The one year that stores the whole mailing address in a single column the adapter splits. */
  combinedMail: { fiscalYear: 'FY2023', street: '2262 DORCHESTER AVE', city: 'DORCHESTER', state: 'MA', zip: '02124' },
  /** A year whose money columns read '$16,721,900.00'. */
  dollarFormatted: { fiscalYear: 'FY2021', totalValue: 16721900 },
  /**
   * Permit history only grows, but the city does sometimes drop a duplicate row, so the floor
   * sits a little under the 25 rows seen on 2026-11-15. The ceiling catches a query that matches
   * other buildings' permits. The known permit is the building's one permit with no applicant
   * on file, so the number printed in every run leads to no person.
   */
  permits: { min: 20, max: 100, knownPermit: 'E1674709' },
  /** None on 2026-11-15. A broken street or number predicate returns hundreds. */
  maxViolations: 5,
  enforcement: {
    /** Closed cases stay in the feed, so these four should stay too. */
    knownCases: ['CE296063', 'CE600761', 'CE668385', 'CE751131'],
    maxCases: 30,
    datedCase: 'CE296063',
    datedCaseStatusDate: '2016-04-19',
    contactAddress: '2262 DORCHESTER AVE',
  },
  serviceRequests: {
    /**
     * What each 311 file held for this building on 2026-11-15, counted from the adapter's own
     * output. The floors below were set against these counts. When the empty-file probe finds a
     * file with no rows, the total floor and the housing floor are each lowered by what that file
     * held here, because a file only the city can reload must not pause the fill. Past
     * `maxEmptiedFiles` such files the emptied-files check fails instead. A file the probe could
     * not reach lowers nothing: an unknown is not an excuse. The 2011 and 2014 files were already
     * empty, so they read 0 and lower nothing, and a file missing from this list lowers nothing
     * either. The current legacy year and the new-system file still grow, so their counts are
     * what a floor gives back when that file is empty, not values a run must match.
     */
    recorded: {
      /** Every row per legacy file, whatever its reason. */
      legacyRows: {
        2026: 5, 2025: 7, 2024: 18, 2023: 20, 2022: 11, 2021: 13, 2020: 11, 2019: 18,
        2018: 12, 2017: 29, 2016: 29, 2015: 16, 2014: 0, 2013: 11, 2012: 12, 2011: 0,
      },
      /** Housing rows per legacy file, for the years inside the housing window. */
      legacyHousing: {
        2024: 6, 2023: 6, 2022: 6, 2021: 5, 2020: 8, 2019: 8, 2018: 4, 2017: 6, 2016: 4,
        2015: 3, 2014: 0, 2013: 6, 2012: 7,
      },
      /** The new-system file's rows. None was opened inside the housing window. */
      newSystemRows: 1,
    },
    /**
     * 213 rows were recorded, so losing 14 or more of them fails this, unless the probe finds the
     * files they were in empty and the floor is lowered by what those files held.
     */
    minTotal: 200,
    /**
     * A closed window of years, so the band moves only if classification changes. Recorded while
     * the city's 2014 file was empty (69 on 2026-11-15). The other years in the window hold 3 to 8
     * housing rows each here, so a reloaded 2014 should land inside the band. The ceiling is never
     * lowered: it is there to catch other reasons counted as housing.
     */
    housing: { fromYear: 2012, toYear: 2024, min: 60, max: 80 },
    /**
     * Every year in this window must hold a row for the building, except a year whose whole
     * legacy file answers with no rows that morning (2014 on 2026-11-15). The fixture asks the
     * city which files are empty, so a reloaded year is held to the check again with no edit here.
     */
    everyYear: { fromYear: 2012, toYear: 2025 },
    /**
     * This floor rests on one case. On 2026-11-15 the new-system resource held a single row for
     * this building, a case opened 2026-10-13, so the check has no headroom: if the city merges,
     * moves or drops that case, the check fails while nothing is broken. Read a failure here as
     * possible data movement first, and re-check the count once more cases arrive. A new-system
     * file that answers with no rows at all is the city's to fix, like an empty legacy file, so
     * the check is skipped that morning rather than failed.
     */
    minNew: 1,
    /**
     * How many 311 files that held the building's rows may answer with no rows before the fill
     * waits. A reload that empties a file or two is the city's to fix, and the checks above
     * excuse it. Many at once looks like a wipe, or the city moving 311 to new resource ids and
     * leaving the old ones empty, which is ours to fix in `LEGACY_311_RESOURCES`. Every pull in
     * the meantime replaces a building's stored 311 rows with none, so past this the check fails,
     * which pauses the fill and sends the email.
     */
    maxEmptiedFiles: 2,
  },
} as const;

function assessmentRows(rows: RecordRow[]): AssessmentPayload[] {
  return rows.filter((r) => r.kind === 'assessment').map((r) => r.payload);
}

function permitRows(rows: RecordRow[]): PermitPayload[] {
  return rows.filter((r) => r.kind === 'permit').map((r) => r.payload);
}

function enforcementRows(rows: RecordRow[]): EnforcementTicketPayload[] {
  return rows.filter((r) => r.kind === 'enforcement_ticket').map((r) => r.payload);
}

function serviceRequestRows(rows: RecordRow[]): ServiceRequestPayload[] {
  return rows.filter((r) => r.kind === 'service_request').map((r) => r.payload);
}

/** The calendar year a 311 row was opened, from the leading digits of its timestamp text. */
function openedYear(row: ServiceRequestPayload): number | null {
  const year = row.openedAt ? /^\d{4}/.exec(row.openedAt)?.[0] : undefined;
  return year ? Number.parseInt(year, 10) : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * How recent the newest RentSmart row in the whole resource has to be. The city's 2026-11-13
 * reload carried rows up to the day before, so sixty days is room for a slow stretch of
 * publishing, not a target.
 */
export const RENTSMART_RECENT_DAYS = 60;

const DAY_MS = 86_400_000;

type CkanRow = Record<string, string | number | null>;

/**
 * The newest RentSmart row dated on or after `since` (YYYY-MM-DD), anywhere in the city. The
 * same resource, the same `ckanSql` helper and the same quoting as the adapter. Interpolation
 * invariant: `since` is computed from the clock, never taken from input, and still passes
 * through `sqlLiteral`; the resource id and column names are code constants. The `date` column
 * is text ('2026-11-12 00:00:00+00'), so `>=` against an ISO day compares correctly.
 *
 * Never rejects, so it can run alongside the sources and be awaited later.
 */
async function newestRentSmartRow(since: string, fetchImpl: FetchLike): Promise<{ rows: CkanRow[] } | { error: string }> {
  const sql =
    `SELECT "date","parcel" FROM "${RENTSMART_RESOURCE_ID}" ` +
    `WHERE "date" >= ${sqlLiteral(since)} ORDER BY "date" DESC LIMIT 1`;
  try {
    return { rows: await ckanSql<CkanRow>(sql, fetchImpl) };
  } catch (err) {
    return { error: messageOf(err) };
  }
}

/**
 * Every 311 file the adapter queries: the legacy years newest first, then the new system. `year`
 * is the legacy file's calendar year, and null for the new system, which spans years.
 */
const SERVICE_REQUEST_FILES: ReadonlyArray<{ name: string; lacks: string; resourceId: string; year: number | null }> = [
  ...LEGACY_311_RESOURCES.map((r) => ({ name: String(r.year), lacks: String(r.year), resourceId: r.resourceId, year: r.year })),
  { name: 'new-system', lacks: 'every new-system request', resourceId: NEW_311_RESOURCE_ID, year: null },
];

/** What the one-row probe of every 311 file found. */
interface ServiceRequestFileProbe {
  /** A notice per file that answered with no rows, then one naming the files the probe could not reach. */
  notices: FixtureNotice[];
  /** Legacy years whose whole file answered with no rows. */
  emptyYears: ReadonlySet<number>;
  /** Legacy years whose file the probe could not reach, so nobody knows whether it is empty. */
  uncheckedYears: ReadonlySet<number>;
  /** Whether the whole new-system file answered with no rows. */
  newSystemEmpty: boolean;
  /** Whether the probe could not reach the new-system file, so nobody knows whether it is empty. */
  newSystemUnchecked: boolean;
}

/** Tries per file, the first included. A second try one second later rides out a single blip. */
const PROBE_ATTEMPTS = 2;
const PROBE_RETRY_DELAY_MS = 1_000;
/**
 * Files in a row that failed both tries before the probe stops retrying. Past it the city is
 * down, not blipping, so each later file gets one try until one answers, and a hung city costs
 * one timeout per file rather than two.
 */
const PROBE_FAILURES_BEFORE_ONE_TRY = 2;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks each 311 file for one row. Each file that has none becomes a notice, and is returned so
 * the 311 checks can skip it or lower their floors by what it held. The city's 2026-09-18 reload
 * left the 2011 and 2014 files empty (same ids, schema intact), which fails nothing: every query
 * answers, with zero rows. The fixture building's own rows cannot tell an emptied file from a
 * query that lost the building, because both look like a year with no rows; one row from the
 * whole file can. A notice is not a failure, so a file only the city can reload never pauses the
 * fill. The same holds for the new-system file. Only the emptied-files check counts them: it
 * fails once more than `maxEmptiedFiles` files that held the building's rows are empty.
 *
 * One file at a time, so the city sees seventeen one-row queries in a row rather than a burst on
 * top of the eleven sources. A file whose query fails is asked once more, a second later and
 * before the next file, and only a file that fails both times is reported as unchecked. An
 * unchecked file excuses nothing, so without the second try one blip on an empty file would fail
 * a check for the morning. Once two files in a row have failed both tries the city is down, so
 * each later file gets one try until one answers and the retry comes back. A hung city then
 * costs one timeout per file after the first two, which keeps the breaker's email from waiting
 * on a second round of timeouts.
 * Interpolation invariant: the resource ids are code constants from `serviceRequests.ts` and
 * nothing else is interpolated. Never rejects; the files it could not check are reported once,
 * in one notice.
 */
async function probeServiceRequestFiles(fetchImpl: FetchLike, sleep: (ms: number) => Promise<void>): Promise<ServiceRequestFileProbe> {
  const notices: FixtureNotice[] = [];
  const emptyYears = new Set<number>();
  const uncheckedYears = new Set<number>();
  let newSystemEmpty = false;
  let newSystemUnchecked = false;
  const unchecked: string[] = [];
  let firstError: string | null = null;
  let failedInARow = 0;
  for (const file of SERVICE_REQUEST_FILES) {
    const tries = failedInARow >= PROBE_FAILURES_BEFORE_ONE_TRY ? 1 : PROBE_ATTEMPTS;
    let rows: CkanRow[] | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= tries && rows === null; attempt += 1) {
      try {
        if (attempt > 1) await sleep(PROBE_RETRY_DELAY_MS);
        rows = await ckanSql<CkanRow>(`SELECT "_id" FROM "${file.resourceId}" LIMIT 1`, fetchImpl);
      } catch (err) {
        lastError = err;
      }
    }
    if (rows === null) {
      failedInARow += 1;
      if (file.year !== null) uncheckedYears.add(file.year);
      else newSystemUnchecked = true;
      unchecked.push(file.name);
      firstError ??= messageOf(lastError);
      continue;
    }
    failedInARow = 0;
    if (rows.length === 0) {
      if (file.year !== null) emptyYears.add(file.year);
      else newSystemEmpty = true;
      notices.push({
        label: `311 ${file.name} file has no rows`,
        detail:
          `resource ${file.resourceId} answered with no rows, so every building's 311 history lacks ${file.lacks} ` +
          'until it has rows again: the city may be reloading it, or may have moved it to a new resource id the adapter has to be pointed at',
      });
    }
  }
  if (unchecked.length > 0) {
    notices.push({ label: '311 empty-file check incomplete', detail: `could not check ${unchecked.join(', ')}: ${firstError}` });
  }
  return { notices, emptyYears, uncheckedYears, newSystemEmpty, newSystemUnchecked };
}

/** What one 311 file held for the fixture building when its counts were recorded, by its name in notices. */
interface RecordedFile {
  name: string;
  rows: number;
}

/**
 * The recorded files the probe found empty that held rows for the building, legacy years newest
 * first and then the new system. A file recorded at 0, or missing from the record, held nothing
 * the floors counted on, so it is left out.
 */
function emptiedFiles(
  files: ServiceRequestFileProbe,
  legacy: Readonly<Partial<Record<number, number>>>,
  newSystem: number,
): RecordedFile[] {
  const emptied: RecordedFile[] = [];
  for (const resource of LEGACY_311_RESOURCES) {
    const rows = legacy[resource.year] ?? 0;
    if (files.emptyYears.has(resource.year) && rows > 0) emptied.push({ name: String(resource.year), rows });
  }
  if (files.newSystemEmpty && newSystem > 0) emptied.push({ name: 'new-system', rows: newSystem });
  return emptied;
}

/**
 * A floor lowered by what the emptied files held, never below zero, and the words that say so.
 * The note is null when nothing was lowered, so a morning with no newly emptied file reads as it
 * always has.
 */
function lowerFloor(floor: number, emptied: readonly RecordedFile[]): { floor: number; note: string | null } {
  const by = Math.min(floor, emptied.reduce((n, f) => n + f.rows, 0));
  if (by === 0) return { floor, note: null };
  const which = emptied.length === 1 ? `${emptied[0].name}, whose file has` : `${emptied.map((f) => `${f.name} (${f.rows})`).join(', ')}, whose files have`;
  return { floor: floor - by, note: `floor lowered by ${by} to ${floor - by} for ${which} no rows` };
}

/**
 * Runs every Boston source for the records fixture and compares the results to the values in
 * `RECORDS_FIXTURE`. Never throws: a source that fails becomes a failed check.
 * Used by `npm run records:check` (prints) and by the scheduler's daily circuit breaker.
 *
 * Every check is recorded unconditionally. A check whose prerequisite is missing is a
 * recorded failure carrying the reason, never a skipped check, so two runs compare label
 * for label. The 311 checks do excuse a file the empty-file probe found empty, and record the
 * check as passed when the rest holds, with what they excused in its detail and note.
 *
 * No check reads a permit's applicant, description or comments, or a 311 closure reason.
 * Those free-text fields name private people and companies, and a failed check's detail lands
 * in the alert email, with its label on the admin panel.
 */
export async function runRecordsFixture(fetchImpl: FetchLike, options: FixtureOptions = {}): Promise<FixtureResult> {
  const checks: FixtureCheck[] = [];
  const sourceErrors: FixtureResult['sourceErrors'] = [];
  const check = (label: string, ok: boolean, detail: string, note: string | null = null): void => {
    checks.push(note === null ? { label, ok, detail } : { label, ok, detail, note });
  };

  const identity: BuildingIdentity = buildIdentity({
    id: 'fixture',
    address: RECORDS_FIXTURE.address,
    city: 'Boston',
    state: 'MA',
    zip_code: RECORDS_FIXTURE.zip,
    parcel_id: null,
    sam_id: null,
  });

  // A thrown resolution is reported as the failed "parcel resolves" check below; the rest
  // of the checks still run, against an identity that never got a parcel id.
  let resolutionError: string | null = null;
  try {
    const resolution = await resolveParcel(identity, fetchImpl);
    identity.parcelId = resolution.parcelId;
    identity.parcelNumeric = resolution.parcelId ? String(Number.parseInt(resolution.parcelId, 10)) : null;
    identity.condominium = resolution.condominium;
  } catch (err) {
    resolutionError = messageOf(err);
  }

  const rowsBySourceLabel = new Map<string, RecordRow[]>();
  const failedSourceLabels = new Map<string, string>();
  const allRows: RecordRow[] = [];

  // The eleven sources run together. They are independent queries against one host for one
  // address, and the daily breaker calls this: run in sequence, a data.boston.gov outage
  // costs eleven consecutive 10s timeouts before the alert can say so. Each source's throw is
  // caught inside its own task, so `Promise.all` never rejects and no rejection goes unhandled.
  //
  // Results are applied AFTERWARDS, walking the source list in order, so `sourceErrors`,
  // `allRows` and the insertion order of `rowsBySource` read the same on every run whatever
  // order the responses arrived in. Two fixture runs have to compare label for label.
  //
  // The city-wide RentSmart query and the 311 empty-file probe start with them for the same
  // reason. Each catches its own failures, so nothing rejects while it waits to be awaited.
  // The probe is awaited at the 311 checks, which read the files it found empty.
  const rentsmartSince = new Date((options.clockMs ?? Date.now)() - RENTSMART_RECENT_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const newestRentSmart = newestRentSmartRow(rentsmartSince, fetchImpl);
  const serviceRequestFiles = probeServiceRequestFiles(fetchImpl, options.sleep ?? defaultSleep);
  const sources = sourcesForCity('Boston');
  const settled = await Promise.all(
    sources.map(async (source): Promise<{ rows: RecordRow[] } | { error: string }> => {
      try {
        return { rows: (await source.run(identity, fetchImpl)).rows };
      } catch (err) {
        return { error: messageOf(err) };
      }
    }),
  );
  sources.forEach((source, index) => {
    const result = settled[index];
    if ('error' in result) {
      failedSourceLabels.set(source.label, result.error);
      sourceErrors.push({ label: source.label, message: result.error });
      return;
    }
    rowsBySourceLabel.set(source.label, result.rows);
    allRows.push(...result.rows);
  });

  /**
   * Rows for a source that returned successfully — 0 rows for a source that never ran
   * would be a false pass for an upper-bound check, so a check that a count stays at or
   * below a ceiling must use this, not a bare `?? []` off rowsBySourceLabel.
   */
  function rowsForOrFail(label: string, checkLabel: string): RecordRow[] | null {
    const failure = failedSourceLabels.get(label);
    if (failure) {
      check(checkLabel, false, `"${label}" source failed to fetch: ${failure}`);
      return null;
    }
    return rowsBySourceLabel.get(label) ?? [];
  }

  /** Appended to a detail whose check can fail because its source threw, so the email says so. */
  function sourceFailureSuffix(label: string): string {
    const failure = failedSourceLabels.get(label);
    return failure ? ` ("${label}" source failed to fetch: ${failure})` : '';
  }

  // --- Parcel resolution ---
  check(
    `parcel resolves to ${RECORDS_FIXTURE.parcelId}, not a condominium`,
    resolutionError === null && identity.parcelId === RECORDS_FIXTURE.parcelId && !identity.condominium,
    resolutionError === null
      ? `got parcelId=${identity.parcelId} condominium=${identity.condominium}`
      : `parcel resolution failed: ${resolutionError}`,
  );

  // --- Assessment (pinned fiscal years + history) ---
  const assessments = assessmentRows(allRows);
  const yearRow = (fiscalYear: string): AssessmentPayload | null =>
    assessments.find((a) => a.fiscalYear === fiscalYear) ?? null;

  const expected = RECORDS_FIXTURE.assessment;
  const pinned = yearRow(expected.fiscalYear);
  check(
    `${expected.fiscalYear} owner matches /${expected.owner.source}/`,
    pinned !== null && pinned.owner !== null && expected.owner.test(pinned.owner),
    `got owner=${JSON.stringify(pinned?.owner ?? null)}`,
  );
  // The addressee is reported as present or absent, never quoted: if one ever appears it may
  // be a person's name.
  check(
    `${expected.fiscalYear} mail: no addressee, street ${expected.mailStreet}`,
    pinned !== null && pinned.mailAddressee === null && pinned.mailStreet === expected.mailStreet,
    `got addressee ${pinned?.mailAddressee == null ? 'absent' : 'present'}, mailStreet=${JSON.stringify(pinned?.mailStreet ?? null)}`,
  );

  const combined = RECORDS_FIXTURE.combinedMail;
  const combinedRow = yearRow(combined.fiscalYear);
  const combinedParts = [combinedRow?.mailStreet ?? null, combinedRow?.mailCity ?? null, combinedRow?.mailState ?? null, combinedRow?.mailZip ?? null];
  check(
    `${combined.fiscalYear} combined mail address parses to ${combined.street}, ${combined.city}, ${combined.state} ${combined.zip}`,
    combinedParts[0] === combined.street && combinedParts[1] === combined.city && combinedParts[2] === combined.state && combinedParts[3] === combined.zip,
    `got ${JSON.stringify(combinedParts)}`,
  );

  check(
    `${expected.fiscalYear} landUse is ${expected.landUse} (${expected.landUseDescription})`,
    pinned !== null && pinned.landUse === expected.landUse && pinned.landUseDescription === expected.landUseDescription,
    `got ${JSON.stringify([pinned?.landUse ?? null, pinned?.landUseDescription ?? null])}`,
  );
  check(
    `${expected.fiscalYear} yearBuilt is ${expected.yearBuilt} and yearRemodel is ${expected.yearRemodel}`,
    pinned !== null && pinned.yearBuilt === expected.yearBuilt && pinned.yearRemodel === expected.yearRemodel,
    `got ${JSON.stringify([pinned?.yearBuilt ?? null, pinned?.yearRemodel ?? null])}`,
  );
  check(
    `${expected.fiscalYear} totalValue is ${expected.totalValue}`,
    pinned?.totalValue === expected.totalValue,
    `got totalValue=${JSON.stringify(pinned?.totalValue ?? null)}`,
  );

  const dollar = RECORDS_FIXTURE.dollarFormatted;
  // Delete this check, and `dollarFormatted`, when FY2021 leaves ASSESSOR_YEARS.
  check(
    `${dollar.fiscalYear} totalValue is ${dollar.totalValue} (dollar-formatted year)`,
    yearRow(dollar.fiscalYear)?.totalValue === dollar.totalValue,
    `got totalValue=${JSON.stringify(yearRow(dollar.fiscalYear)?.totalValue ?? null)}`,
  );

  // Counted from the list, so the yearly rollover is an edit to ASSESSOR_YEARS alone.
  const yearCount = ASSESSOR_YEARS.length;
  const fiscalYearsPresent = new Set(assessments.map((a) => a.fiscalYear));
  const allHaveTotalValue = assessments.length > 0 && assessments.every((a) => a.totalValue != null);
  check(
    `${yearCount} assessment years present, each with a non-null totalValue`,
    fiscalYearsPresent.size === yearCount && assessments.length === yearCount && allHaveTotalValue,
    `got ${assessments.length} rows across years [${Array.from(fiscalYearsPresent).sort().join(', ')}]`,
  );

  // --- Permits ---
  // Only the row count and permit numbers are read.
  const permitsExpected = RECORDS_FIXTURE.permits;
  const permitsLabel = `permits: between ${permitsExpected.min} and ${permitsExpected.max}, including ${permitsExpected.knownPermit}`;
  const permitSourceRows = rowsForOrFail('Approved Building Permits', permitsLabel);
  if (permitSourceRows !== null) {
    const permits = permitRows(permitSourceRows);
    const hasKnown = permits.some((p) => p.permitNumber === permitsExpected.knownPermit);
    check(
      permitsLabel,
      permits.length >= permitsExpected.min && permits.length <= permitsExpected.max && hasKnown,
      `got ${permits.length} rows, ${permitsExpected.knownPermit} ${hasKnown ? 'present' : 'absent'}`,
    );
  }

  // --- Violations ---
  const violationsLabel = `ISD violations: at most ${RECORDS_FIXTURE.maxViolations}`;
  const violationRows = rowsForOrFail('Building and Property Violations', violationsLabel);
  if (violationRows !== null) {
    check(violationsLabel, violationRows.length <= RECORDS_FIXTURE.maxViolations, `got ${violationRows.length} rows`);
  }

  // --- Enforcement ---
  // Contact and SAM values are read for the known cases only. A future ticket may name a
  // different contact, and it must neither fail these checks nor appear in their details.
  const enforcementExpected = RECORDS_FIXTURE.enforcement;
  const knownCases: readonly string[] = enforcementExpected.knownCases;
  const enforcementSuffix = sourceFailureSuffix('Public Works Code Enforcement');
  const enforcement = enforcementRows(allRows);
  const distinctCaseNumbers = new Set(enforcement.map((e) => e.caseNumber));
  const missingCases = knownCases.filter((c) => !distinctCaseNumbers.has(c));
  check(
    `enforcement: all ${knownCases.length} known cases present, at most ${enforcementExpected.maxCases} distinct cases`,
    missingCases.length === 0 && distinctCaseNumbers.size <= enforcementExpected.maxCases,
    `got ${distinctCaseNumbers.size} distinct cases in ${enforcement.length} rows` +
      `${missingCases.length > 0 ? `, missing ${missingCases.join(', ')}` : ''}${enforcementSuffix}`,
  );

  const datedRows = enforcement.filter((e) => e.caseNumber === enforcementExpected.datedCase);
  check(
    `enforcement: ${enforcementExpected.datedCase} statusDate starts with ${enforcementExpected.datedCaseStatusDate}`,
    datedRows.length > 0 && datedRows.every((e) => e.statusDate?.startsWith(enforcementExpected.datedCaseStatusDate) === true),
    `got statusDates=${JSON.stringify(datedRows.map((e) => e.statusDate))}${enforcementSuffix}`,
  );

  const knownRows = enforcement.filter((e) => knownCases.includes(e.caseNumber));
  const knownCasesSeen = new Set(knownRows.map((e) => e.caseNumber));
  check(
    `enforcement: every known case has contactAddress ${enforcementExpected.contactAddress} and samId ${RECORDS_FIXTURE.samId}`,
    knownCasesSeen.size === knownCases.length
      && knownRows.every((e) => e.contactAddress === enforcementExpected.contactAddress && e.samId === RECORDS_FIXTURE.samId),
    `got ${JSON.stringify(knownRows.map((e) => [e.caseNumber, e.contactAddress, e.samId]))}${enforcementSuffix}`,
  );

  // --- 311 service requests ---
  // Counts and years only.
  const srExpected = RECORDS_FIXTURE.serviceRequests;
  const serviceRequestsSuffix = sourceFailureSuffix('311 Service Requests');
  const serviceRequests = serviceRequestRows(allRows);
  // The empty-file probe decides what every 311 check below may excuse. A file whose whole
  // resource answered with no rows is the city's to fix and already a notice, so the floors give
  // back what it held when the counts were recorded, and the every-year and new-system checks
  // skip it. A file the probe could not reach excuses nothing. The labels never change with what
  // was lowered or skipped, so two runs compare label for label; the details say what was, and
  // each check that excused something carries the same words as its note.
  const files = await serviceRequestFiles;
  const recorded = srExpected.recorded;
  const withNote = (detail: string, note: string | null): string => (note === null ? detail : `${detail}; ${note}`);

  const emptied = emptiedFiles(files, recorded.legacyRows, recorded.newSystemRows);
  const total = lowerFloor(srExpected.minTotal, emptied);
  check(
    `311 total >= ${srExpected.minTotal}`,
    serviceRequests.length >= total.floor,
    `${withNote(`got ${serviceRequests.length} rows`, total.note)}${serviceRequestsSuffix}`,
    total.note,
  );

  // At this building, counting sanitation as housing would push this far past the ceiling,
  // and dropping the Housing reason would sink it far below the floor. Only the floor follows
  // the probe; the ceiling stays where it is.
  const housingWindow = srExpected.housing;
  const housingCount = serviceRequests.filter((r) => r.classification === 'housing').length;
  const housingInWindow = serviceRequests.filter((r) => {
    const year = openedYear(r);
    return r.classification === 'housing' && year !== null && year >= housingWindow.fromYear && year <= housingWindow.toYear;
  }).length;
  const housingFloor = lowerFloor(housingWindow.min, emptiedFiles(files, recorded.legacyHousing, 0));
  check(
    `311 housing rows opened ${housingWindow.fromYear}-${housingWindow.toYear} between ${housingWindow.min} and ${housingWindow.max}`,
    housingInWindow >= housingFloor.floor && housingInWindow <= housingWindow.max,
    `${withNote(`got ${housingInWindow} in those years, ${housingCount} housing rows out of ${serviceRequests.length} in all`, housingFloor.note)}${serviceRequestsSuffix}`,
    housingFloor.note,
  );

  // Each closed year is its own legacy resource, so a year with no rows is a resource the city
  // emptied or retired, or a query that lost the building. A total alone cannot see one year go
  // missing. The file probe tells the cases apart: a year whose whole file answered with no rows
  // is the city's to fix, already a notice, and skipped here. A year whose file has rows, or
  // that the probe could not reach, still has to hold rows for this building: an unknown is not
  // an excuse. The label never names the skipped years, so two runs compare label for label.
  const everyYear = srExpected.everyYear;
  const yearsOpened = new Set(serviceRequests.map(openedYear));
  const skippedYears: number[] = [];
  const missingYears: number[] = [];
  for (let year = everyYear.fromYear; year <= everyYear.toYear; year += 1) {
    if (files.emptyYears.has(year)) skippedYears.push(year);
    else if (!yearsOpened.has(year)) missingYears.push(year);
  }
  const unreachedYears = missingYears.filter((year) => files.uncheckedYears.has(year));
  const skippedNote =
    skippedYears.length > 0
      ? `skipped ${skippedYears.join(', ')}, whose ${skippedYears.length === 1 ? 'file has' : 'files have'} no rows`
      : null;
  const everyYearDetail = [
    missingYears.length === 0
      ? `got rows in every year asked for, ${serviceRequests.length} rows in all`
      : `no rows opened in ${missingYears.join(', ')}`,
    ...(unreachedYears.length > 0 ? [`the empty-file check could not reach ${unreachedYears.join(', ')}`] : []),
    ...(skippedNote !== null ? [skippedNote] : []),
  ].join('; ');
  check(
    `311 rows opened in every year ${everyYear.fromYear}-${everyYear.toYear} whose file has rows`,
    missingYears.length === 0,
    missingYears.length === 0 ? everyYearDetail : `${everyYearDetail}${serviceRequestsSuffix}`,
    skippedNote,
  );

  // An empty new-system file is the city's to fix, the same as an empty legacy file, so the
  // check is skipped that morning. A new-system file the probe could not reach is held to it.
  const newSystemCount = serviceRequests.filter((r) => r.system === 'new').length;
  const newSystemOk = files.newSystemEmpty || newSystemCount >= srExpected.minNew;
  const newSystemSkipped = files.newSystemEmpty ? 'skipped, because the new-system file has no rows' : null;
  const newSystemDetail = newSystemSkipped !== null
    ? `got ${newSystemCount} new-system rows; ${newSystemSkipped}`
    : `got ${newSystemCount} new-system rows${!newSystemOk && files.newSystemUnchecked ? '; the empty-file check could not reach the new-system file' : ''}`;
  check(`311 new-system rows >= ${srExpected.minNew}`, newSystemOk, `${newSystemDetail}${serviceRequestsSuffix}`, newSystemSkipped);

  // The checks above excuse a file or two the city empties. Many emptied at once is a wipe, or
  // the city moving 311 to new resource ids and leaving the old ones empty, and every pull in the
  // meantime replaces a building's stored 311 rows with none. So past the limit this fails, the
  // fill waits and the email goes out. Only files that held the building's rows when the counts
  // were recorded are counted, and a file the probe could not reach is not: an unknown is held
  // to the other checks instead. The source failing does not touch this, because the probe asks
  // the files directly.
  const maxEmptied = srExpected.maxEmptiedFiles;
  const emptiedOk = emptied.length <= maxEmptied;
  const emptiedNames = emptied.map((f) => f.name).join(', ');
  const emptiedDetail =
    emptied.length === 0
      ? 'none of the files that held the building\'s rows is empty'
      : `${emptied.length} of the files that held the building's rows ${emptied.length === 1 ? 'has' : 'have'} none: ${emptiedNames}` +
        (emptiedOk ? '' : `; more than ${maxEmptied} at once is a wipe or a move to new resource ids, not one reload`);
  check(
    `311 files emptied since the counts were recorded: at most ${maxEmptied}`,
    emptiedOk,
    emptiedDetail,
    emptied.length > 0 ? emptiedDetail : null,
  );

  // --- RentSmart ---
  // RentSmart is the city's current export, not a history. A reload of it can drop any parcel's
  // rows, so a check that one parcel has rows can fail every morning while the source works.
  // These two checks ask what a pull depends on instead: the adapter's own parcel query runs and
  // answers (zero rows is an answer), and the same resource still has recent rows keyed by a
  // ten-digit parcel, the form that query sends.
  const rentsmartParcelLabel = 'RentSmart answers the parcel query';
  const rentsmartParcelRows = rowsForOrFail('RentSmart', rentsmartParcelLabel);
  if (rentsmartParcelRows !== null) {
    // With no parcel id the adapter returns no rows without asking the city.
    check(
      rentsmartParcelLabel,
      identity.parcelId !== null,
      identity.parcelId !== null
        ? `got ${rentsmartParcelRows.length} rows for parcel ${identity.parcelId}`
        : 'no parcel id, so the parcel query never ran',
    );
  }

  const newest = await newestRentSmart;
  let recentOk = false;
  let recentDetail: string;
  if ('error' in newest) {
    // No source entry to fail into, as with SAM below: counted once, as this check.
    recentDetail = `RentSmart recent-rows query failed: ${newest.error}`;
  } else if (newest.rows.length === 0) {
    recentDetail = `no rows dated on or after ${rentsmartSince}`;
  } else {
    const date = textOrNull(newest.rows[0].date);
    const parcel = textOrNull(newest.rows[0].parcel);
    // Checked here as well as in the SQL, so the check never rests on the query's filter alone.
    const day = date !== null ? (/^\d{4}-\d{2}-\d{2}/.exec(date)?.[0] ?? null) : null;
    recentOk = day !== null && day >= rentsmartSince && parcel !== null && /^\d{10}$/.test(parcel);
    recentDetail = `newest row dated ${date ?? 'none'}, parcel ${parcel ?? 'none'} (window starts ${rentsmartSince})`;
  }
  check(`RentSmart has a row from the last ${RENTSMART_RECENT_DAYS} days with a ten-digit parcel`, recentOk, recentDetail);

  // --- SAM address points ---
  // SAM is the seed's coordinate, neighborhood, and zip source (src/lib/records/seed/sam.ts).
  // It is not one of the sourcesForCity adapters, so it is fetched here directly, filtered to
  // the fixture parcel so this is one request rather than the 400,000-row bulk download.
  // Having no source entry to fail into, a throw here becomes this check's detail rather
  // than a sourceErrors row — counted once either way.
  let samOk = false;
  let samDetail: string;
  try {
    const samRows = await fetchAllRows<SamRow>(
      SAM_RESOURCE_ID,
      {
        fields: [...SAM_FIELDS],
        filters: { PARCEL_ID: RECORDS_FIXTURE.parcelId },
        // fetchAllRows defaults to the 120s bulk-page budget, sized for a 32,000-row
        // download. This is a one-parcel filtered query, so it gets the single-building
        // budget instead: a hung SAM request must not hold the breaker's run open for
        // two minutes per attempt.
        timeoutMs: options.timeoutMs ?? FETCH_TIMEOUT_MS,
        // The 1s + 4s retry backoff stays — a blip at data.boston.gov must not trip the
        // breaker — but tests inject a no-op sleep so they do not wait it out.
        sleep: options.sleep,
      },
      fetchImpl,
    );
    // The parcel carries one primary row and a row per unit, so this also checks that the
    // primary point wins.
    const samPoint = indexSamByParcel(samRows).get(RECORDS_FIXTURE.parcelId);
    samOk = samPoint?.samId === RECORDS_FIXTURE.samId
      && samPoint.neighborhood === RECORDS_FIXTURE.neighborhood
      && samPoint.zip === RECORDS_FIXTURE.zip
      && samPoint.latitude > 42.2
      && samPoint.latitude < 42.4
      && samPoint.longitude > -71.2
      && samPoint.longitude < -70.9;
    samDetail = `got ${JSON.stringify(samPoint ?? null)} from ${samRows.length} SAM rows`;
  } catch (err) {
    samDetail = `SAM fetch failed: ${messageOf(err)}`;
  }
  check(
    `SAM primary point for the fixture: id ${RECORDS_FIXTURE.samId}, ${RECORDS_FIXTURE.neighborhood}, ZIP ${RECORDS_FIXTURE.zip}, inside Boston`,
    samOk,
    samDetail,
  );

  const rowsBySource: Record<string, number> = {};
  for (const [label, rows] of rowsBySourceLabel) rowsBySource[label] = rows.length;

  const checksFailed = checks.filter((c) => !c.ok).length;
  const failures = checksFailed + sourceErrors.length;
  return {
    checks,
    checksFailed,
    failures,
    sourceErrors,
    rowsBySource,
    notices: files.notices,
    parcelId: identity.parcelId,
    condominium: identity.condominium,
  };
}
