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

// Single-word neighborhoods that are also common street names, so the
// street-word heuristic below would otherwise wrongly discard them (e.g.
// "45 Roxbury Street" really is in Roxbury). These are checked first and
// always trusted. Multi-word names (Hyde Park, Jamaica Plain) need no entry
// here — a multi-word neighborhood can never equal a single address word, so
// the street-word test already leaves them alone.
const KNOWN_NEIGHBORHOODS = new Set([
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
  // New Haven — production has New Haven addresses too.
  'westville',
  'newhallville',
  'dwight',
  'dixwell',
]);

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
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
