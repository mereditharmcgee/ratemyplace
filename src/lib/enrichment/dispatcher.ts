import { BostonAdapter } from './adapters/boston';
import { NewHavenAdapter } from './adapters/new-haven';
import { NullAdapter } from './adapters/null';
import type { CityAdapter } from './types';

// Map of normalized city names to adapter constructors.
// Cambridge is NOT included — Boston Assessing API is City of Boston only;
// Cambridge has its own assessing database. Route Cambridge to NullAdapter until verified.
const CITY_ADAPTERS: Record<string, new () => CityAdapter> = {
  'boston': BostonAdapter,
  'new haven': NewHavenAdapter,
};

export function selectAdapter(city: string | null): CityAdapter {
  if (!city) return new NullAdapter();
  // Strip trailing state abbreviation (e.g., "Boston, MA" -> "boston")
  const key = city.replace(/,\s*[A-Z]{2}$/, '').trim().toLowerCase();
  const AdapterClass = CITY_ADAPTERS[key];
  return AdapterClass ? new AdapterClass() : new NullAdapter();
}
