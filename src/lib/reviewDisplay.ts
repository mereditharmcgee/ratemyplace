/**
 * Display helpers for public review cards and the review summary on building pages.
 *
 * Leaf module: no runtime imports, so a React island can use it without pulling server
 * code into the client bundle.
 */

import type { UnitType } from './types';

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  studio: 'Studio',
  '1br': '1 bedroom',
  '2br': '2 bedrooms',
  '3br': '3 bedrooms',
  '4br+': '4+ bedrooms',
  house: 'House',
};

// Every value of `bedroomOptions` in formOptions.ts, plus the legacy '0' for a studio.
const UNIT_TYPE_BY_BEDROOMS: Record<string, UnitType> = {
  studio: 'studio',
  '0': 'studio',
  '1': '1br',
  '2': '2br',
  '3': '3br',
  '4': '4br+',
  '5+': '4br+',
};

/** The unit type for a bedrooms answer, or null when the answer is missing or unknown. */
export function unitTypeFromBedrooms(bedrooms: unknown): UnitType | null {
  if (bedrooms === null || bedrooms === undefined) return null;
  return UNIT_TYPE_BY_BEDROOMS[String(bedrooms)] ?? null;
}

/**
 * The unit type to show and group by. The review form asks only for bedrooms; the stored
 * unit_type is derived from it, and that derivation once turned a studio or a 5+ bedroom
 * answer into '1br'. So the bedrooms answer wins when it is known. A house stays a house:
 * that is a kind of home, not a bedroom count.
 */
export function resolveUnitType(review: { unit_type?: string | null; bedrooms?: string | null }): string | null {
  if (review.unit_type === 'house') return 'house';
  return unitTypeFromBedrooms(review.bedrooms) ?? review.unit_type ?? null;
}

export function unitTypeLabel(unitType: string | null | undefined): string | null {
  if (!unitType) return null;
  return UNIT_TYPE_LABELS[unitType as UnitType] ?? unitType;
}

/** Short label for the bedrooms chip on a review card: "Studio", "1 bed", "2 beds", "5+ beds". */
export function bedroomsLabel(bedrooms: unknown): string | null {
  if (bedrooms === null || bedrooms === undefined || bedrooms === '') return null;
  const value = String(bedrooms);
  if (unitTypeFromBedrooms(value) === 'studio') return 'Studio';
  return `${value} bed${value === '1' ? '' : 's'}`;
}

/** The answers the review form offers to "Would you recommend this unit?" (`supplementaryItems`). */
export type RecommendAnswer = 'yes' | 'maybe' | 'no';

export const RECOMMEND_LABELS: Record<RecommendAnswer, string> = {
  yes: 'Would recommend',
  maybe: 'Maybe / It depends',
  no: 'Would not recommend',
};

/**
 * The review card's recommend answer, or null when the reviewer skipped the optional question
 * or the stored value is not one the form offers. Null shows no badge. The aggregate rate in
 * `scoring.ts` classifies answers its own way and is not changed by this.
 */
export function recommendAnswer(value: unknown): RecommendAnswer | null {
  return value === 'yes' || value === 'maybe' || value === 'no' ? value : null;
}

// ---------------------------------------------------------------------------------------
// Rent and square footage as ranges
//
// Exact rent and square footage, together with bedrooms and bathrooms, can let a landlord
// work out which unit, and so which tenant, wrote a review. The exact values stay stored for
// admins and for the reviewer's own edit form; every public surface shows a band from here
// instead (owner decision, 2026-11-17). Like privacy.ts this is a safety control: do not add
// a public display path that bypasses it, and do not narrow the bands.
//
// The open bounds sit where a $250 or 250 sq ft band would hold too few units to hide one:
// - Rent under $1,000 is almost never a market rent in Boston or New Haven. It is usually a
//   tenant's share under a voucher or income-based rent, so a narrow band there would point
//   at a subsidized household. One open band covers all of it.
// - Rent from $6,000 is a thin tail (large houses, luxury units), where each $250 band would
//   hold a unit or two in a building.
// - Under 500 sq ft is studio and single-room territory, where reported sizes cluster.
// - From 2,000 sq ft is whole houses and the largest apartments, a thin tail again.
// ---------------------------------------------------------------------------------------

/** A display band. `lo` is null for the open band at the bottom, `hi` for the one at the top. */
export interface DisplayBand {
  lo: number | null;
  hi: number | null;
}

/** Band width and the two open bounds, each a multiple of the width. */
export interface BandScale {
  width: number;
  openBelow: number;
  openFrom: number;
}

