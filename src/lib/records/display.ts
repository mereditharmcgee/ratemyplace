// Pure display helpers for the building records panel. Nothing here touches the
// database or the network: every function is a straight transform of already-validated
// payloads (see query.ts) into strings and view models.
//
// Product rule, non-negotiable: the panel has no opinion. Every rendered value is a
// field from a record or a count of records.
//
// This file holds the panel's *framing* copy — the sentences that explain what the reader
// is looking at, and the caveats attached to a figure. It is not the whole surface: each
// section's empty state ("No violations on record.", "Not retrieved yet.") is written
// inline in the template that owns it. BANNED_WORDS is the guardrail over both halves:
// `__tests__/recordsDisplay.test.ts` scans the constants below, and
// `__tests__/recordsPanelCopy.test.ts` scans the raw source of `BuildingRecords.astro` and
// `components/records/*.astro`. A future edit cannot smuggle an editorial reading of the
// data in through either door.
import { PERMIT_COVERAGE_START } from './sources/boston/permits';
import type {
  AssessmentPayload,
  PermitPayload,
  RecordKind,
  RentSmartPayload,
  ServiceRequestPayload,
} from './types';

export const BANNED_WORDS: readonly string[] = [
  'cash-out',
  'extracted',
  'cross-collateralized',
  'deferred maintenance',
  'pattern',
  'evasive',
  'delay',
];

export const PANEL_FRAMING_COPY =
  'These are facts from City of Boston and Commonwealth of Massachusetts records, shown as recorded. No rating is applied to them and they are not part of any score.';

const PERMIT_COVERAGE_YEAR = /\d{4}/.exec(PERMIT_COVERAGE_START)?.[0] ?? PERMIT_COVERAGE_START;

export const ZERO_PERMITS_COPY = `No permitted work on record since ${PERMIT_COVERAGE_YEAR}. This means no permits were filed, not that no maintenance was done.`;

export const DECLARED_VALUATION_CAVEAT =
  "Declared valuation is the applicant's own estimate at filing and is a floor, not a cost.";

export const OTHER_REQUESTS_COPY =
  'Other 311 requests at or near this address: parking, trash pickup, streetlights, and similar. Counted but not listed.';

export const CONDOMINIUM_COPY =
  'This building is divided into individually owned condominium units. No single owner of record is shown.';

/**
 * Word-boundary entity tokens. A bare substring test (INC in PRINCE) would publish an
 * individual's home address. Periods become spaces before matching, so `L.L.C.` arrives as
 * the spaced form `L L C` and is listed here that way — the escaped `L\.L\.C` this replaced
 * could never match anything.
 *
 * Deliberately absent: `CO` and `CHURCH`, both common surnames (CO JOHN, CHURCH MARY E).
 * `COMPANY` and `CORP` cover the actual corporate uses.
 */
const ENTITY_TOKEN =
  /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|TRUST|REALTY|CONDO|CONDOMINIUM|LP|L P|LLP|LLLP|PARTNERSHIP|PARTNERS|REIT|ASSOC|ASSOCIATES|ASSOCIATION|AUTHORITY|COMMONWEALTH|CITY OF|HOUSING|DEVELOPMENT|HOLDINGS|PROPERTIES|GROUP|FUND|BANK|UNIVERSITY|COLLEGE|HOSPITAL)\b/;

/**
 * A trustee suffix is not an entity on its own. `SMITH JOHN TR` and `DOE JANE TRUSTEE` are
 * individuals holding a family trust, and the address on file is their home.
 */
const TRUSTEE_TOKEN = /\b(TR|TRS|TRUSTEE|TRUSTEES|TRSTEE|TRSTEES)\b/;

/**
 * What has to accompany a trustee suffix before the name reads as a trust rather than a
 * person. `NOMINEE` and `FAMILY` name a trust without naming an entity, so `SMITH FAMILY TR`
 * clears the gate while `SMITH JOHN TR` does not; the rest are entity tokens too, listed
 * again here so the rule reads on its own.
 */
const TRUSTEE_COMPANION = /\b(TRUST|REALTY|CONDO|CONDOMINIUM|NOMINEE|FAMILY)\b/;

/**
 * No mailing address for an individual owner: it would be a home address, not a business one.
 *
 * This errs toward hiding. A trust held by named individuals — `SMITH JOHN TR` — is a real
 * trust whose address stays hidden, because from the owner string alone it is
 * indistinguishable from a person's name plus a suffix. That is the intended fail direction:
 * a hidden business address costs a reader one lookup; a published home address cannot be
 * taken back.
 */
