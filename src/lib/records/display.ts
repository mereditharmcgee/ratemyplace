// Copy and string formatters for the building records panel. Nothing here touches the
// database or the network: every function is a straight transform of already-validated
// payloads (see query.ts) into strings. The counting helpers behind the bars and the
// sparkline live next door in `charts.ts`; the per-source view model in `ledger.ts`.
//
// Product rule, non-negotiable: the panel has no opinion. Every rendered value is a
// field from a record or a count of records.
//
// This file holds the panel's *framing* copy — the sentences that explain what the reader
// is looking at, and the caveats attached to a figure. It is not the whole surface: each
// section's empty state ("No violations on record.", "Not retrieved yet.") is written
// inline in the template that owns it. BANNED_WORDS is the guardrail over both halves:
// `__tests__/recordsDisplay.test.ts` scans every string in `PANEL_COPY` at the foot of this
// file, which a reflection test in the same file keeps exhaustive, and
// `__tests__/recordsPanelCopy.test.ts` scans the raw source of `BuildingRecords.astro` and
// `components/records/*.astro`. A future edit cannot smuggle an editorial reading of the
// data in through either door.
import { ROW_CAP } from './ckan';
import { PERMIT_COVERAGE_START } from './sources/boston/permits';
import type { YearCount } from './charts';
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

/** The panel's single string for a field the city left blank. Used as a label and as a category key. */
export const NOT_RECORDED = 'Not recorded';

/**
 * A stored field as the panel prints it, with one name for absence. Two templates each grew
 * a private copy of this, which is how two surfaces end up disagreeing about what a blank
 * field looks like. Zero is a recorded value and prints as one.
 */
export function orNotRecorded(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? NOT_RECORDED : String(value);
}

export const PANEL_FRAMING_COPY =
  'These are facts from City of Boston and Commonwealth of Massachusetts records, shown as recorded. No rating is applied to them and they are not part of any score.';

const PERMIT_COVERAGE_YEAR = /\d{4}/.exec(PERMIT_COVERAGE_START)?.[0] ?? PERMIT_COVERAGE_START;

/**
 * The same coverage year as a number, for bounding a year series. Null when the phrase carries
 * no four-digit year, so a caller falls back to the observed rows rather than to `NaN`.
 */
export const PERMIT_COVERAGE_YEAR_NUMBER: number | null = /^\d{4}$/.test(PERMIT_COVERAGE_YEAR)
  ? Number(PERMIT_COVERAGE_YEAR)
  : null;

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
  return joined === '' ? NOT_RECORDED : joined;
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
  if (value === null || !Number.isFinite(value)) return NOT_RECORDED;
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
}