export const RENT_BANDS: BandScale = { width: 250, openBelow: 1000, openFrom: 6000 };
export const SQUARE_FOOTAGE_BANDS: BandScale = { width: 250, openBelow: 500, openFrom: 2000 };

/** Every word the range labels use, in one place for the owner to edit. */
export const RANGE_COPY = {
  under: 'Under',
  to: 'to',
  andUp: '+',
  perMonth: '/mo',
  squareFeet: 'sq ft',
} as const;

interface BandFormat {
  amount: (n: number) => string;
  suffix: string;
}

function withCommas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const RENT_FORMAT: BandFormat = { amount: (n) => `$${withCommas(n)}`, suffix: RANGE_COPY.perMonth };
const SQUARE_FOOTAGE_FORMAT: BandFormat = { amount: withCommas, suffix: ` ${RANGE_COPY.squareFeet}` };

/** A stored number or numeric string above zero, or null. Zero is how a skipped field reads. */
function positiveAmount(value: unknown): number | null {
  let n = Number.NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function bandFor(value: unknown, scale: BandScale): DisplayBand | null {
  const n = positiveAmount(value);
  if (n === null) return null;
  if (n < scale.openBelow) return { lo: null, hi: scale.openBelow };
  if (n >= scale.openFrom) return { lo: scale.openFrom, hi: null };
  const lo = Math.floor(n / scale.width) * scale.width;
  return { lo, hi: lo + scale.width };
}

/** "$2,250 to $2,500/mo" for one band, or from the low band's floor to the high band's ceiling. */
function spanLabel(low: DisplayBand, high: DisplayBand, format: BandFormat): string {
  const { amount, suffix } = format;
  const oneBand = low.lo === high.lo && low.hi === high.hi;
  if (oneBand && low.lo === null) return `${RANGE_COPY.under} ${amount(low.hi as number)}${suffix}`;
  if (oneBand && low.hi === null) return `${amount(low.lo as number)}${RANGE_COPY.andUp}${suffix}`;
  const start = low.lo === null ? `${RANGE_COPY.under} ${amount(low.hi as number)}` : amount(low.lo);
  const end = high.hi === null ? `${amount(high.lo as number)}${RANGE_COPY.andUp}` : amount(high.hi);
  return `${start} ${RANGE_COPY.to} ${end}${suffix}`;
}

/** The rent band a value falls in, lower bound inclusive. Null when no rent was given. */
export function rentBand(value: unknown): DisplayBand | null {
  return bandFor(value, RENT_BANDS);
}

/** The square footage band a value falls in, lower bound inclusive. Null when none was given. */
export function squareFootageBand(value: unknown): DisplayBand | null {
  return bandFor(value, SQUARE_FOOTAGE_BANDS);
}

/** "$2,250 to $2,500/mo", "Under $1,000/mo" or "$6,000+/mo"; null when no rent was given. */
export function rentRangeLabel(value: unknown): string | null {
  const band = rentBand(value);
  return band ? spanLabel(band, band, RENT_FORMAT) : null;
}

/** "750 to 1,000 sq ft", "Under 500 sq ft" or "2,000+ sq ft"; null when none was given. */
export function squareFootageRangeLabel(value: unknown): string | null {
  const band = squareFootageBand(value);
  return band ? spanLabel(band, band, SQUARE_FOOTAGE_FORMAT) : null;
}

/**
 * One rent line for several reviews, such as a unit group on a building page. Each rent is
 * banded first and the exact values are not read again, so the line runs from the lowest
 * band's floor to the highest band's ceiling and says nothing the review cards' own bands do
 * not. A group of one shows that review's band. Null when no review gave a rent.
 */
export function rentRangeAcross(values: readonly unknown[]): string | null {
  const bands = values.map(rentBand).filter((band): band is DisplayBand => band !== null);
  if (bands.length === 0) return null;
  const floor = (band: DisplayBand) => band.lo ?? Number.NEGATIVE_INFINITY;
  const sorted = [...bands].sort((a, b) => floor(a) - floor(b));
  return spanLabel(sorted[0], sorted[sorted.length - 1], RENT_FORMAT);
}

/**
 * Shown in the building page's "Common issues reported" box when no review checked any of
 * the four yes/no issue questions. It names those questions, so it does not read as "these
 * reviews describe no problems" next to a review whose ratings or text describe some.
 */
export const NO_CHECKLIST_ISSUES_COPY = 'No reviewer marked pest, heat, plumbing or deposit issues.';
