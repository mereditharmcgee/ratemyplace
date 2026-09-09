import { addressKey } from '../identity';
import type { ExistingBuilding, SeedBuilding } from './types';

export type UnmatchedReason = 'unparseable_address' | 'no_parcel_for_address' | 'range_overlaps_parcel_boundary' | 'ambiguous';

export interface MatchResult {
  matched: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
  /** The existing row already carries a different parcel id; never overwritten, listed for a human. */
  conflicts: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
  unmatched: Array<{ building: ExistingBuilding; reason: UnmatchedReason }>;
}

/**
 * Existing production rows onto seeded parcels, by street key and range containment.
 * Nothing is guessed: a partial overlap, two candidate parcels, or a disagreeing parcel id
 * is reported, not resolved.
 */
export function matchExistingBuildings(existing: readonly ExistingBuilding[], parcels: readonly SeedBuilding[]): MatchResult {
  const byStreet = new Map<string, SeedBuilding[]>();
  for (const parcel of parcels) {
    const list = byStreet.get(parcel.streetKey) ?? [];
    list.push(parcel);
    byStreet.set(parcel.streetKey, list);
  }
  const result: MatchResult = { matched: [], conflicts: [], unmatched: [] };
  for (const building of existing) {
    const key = addressKey(building.address);
    if (!key) {
      result.unmatched.push({ building, reason: 'unparseable_address' });
      continue;
    }
    const candidates = byStreet.get(key.streetKey) ?? [];
    const contained = candidates.filter((p) => p.numLo <= key.numLo && key.numHi <= p.numHi);
    if (contained.length > 1) {
      result.unmatched.push({ building, reason: 'ambiguous' });
      continue;
    }
    if (contained.length === 0) {
      const overlapping = candidates.some((p) => p.numLo <= key.numHi && key.numLo <= p.numHi);
      result.unmatched.push({ building, reason: overlapping ? 'range_overlaps_parcel_boundary' : 'no_parcel_for_address' });
      continue;
    }
    const parcel = contained[0];
    if (building.parcel_id && building.parcel_id !== parcel.parcelId) {
      result.conflicts.push({ building, parcel });
      continue;
    }
    result.matched.push({ building, parcel });
  }
  return result;
}
