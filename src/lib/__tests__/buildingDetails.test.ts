import { describe, expect, it } from 'vitest';
import { hasBuildingDetails } from '../buildingDetails';
import type { Building } from '../types';

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

  it('tolerates the real buildings row shape, with unrelated columns present', () => {
    // Assigned to a `Building`-typed variable (not passed as an inline literal) so this
    // exercises the same wide row shape the DB actually returns, unrelated columns and all.
    const row: Building = {
      id: 'bld_123',
      landlord_id: 'll_456',
      address: '12 Brighton Ave',
      slug: '12-brighton-ave',
      neighborhood: 'Allston',
      city: 'Boston',
      state: 'MA',
      zip_code: '02134',
      latitude: 42.3536,
      longitude: -71.1325,
      building_type: 'apartment',
      year_built: null,
      unit_count: null,
      created_at: 1700000000,
      updated_at: 1700000000,
    };

    expect(hasBuildingDetails(row)).toBe(true);
  });
});
