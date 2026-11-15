// The geocoder that backfills `buildings.neighborhood` sometimes writes a
// street-name word instead of an actual neighborhood (e.g. "Commonwealth" for
// "1027 Commonwealth Avenue"). Displaying that verbatim reads as nonsense
// ("Commonwealth, Boston, MA" repeated across search results). This module
// centralizes the fallback so every surface that shows a building's locality
// agrees: if the stored neighborhood is blank, or is itself one of the words
// in the street address, fall back to the city instead.

import { BOSTON_LOCALITY_NAMES, BOSTON_SUB_AREAS, BOSTON_ZIP_NEIGHBORHOODS } from './bostonLocalities';

interface LocalityBuilding {
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
}

// Every locality name a Boston building's city can be spelled as, in `normalize()` form
// (lowercase, non-alphanumerics stripped, so "Hyde Park" is 'hydepark'). Two jobs:
// `isBostonLocality` tests membership, and `displayLocality` trusts the single-word names
// that are also common street names, which the street-word heuristic below would otherwise
// wrongly discard (e.g. "45 Roxbury Street" really is in Roxbury). The multi-word names
// mostly do not need that rescue: `normalize()` strips punctuation, so a multi-word name can
// only equal a single address word when that word is hyphenated ("Hyde-Park Ave" normalizes
// to 'hydepark'), which is rare but real. They are listed both for that case and so the
// Boston vocabulary lives in one place. `readville` is single-word, so it is trusted the
// same way the rest of the single-word names are.
/**
 * Derived from `bostonLocalities.ts`, which is the one place a Boston locality name is
 * written down — `records/identity.ts` derives its uppercase, space-preserving twin from the
 * same list. 'boston' is dropped here: this is the *neighborhood* set, and `isBostonLocality`
 * tests the city name separately. Read-only to callers — `isBostonLocality` is the predicate
 * to use.
 */
export const BOSTON_NEIGHBORHOODS: ReadonlySet<string> = new Set(
  BOSTON_LOCALITY_NAMES.map(normalize).filter((name) => name !== 'boston')
);

// New Haven — production has New Haven addresses too.
const NEW_HAVEN_NEIGHBORHOODS = new Set(['westville', 'newhallville', 'dwight', 'dixwell']);

const KNOWN_NEIGHBORHOODS = new Set([...BOSTON_NEIGHBORHOODS, ...NEW_HAVEN_NEIGHBORHOODS]);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// `BOSTON_SUB_AREAS` keyed by `normalize()`, so "ABERDEEN", "aberdeen " and "Aberdeen"
// all find Brighton.
const SUB_AREA_TO_NEIGHBORHOOD: ReadonlyMap<string, string> = new Map(
  Object.entries(BOSTON_SUB_AREAS).map(([subArea, neighborhood]) => [normalize(subArea), neighborhood])
);

/**
 * The Boston neighborhood a Google-style sub-area sits in ("Aberdeen" -> "Brighton"), or the
 * value trimmed and otherwise unchanged when it is not a known sub-area. The caller decides
 * whether the building is in Boston; this only knows names.
 */
export function resolveBostonSubArea(value: string): string {
  const trimmed = value.trim();
  return SUB_AREA_TO_NEIGHBORHOOD.get(normalize(trimmed)) ?? trimmed;
}

/**
 * "Boston" or one of its neighborhoods, as Google Places and manual entry both spell the
 * city. A comma-delimited state tail is tolerated ("Boston, MA"); a comma-less one
 * ("Boston MA") is not, and no current writer produces that shape.
 */
export function isBostonLocality(city: string | null | undefined): boolean {
  if (!city) return false;
  const key = normalize(city.replace(/,\s*[A-Za-z]{2}\s*$/, ''));
  return key === 'boston' || BOSTON_NEIGHBORHOODS.has(key);
}

// `BOSTON_LOCALITY_NAMES` keyed by `normalize()`, so "east boston" and "EAST BOSTON" both find "East Boston".
const BOSTON_LOCALITY_BY_KEY: ReadonlyMap<string, string> = new Map(
  BOSTON_LOCALITY_NAMES.map((name) => [normalize(name), name])
);

/**
 * The display spelling, from `BOSTON_LOCALITY_NAMES`, of a value `isBostonLocality` accepts
 * ("east boston" -> "East Boston", "Boston, MA" -> "Boston"); null for anything else. Sub-areas
 * ("Aberdeen") are not locality names: pass the value through `displayLocality` first.
 */
export function bostonLocalityName(value: string | null | undefined): string | null {
  if (!value) return null;
  return BOSTON_LOCALITY_BY_KEY.get(normalize(value.replace(/,\s*[A-Za-z]{2}\s*$/, ''))) ?? null;
}

