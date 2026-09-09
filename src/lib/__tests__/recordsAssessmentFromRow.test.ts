import { describe, expect, it } from 'vitest';
import { ASSESSOR_FIXED_COLUMNS, ASSESSOR_YEARS, MODERN_COLUMNS, assessmentFromRow } from '../records/sources/boston/assessor';

describe('assessmentFromRow', () => {
  it('maps a modern assessor row to the assessment payload', () => {
    const payload = assessmentFromRow(
      {
        PID: '2102098000', OWNER: 'LANARK ROAD LLC', LU: 'A', LU_DESC: 'APT 7-30 UNITS', YR_BUILT: '1925', YR_REMODEL: null,
        GROSS_AREA: '12000', LIVING_AREA: '10000', RES_UNITS: '12', COM_UNITS: '0', TOTAL_VALUE: '3500000.00', LAND_VALUE: '1000000', BLDG_VALUE: '2500000',
        MAIL_ADDRESSEE: null, MAIL_STREET_ADDRESS: '1 Main St', MAIL_CITY: 'Boston', MAIL_STATE: 'MA', MAIL_ZIP_CODE: '02135',
      },
      ASSESSOR_YEARS[0],
    );
    expect(payload.fiscalYear).toBe('FY2026');
    expect(payload.parcelId).toBe('2102098000');
    expect(payload.owner).toBe('LANARK ROAD LLC');
    expect(payload.residentialUnits).toBe(12);
    expect(payload.totalValue).toBe(3500000);
    expect(payload.mailStreet).toBe('1 Main St');
    expect(payload.condominium).toBe(false);
  });

  it('exposes the modern column map the seed selects with', () => {
    expect(MODERN_COLUMNS.mailStreet).toBe('MAIL_STREET_ADDRESS');
  });

  it('freezes the shared column map so no year entry can mutate it', () => {
    expect(Object.isFrozen(MODERN_COLUMNS)).toBe(true);
  });

  // ASSESSOR_FIXED_COLUMNS is what the bulk seed asks CKAN for. A column added there but
  // never picked here downloads for nothing; this fails the moment the two drift apart.
  it('reads every column the seed selects', () => {
    const NUMERIC = new Set(['YR_BUILT', 'YR_REMODEL', 'GROSS_AREA', 'LIVING_AREA', 'RES_UNITS', 'COM_UNITS', 'TOTAL_VALUE', 'LAND_VALUE', 'BLDG_VALUE']);
    const row: Record<string, unknown> = {};
    const expected = new Map<string, string>();
    ASSESSOR_FIXED_COLUMNS.forEach((column, index) => {
      // PID has to survive toCanonicalParcel, and a numeric column parses to a number,
      // so those get digit sentinels; the rest can be tagged with their own name.
      const sentinel = column === 'PID' ? '1000000001' : NUMERIC.has(column) ? String(1001 + index) : `sentinel-${column}`;
      row[column] = sentinel;
      expected.set(column, sentinel);
    });

    const json = JSON.stringify(assessmentFromRow(row, ASSESSOR_YEARS[0]));
    for (const [column, sentinel] of expected) {
      expect(json, `"${column}" is in ASSESSOR_FIXED_COLUMNS but assessmentFromRow never reads it`).toContain(sentinel);
    }
  });
});
