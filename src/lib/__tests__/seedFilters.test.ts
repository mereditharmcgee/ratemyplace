import { describe, expect, it } from 'vitest';
import { HOUSING_A_DESCRIPTIONS, SEED_LAND_USES, isSeedParcelRow } from '../records/seed/filters';

describe('isSeedParcelRow', () => {
  it('accepts every R2, R3, R4, and RC row regardless of description', () => {
    for (const lu of ['R2', 'R3', 'R4', 'RC']) {
      expect(isSeedParcelRow({ LU: lu, LU_DESC: 'ANYTHING' })).toBe(true);
    }
  });
  it('accepts A only for the housing descriptions', () => {
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'APT 7-30 UNITS' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'SUBSD HOUSING S- 8' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'ROOMING HOUSE' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'DAY CARE CENTER' })).toBe(false);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'ELDERLY HOME' })).toBe(false);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'RES PARKING LOT' })).toBe(false);
  });
  it('rejects condos, single-family, and land', () => {
    for (const lu of ['CD', 'CM', 'R1', 'RL', 'C', null]) {
      expect(isSeedParcelRow({ LU: lu, LU_DESC: 'APT 7-30 UNITS' })).toBe(false);
    }
  });
  it('trims and upper-cases before comparing', () => {
    expect(isSeedParcelRow({ LU: ' r3 ', LU_DESC: 'three-fam dwelling' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: ' luxury apartment ' })).toBe(true);
  });
  it('publishes the lists the filter uses', () => {
    expect(SEED_LAND_USES).toEqual(['A', 'R2', 'R3', 'R4', 'RC']);
    expect(HOUSING_A_DESCRIPTIONS).toContain('APT 100+ UNITS');
  });
});
