import { describe, expect, it } from 'vitest';
import { hasBuildingDetails } from '../buildingDetails';

describe('hasBuildingDetails', () => {
  it('is false when type, year built, and unit count are all missing', () => {
    expect(hasBuildingDetails({ building_type: null, year_built: null, unit_count: null })).toBe(false);
  });

  it('is false for an empty object', () => {
    expect(hasBuildingDetails({})).toBe(false);
  });

  it('is true when a year built is present', () => {
    expect(hasBuildingDetails({ building_type: null, year_built: 1920, unit_count: null })).toBe(true);
  });

  it('is true when only a building type is present', () => {
    expect(hasBuildingDetails({ building_type: 'apartment', year_built: null, unit_count: null })).toBe(true);
  });

  it('is true when only a unit count is present', () => {
    expect(hasBuildingDetails({ building_type: null, year_built: null, unit_count: 12 })).toBe(true);
  });

  it('is false when fields are empty string or zero, matching the template truthiness checks', () => {
    expect(hasBuildingDetails({ building_type: '', year_built: 0, unit_count: 0 })).toBe(false);
  });
});
