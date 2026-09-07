// Pure display helpers for the building records panel. Nothing here touches the
// database or the network: every function is a straight transform of already-validated
// payloads (see query.ts) into strings and view models.
//
// Product rule, non-negotiable: the panel has no opinion. Every rendered value is a
// field from a record or a count of records. BANNED_WORDS is the guardrail a test
// enforces against every exported copy constant so a future edit cannot smuggle in an
// editorial reading of the data.
import { PERMIT_COVERAGE_START } from './sources/boston/permits';
import type { PermitPayload, RentSmartPayload, ServiceRequestPayload } from './types';

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

/** Word-boundary entity tokens. A bare substring test (INC in PRINCE) would publish an individual's home address. */
const ENTITY_TOKEN = /\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|TRUST|TRUSTEE|TRUSTEES|TRSTEE|TRSTEES|TR|TRS|LP|L\.P|LLP|LLLP|PARTNERSHIP|PARTNERS|REIT|REALTY|ASSOC|ASSOCIATES|ASSOCIATION|CONDOMINIUM|CONDO|AUTHORITY|COMMONWEALTH|CITY OF|HOUSING|DEVELOPMENT|HOLDINGS|PROPERTIES|GROUP|FUND|BANK|CHURCH|UNIVERSITY|COLLEGE|HOSPITAL)\b/;

/** No mailing address for an individual owner: it would be a home address, not a business one. */
export function showMailingAddress(owner: string | null): boolean {
  if (!owner) return false;
  return ENTITY_TOKEN.test(owner.toUpperCase().replace(/[.,]/g, ' '));
}

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
