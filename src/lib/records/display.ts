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
import { RECORD_GROUPS } from './recordGroups';
import type { YearCount } from './charts';
import type {
  AssessmentPayload,
  PermitPayload,
  RecordKind,
  RentSmartPayload,
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
  'These are facts from City of Boston records, shown as recorded. No rating is applied to them and they are not part of any score.';

const PERMIT_COVERAGE_YEAR = /\d{4}/.exec(PERMIT_COVERAGE_START)?.[0] ?? PERMIT_COVERAGE_START;

/**
 * The same coverage year as a number, for bounding a year series. Null when the phrase carries
 * no four-digit year, so a caller falls back to the observed rows rather than to `NaN`.
 */
export const PERMIT_COVERAGE_YEAR_NUMBER: number | null = /^\d{4}$/.test(PERMIT_COVERAGE_YEAR)
  ? Number(PERMIT_COVERAGE_YEAR)
  : null;

export const ZERO_PERMITS_COPY = `No permitted work on record since ${PERMIT_COVERAGE_YEAR}. This means no permits were filed, not that no maintenance was done.`;

/**
 * Where the city's permit feed starts, said as a fact about the feed. It read "On record from
 * September 2006" under a row headed with this building's own span ("2010–2026"), and the two
 * looked like two answers to one question. The row's span is this building's permits; this is
 * the feed's, which is also why the bars start in 2006.
 */
export const PERMIT_COVERAGE_NOTE = `The city's permit records start in ${PERMIT_COVERAGE_START}.`;

export const DECLARED_VALUATION_CAVEAT =
  "Declared valuation is the applicant's own estimate at filing and is a floor, not a cost.";

/**
 * How the 311 rows are split across the panel's three groups, in one line. The full list of
 * types per group is published on the methodology page from the same table the panel uses
 * (`recordGroups.ts`), so the split can be checked rather than taken on trust.
 */
export const GROUPING_NOTE = 'How 311 requests are grouped: by the request type the city recorded.';

/** The link text after `GROUPING_NOTE`, pointing at the methodology page's list of types. */
export const GROUPING_LINK_TEXT = 'See the types in each group.';

/**
 * The 311 requests that fit none of the three groups: counted, never listed. Said as one
 * sentence with its own count, so it cannot be read against a "Show all" link above it as a
 * second, contradicting figure for the same list. Null when there are none.
 */
export function otherRequestsLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 other 311 request at or near this address, about something like parking, trash pickup or streetlights, falls outside these groups. It is counted here, not listed.'
    : `${count} other 311 requests at or near this address, such as parking, trash pickup and streetlights, fall outside these groups. They are counted here, not listed.`;
}

/** A noun in both numbers, so a count of one never reads "1 requests". */
export interface CountNoun {
  one: string;
  many: string;
}

export function countWithNoun(count: number, noun: CountNoun): string {
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}

/**
 * The disclosure label over a full list. "Show all 1 requests" was both wrong in number and
 * odd in sense; one record reads "Show 1 request".
 */
export function showAllLabel(count: number, noun: CountNoun): string {
  return count === 1 ? `Show ${countWithNoun(count, noun)}` : `Show all ${countWithNoun(count, noun)}`;
}

/**
 * What the same disclosure says once it is open. "Show all 31 requests" stayed on the control
 * after the list unfolded, so it never said how to fold it again.
 */
export const SHOW_LESS_LABEL = 'Show less';

/** From this many rows, an open list also gets a "Show less" at its end. */
const SHOW_LESS_AT_END_FROM = 6;

/**
 * Whether an open list is long enough to need a second "Show less" after its last row. A reader
 * who scrolled to the end of a long list should not have to scroll back to its top to fold it;
 * on a short list the control at the top is already in view.
 */
export function showLessAtEnd(rowCount: number): boolean {
  return rowCount >= SHOW_LESS_AT_END_FROM;
}

/**
 * The leftover line under a category chart. Built as one string because the template wrote it
 * as two adjacent expressions, and the space between them was lost in the rendered page
 * ("3 more types · 7requests").
 */
export function categoryRestLine(restTypes: number, restCount: number, noun: CountNoun): string {
  return `${countWithNoun(restTypes, { one: 'more type', many: 'more types' })} · ${countWithNoun(restCount, noun)}`;
}

