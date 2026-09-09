import { describe, expect, it } from 'vitest';
import { matchExistingBuildings } from '../records/seed/match';
import type { ExistingBuilding, SeedBuilding } from '../records/seed/types';

const seed = (o: Partial<SeedBuilding>): SeedBuilding => ({
  parcelId: '2102098000', address: '23-27 Lanark Road', streetKey: 'LANARK RD', numLo: 23, numHi: 27, neighborhood: 'Brighton', zip: '02135',
  unitCount: 12, yearBuilt: 1925, buildingType: 'apartment', latitude: 42.3, longitude: -71.1, samId: '83763',
  assessment: { fiscalYear: 'FY2026' } as SeedBuilding['assessment'], ...o,
});
const existing = (o: Partial<ExistingBuilding>): ExistingBuilding => ({ id: 'b1', address: '23 Lanark Rd', slug: '23-lanark-rd-boston', parcel_id: null, latitude: null, longitude: null, zip_code: '02135', ...o });

/** Two Jamaica Plain / Allston parcels that both contain number 15, distinguished only by ZIP. */
const gordonJP = seed({ parcelId: '1400001000', address: '15-17 Gordon Street', streetKey: 'GORDON ST', numLo: 15, numHi: 17, zip: '02130' });
const gordonAllston = seed({ parcelId: '1400002000', address: '15 Gordon Street', streetKey: 'GORDON ST', numLo: 15, numHi: 15, zip: '02134' });
const onGordon = (o: Partial<ExistingBuilding>): ExistingBuilding => existing({ id: 'g1', address: '15 Gordon St', ...o });

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

  it('matches on the parcel id alone, canonicalized on both sides, before looking at the address', () => {
    // Nine digits in the existing row, ten in the seed; the address is on another street.
    const building = existing({ parcel_id: '100037000', address: '4 Nowhere Blvd' });
    const parcel = seed({ parcelId: '0100037000', streetKey: 'ELSEWHERE AVE', numLo: 4, numHi: 4 });
    const result = matchExistingBuildings([building], [parcel]);
    expect(result.matched).toEqual([{ building, parcel }]);
    expect(result.unmatched).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('breaks a two-parcel tie on the ZIP the existing row already carries', () => {
    const result = matchExistingBuildings([onGordon({ zip_code: '02130' })], [gordonJP, gordonAllston]);
    expect(result.matched.map((m) => m.parcel.parcelId)).toEqual(['1400001000']);
    expect(result.unmatched).toEqual([]);
  });
  it('reports the tie as ambiguous when the existing row has no ZIP', () => {
    const result = matchExistingBuildings([onGordon({ zip_code: null })], [gordonJP, gordonAllston]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe('ambiguous');
    expect(result.unmatched[0].candidates.map((p) => p.parcelId)).toEqual(['1400001000', '1400002000']);
  });
  it('reports the tie as ambiguous when both parcels share the ZIP', () => {
    const result = matchExistingBuildings([onGordon({ zip_code: '02130' })], [gordonJP, seed({ ...gordonAllston, zip: '02130' })]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe('ambiguous');
  });

  it('reports an address with no parcel and an unparseable address', () => {
    const result = matchExistingBuildings(
      [existing({ id: 'x', address: '99 Lanark Rd' }), existing({ id: 'y', address: 'Lanark Rd' })],
      [seed({})],
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched.map((u) => [u.building.id, u.reason])).toEqual([['x', 'no_parcel_for_address'], ['y', 'unparseable_address']]);
  });
  it('separates a range that crosses a parcel edge from one that swallows a whole parcel', () => {
    const crosses = matchExistingBuildings([existing({ address: '21-25 Lanark Rd' })], [seed({})]);
    expect(crosses.unmatched.map((u) => u.reason)).toEqual(['range_overlaps_parcel_boundary']);
    expect(crosses.unmatched[0].candidates.map((p) => p.parcelId)).toEqual(['2102098000']);
    const swallows = matchExistingBuildings([existing({ address: '21-31 Lanark Rd' })], [seed({})]);
    expect(swallows.unmatched.map((u) => u.reason)).toEqual(['existing_spans_multiple_parcels']);
    expect(swallows.unmatched[0].candidates.map((p) => p.parcelId)).toEqual(['2102098000']);
  });
  it('respects street-side parity: an even number is not inside an odd-only parcel range', () => {
    // The production dry run of 2026-09-09: 66 Chiswick Road saw two candidates, the odd
    // side "61-69" and the even side "66-70". Only the even side really contains 66.
    const oddSide = seed({ parcelId: '2102229000', address: '61-69 Chiswick Road', streetKey: 'CHISWICK RD', numLo: 61, numHi: 69, zip: '02135' });
    const evenSide = seed({ parcelId: '2102304000', address: '66-70 Chiswick Road', streetKey: 'CHISWICK RD', numLo: 66, numHi: 70, zip: '02135' });
    const result = matchExistingBuildings([existing({ id: 'c1', address: '66 Chiswick Rd' })], [oddSide, evenSide]);
    expect(result.matched.map((m) => m.parcel.parcelId)).toEqual(['2102304000']);
    expect(result.unmatched).toEqual([]);
  });

  it('treats a mixed-parity parcel range as spanning both sides', () => {
    const bothSides = seed({ parcelId: '2102229000', address: '6-9 A Street', streetKey: 'A ST', numLo: 6, numHi: 9 });
    const result = matchExistingBuildings([existing({ id: 'a1', address: '7 A St' }), existing({ id: 'a2', address: '8 A St' })], [bothSides]);
    expect(result.matched).toHaveLength(2);
  });

  it('reports two parcels claiming one address as ambiguous', () => {
    const result = matchExistingBuildings([existing({ address: '25 Lanark Rd' })], [seed({}), seed({ parcelId: '2102099000', numLo: 25, numHi: 25 })]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe('ambiguous');
  });

  it('claims every parcel a human still has to look at, so the seed never creates a twin for one', () => {
    const result = matchExistingBuildings(
      [
        existing({ id: 'm', address: '23 Lanark Rd' }),
        existing({ id: 'c', address: '25 Fenwood Rd', parcel_id: '0100037000' }),
        onGordon({ zip_code: null }),
        existing({ id: 's', address: '10-40 Wilcock St' }),
      ],
      [
        seed({}),
        seed({ parcelId: '3300123000', streetKey: 'FENWOOD RD', numLo: 25, numHi: 25 }),
        gordonJP,
        gordonAllston,
        seed({ parcelId: '4400001000', streetKey: 'WILCOCK ST', numLo: 20, numHi: 22 }),
      ],
    );
    expect(result.matched.map((m) => m.building.id)).toEqual(['m']);
    expect(result.conflicts.map((c) => c.building.id)).toEqual(['c']);
    expect([...result.claimedParcels].sort()).toEqual(['1400001000', '1400002000', '2102098000', '3300123000', '4400001000']);
  });
});