export function permitSummary(permits: PermitPayload[]): PermitSummary {
  let declaredTotal: number | null = null;
  let declaredCount = 0;
  for (const permit of permits) {
    if (typeof permit.declaredValuation === 'number' && Number.isFinite(permit.declaredValuation)) {
      declaredTotal = (declaredTotal ?? 0) + permit.declaredValuation;
      declaredCount += 1;
    }
  }
  return { count: permits.length, declaredTotal, declaredCount };
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

/**
 * A section listing what the city's feed holds, not a statement about the building. Read
 * next to "No violations on record." so an empty list is not mistaken for a clearance.
 */
export const NO_VIOLATIONS_CAVEAT =
  "This section lists what the city's violation feed holds for this address. An empty list is a fact about the feed, not confirmation that the building meets code.";

/** A source nobody has queried has no finding to report — not an empty one, none at all. */
export const NEVER_PULLED_COPY = 'Not retrieved yet.';

/**
 * A source whose latest attempt failed and left no rows behind. The upstream error text is
 * never shown — see the note on `SourceStatus.errorMessage` — only the fact and the date.
 */
export function unavailableCopy(retrievedAt: number): string {
  return `Record unavailable. Last attempt ${formatPullDate(retrievedAt)}.`;
}

/**
 * The CKAN row cap is a hard slice, so a full page means there may be more upstream. The 311
 * wording differs because its cap applies before the housing filter: the rows beyond it were
 * not weighed at all, rather than fetched and left off a list.
 */
export const CAPPED_REQUESTS_COPY = `First ${ROW_CAP} requests considered.`;
export const CAPPED_ROWS_COPY = `First ${ROW_CAP} shown.`;

const COMPACT_UNITS: Array<{ threshold: number; suffix: string }> = [
  { threshold: 1_000_000_000, suffix: 'B' },
  { threshold: 1_000_000, suffix: 'M' },
  { threshold: 1_000, suffix: 'K' },
];

/** Three significant figures: two decimals under ten, one under a hundred, none above. */
function compactDecimals(scaled: number): number {
  return scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
}

/**
 * Three significant figures plus a unit — `$9.51M`, `$630K`, `$950`. The long form stays in
 * `formatDollars`; this exists so a dollar figure can sit in a fact cell without wrapping.
 * It rounds, and rounding is a loss, so never use it where the exact figure is the point.
 */
export function formatDollarsCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_RECORDED;
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  let index = COMPACT_UNITS.findIndex((candidate) => magnitude >= candidate.threshold);
  if (index === -1) return `${sign}$${Math.round(magnitude).toLocaleString('en-US')}`;

  let scaled = magnitude / COMPACT_UNITS[index].threshold;
  let fixed = scaled.toFixed(compactDecimals(scaled));
  // Rounding can carry a figure onto the next unit's doorstep: 999,500 scales to 999.5K,
  // which rounds to "1000K" — the same number as $1M, written in a way no one writes it.
  if (Number(fixed) >= 1000 && index > 0) {
    index -= 1;
    scaled = magnitude / COMPACT_UNITS[index].threshold;
    fixed = scaled.toFixed(compactDecimals(scaled));
  }

  // Trailing zeroes carry no information at this precision, and "$9.50M" reads as more
  // certainty than a rounded figure has. Anchored on the decimal point: a bare `0+$` strip
  // would turn "630K" into "63K", off by a factor of ten.
  const text = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return `${sign}$${text}${COMPACT_UNITS[index].suffix}`;
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

/**
 * A fixed instant for the sampled copy below. Any unix second would do — the guard cares
 * about the sentence around the date, not the date.
 */
const SAMPLE_PULL_DATE = 1_757_000_000;

/** A minimal roll-up row, only so the disagreement sentence can be sampled below. */
const SAMPLE_RENTSMART_ROW: RentSmartPayload = {
  rowId: 'sample',
  date: null,
  violationType: 'Housing Complaints',
  description: null,
  address: null,
  parcel: null,
};

/**
 * Every user-visible string this module publishes, in one object, keyed by where it comes
 * from. `__tests__/recordsDisplay.test.ts` iterates this against BANNED_WORDS instead of
 * naming constants by hand — the hand-written list had five entries while the file exported
 * eleven, so six sentences were shipping unguarded. Copy produced by a function is sampled
 * here with representative arguments, since the guard can only read a string.
 *
 * The same test reflects over this module's exports and fails if an all-caps string export is
 * missing a key below, so a new constant cannot quietly escape the scan.
 */
export const PANEL_COPY: Readonly<Record<string, string>> = {
  NOT_RECORDED,
  PANEL_FRAMING_COPY,
  ZERO_PERMITS_COPY,
  DECLARED_VALUATION_CAVEAT,
  OTHER_REQUESTS_COPY,
  CONDOMINIUM_COPY,
  NO_VIOLATIONS_CAVEAT,
  NEVER_PULLED_COPY,
  CAPPED_REQUESTS_COPY,
  CAPPED_ROWS_COPY,
  ...Object.fromEntries(
    Object.entries(KIND_LABELS).map(([kind, label]) => [`KIND_LABELS.${kind}`, label]),
  ),
  'unavailableCopy()': unavailableCopy(SAMPLE_PULL_DATE),
  'openSubCount() — empty': openSubCount(0, 0),
  'openSubCount() — all closed': openSubCount(0, 3),
  'openSubCount() — some open': openSubCount(2, 3),
  'formatRecordDate() — no date': formatRecordDate(null),
  'formatPullDate() — no date': formatPullDate(Number.NaN),
  'rentSmartDisagreement()': rentSmartDisagreement([SAMPLE_RENTSMART_ROW], 0) ?? '',
};
