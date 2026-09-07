// Pure display helpers for the building records panel. Nothing here touches the
// database or the network: every function is a straight transform of already-validated
// payloads (see query.ts) into strings and view models.
//
// Product rule, non-negotiable: the panel has no opinion. Every rendered value is a
// field from a record or a count of records. BANNED_WORDS is the guardrail a test
// enforces against every exported copy constant so a future edit cannot smuggle in an
// editorial reading of the data.
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
