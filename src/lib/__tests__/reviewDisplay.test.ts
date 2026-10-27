import { describe, expect, it } from 'vitest';
import { bedroomOptions } from '../formOptions';
import {
  UNIT_TYPE_LABELS,
  bedroomsLabel,
  resolveUnitType,
  unitTypeFromBedrooms,
  unitTypeLabel,
} from '../reviewDisplay';

// The values the reviews.unit_type CHECK constraint accepts (migrations/0001_initial.sql).
const DB_UNIT_TYPES = ['studio', '1br', '2br', '3br', '4br+', 'house'];

describe('unitTypeFromBedrooms', () => {
  it('maps every bedrooms option the review form offers to a unit type the database accepts', () => {
    for (const option of bedroomOptions) {
      const unitType = unitTypeFromBedrooms(option.value);
      expect(unitType, option.value).not.toBeNull();
      expect(DB_UNIT_TYPES).toContain(unitType);
    }
  });

  it.each([
    ['studio', 'studio'],
    ['0', 'studio'],
    ['1', '1br'],
    ['2', '2br'],
    ['3', '3br'],
    ['4', '4br+'],
    ['5+', '4br+'],
  ])('maps %s to %s', (bedrooms, unitType) => {
    expect(unitTypeFromBedrooms(bedrooms)).toBe(unitType);
  });

  it.each([[null], [undefined], [''], ['seven']])('returns null for %s', (bedrooms) => {
    expect(unitTypeFromBedrooms(bedrooms)).toBeNull();
  });
});

describe('resolveUnitType', () => {
  it('uses the bedrooms the reviewer picked when the stored unit type disagrees', () => {
    expect(resolveUnitType({ unit_type: '1br', bedrooms: 'studio' })).toBe('studio');
    expect(resolveUnitType({ unit_type: '1br', bedrooms: '5+' })).toBe('4br+');
  });

  it('keeps the stored unit type when it agrees or bedrooms is missing', () => {
    expect(resolveUnitType({ unit_type: '2br', bedrooms: '2' })).toBe('2br');
    expect(resolveUnitType({ unit_type: '3br', bedrooms: null })).toBe('3br');
    expect(resolveUnitType({ unit_type: '3br' })).toBe('3br');
  });

  it('keeps a house as a house', () => {
    expect(resolveUnitType({ unit_type: 'house', bedrooms: '3' })).toBe('house');
  });

  it('returns null when neither field is set', () => {
    expect(resolveUnitType({ unit_type: null, bedrooms: null })).toBeNull();
    expect(resolveUnitType({})).toBeNull();
  });
});

describe('unitTypeLabel', () => {
  it('labels every unit type', () => {
    for (const unitType of DB_UNIT_TYPES) {
      expect(UNIT_TYPE_LABELS[unitType as keyof typeof UNIT_TYPE_LABELS]).toBeTruthy();
    }
    expect(unitTypeLabel('studio')).toBe('Studio');
    expect(unitTypeLabel('1br')).toBe('1 bedroom');
    expect(unitTypeLabel('4br+')).toBe('4+ bedrooms');
  });

  it('passes an unknown value through and returns null for nothing', () => {
    expect(unitTypeLabel('loft')).toBe('loft');
    expect(unitTypeLabel(null)).toBeNull();
    expect(unitTypeLabel(undefined)).toBeNull();
  });
});

describe('bedroomsLabel', () => {
  it.each([
    ['studio', 'Studio'],
    ['0', 'Studio'],
    ['1', '1 bed'],
    ['2', '2 beds'],
    ['5+', '5+ beds'],
  ])('labels %s as %s', (bedrooms, label) => {
    expect(bedroomsLabel(bedrooms)).toBe(label);
  });

  it('never produces "studio beds"', () => {
    for (const option of bedroomOptions) {
      expect(bedroomsLabel(option.value)?.toLowerCase()).not.toContain('studio bed');
    }
  });

  it.each([[null], [undefined], ['']])('returns null for %s', (bedrooms) => {
    expect(bedroomsLabel(bedrooms)).toBeNull();
  });
});
