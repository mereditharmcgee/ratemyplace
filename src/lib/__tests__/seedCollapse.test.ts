import { describe, expect, it } from 'vitest';
import { ASSESSOR_SEED_FIELDS, collapseAssessorRows } from '../records/seed/collapse';
import type { AssessorRow, SamPoint } from '../records/seed/types';

const base: AssessorRow = {
  PID: '2102098000', BLDG_SEQ: '1', ST_NUM: '23', ST_NUM2: '27', ST_NAME: 'Lanark RD', CITY: 'BRIGHTON', ZIP_CODE: '02135',
  LU: 'A', LU_DESC: 'APT 7-30 UNITS', OWNER: 'LANARK ROAD LLC', YR_BUILT: '1925', YR_REMODEL: null, GROSS_AREA: '12000', LIVING_AREA: '10000',
  RES_UNITS: '12', COM_UNITS: '0', TOTAL_VALUE: '3500000', LAND_VALUE: '1000000', BLDG_VALUE: '2500000',
  MAIL_ADDRESSEE: null, MAIL_STREET_ADDRESS: '1 Main St', MAIL_CITY: 'Boston', MAIL_STATE: 'MA', MAIL_ZIP_CODE: '02135',
};
const sam = new Map<string, SamPoint>([['2102098000', { samId: '83763', latitude: 42.33909, longitude: -71.1458, neighborhood: 'Brighton', zip: '02135' }]]);

describe('collapseAssessorRows', () => {
  it('builds one SeedBuilding with SAM coordinates and neighborhood', () => {
    const { buildings, skipped } = collapseAssessorRows([base], sam);
    expect(skipped).toEqual([]);
    expect(buildings).toHaveLength(1);
    const b = buildings[0];
    expect(b.parcelId).toBe('2102098000');
    expect(b.address).toBe('23-27 Lanark Road');
    expect(b.streetKey).toBe('LANARK RD');
    expect(b.numLo).toBe(23);
    expect(b.numHi).toBe(27);
    expect(b.neighborhood).toBe('Brighton');
    expect(b.zip).toBe('02135');
    expect(b.unitCount).toBe(12);
    expect(b.yearBuilt).toBe(1925);
    expect(b.buildingType).toBe('apartment');
    expect(b.latitude).toBe(42.33909);
    expect(b.samId).toBe('83763');
    expect(b.assessment.fiscalYear).toBe('FY2026');
    expect(b.assessment.owner).toBe('LANARK ROAD LLC');
  });

  it('collapses BLDG_SEQ rows of one parcel, summing units and keeping the first row', () => {
    const { buildings } = collapseAssessorRows(
      [
        { ...base, BLDG_SEQ: '2', RES_UNITS: '4', YR_BUILT: '1990' },
        { ...base, BLDG_SEQ: '1', RES_UNITS: '8' },
      ],
      sam,
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0].unitCount).toBe(12);
    expect(buildings[0].yearBuilt).toBe(1925);
  });

  it('infers units for R2 and R3 when the assessor leaves them blank', () => {
    const { buildings } = collapseAssessorRows([{ ...base, PID: '0100037000', LU: 'R3', RES_UNITS: null }], new Map());
    expect(buildings[0].unitCount).toBe(3);
    expect(buildings[0].buildingType).toBe('three_family');
  });

  it('falls back to the assessor CITY and zip without a SAM point', () => {
    const { buildings } = collapseAssessorRows([{ ...base, PID: '0100037000' }], new Map());
    expect(buildings[0].neighborhood).toBe('Brighton');
    expect(buildings[0].latitude).toBeNull();
    expect(buildings[0].samId).toBeNull();
    expect(buildings[0].zip).toBe('02135');
  });

  it('skips rows that fail the filter or cannot be addressed, with a reason', () => {
    // Parcel ids must survive `toCanonicalParcel` (9-10 digits) to reach the address stage
    // at all, so each row that is meant to be skipped for a later reason carries a real one.
    // Filter and parcel skips are recorded while reading rows; address skips only once the
    // rows of a parcel have been grouped, hence the order.
    const { buildings, skipped } = collapseAssessorRows(
      [
        { ...base, PID: '0100037001', LU: 'CD' },
        { ...base, PID: '0100037002', ST_NUM: null },
        { ...base, PID: '0100037003', ST_NAME: 'AVE' },
        { ...base, PID: 'abc' },
      ],
      new Map(),
    );
    expect(buildings).toEqual([]);
    expect(skipped).toEqual([
      { pid: '0100037001', reason: 'land_use' },
      { pid: 'abc', reason: 'no_parcel' },
      { pid: '0100037002', reason: 'no_address' },
      { pid: '0100037003', reason: 'no_address' },
    ]);
  });

  it('names the assessor fields to download', () => {
    expect(ASSESSOR_SEED_FIELDS).toEqual(expect.arrayContaining(['PID', 'BLDG_SEQ', 'ST_NUM', 'ST_NUM2', 'ST_NAME', 'CITY', 'ZIP_CODE', 'LU', 'LU_DESC', 'MAIL_STREET_ADDRESS']));
  });
});
