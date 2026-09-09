import { describe, expect, it } from 'vitest';
import { buildingTypeFor, formatSeedAddress, seedSlug, titleCaseNeighborhood } from '../records/seed/format';

describe('formatSeedAddress', () => {
  it('spells the suffix out and title-cases the street', () => {
    expect(formatSeedAddress('23', '27', 'Lanark RD')).toBe('23-27 Lanark Road');
    expect(formatSeedAddress('1027', null, 'COMMONWEALTH AV')).toBe('1027 Commonwealth Avenue');
    expect(formatSeedAddress('432', null, 'Chelsea ST')).toBe('432 Chelsea Street');
  });
  it('keeps a directional and a single-letter street readable', () => {
    expect(formatSeedAddress('10', null, 'W BROADWAY')).toBe('10 W Broadway');
    expect(formatSeedAddress('6', '10', 'A ST')).toBe('6-10 A Street');
  });
  it('drops an equal or empty second number', () => {
    expect(formatSeedAddress('5', '5', 'Park ST')).toBe('5 Park Street');
    expect(formatSeedAddress('5', '', 'Park ST')).toBe('5 Park Street');
  });
  it('returns null without a number or street', () => {
    expect(formatSeedAddress(null, null, 'Park ST')).toBeNull();
    expect(formatSeedAddress('5', null, '')).toBeNull();
  });
});

describe('seedSlug', () => {
  it('follows the existing address-city convention', () => {
    expect(seedSlug('23-27 Lanark Road', new Set())).toBe('23-27-lanark-road-boston');
  });
  it('suffixes on collision and records the slug it took', () => {
    const taken = new Set(['5-park-street-boston']);
    expect(seedSlug('5 Park Street', taken)).toBe('5-park-street-boston-2');
    expect(taken.has('5-park-street-boston-2')).toBe(true);
    expect(seedSlug('5 Park Street', taken)).toBe('5-park-street-boston-3');
  });
});

describe('buildingTypeFor', () => {
  it('maps land use to the site building types', () => {
    expect(buildingTypeFor('R2')).toBe('two_family');
    expect(buildingTypeFor('R3')).toBe('three_family');
    expect(buildingTypeFor('R4')).toBe('apartment');
    expect(buildingTypeFor('A')).toBe('apartment');
    expect(buildingTypeFor('RC')).toBe('mixed_use');
  });
});

describe('titleCaseNeighborhood', () => {
  it('title-cases and nulls plain Boston', () => {
    expect(titleCaseNeighborhood('EAST BOSTON')).toBe('East Boston');
    expect(titleCaseNeighborhood('Jamaica Plain')).toBe('Jamaica Plain');
    expect(titleCaseNeighborhood('BOSTON')).toBeNull();
    expect(titleCaseNeighborhood(null)).toBeNull();
  });
});
