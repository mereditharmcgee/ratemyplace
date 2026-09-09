import { addressKey, toCanonicalParcel } from '../identity';
import { zip5 } from './sam';
import type { ExistingBuilding, SeedBuilding } from './types';

export type UnmatchedReason =
  | 'unparseable_address'
  | 'no_parcel_for_address'
  /** The existing range crosses a parcel edge without swallowing one: 21-25 against a 23-27 parcel. */
  | 'range_overlaps_parcel_boundary'
  /** The existing range contains a whole parcel, so it is probably several parcels' worth of building. */
  | 'existing_spans_multiple_parcels'
  | 'ambiguous';

export interface UnmatchedBuilding {
  building: ExistingBuilding;
  reason: UnmatchedReason;
  /** The parcels that made this undecidable; empty when nothing on the street came close. */
  candidates: SeedBuilding[];
}

export interface MatchResult {
  matched: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
  /** The existing row already carries a different parcel id; never overwritten, listed for a human. */
  conflicts: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
  unmatched: UnmatchedBuilding[];
  /**
   * Every parcel an existing row has a claim on — matched, in conflict, or named as a
   * candidate in an outcome a human still has to resolve. The script subtracts this from
   * the parcels it creates, so a parcel awaiting review is never seeded as a twin of the
   * row that is arguing with it.
   */
  claimedParcels: Set<string>;
}

/**
 * Existing production rows onto seeded parcels: by parcel id when the row already carries
 * one, otherwise by street key and range containment, with the row's ZIP breaking a
 * two-parcel tie. Nothing is guessed — a partial overlap, a tie the ZIP cannot break, or a
 * disagreeing parcel id is reported, not resolved. Parcel ids are canonicalized on both
 * sides before any comparison, since the two feeds disagree about the leading zero.
 */
/**
 * A parcel range contains an address range when the numbers fall inside it AND, for a
 * parcel whose two ends share parity, the address shares that parity too. Boston numbers
 * the two sides of a street separately: "61-69 Chiswick Rd" is the odd side, so 66 is not
 * in it even though 61 <= 66 <= 69. A parcel with mixed-parity ends ("6-9") spans both
 * sides and contains every number in between.
 */
export function rangeContains(parcel: { numLo: number; numHi: number }, key: { numLo: number; numHi: number }): boolean {
  if (!(parcel.numLo <= key.numLo && key.numHi <= parcel.numHi)) return false;
  const parcelParity = parcel.numLo % 2;
  const singleSide = parcel.numLo !== parcel.numHi && parcelParity === parcel.numHi % 2;
  if (!singleSide) return true;
  return key.numLo % 2 === parcelParity && key.numHi % 2 === parcelParity;
}

export function matchExistingBuildings(existing: readonly ExistingBuilding[], parcels: readonly SeedBuilding[]): MatchResult {
  const byStreet = new Map<string, SeedBuilding[]>();
  const byParcel = new Map<string, SeedBuilding>();
  for (const parcel of parcels) {
    const list = byStreet.get(parcel.streetKey) ?? [];
    list.push(parcel);
    byStreet.set(parcel.streetKey, list);
    const canonical = toCanonicalParcel(parcel.parcelId);
    if (canonical) byParcel.set(canonical, parcel);
  }

  const result: MatchResult = { matched: [], conflicts: [], unmatched: [], claimedParcels: new Set() };
  const claim = (parcel: SeedBuilding): void => {
    result.claimedParcels.add(parcel.parcelId);
  };
  const unmatched = (building: ExistingBuilding, reason: UnmatchedReason, candidates: SeedBuilding[]): void => {
    result.unmatched.push({ building, reason, candidates });
    for (const parcel of candidates) claim(parcel);
  };

  for (const building of existing) {
    // The row's own parcel id wins outright: it is the assessor's identifier, not an inference.
    const claimed = toCanonicalParcel(building.parcel_id);
    const byId = claimed ? byParcel.get(claimed) : undefined;
    if (byId) {
      result.matched.push({ building, parcel: byId });
      claim(byId);
      continue;
    }

    const key = addressKey(building.address);
    if (!key) {
      unmatched(building, 'unparseable_address', []);
      continue;
    }
    const candidates = byStreet.get(key.streetKey) ?? [];
    const contained = candidates.filter((p) => rangeContains(p, key));

    if (contained.length > 1) {
      // Same street, same number, two parcels: only the ZIP can separate them, and only
      // when the existing row has one and the parcels disagree about it.
      const zip = zip5(building.zip_code);
      const sameZip = zip ? contained.filter((p) => p.zip === zip) : [];
      if (sameZip.length !== 1) {
        unmatched(building, 'ambiguous', contained);
        continue;
      }
      result.matched.push({ building, parcel: sameZip[0] });
      claim(sameZip[0]);
      continue;
    }

    if (contained.length === 0) {
      const overlapping = candidates.filter((p) => p.numLo <= key.numHi && key.numLo <= p.numHi);
      if (overlapping.length === 0) {
        unmatched(building, 'no_parcel_for_address', []);
        continue;
      }
      const swallows = overlapping.some((p) => key.numLo <= p.numLo && p.numHi <= key.numHi);
      unmatched(building, swallows ? 'existing_spans_multiple_parcels' : 'range_overlaps_parcel_boundary', overlapping);
      continue;
    }

    const parcel = contained[0];
    if (building.parcel_id && claimed !== parcel.parcelId) {
      result.conflicts.push({ building, parcel });
      claim(parcel);
      continue;
    }
    result.matched.push({ building, parcel });
    claim(parcel);
  }
  return result;
}