// `BOSTON_ZIP_NEIGHBORHOODS` as a Map, so a key such as "constructor" finds nothing rather
// than an Object method.
const ZIP_TO_NEIGHBORHOOD: ReadonlyMap<string, string> = new Map(Object.entries(BOSTON_ZIP_NEIGHBORHOODS));

/**
 * True when a city and state name a place in Boston: a Boston locality name, in
 * Massachusetts or with no state given (manual entry may leave it out). The city alone is not
 * enough here, because Brighton, Hyde Park, Charlestown and Roxbury are also towns in other
 * states, and a Brighton, NY neighborhood must not be read against Boston's vocabulary.
 */
export function isBostonPlace(city: string | null | undefined, state: string | null | undefined): boolean {
  if (!isBostonLocality(city)) return false;
  const code = state?.trim().toUpperCase() ?? '';
  return code === '' || code === 'MA' || code === 'MASSACHUSETTS';
}

/** The display spelling of a value as a Boston neighborhood: sub-areas resolved, plain "Boston" and unknown names null. */
function neighborhoodName(value: string | null | undefined): string | null {
  const name = value?.trim() ? bostonLocalityName(resolveBostonSubArea(value)) : null;
  return name && name !== 'Boston' ? name : null;
}

/**
 * The neighborhood to store for a new Boston building (`isBostonPlace` decides that), from
 * the name Google or a person supplied, the city, and the five-digit ZIP (normalize it with
 * `zip5` first). In order:
 *
 * 1. A sub-area reads as its neighborhood ("Aberdeen" -> "Brighton"), and a Boston locality
 *    name is kept in its display spelling.
 * 2. Otherwise, blank and plain "Boston" included, a city that is itself a neighborhood
 *    ("Allston") already places the building, so nothing is stored and display reads the
 *    city. The ZIP's name could contradict it ("Brighton, Allston").
 * 3. Otherwise the ZIP's neighborhood in `BOSTON_ZIP_NEIGHBORHOODS`, or null when the ZIP is
 *    not listed, and the page reads "Boston".
 */
export function bostonNeighborhoodFor(place: {
  neighborhood: string | null | undefined;
  city: string | null | undefined;
  zip: string | null | undefined;
}): string | null {
  const name = neighborhoodName(place.neighborhood);
  if (name) return name;
  if (neighborhoodName(place.city)) return null;
  return (place.zip ? ZIP_TO_NEIGHBORHOOD.get(place.zip.trim()) : undefined) ?? null;
}

function addressWords(address?: string | null): Set<string> {
  if (!address) return new Set();
  return new Set(
    address
      .split(/\s+/)
      .map((word) => normalize(word))
      .filter((word) => word.length > 0)
  );
}

/**
 * Returns the neighborhood to display (a Boston sub-area such as "Aberdeen" read as its
 * neighborhood, "Brighton", when the city is Boston), unless it is empty/whitespace or
 * matches (case-insensitively, trimmed) a whitespace-separated word from the
 * street address — in which case it falls back to the city (or '' if the
 * city is also missing). Known neighborhoods that happen to also be street
 * names (see KNOWN_NEIGHBORHOODS) are trusted before that street-word check
 * ever runs, so they're never discarded.
 */
export function displayLocality(building: LocalityBuilding): string {
  const neighborhood = building.neighborhood?.trim();
  const city = building.city?.trim() || '';

  if (!neighborhood) {
    return city;
  }

  // A Boston sub-area reads as its neighborhood. Gated on the city because the names are
  // not unique to Boston (Philadelphia has a Fairmount too).
  if (isBostonLocality(city)) {
    const alias = SUB_AREA_TO_NEIGHBORHOOD.get(normalize(neighborhood));
    if (alias) return alias;
  }

  const normalizedNeighborhood = normalize(neighborhood);
  if (KNOWN_NEIGHBORHOODS.has(normalizedNeighborhood)) {
    return neighborhood;
  }

  const words = addressWords(building.address);
  if (words.has(normalizedNeighborhood)) {
    return city;
  }

  return neighborhood;
}

/**
 * Builds a display line joining the resolved locality, the city (only when
 * it differs from the locality, so a city-fallback doesn't repeat itself),
 * and the state — skipping any blank parts.
 */
export function localityLine(building: LocalityBuilding, state?: string | null): string {
  const locality = displayLocality(building);
  const city = building.city?.trim() || '';

  // With no locality and no city there's nothing to anchor a state to —
  // don't render a bare state on its own.
  if (!locality && !city) {
    return '';
  }

  const parts: string[] = [];
  if (locality) parts.push(locality);
  if (city && normalize(city) !== normalize(locality)) parts.push(city);
  if (state && state.trim()) parts.push(state.trim());

  return parts.join(', ');
}
