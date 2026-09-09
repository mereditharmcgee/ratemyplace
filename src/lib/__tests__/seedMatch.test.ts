import { describe, expect, it } from 'vitest';
import { matchExistingBuildings } from '../records/seed/match';
import type { ExistingBuilding, SeedBuilding } from '../records/seed/types';

const seed = (o: Partial<SeedBuilding>): SeedBuilding => ({
  parcelId: '2102098000', address: '23-27 Lanark Road', streetKey: 'LANARK RD', numLo: 23, numHi: 27, neighborhood: 'Brighton', zip: '02135',
  unitCount: 12, yearBuilt: 1925, buildingType: 'apartment', latitude: 42.3, longitude: -71.1, samId: '83763',
  assessment: { fiscalYear: 'FY2026' } as SeedBuilding['assessment'], ...o,
});
const existing = (o: Partial<ExistingBuilding>): ExistingBuilding => ({ id: 'b1', address: '23 Lanark Rd', slug: '23-lanark-rd-boston', parcel_id: null, latitude: null, longitude: null, ...o });

describe('matchExistingBuildings', () => {
  it('matches a number inside a seeded range on the same street key', () => {
    const result = matchExistingBuildings([existing({})], [seed({})]);
    expect(result.matched).toEqual([{ building: existing({}), parcel: seed({}) }]);
    expect(result.unmatched).toEqual([]);
  });
  it('matches a range that the parcel range contains', () => {
    const result = matchExistingBuildings([existing({ address: '23-25 Lanark Rd' })], [seed({})]);
    expect(result.matched).toHaveLength(1);
  });
  it('keeps an existing parcel id that agrees and reports one that disagrees', () => {
    const agree = matchExistingBuildings([existing({ parcel_id: '2102098000' })], [seed({})]);
    expect(agree.matched).toHaveLength(1);
    const disagree = matchExistingBuildings([existing({ parcel_id: '0100037000' })], [seed({})]);
    expect(disagree.matched).toEqual([]);
    expect(disagree.conflicts).toEqual([{ building: existing({ parcel_id: '0100037000' }), parcel: seed({}) }]);
  });
  it('reports an address with no parcel, an unparseable address, and an overlapping-but-not-contained range', () => {
    const result = matchExistingBuildings(
      [existing({ id: 'x', address: '99 Lanark Rd' }), existing({ id: 'y', address: 'Lanark Rd' }), existing({ id: 'z', address: '21-25 Lanark Rd' })],
      [seed({})],
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched.map((u) => [u.building.id, u.reason])).toEqual([['x', 'no_parcel_for_address'], ['y', 'unparseable_address'], ['z', 'range_overlaps_parcel_boundary']]);
  });
  it('reports two parcels claiming one address as ambiguous', () => {
    const result = matchExistingBuildings([existing({ address: '25 Lanark Rd' })], [seed({}), seed({ parcelId: '2102099000', numLo: 25, numHi: 25 })]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe('ambiguous');
  });
});
