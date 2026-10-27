import { describe, expect, it } from 'vitest';
import {
  ESTIMATED_UNITS_LABEL,
  UNITS_LABEL,
  hasBuildingDetails,
  isLandUseUnitEstimate,
  unitCountLabel,
  type UnitCountEvidence,
} from '../buildingDetails';
import { IMPLIED_UNITS, impliedUnitsFor } from '../records/seed/impliedUnits';
import type { Building } from '../types';

describe('impliedUnitsFor', () => {
  it('gives the seed estimate for the land uses it estimates for, and null otherwise', () => {
    expect(impliedUnitsFor('R2')).toBe(2);
    expect(impliedUnitsFor('R3')).toBe(3);
    expect(impliedUnitsFor('A')).toBeNull();
    expect(impliedUnitsFor('R4')).toBeNull();
    expect(impliedUnitsFor('RC')).toBeNull();
    expect(impliedUnitsFor(null)).toBeNull();
    expect(impliedUnitsFor('')).toBeNull();
  });

  it('reads a raw stored code the way the seed normalized it', () => {
    expect(impliedUnitsFor(' r3 ')).toBe(3);
  });

  it('does not read inherited object keys as land-use codes', () => {
    expect(impliedUnitsFor('constructor')).toBeNull();
    expect(impliedUnitsFor('toString')).toBeNull();
  });

  it('is the table the seed writes from', () => {
    expect(IMPLIED_UNITS).toEqual({ R2: 2, R3: 3 });
  });
});

describe('unit count label', () => {
  const blank = (landUse: string | null): UnitCountEvidence => ({ landUse, residentialUnits: null });

  it("labels the seed's estimate on a parcel the assessor left blank", () => {
    expect(isLandUseUnitEstimate(3, blank('R3'))).toBe(true);
    expect(isLandUseUnitEstimate(2, blank('R2'))).toBe(true);
    expect(unitCountLabel(3, blank('R3'))).toBe(ESTIMATED_UNITS_LABEL);
    expect(ESTIMATED_UNITS_LABEL).toBe('Units (estimated from land use)');
  });

  it('keeps "Units" for a count a person entered on a land use the seed does not estimate for', () => {
    // An apartment parcel: the seed implies nothing for A, so any stored count came from a person.
    expect(isLandUseUnitEstimate(18, blank('A'))).toBe(false);
    expect(unitCountLabel(18, blank('A'))).toBe(UNITS_LABEL);
    expect(UNITS_LABEL).toBe('Units');
  });

  it('keeps "Units" for a count that is not the estimate', () => {
    expect(isLandUseUnitEstimate(4, blank('R3'))).toBe(false);
    expect(isLandUseUnitEstimate(3, blank('R2'))).toBe(false);
  });

  it('keeps "Units" when the assessor recorded a count, zero included', () => {
    expect(isLandUseUnitEstimate(3, { landUse: 'R3', residentialUnits: 3 })).toBe(false);
    expect(isLandUseUnitEstimate(3, { landUse: 'R3', residentialUnits: 0 })).toBe(false);
  });

  it('keeps "Units" with no assessor record or no count', () => {
    expect(unitCountLabel(3, null)).toBe(UNITS_LABEL);
    expect(isLandUseUnitEstimate(null, blank('R3'))).toBe(false);
    expect(isLandUseUnitEstimate(0, blank('R3'))).toBe(false);
  });

  it('stays plain: no dash, no exclamation point', () => {
    expect(ESTIMATED_UNITS_LABEL).not.toMatch(/[—!]/);
  });
});

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
