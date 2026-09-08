import type { Building } from './types';

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
