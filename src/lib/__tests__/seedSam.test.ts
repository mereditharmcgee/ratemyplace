import { describe, expect, it } from 'vitest';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel } from '../records/seed/sam';
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
  it('names the resource and the fields it downloads', () => {
    expect(SAM_RESOURCE_ID).toBe('6d6cfc99-6f26-4974-bbb3-17b5dbad49a9');
    expect(SAM_FIELDS).toContain('POINT_Y');
  });
});
