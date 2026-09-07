// Maps a building's city to the jurisdiction that knows how to pull records for it, and
// to that jurisdiction's list of sources. New Haven has no source implementation yet, so
// it (and anything else unrecognized) resolves to no jurisdiction and an empty source list.
import { assessorSource, ASSESSOR_YEARS } from './sources/boston/assessor';
import { enforcementSource } from './sources/boston/enforcement';
import { permitsSource } from './sources/boston/permits';
import { rentsmartSource } from './sources/boston/rentsmart';
import { serviceRequestsSource } from './sources/boston/serviceRequests';
import { violationsSource } from './sources/boston/violations';
import type { RecordSource } from './types';

export type Jurisdiction = 'boston';

/**
 * Strip a trailing ", XX" state, lowercase. Deliberately looser than
 * enrichment/dispatcher.ts, which requires an uppercase state and treats "Boston, ma" as
 * unrecognized.
 */
function normalizeCity(city: string): string {
  return city.replace(/,\s*[A-Z]{2}$/i, '').trim().toLowerCase();
}

export function jurisdictionForCity(city: string | null): Jurisdiction | null {
  if (!city) return null;
  return normalizeCity(city) === 'boston' ? 'boston' : null;
}

export function sourcesForCity(city: string | null): RecordSource[] {
  const jurisdiction = jurisdictionForCity(city);
  if (jurisdiction === null) return [];
  switch (jurisdiction) {
    case 'boston':
      return [...ASSESSOR_YEARS.map(assessorSource), permitsSource, violationsSource, enforcementSource, serviceRequestsSource, rentsmartSource];
    default: {
      // Exhaustiveness guard: adding a Jurisdiction without a source list here is a
      // compile error, not a silently empty result at runtime.
      const unreachable: never = jurisdiction;
      throw new Error(`sourcesForCity: no source list for jurisdiction "${unreachable}"`);
    }
  }
}
