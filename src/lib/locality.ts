// The geocoder that backfills `buildings.neighborhood` sometimes writes a
// street-name word instead of an actual neighborhood (e.g. "Commonwealth" for
// "1027 Commonwealth Avenue"). Displaying that verbatim reads as nonsense
// ("Commonwealth, Boston, MA" repeated across search results). This module
// centralizes the fallback so every surface that shows a building's locality
// agrees: if the stored neighborhood is blank, or is itself one of the words
// in the street address, fall back to the city instead.

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
//
// `src/lib/records/identity.ts` keeps the uppercase, space-preserving version of the same
// vocabulary (`TRAILING_LOCALITIES`, plus 'BOSTON' itself) for stripping a trailing
// locality off a street. Keep the two lists in step; worth folding into one data module
// later.
/**
 * Exported so one test can hold it against `identity.ts`'s `TRAILING_LOCALITIES`: the same
 * vocabulary in two spellings cannot be kept in step by a comment alone. Read-only to
 * callers — `isBostonLocality` is the predicate to use.
 */
export const BOSTON_NEIGHBORHOODS: ReadonlySet<string> = new Set([
  'allston',
  'brighton',
  'charlestown',
  'chinatown',
  'dorchester',
  'downtown',
  'fenway',
  'mattapan',
  'roslindale',
  'roxbury',
  'seaport',
  'hydepark',
  'jamaicaplain',
  'southboston',
  'eastboston',
  'westroxbury',
  'southend',
  'northend',
  'backbay',
  'beaconhill',
  'missionhill',
  'westend',
  // Postal city names for Boston ZIPs that are not the bare neighborhood name.
  'dorchestercenter',
  'roxburycrossing',
  'readville',
]);

// New Haven — production has New Haven addresses too.
const NEW_HAVEN_NEIGHBORHOODS = new Set(['westville', 'newhallville', 'dwight', 'dixwell']);

const KNOWN_NEIGHBORHOODS = new Set([...BOSTON_NEIGHBORHOODS, ...NEW_HAVEN_NEIGHBORHOODS]);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
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
 * Returns the neighborhood to display, unless it is empty/whitespace or
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
