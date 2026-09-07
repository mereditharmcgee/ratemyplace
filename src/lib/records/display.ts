// Pure display helpers for the building records panel. Nothing here touches the
// database or the network: every function is a straight transform of already-validated
// payloads (see query.ts) into strings and view models.
//
// Product rule, non-negotiable: the panel has no opinion. Every rendered value is a
// field from a record or a count of records. BANNED_WORDS is the guardrail a test
// enforces against every exported copy constant so a future edit cannot smuggle in an
// editorial reading of the data.
import { inferOwnerEntity } from '../enrichment/helpers';
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

/** No mailing address for an individual owner: it would be a home address, not a business one. */
export function showMailingAddress(owner: string | null): boolean {
  if (owner === null) return false;
  return inferOwnerEntity(owner) !== 'individual';
}

export function formatDollars(value: number | null): string {
  if (value === null) return 'Not recorded';
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
  declaredTotal: number;
  earliest: string | null;
  latest: string | null;
}

export function permitSummary(permits: PermitPayload[]): PermitSummary {
  let declaredTotal = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const permit of permits) {
    declaredTotal += permit.declaredValuation ?? 0;
    if (permit.issuedDate) {
      if (earliest === null || permit.issuedDate < earliest) earliest = permit.issuedDate;
      if (latest === null || permit.issuedDate > latest) latest = permit.issuedDate;
    }
  }
  return { count: permits.length, declaredTotal, earliest, latest };
}

export function splitServiceRequests(
  rows: ServiceRequestPayload[],
): { housing: ServiceRequestPayload[]; otherCount: number } {
  const housing = rows
    .filter((row) => row.classification === 'housing')
    .sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? ''));
  const otherCount = rows.filter((row) => row.classification === 'other').length;
  return { housing, otherCount };
}

export function rentSmartDisagreement(rows: RentSmartPayload[], housingRequestCount: number): string | null {
  const complaintCount = rows.filter((row) => row.violationType === 'Housing Complaints').length;
  if (complaintCount > housingRequestCount) {
    return `The city's RentSmart summary reports ${complaintCount} housing complaints for this address; the 311 records above show ${housingRequestCount}.`;
  }
  return null;
}
