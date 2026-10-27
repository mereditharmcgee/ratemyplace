// Whether the address-keyed record feeds (311, ISD violations, Public Works tickets) could be
// matched to a building with confidence. Those feeds key on house number and street, so a
// zero from them is only a finding when every number the building goes by was searched. When
// one was not, the panel says the records could not be matched with confidence instead of
// "none on record", and says why.
//
// Read side only: derived from the stored address and the stored current-year assessment, so
// it needs no column of its own and changes nothing that is written.
import { parseStreetAddress } from '../enrichment/helpers';
import { addressMatchUncertainty, expandHouseNumbers } from './identity';
import { zip5 } from './seed/sam';
import type { AddressMatchUncertainty, AssessmentPayload } from './types';

/**
 * `wide_range` / `mixed_parity`: the address itself could not be expanded (see
 * `expandHouseNumbers`). `parcel_wider`: the city's parcel covers house numbers this address
 * does not, and the feeds file records under those numbers too. `zip_differs`: the page's ZIP and
 * the parcel's disagree, and the feeds are narrowed by the page's ZIP.
 */
export type RecordsMatchUncertainty = AddressMatchUncertainty | 'parcel_wider' | 'zip_differs';

export interface MatchConfidenceInput {
  address: string | null;
  zip: string | null;
  /** The current fiscal year's assessment, when one is stored. */
  current: Pick<AssessmentPayload, 'parcelStreetNumber' | 'parcelStreetNumberHigh' | 'parcelZip'> | null;
}

function numberValue(value: string | null | undefined): number | null {
  const match = /^\s*(\d+)/.exec(value ?? '');
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The address's own numeric span, the way `buildIdentity` derives it. */
function addressSpan(address: string): { low: number; high: number } | null {
  const parsed = parseStreetAddress(address.trim());
  if (!parsed) return null;
  const parts = Array.from(new Set(parsed.number.toUpperCase().split('-').filter(Boolean)));
  return expandHouseNumbers(parts, parts).span;
}

/**
 * The first reason the address-keyed feeds may have missed records for this building, or null
 * when nothing says so. Errs toward null: a field that is absent (an assessment stored before
 * the parcel's own numbers were captured, a condominium with no parcel) is not evidence.
 */
export function recordsMatchUncertainty(input: MatchConfidenceInput): RecordsMatchUncertainty | null {
  if (!input.address) return null;
  const fromAddress = addressMatchUncertainty(input.address);
  if (fromAddress) return fromAddress;

  const current = input.current;
  if (!current) return null;

  // The ZIP first: the feeds are narrowed by the page's ZIP, so a wrong one can hide every
  // record at every number, where a wider parcel hides only the numbers the page leaves out.
  const pageZip = zip5(input.zip);
  const parcelZip = zip5(current.parcelZip);
  if (pageZip && parcelZip && pageZip !== parcelZip) return 'zip_differs';

  const span = addressSpan(input.address);
  const parcelValues = [numberValue(current.parcelStreetNumber), numberValue(current.parcelStreetNumberHigh)].filter(
    (n): n is number => n !== null,
  );
  if (span && parcelValues.length > 0) {
    const parcelLow = Math.min(...parcelValues);
    const parcelHigh = Math.max(...parcelValues);
    if (parcelLow < span.low || parcelHigh > span.high) return 'parcel_wider';
  }
  return null;
}