export function showMailingAddress(owner: string | null): boolean {
  if (!owner) return false;
  // Periods and commas become spaces so `L.L.C.` and `SMITH, JOHN` tokenize; runs of
  // whitespace collapse so the spaced `L L C` and `L P` forms match as written above.
  const normalized = owner.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (ENTITY_TOKEN.test(normalized)) return true;
  return TRUSTEE_TOKEN.test(normalized) && TRUSTEE_COMPANION.test(normalized);
}

/**
 * The tax mailing address as one line, with the addressee held to the same entity gate as the
 * owner. An entity can list a person as its addressee (`C/O ATT <person>`), and printing
 * that name beside the address publishes exactly what the owner gate exists to withhold. The
 * street and city lines are kept either way — those belong to the entity.
 */
export function mailingAddressLine(assessment: AssessmentPayload): string {
  const addressee = showMailingAddress(assessment.mailAddressee) ? assessment.mailAddressee : null;
  const cityState = [assessment.mailCity, assessment.mailState].filter(Boolean).join(', ');
  const cityLine = [cityState, assessment.mailZip].filter(Boolean).join(' ');
  const joined = [addressee, assessment.mailStreet, cityLine].filter(Boolean).join(', ');
  return joined === '' ? 'Not recorded' : joined;
}

/** Reader-facing names for the record kinds, for copy that has to list a kind by name. */
export const KIND_LABELS: Record<RecordKind, string> = {
  assessment: 'property assessment',
  permit: 'building permits',
  violation: 'violations',
  enforcement_ticket: 'code enforcement',
  service_request: '311 requests',
  rentsmart: 'RentSmart',
};

export function formatDollars(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Not recorded';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

const MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Reads only the `YYYY-MM-DD` prefix a record's timestamp starts with, whichever of the
 * three shapes it arrived in (`2008-08-30 09:42:00`, `2021-01-28T16:29:26`,
 * `2026-07-17 13:56:00+00`). Deliberately never touches `Date`: these are public-record
 * dates, exact by design, and running them through `Date` risks a timezone shift that
 * would silently move a city-recorded date by a day.
 */
export function formatRecordDate(value: string | null): string {
  if (!value) return 'Date not recorded';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return 'Date not recorded';
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return 'Date not recorded';
  const dayNumber = Number(day);
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 31) return 'Date not recorded';
  return `${MONTH_ABBREVIATIONS[monthIndex]} ${dayNumber}, ${year}`;
}

/**
 * For our own timestamps — when a pull ran, when a correction was resolved — which are unix
 * seconds rather than record strings. Unlike `formatRecordDate` these are real instants, so
 * they are pinned to `America/New_York`: a pull at 8pm Boston time must not render as the
 * next day because the worker rendering it runs in UTC.
 */
const PULL_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function formatPullDate(unix: number): string {
  if (!Number.isFinite(unix)) return 'Date not recorded';
  return PULL_DATE_FORMAT.format(new Date(unix * 1000));
}

export interface PermitSummary {
  count: number;
  /** Sum of the permits that carried a declared valuation; null when none did. A missing figure is not $0. */
  declaredTotal: number | null;
  /** How many of `count` permits carried a declared valuation. */
  declaredCount: number;
  earliest: string | null;
  latest: string | null;
}

export function permitSummary(permits: PermitPayload[]): PermitSummary {
  let declaredTotal: number | null = null;
  let declaredCount = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const permit of permits) {
    if (typeof permit.declaredValuation === 'number' && Number.isFinite(permit.declaredValuation)) {
      declaredTotal = (declaredTotal ?? 0) + permit.declaredValuation;
      declaredCount += 1;
    }
    if (permit.issuedDate) {
      if (earliest === null || permit.issuedDate < earliest) earliest = permit.issuedDate;
      if (latest === null || permit.issuedDate > latest) latest = permit.issuedDate;
    }
  }
  return { count: permits.length, declaredTotal, declaredCount, earliest, latest };
}

