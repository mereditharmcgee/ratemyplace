import { describe, it, expect } from 'vitest';
import { buildIdentity, toCanonicalParcel, toNumericParcel } from '../records/identity';

const base = { id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null };

describe('buildIdentity', () => {
  it('splits a ranged address into numbers, keeps the range, and normalizes the suffix', () => {
    const id = buildIdentity(base);
    expect(id.numbers).toEqual(['23', '27']);
    expect(id.rangeForm).toBe('23-27');
    expect(id.streetShort).toBe('LANARK RD');
    expect(id.streetLong).toBe('LANARK ROAD');
    expect(id.streetBase).toBe('LANARK');
    expect(id.addressFormsShort).toEqual(['23 LANARK RD', '27 LANARK RD', '23-27 LANARK RD']);
    expect(id.addressFormsLong).toEqual(['23 LANARK ROAD', '27 LANARK ROAD', '23-27 LANARK ROAD']);
    expect(id.zip).toBe('02135');
    expect(id.parcelId).toBeNull();
    expect(id.condominium).toBe(false);
  });

  it('maps Ave and Avenue to AV, the assessor spelling', () => {
    const id = buildIdentity({ ...base, address: '1066 Commonwealth Ave, Boston, MA 02215' });
    expect(id.streetShort).toBe('COMMONWEALTH AV');
    expect(id.streetLong).toBe('COMMONWEALTH AVENUE');
    expect(id.numbers).toEqual(['1066']);
    expect(id.rangeForm).toBeNull();
  });

  it('strips unit suffixes and handles a street with no suffix', () => {
    const id = buildIdentity({ ...base, address: '5 Ayr Rd Apt 2, Boston, MA' });
    expect(id.streetShort).toBe('AYR RD');
    const noSuffix = buildIdentity({ ...base, address: '10 Broadway, Boston, MA' });
    expect(noSuffix.streetShort).toBe('BROADWAY');
    expect(noSuffix.streetLong).toBe('BROADWAY');
    expect(noSuffix.streetBase).toBe('BROADWAY');
  });

  it('carries parcel forms when the building already has one', () => {
    const id = buildIdentity({ ...base, parcel_id: '0100001000' });
    expect(id.parcelId).toBe('0100001000');
    expect(id.parcelNumeric).toBe('100001000');
  });

  it('throws on an address it cannot parse', () => {
    expect(() => buildIdentity({ ...base, address: 'Lanark Road' })).toThrow(/parse/i);
  });

  it('keeps the unit letter in lettered ranges and does not duplicate numbers', () => {
    const id = buildIdentity({ ...base, address: '100-100A Lanark Rd, Boston, MA' });
    expect(id.numbers).toEqual(['100', '100A']);
    expect(id.rangeForm).toBe('100-100A');
    expect(id.addressFormsShort).toEqual(['100 LANARK RD', '100A LANARK RD', '100-100A LANARK RD']);
    const single = buildIdentity({ ...base, address: '12A Main St, Boston, MA' });
    expect(single.numbers).toEqual(['12A']);
    expect(single.rangeForm).toBeNull();
  });
});

describe('parcel helpers', () => {
  it('canonical form keeps ten digits with a leading zero; numeric strips it', () => {
    expect(toCanonicalParcel('100001000')).toBe('0100001000');
    expect(toCanonicalParcel('2102098000')).toBe('2102098000');
    expect(toNumericParcel('0100001000')).toBe('100001000');
    expect(toCanonicalParcel('12ab')).toBeNull();
  });
});
