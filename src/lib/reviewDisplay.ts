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

/**
 * Shown in the building page's "Common issues reported" box when no review checked any of
 * the four yes/no issue questions. It names those questions, so it does not read as "these
 * reviews describe no problems" next to a review whose ratings or text describe some.
 */
export const NO_CHECKLIST_ISSUES_COPY = 'No reviewer marked pest, heat, plumbing or deposit issues.';