export function splitServiceRequests(
  rows: ServiceRequestPayload[],
): { housing: ServiceRequestPayload[]; otherCount: number } {
  // Plain string comparison, not localeCompare: these are ISO-ish date strings, and
  // locale collation would make the order depend on the runtime's ICU data.
  const housing = rows
    .filter((row) => row.classification === 'housing')
    .sort((a, b) => {
      const left = a.openedAt ?? '';
      const right = b.openedAt ?? '';
      return left < right ? 1 : left > right ? -1 : 0;
    });
  const otherCount = rows.filter((row) => row.classification === 'other').length;
  return { housing, otherCount };
}

/**
 * One-directional by design. RentSmart is a periodic roll-up of the same city data, so it
 * lagging the raw 311 feed is expected and unremarkable; only an excess — the roll-up
 * claiming more housing complaints than the records above show — is worth a note.
 */
export function rentSmartDisagreement(rows: RentSmartPayload[], housingRequestCount: number): string | null {
  const complaintCount = rows.filter(
    (row) => (row.violationType ?? '').trim().toLowerCase() === 'housing complaints',
  ).length;
  if (complaintCount <= housingRequestCount) return null;
  const noun = complaintCount === 1 ? 'housing complaint' : 'housing complaints';
  return `The city's RentSmart summary reports ${complaintCount} ${noun} for this address; the 311 records above show ${housingRequestCount}.`;
}

// ---------------------------------------------------------------------------
// Shape helpers for the panel's bars, category lists, and assessed-value sparkline.
//
// Every one of these is a counting function. They turn stored rows into counts, spans, and
// coordinates; none of them reads a value and decides what it means. A bar is tall because
// the city recorded more rows that year, and for no other reason.
// ---------------------------------------------------------------------------

/** The panel's single string for a field the city left blank. Used as a label and as a category key. */
export const NOT_RECORDED = 'Not recorded';

/**
 * A section listing what the city's feed holds, not a statement about the building. Read
 * next to "No violations on record." so an empty list is not mistaken for a clearance.
 */
export const NO_VIOLATIONS_CAVEAT =
  "This section lists what the city's violation feed holds for this address. An empty list is a fact about the feed, not confirmation that the building meets code.";

export interface YearCount {
  year: number;
  count: number;
}

/**
 * Rows bucketed by the calendar year of `getDate`, dense across the span so a year with
 * nothing in it still gets a bar. Reads only the leading `YYYY` the way `formatRecordDate`
 * reads the leading `YYYY-MM-DD` — never through `Date`, whose timezone handling could move
 * a December 31st record into the next year.
 *
 * A row whose date will not parse is skipped rather than bucketed anywhere: inventing a year
 * for it would put a count under a year the city never recorded.
 */
export function countByYear<T>(
  rows: readonly T[],
  getDate: (row: T) => string | null | undefined,
  opts?: { from?: number; to?: number },
): YearCount[] {
  const counts = new Map<number, number>();
  let observedMin: number | null = null;
  let observedMax: number | null = null;

  for (const row of rows) {
    const value = getDate(row);
    if (!value) continue;
    const match = /^(\d{4})-\d{2}-\d{2}/.exec(value);
    if (!match) continue;
    const year = Number(match[1]);
    if (opts?.from !== undefined && year < opts.from) continue;
    if (opts?.to !== undefined && year > opts.to) continue;
    counts.set(year, (counts.get(year) ?? 0) + 1);
    if (observedMin === null || year < observedMin) observedMin = year;
    if (observedMax === null || year > observedMax) observedMax = year;
  }

  const from = opts?.from ?? observedMin;
  const to = opts?.to ?? observedMax;
  if (from === null || to === null || from === undefined || to === undefined || to < from) return [];

  const series: YearCount[] = [];
  for (let year = from; year <= to; year += 1) {
    series.push({ year, count: counts.get(year) ?? 0 });
  }
  return series;
}

export interface KeyCount {
  key: string;
  count: number;
}

export interface KeyBreakdown {
  /** At most `topN` categories, most rows first. */
  top: KeyCount[];
  /** How many categories fell outside `top`. */
  restTypes: number;
  /** How many rows those categories hold between them. */
  restCount: number;
}

/**
 * Rows grouped by `getKey`, largest group first. Ties break on the key ascending so the
 * same data always renders in the same order — an unstable list would look like the records
 * changed when only the sort did.
 */
