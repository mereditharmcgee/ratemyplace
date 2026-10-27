import type { Building } from './types';
import type { AssessmentPayload } from './records/types';
import { impliedUnitsFor } from './records/seed/impliedUnits';

/**
 * The building fields shown in the "Building details" card, in display order.
 *
 * Single source of truth: both `hasBuildingDetails` and the `<dl>` template in
 * `src/pages/building/[slug].astro` map over this array, so a field cannot be
 * added to one without the other.
 */
export const BUILDING_DETAIL_FIELDS = ['building_type', 'year_built', 'unit_count'] as const;

export type BuildingDetailFields = Pick<Building, (typeof BUILDING_DETAIL_FIELDS)[number]>;

/**
 * Whether the "Building details" card on the building page has anything to show.
 */
export function hasBuildingDetails(building: BuildingDetailFields): boolean {
  return BUILDING_DETAIL_FIELDS.some((field) => Boolean(building[field]));
}

/** The unit count's label when a person or the assessor recorded the number. */
export const UNITS_LABEL = 'Units';

/** The unit count's label when the number is the Boston seed's estimate from the parcel's land use. */
export const ESTIMATED_UNITS_LABEL = 'Units (estimated from land use)';

/** The two assessor fields that say whether a stored unit count could be the seed's estimate. */
export type UnitCountEvidence = Pick<AssessmentPayload, 'landUse' | 'residentialUnits'>;

/**
 * Whether a building's stored `unit_count` is the Boston seed's land-use estimate rather than a
 * number someone recorded. There is no column saying who wrote the count, so this reads it off
 * the stored assessor record, the same one the facts strip shows: the seed estimates only when
 * the assessor left the unit count blank, and only for a land use it implies a count for (two
 * for R2, three for R3, `impliedUnitsFor`). A count that matches that estimate on such a
 * parcel is the estimate. A seed match also writes the estimate over a user-created row's
 * count, so this goes by the number, not by `buildings.source`.
 *
 * Errs toward the plain label: no assessor record, a count the assessor recorded, a land use
 * the seed does not estimate for, or any other number all read "Units". A person who entered
 * exactly the estimate on such a parcel gets the estimate's label; the stored data cannot tell
 * the two apart. A multi-building parcel the seed summed to a multiple of the estimate also
 * reads "Units"; there were none in production when this was written.
 */
export function isLandUseUnitEstimate(
  unitCount: number | null | undefined,
  assessment: UnitCountEvidence | null,
): boolean {
  if (!unitCount || assessment === null) return false;
  if (assessment.residentialUnits !== null && assessment.residentialUnits !== undefined) return false;
  return impliedUnitsFor(assessment.landUse) === unitCount;
}

/** The Building details label for a building's unit count. */
export function unitCountLabel(unitCount: number | null | undefined, assessment: UnitCountEvidence | null): string {
  return isLandUseUnitEstimate(unitCount, assessment) ? ESTIMATED_UNITS_LABEL : UNITS_LABEL;
}
