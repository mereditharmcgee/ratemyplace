import { describe, expect, it } from 'vitest';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel, zip5 } from '../records/seed/sam';
import type { SamRow } from '../records/seed/types';

const row = (o: Partial<SamRow>): SamRow => ({
  SAM_ADDRESS_ID: '1', RELATIONSHIP_TYPE: '1', PARCEL_ID: '2102098000', MAILING_NEIGHBORHOOD: 'Brighton', ZIP_CODE: '02135',
  POINT_X: '-71.1458', POINT_Y: '42.33909', UNIT: null, ...o,
});

describe('indexSamByParcel', () => {
  it('keeps the primary address point with the lowest SAM id per parcel', () => {
    const index = indexSamByParcel([
      row({ SAM_ADDRESS_ID: '262632', RELATIONSHIP_TYPE: '2', UNIT: '1' }),
      row({ SAM_ADDRESS_ID: '83763' }),
      row({ SAM_ADDRESS_ID: '90000', MAILING_NEIGHBORHOOD: 'Allston' }),
    ]);
    expect(index.get('2102098000')).toEqual({ samId: '83763', latitude: 42.33909, longitude: -71.1458, neighborhood: 'Brighton', zip: '02135' });
  });
  it('prefers a primary row over a lower-numbered unit row', () => {
    const index = indexSamByParcel([
      row({ SAM_ADDRESS_ID: '5', RELATIONSHIP_TYPE: '2', UNIT: '1' }),
      row({ SAM_ADDRESS_ID: '900' }),
    ]);
    expect(index.get('2102098000')?.samId).toBe('900');
  });
  it('falls back to a unit row when a parcel has no primary point', () => {
    const index = indexSamByParcel([row({ SAM_ADDRESS_ID: '5', RELATIONSHIP_TYPE: '2', UNIT: '3' })]);
    expect(index.get('2102098000')?.samId).toBe('5');
  });
  it('canonicalizes numeric parcel ids and skips rows without one or without coordinates', () => {
    const index = indexSamByParcel([
      row({ PARCEL_ID: 2102098000 }),
      row({ SAM_ADDRESS_ID: '2', PARCEL_ID: null }),
      row({ SAM_ADDRESS_ID: '3', PARCEL_ID: '0100037000', POINT_X: null }),
    ]);
    expect([...index.keys()]).toEqual(['2102098000']);
  });

  it('sorts an unparseable SAM id last, whichever order the rows arrive in', () => {
    const numbered = row({ SAM_ADDRESS_ID: '7' });
    const lettered = row({ SAM_ADDRESS_ID: 'ABC-1', MAILING_NEIGHBORHOOD: 'Allston' });
    expect(indexSamByParcel([lettered, numbered]).get('2102098000')?.samId).toBe('7');
    expect(indexSamByParcel([numbered, lettered]).get('2102098000')?.samId).toBe('7');
  });

  it('rejects a coordinate outside Boston, leaving the parcel without a point', () => {
    expect(indexSamByParcel([row({ POINT_X: '0', POINT_Y: '0' })]).size).toBe(0);
    expect(indexSamByParcel([row({ POINT_Y: '42.9' })]).size).toBe(0);
    expect(indexSamByParcel([row({ POINT_X: '-70.5' })]).size).toBe(0);
    const index = indexSamByParcel([row({ SAM_ADDRESS_ID: '1', POINT_X: '0', POINT_Y: '0' }), row({ SAM_ADDRESS_ID: '9' })]);
    expect(index.get('2102098000')?.samId).toBe('9');
  });

  it('pads the zip it carries', () => {
    expect(indexSamByParcel([row({ ZIP_CODE: 2135 })]).get('2102098000')?.zip).toBe('02135');
    expect(indexSamByParcel([row({ ZIP_CODE: 'n/a' })]).get('2102098000')?.zip).toBeNull();
  });

  it('names the resource and the fields it downloads', () => {
    expect(SAM_RESOURCE_ID).toBe('6d6cfc99-6f26-4974-bbb3-17b5dbad49a9');
    expect(SAM_FIELDS).toEqual([
      'SAM_ADDRESS_ID', 'RELATIONSHIP_TYPE', 'PARCEL_ID', 'MAILING_NEIGHBORHOOD', 'ZIP_CODE', 'POINT_X', 'POINT_Y', 'UNIT',
    ]);
  });
});

describe('zip5', () => {
  it('zero-pads a zip that lost its leading zero to a numeric column', () => {
    expect(zip5(2135)).toBe('02135');
    expect(zip5('2135')).toBe('02135');
    expect(zip5('02135')).toBe('02135');
  });
  it('drops the +4', () => {
    expect(zip5('02135-1234')).toBe('02135');
    expect(zip5('021351234')).toBe('02135');
  });
  it('returns null for anything that is not a zip', () => {
    expect(zip5(null)).toBeNull();
    expect(zip5('')).toBeNull();
    expect(zip5('n/a')).toBeNull();
    expect(zip5('123')).toBeNull();
    expect(zip5('021356')).toBeNull();
  });
});
