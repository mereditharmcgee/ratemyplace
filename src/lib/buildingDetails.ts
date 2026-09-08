/**
 * Whether the "Building details" card on the building page has anything to show.
 *
 * Mirrors the exact truthiness checks the template uses for each `dt`/`dd` pair
 * (`building_type`, `year_built`, `unit_count`) so the card and this helper cannot
 * drift: if a field is added to the `<dl>`, add it here too.
 */
export function hasBuildingDetails(building: {
  building_type?: unknown;
  year_built?: unknown;
  unit_count?: unknown;
}): boolean {
  return Boolean(building.building_type) || Boolean(building.year_built) || Boolean(building.unit_count);
}