/**
 * Under an ISD count that is now a count of cases: how many code lines those cases hold, when
 * that differs. One inspection can cite six code lines on a single case number.
 */
export function caseLinesNote(lines: number, cases: number): string | null {
  if (lines <= cases) return null;
  return `${countWithNoun(lines, { one: 'code line', many: 'code lines' })} in ${countWithNoun(cases, { one: 'case', many: 'cases' })}`;
}

/** The same for Public Works: one ticket can carry several violation lines. */
export function ticketLinesNote(lines: number, tickets: number): string | null {
  if (lines <= tickets) return null;
  return `${countWithNoun(lines, { one: 'violation line', many: 'violation lines' })} on ${countWithNoun(tickets, { one: 'ticket', many: 'tickets' })}`;
}

/**
 * The assessor's residential unit count, as the facts strip words it. A blank says whose field
 * is blank. The building's own details can carry a unit count from elsewhere (the Boston seed
 * gives a three-family parcel 3 units from its land use when the assessor left the count
 * empty), and "units not recorded" printed beside "Units: 3" read as the site contradicting
 * itself. Zero is a recorded value and prints as one.
 */
export function assessorUnitsText(units: number | null | undefined): string {
  return units === null || units === undefined ? 'units not recorded by the assessor' : `units ${units}`;
}

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

/**
 * One-directional by design. RentSmart is a periodic roll-up of the same city data, so it
 * lagging the raw 311 feed is expected and unremarkable; only an excess — the roll-up
 * claiming more housing complaints than the records above show — is worth a note.
 *
 * RentSmart is matched by parcel (`sources/boston/rentsmart.ts`) while the 311 list is matched
 * by address, and a parcel can hold several addresses. The sentence says "this parcel" and
 * says why the two counts can differ, rather than claiming a gap at this address.
 */
