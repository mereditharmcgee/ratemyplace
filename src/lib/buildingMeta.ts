import { displayLocality } from './locality';
import { jurisdictionForCity } from './records/jurisdiction';

export interface BuildingMetaInput {
  address: string;
  city: string | null;
  neighborhood?: string | null;
  parcel_id: string | null;
}

/**
 * Title and description for a building page. A building in a city whose records we can pull,
 * with a parcel and no approved review, is a city-records page and says so (design spec
 * Section 6); the moment a review exists, the review metadata takes over. Eligibility is
 * `jurisdictionForCity` rather than a strict `city === 'Boston'`, so this agrees with the
 * request button, the queue, and the rest of the coverage work about which buildings have
 * records at all. `BaseLayout` appends " | RateMyPlace".
 */
export function buildingPageMeta(
  building: BuildingMetaInput,
  approvedReviewCount: number,
): { title: string; description: string } {
  // Matched against 'boston' rather than just non-null: the copy below names the city it
  // describes, so a jurisdiction added later falls back to the review metadata instead of
  // claiming City of Boston records for a building somewhere else.
  const jurisdiction =
    approvedReviewCount === 0 && building.parcel_id !== null ? jurisdictionForCity(building.city) : null;
  if (jurisdiction !== 'boston') {
    return { title: building.address, description: `Reviews for ${building.address} in ${displayLocality(building)}` };
  }
  // Some seeded addresses already carry the city, so the suffix is only added when it is
  // missing — otherwise the title reads "Boston" twice.
  const suffix = /,\s*boston\b/i.test(building.address) ? '' : ', Boston';
  return {
    title: `${building.address}${suffix}`,
    description: `City of Boston records for ${building.address}: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.`,
  };
}
