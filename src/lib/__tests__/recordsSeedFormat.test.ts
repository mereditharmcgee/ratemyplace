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
  it('abbreviates a spelled-out leading directional, as splitSuffix does', () => {
    expect(formatSeedAddress('10', null, 'WEST BROADWAY')).toBe('10 W Broadway');
    expect(formatSeedAddress('7', null, 'NORTH ST')).toBe('7 North Street');
  });
  it('drops an equal or empty second number', () => {
    expect(formatSeedAddress('5', '5', 'Park ST')).toBe('5 Park Street');
    expect(formatSeedAddress('5', '', 'Park ST')).toBe('5 Park Street');
  });
  it('returns null without a number or street', () => {
    expect(formatSeedAddress(null, null, 'Park ST')).toBeNull();
    expect(formatSeedAddress('5', null, '')).toBeNull();
  });

  it('returns null for a degenerate street, the same rule buildIdentity throws on', () => {
    expect(formatSeedAddress('5', null, 'AVE')).toBeNull();
    expect(formatSeedAddress('5', null, '& ST')).toBeNull();
  });

  it('returns null for the assessor 0, which marks an unnumbered rear lot', () => {
    expect(formatSeedAddress('0', null, 'Lanark RD')).toBeNull();
    expect(formatSeedAddress('00', null, 'Lanark RD')).toBeNull();
    expect(formatSeedAddress(0, null, 'Lanark RD')).toBeNull();
  });

  it('renders a reversed or zero-padded range low to high, numerically', () => {
    expect(formatSeedAddress('27', '23', 'Lanark RD')).toBe('23-27 Lanark Road');
    expect(formatSeedAddress('5', '05', 'Park ST')).toBe('5 Park Street');
    expect(formatSeedAddress('05', null, 'Park ST')).toBe('5 Park Street');
  });

  it('keeps the assessor own mixed casing and title-cases around an apostrophe or hyphen', () => {
    expect(formatSeedAddress('1', null, "O'BRIEN CT")).toBe("1 O'Brien Court");
    expect(formatSeedAddress('1', null, 'McBride ST')).toBe('1 McBride Street');
    expect(formatSeedAddress('1', null, 'DeWolfe ST')).toBe('1 DeWolfe Street');
    expect(formatSeedAddress('1', null, 'MARTIN-LUTHER KING BLVD')).toBe('1 Martin-Luther King Boulevard');
    // Rule-based, not a name list: an all-caps MCKINLEY has no internal capital to preserve.
    expect(formatSeedAddress('1', null, 'MCKINLEY RD')).toBe('1 Mckinley Road');
  });

  it('renders a comma tail as a parenthesized suffix so a rear lot is not a visible twin', () => {
    expect(formatSeedAddress('23', null, 'LANARK RD, REAR')).toBe('23 Lanark Road (Rear)');
    expect(formatSeedAddress('23', '27', 'Lanark RD, rear')).toBe('23-27 Lanark Road (Rear)');
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
  it('throws rather than minting a body-less slug', () => {
    expect(() => seedSlug('   ', new Set())).toThrow(/slug/i);
    expect(() => seedSlug('#!', new Set())).toThrow(/slug/i);
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
  it('launders whatever CKAN returned', () => {
    expect(buildingTypeFor(' r2 ')).toBe('two_family');
  });
  it('throws on a land use the seed filter should never have let through', () => {
    expect(() => buildingTypeFor('CD')).toThrow(/land use/i);
    expect(() => buildingTypeFor(null)).toThrow(/land use/i);
    expect(() => buildingTypeFor('')).toThrow(/land use/i);
  });
});

describe('titleCaseNeighborhood', () => {
  it('title-cases and nulls plain Boston', () => {
    expect(titleCaseNeighborhood('EAST BOSTON')).toBe('East Boston');
    expect(titleCaseNeighborhood('Jamaica Plain')).toBe('Jamaica Plain');
    expect(titleCaseNeighborhood('BOSTON')).toBeNull();
    expect(titleCaseNeighborhood(null)).toBeNull();
  });
  it('title-cases around an apostrophe or hyphen too', () => {
    expect(titleCaseNeighborhood("O'BRIEN SQUARE")).toBe("O'Brien Square");
    expect(titleCaseNeighborhood('ROSLINDALE-WEST')).toBe('Roslindale-West');
  });
});
