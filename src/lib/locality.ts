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

function normalize(value: string): string {
  return value.trim().toLowerCase();
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
 * city is also missing).
 */
export function displayLocality(building: LocalityBuilding): string {
  const neighborhood = building.neighborhood?.trim();
  const city = building.city?.trim() || '';

  if (!neighborhood) {
    return city;
  }

  const words = addressWords(building.address);
  if (words.has(normalize(neighborhood))) {
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

  const parts: string[] = [];
  if (locality) parts.push(locality);
  if (city && normalize(city) !== normalize(locality)) parts.push(city);
  if (state && state.trim()) parts.push(state.trim());

  return parts.join(', ');
}