export function rentSmartDisagreement(rows: RentSmartPayload[], listedRequestCount: number): string | null {
  const complaintCount = rows.filter(
    (row) => (row.violationType ?? '').trim().toLowerCase() === 'housing complaints',
  ).length;
  if (complaintCount <= listedRequestCount) return null;
  const noun = complaintCount === 1 ? 'housing complaint' : 'housing complaints';
  return `The city's RentSmart summary reports ${complaintCount} ${noun} for this parcel; the 311 records above show ${listedRequestCount}. A parcel can include more than one address.`;
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
 * wording differs because its cap applies before the 311 grouping: the rows beyond it were
 * not weighed at all, rather than fetched and left off a list.
 */
export const CAPPED_REQUESTS_COPY = `First ${ROW_CAP} requests considered.`;
export const CAPPED_ROWS_COPY = `First ${ROW_CAP} shown.`;
/**
 * ISD and Public Works are counted by case and by ticket, but the cap counts stored lines. "First
 * 500 shown." beside "430 tickets" would read as 500 tickets listed, so these name the unit
 * the cap applies to. When it bites, the last case or ticket in the list may be missing lines.
 */
export const CAPPED_CODE_LINES_COPY = `First ${ROW_CAP} code lines shown.`;
export const CAPPED_VIOLATION_LINES_COPY = `First ${ROW_CAP} violation lines shown.`;

// Reader-facing request button and page states (design spec Section 4). The button asks the
// companion Worker to fetch; nothing is fetched in the request. Copy stays here so the
// banned-words scan covers it.
export const REQUEST_BUTTON_LABEL = "Get this building's city records";
export const REQUEST_BUTTON_HELP =
  'Permits, violations, code enforcement tickets, and 311 requests are fetched from the city when someone asks. It takes a few minutes.';
export const REQUEST_VERIFYING_COPY = 'Checking that you are a person, then sending the request.';
export const REQUESTED_COPY = 'Records requested. They usually appear within a few minutes; reload to check.';
export const FILL_QUEUED_COPY = 'Queued for the city-wide pass.';
/**
 * The queue row for this building used up its claims, so nothing will happen to it until a
 * human retries it from the admin panel, where parked rows are listed. `REQUESTED_COPY`
 * would keep telling the reader to reload a page that is not going to change, so this says
 * what is true — the request stands, set aside for a person — and stops asking.
 */
export const REQUEST_PARKED_COPY =
  'These records could not be retrieved yet. The request has been set aside for a closer look.';
export const REQUEST_ALREADY_PULLED_COPY = 'These records have already been retrieved. Reload to see them.';
export const REQUEST_FAILED_COPY = 'The request did not go through. Please try again.';
/**
 * Turnstile's own `error-callback` / `timeout-callback` — the widget could not reach
 * Cloudflare, or the challenge expired before it was solved. Shown by the correction form,
 * which stores the token rather than submitting on it, so there is nothing to undo beyond
 * clearing the token and telling the reader to press again. Same sentence the corrections
 * endpoint returns on a rejected token, so a reader sees one wording either way.
 *
 * The request button says this too when its widget reports a failure: nothing was sent, so
 * `REQUEST_FAILED_COPY` would name the wrong thing. That one stays for a POST that came
 * back wrong and for an api.js that never loads at all.
 */
export const TURNSTILE_FAILED_COPY = 'Bot verification failed. Please try again.';

// The building page's no-reviews card and the search result line for a seeded building.
// Registered in PANEL_COPY for the banned-words scan; rendered by the building page and
// search, not the panel.
export const NO_REVIEWS_CARD_TITLE = 'No reviews yet.';
export const NO_REVIEWS_CARD_BODY = 'Lived here? Rate this place.';
export const NO_REVIEWS_BREAKDOWN_COPY = 'Rating breakdown appears after the first review.';
export const SEARCH_SEEDED_COPY = 'No reviews yet · city records';

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
 * A record's status word as the panel prints it, with one name for a blank. The city's word is
 * printed as recorded; this only stops an empty field from printing as nothing.
 */
export function statusText(status: string | null | undefined): string {
  return status === null || status === undefined || status.trim() === '' ? NOT_RECORDED : status;
}

/**
 * "Open" is the city's status word for a case with no recorded closing action, and a reader
 * takes it to mean the problem is there today. A 311 request opened years ago and never closed
 * still reads "Open" in the feed. The panel keeps every such record and words it as what the
 * record says: open in the city's records, not open in the building. Permits do not use this
 * wording, because an open permit is an active one and its status stays as recorded.
 */
export const STILL_OPEN_LABEL = 'Still open in city records';

/** One line under the open list, so the label is not read as a statement about today. */
export const STILL_OPEN_NOTE =
  'Open means the city has not recorded a closing action. It does not confirm the problem exists today.';

/** The heading over a section's open cases, with their count. */
export function stillOpenHeading(count: number): string {
  return `${STILL_OPEN_LABEL} (${count})`;
}

/**
 * What an open 311, ISD or Public Works row prints in place of the bare word "Open". `filedAt`
 * is the date the case was opened, when the feed carries one, and only its year is used: the
 * row's own date column already shows the full date, so the label is never more precise than
 * the panel. An unreadable or missing date leaves the year off rather than inventing one.
 * The ISD and Public Works feeds carry a status date only, which is not a filing date, so
 * their rows pass null.
 */
export function stillOpenLabel(filedAt: string | null): string {
  // formatRecordDate decides what a readable record date is; a value it cannot read has no year.
  if (!filedAt || formatRecordDate(filedAt) === formatRecordDate(null)) return STILL_OPEN_LABEL;
  return `${STILL_OPEN_LABEL}, filed ${filedAt.slice(0, 4)}`;
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

/** `2014`, `2011 and 2014`, `2011, 2012 and 2014`. */
function joinYears(years: readonly number[]): string {
  if (years.length <= 1) return years.map(String).join('');
  return `${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;
}

/**
 * Under a 311 year chart whose span crosses a year the city's 311 API returns no rows for (see
 * `EMPTY_311_YEARS` in `ledger.ts`). The bar for that year is drawn as missing rather than as a
 * zero, and this says why. Null when the chart crosses no such year.
 */
export function missingYearsNote(years: readonly number[]): string | null {
  if (years.length === 0) return null;
  return years.length === 1
    ? `${years[0]} is marked as missing data, not zero. The city's open data API currently returns no 311 records for that year.`
    : `${joinYears(years)} are marked as missing data, not zero. The city's open data API currently returns no 311 records for those years.`;
}

/**
 * The accessible label on a year chart: the total in the right number, the span, and any year
 * drawn as missing. It read "1 requests across 2026 to 2026" before; one year now reads "in".
 */
export function yearChartLabel(
  title: string,
  total: number,
  noun: CountNoun,
  firstYear: number,
  lastYear: number,
  missingYears: readonly number[] = [],
): string {
  const span = firstYear === lastYear ? `in ${firstYear}` : `across ${firstYear} to ${lastYear}`;
  const missing = missingYears.length > 0 ? `, no data for ${joinYears(missingYears)}` : '';
  return `${title}: ${countWithNoun(total, noun)} ${span}${missing}`;
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
  PERMIT_COVERAGE_NOTE,
  DECLARED_VALUATION_CAVEAT,
  GROUPING_NOTE,
  GROUPING_LINK_TEXT,
  CONDOMINIUM_COPY,
  NO_VIOLATIONS_CAVEAT,
  NEVER_PULLED_COPY,
  CAPPED_REQUESTS_COPY,
  CAPPED_ROWS_COPY,
  CAPPED_CODE_LINES_COPY,
  CAPPED_VIOLATION_LINES_COPY,
  REQUEST_BUTTON_LABEL,
  REQUEST_BUTTON_HELP,
  REQUEST_VERIFYING_COPY,
  REQUESTED_COPY,
  FILL_QUEUED_COPY,
  REQUEST_PARKED_COPY,
  REQUEST_ALREADY_PULLED_COPY,
  REQUEST_FAILED_COPY,
  TURNSTILE_FAILED_COPY,
  NO_REVIEWS_CARD_TITLE,
  NO_REVIEWS_CARD_BODY,
  NO_REVIEWS_BREAKDOWN_COPY,
  SEARCH_SEEDED_COPY,
  STILL_OPEN_LABEL,
  STILL_OPEN_NOTE,
  SHOW_LESS_LABEL,
  ...Object.fromEntries(
    Object.entries(KIND_LABELS).map(([kind, label]) => [`KIND_LABELS.${kind}`, label]),
  ),
  // The group headings and their one-line descriptions are defined beside the table that
  // fills the groups, but they are panel copy and are scanned here with the rest.
  ...Object.fromEntries(
    RECORD_GROUPS.flatMap((group) => [
      [`RECORD_GROUPS.${group.id}.title`, group.title],
      [`RECORD_GROUPS.${group.id}.description`, group.description],
    ]),
  ),
  'unavailableCopy()': unavailableCopy(SAMPLE_PULL_DATE),
  'openSubCount() — empty': openSubCount(0, 0),
  'openSubCount() — all closed': openSubCount(0, 3),
  'openSubCount() — some open': openSubCount(2, 3),
  'stillOpenHeading()': stillOpenHeading(2),
  'stillOpenLabel() — filed year': stillOpenLabel('2013-04-02'),
  'formatRecordDate() — no date': formatRecordDate(null),
  'formatPullDate() — no date': formatPullDate(Number.NaN),
  'rentSmartDisagreement()': rentSmartDisagreement([SAMPLE_RENTSMART_ROW], 0) ?? '',
  'otherRequestsLine() — one': otherRequestsLine(1) ?? '',
  'otherRequestsLine() — many': otherRequestsLine(4) ?? '',
  'showAllLabel() — one': showAllLabel(1, { one: 'request', many: 'requests' }),
  'showAllLabel() — many': showAllLabel(3, { one: 'request', many: 'requests' }),
  'categoryRestLine()': categoryRestLine(5, 8, { one: 'request', many: 'requests' }),
  'caseLinesNote()': caseLinesNote(6, 1) ?? '',
  'ticketLinesNote()': ticketLinesNote(12, 9) ?? '',
  'assessorUnitsText() — blank': assessorUnitsText(null),
  'missingYearsNote() — one': missingYearsNote([2014]) ?? '',
  'missingYearsNote() — two': missingYearsNote([2011, 2014]) ?? '',
  'yearChartLabel()': yearChartLabel('Requests by year opened', 1, { one: 'request', many: 'requests' }, 2013, 2026, [2014]),
};
