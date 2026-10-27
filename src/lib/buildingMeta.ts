import { bostonLocalityName, displayLocality } from './locality';
import { jurisdictionForCity } from './records/jurisdiction';

export interface BuildingMetaInput {
  address: string;
  city: string | null;
  neighborhood?: string | null;
  parcel_id: string | null;
}

/** A Boston locality the address already names after a comma ("12 Elm St, South Boston"), in display form. */
function localityInAddress(address: string): string | null {
  if (/,\s*boston\b/i.test(address)) return 'Boston'; // the original guard; also catches "…, Boston MA"
  for (const part of address.split(',').slice(1).reverse()) {
    const name = bostonLocalityName(part);
    if (name !== null) return name;
  }
  return null;
}

/**
 * Where in Boston a records page is: `title` for <title>, `line` for the description. The
 * neighbourhood is named only when it is a real Boston locality, in its display spelling, so a
 * junk or out-of-city value ("St. Elizabeth's", "Chestnut Hill") falls back to plain Boston, and
 * Boston is never named twice. Exported for tests.
 */
export function bostonPlace(building: BuildingMetaInput): { title: string; line: string } {
  const named = localityInAddress(building.address);
  if (named !== null) {
    return { title: /\bboston$/i.test(named) ? building.address : `${building.address}, Boston`, line: building.address };
  }
  const name = bostonLocalityName(displayLocality(building));
  if (name === null || name === 'Boston') {
    const plain = `${building.address}, Boston`;
    return { title: plain, line: plain };
  }
  const line = `${building.address}, ${name}`;
  return { title: /\bboston$/i.test(name) ? line : `${line}, Boston`, line }; // East Boston, South Boston
}

/**
 * Title and description for a building page. A building in a city whose records we can pull,
 * with a parcel and no approved review, is a city-records page and says so (design spec
 * Section 6); the moment a review exists, the review metadata takes over. Eligibility is
 * `jurisdictionForCity` rather than a strict `city === 'Boston'`, so this agrees with the
 * request button, the queue, and the rest of the coverage work about which buildings have
 * records at all. Before October 2026, 711 seeded URLs shared a title with another page, so a
 * records page now names its neighbourhood (`bostonPlace`); twin parcels at one address and ZIP
 * (about 120 groups) still share one by design. `BaseLayout` appends " | RateMyPlace".
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
  const place = bostonPlace(building);
  return {
    title: place.title,
    description: `City of Boston records for ${place.line}: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.`,
  };
}