export function countByKey<T>(
  rows: readonly T[],
  getKey: (row: T) => string | null | undefined,
  topN: number,
): KeyBreakdown {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = getKey(row);
    const key = raw === null || raw === undefined || raw.trim() === '' ? NOT_RECORDED : raw.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const ordered = Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const limit = Math.max(0, topN);
  const top = ordered.slice(0, limit);
  const rest = ordered.slice(limit);
  return {
    top,
    restTypes: rest.length,
    restCount: rest.reduce((sum, entry) => sum + entry.count, 0),
  };
}

const COMPACT_UNITS: Array<{ threshold: number; suffix: string }> = [
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
];

/**
 * Three significant figures plus a unit — `$9.51M`, `$630K`, `$950`. The long form stays in
 * `formatDollars`; this exists so a dollar figure can sit in a fact cell without wrapping.
 * It rounds, and rounding is a loss, so never use it where the exact figure is the point.
 */
export function formatDollarsCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NOT_RECORDED;
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  const unit = COMPACT_UNITS.find((candidate) => magnitude >= candidate.threshold);
  if (!unit) return `${sign}$${Math.round(magnitude).toLocaleString('en-US')}`;

  const scaled = magnitude / unit.threshold;
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  // Trailing zeroes carry no information at this precision, and "$9.50M" reads as more
  // certainty than a rounded figure has. Anchored on the decimal point: a bare `0+$` strip
  // would turn "630K" into "63K", off by a factor of ten.
  const fixed = scaled.toFixed(decimals);
  const text = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return `${sign}$${text}${unit.suffix}`;
}

export interface AssessmentSeries {
  /** Totals ordered by fiscal year ascending. */
  values: number[];
  min: number;
  max: number;
  /** Fiscal year labels as the assessor writes them, e.g. `FY2021`. */
  firstYear: string;
  lastYear: string;
}

/**
 * The assessed-value series behind the sparkline. Years with no recorded total drop out of
 * `values` — a missing figure is not a zero, and plotting it as one would draw a collapse
 * the records do not show. The first and last labels are the first and last *recorded*
 * years, so the axis label and the line describe the same span.
 */
export function assessmentSeries(assessments: readonly AssessmentPayload[]): AssessmentSeries | null {
  const usable = assessments
    .filter((row) => typeof row.totalValue === 'number' && Number.isFinite(row.totalValue))
    .slice()
    .sort((a, b) => (a.fiscalYear < b.fiscalYear ? -1 : a.fiscalYear > b.fiscalYear ? 1 : 0));
  if (usable.length === 0) return null;

  const values = usable.map((row) => row.totalValue as number);
  return {
    values,
    min: Math.min(...values),
    max: Math.max(...values),
    firstYear: usable[0].fiscalYear,
    lastYear: usable[usable.length - 1].fiscalYear,
  };
}

/**
 * An SVG `points` string for the assessed-value line: every value on one linear scale
 * between the series low and high, so the slope between two years is proportional to the
 * change the records show. A constant series (including a single year) draws flat through
 * the middle rather than pinned to the top, which would read as a maximum.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number, pad: number): string {
  if (values.length === 0) return '';
  const midY = height / 2;
  if (values.length === 1) return `${pad},${midY} ${width - pad},${midY}`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  const span = max - min;

  return values
    .map((value, index) => {
      const x = pad + (innerWidth * index) / (values.length - 1);
      const y = span === 0 ? midY : pad + innerHeight * (1 - (value - min) / span);
      return `${x},${y}`;
    })
    .join(' ');
}

/**
 * Whether a record's own status field says the city still has it open. Plain equality on the
 * city's word, lowercased — not an inference from a missing close date, which would turn a
 * blank field into an assertion that the matter is unresolved.
 */
export function isOpenStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'open';
}

/**
 * The small line under a ledger row's count. Three distinct readings: nothing was recorded,
 * everything recorded has been closed, or this many are still open. "0 open" would read the
 * same for an empty source and a fully closed one, which are not the same fact.
 */
export function openSubCount(openCount: number, total: number): string {
  if (total === 0) return 'none on record';
  if (openCount === 0) return 'all closed';
  return `${openCount} open`;
}

/**
 * The span a dense year series covers, as the ledger's coverage line writes it. Null when no
 * row carried a readable date — there is no span to state, and "–" alone would suggest one.
 */
export function yearSpanLabel(series: readonly YearCount[]): string | null {
  if (series.length === 0) return null;
  const first = series[0].year;
  const last = series[series.length - 1].year;
  return first === last ? String(first) : `${first}–${last}`;
}
