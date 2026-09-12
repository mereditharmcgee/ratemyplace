// Maps a jurisdiction to its list of sources. New Haven has no source implementation yet,
// so it (and anything else unrecognized) resolves to no jurisdiction and an empty source
// list.
//
// City resolution itself lives in `./jurisdiction` (singular), which imports nothing: this
// file pulls in all six Boston source modules, so anything that only needs to ask "is this
// a Boston building?" — a React island above all — imports the leaf instead of this.
// `Jurisdiction`, `normalizeCity` and `jurisdictionForCity` are re-exported here so the
// server call sites that already import them from this module keep working.
import { jurisdictionForCity, normalizeCity, type Jurisdiction } from './jurisdiction';
import { assessorSource, ASSESSOR_YEARS } from './sources/boston/assessor';
import { enforcementSource } from './sources/boston/enforcement';
import { permitsSource } from './sources/boston/permits';
import { rentsmartSource } from './sources/boston/rentsmart';
import { serviceRequestsSource } from './sources/boston/serviceRequests';
import { violationsSource } from './sources/boston/violations';
import type { RecordSource } from './types';

export { jurisdictionForCity, normalizeCity };
export type { Jurisdiction };

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
