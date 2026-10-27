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

  it('maps Ave and Avenue to AV, the assessor spelling, and exposes every spelling', () => {
    const id = buildIdentity({ ...base, address: '1066 Commonwealth Ave, Boston, MA 02215' });
    expect(id.streetShort).toBe('COMMONWEALTH AV');
    expect(id.streetLong).toBe('COMMONWEALTH AVENUE');
    expect(id.streetForms).toEqual(['COMMONWEALTH AV', 'COMMONWEALTH AVE', 'COMMONWEALTH AVENUE']);
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
    expect(noSuffix.streetForms).toEqual(['BROADWAY']);
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
    expect(single.numbers).toEqual(['12A', '12']);
    expect(single.rangeForm).toBeNull();
  });

  // Every spelling here was verified against the live City of Boston datasets on 2026-09-07.
  const cases: Array<[address: string, streetShort: string, streetBase: string]> = [
    ['7 Unity St, Boston, MA', 'UNITY ST', 'UNITY'],
    ['7 Unity Ct', 'UNITY CT', 'UNITY'],
    ['10 Aptucxet Rd', 'APTUCXET RD', 'APTUCXET'],
    ['40 Boylston St #2, Boston, MA', 'BOYLSTON ST', 'BOYLSTON'],
    ['40 Boylston St Unit 2', 'BOYLSTON ST', 'BOYLSTON'],
    ['5 St. Botolph St', 'ST BOTOLPH ST', 'ST BOTOLPH'],
    ['5 St. Botolph', 'ST BOTOLPH', 'ST BOTOLPH'],
    ['24 Union Park, Boston, MA', 'UNION PK', 'UNION'],
    ['100 West Newton St', 'W NEWTON ST', 'W NEWTON'],
    ['100 W Newton St', 'W NEWTON ST', 'W NEWTON'],
    ['12 North St', 'NORTH ST', 'NORTH'],
    ['50 S Huntington Ave', 'S HUNTINGTON AV', 'S HUNTINGTON'],
    ['1 Rowes Wharf', 'ROWES WHARF', 'ROWES'],
    ['9 S Munroe Ter', 'S MUNROE TE', 'S MUNROE'],
    ['25 Winthrop Sq', 'WINTHROP SQ', 'WINTHROP'],
    ['10 Broadway, Boston, MA', 'BROADWAY', 'BROADWAY'],
    // Real streets named after suffix words: the guard must only fire when a suffix word
    // stands alone with nothing to split off, not whenever the base happens to be one.
    ['10 Park St', 'PARK ST', 'PARK'],
    ['26 Court St', 'COURT ST', 'COURT'],
    ['1 Park Dr', 'PARK DR', 'PARK'],
    ['100 Terrace St', 'TERRACE ST', 'TERRACE'],
    ['5 Court Sq', 'COURT SQ', 'COURT'],
    // Directionals abbreviate whenever a name follows, suffix or not.
    ['100 West Broadway', 'W BROADWAY', 'W BROADWAY'],
    ['20 East Broadway', 'E BROADWAY', 'E BROADWAY'],
    ['3 E First St', 'E FIRST ST', 'E FIRST'],
  ];

  it.each(cases)('normalizes %s to %s', (address, streetShort, streetBase) => {
    const id = buildIdentity({ ...base, address });
    expect(id.streetShort).toBe(streetShort);
    expect(id.streetBase).toBe(streetBase);
  });

  it('exposes both Park spellings, since the assessor writes PK and 311 writes Park', () => {
    const id = buildIdentity({ ...base, address: '24 Union Park, Boston, MA' });
    expect(id.streetForms).toEqual(['UNION PK', 'UNION PARK']);
  });

  it('throws when stripping the unit designator leaves no street name', () => {
    expect(() => buildIdentity({ ...base, address: '99 Unit Ave' })).toThrow(/degenerate/i);
  });

  it('throws when a leading unit designator strips the whole street', () => {
    expect(() => buildIdentity({ ...base, address: '5 Apt 3' })).toThrow(/degenerate/i);
  });

  it('throws on a bare suffix word with nothing to split off', () => {
    expect(() => buildIdentity({ ...base, address: '5 Ave' })).toThrow(/degenerate/i);
  });

  it('throws on a spaced range the number parser cannot take whole', () => {
    // parseStreetAddress keeps only "23", leaving "- 27 Lanark" as the street base.
    expect(() => buildIdentity({ ...base, address: '23 - 27 Lanark Rd' })).toThrow(/degenerate/i);
  });

  it('strips a comma-less trailing locality, so both forms of one address agree', () => {
    const typed = buildIdentity({ ...base, address: '1027 Commonwealth Ave Boston', zip_code: '02215' });
    expect(typed.streetForms).toEqual(['COMMONWEALTH AV', 'COMMONWEALTH AVE', 'COMMONWEALTH AVENUE']);
    expect(typed.streetBase).toBe('COMMONWEALTH');
    const comma = buildIdentity({ ...base, address: '1027 Commonwealth Ave, Boston, MA 02215', zip_code: '02215' });
    expect(comma.streetForms).toEqual(typed.streetForms);
    expect(comma.streetBase).toBe('COMMONWEALTH');
  });

  it('round-trips the SAM id', () => {
    expect(buildIdentity({ ...base, sam_id: '12345' }).samId).toBe('12345');
    expect(buildIdentity(base).samId).toBeNull();
  });
});

describe('buildIdentity on the assessor suffixes added in October 2026', () => {
  // One real address per new suffix row (production D1, 2026-10-26). The short form keeps the
  // assessor spelling the stored key ends in; streetForms carries the whole row so 311's
  // GRAMPIAN WAY / CUMMINS HWY / VFW PKWY and the permits feed's RADFORD LN all match.
  const cases: Array<[address: string, streetBase: string, streetShort: string, streetLong: string, streetForms: string[]]> = [
    ['9 Grampian Wy', 'GRAMPIAN', 'GRAMPIAN WY', 'GRAMPIAN WAY', ['GRAMPIAN WY', 'GRAMPIAN WAY']],
    ['9 Cummins Hw', 'CUMMINS', 'CUMMINS HW', 'CUMMINS HIGHWAY', ['CUMMINS HW', 'CUMMINS HWY', 'CUMMINS HIGHWAY']],
    ['530 Vfw Pw', 'VFW', 'VFW PW', 'VFW PARKWAY', ['VFW PW', 'VFW PKWY', 'VFW PARKWAY']],
    ['3 Mamelon Ci', 'MAMELON', 'MAMELON CI', 'MAMELON CIRCLE', ['MAMELON CI', 'MAMELON CIR', 'MAMELON CIRCLE']],
    ['11 Radford La', 'RADFORD', 'RADFORD LA', 'RADFORD LANE', ['RADFORD LA', 'RADFORD LN', 'RADFORD LANE']],
    ['2 Holden Ro', 'HOLDEN', 'HOLDEN RO', 'HOLDEN ROW', ['HOLDEN RO', 'HOLDEN ROW']],
    ['11 Board Al', 'BOARD', 'BOARD AL', 'BOARD ALLEY', ['BOARD AL', 'BOARD ALY', 'BOARD ALLEY']],
    ['10-12 Conry Cr', 'CONRY', 'CONRY CR', 'CONRY CRESCENT', ['CONRY CR', 'CONRY CRES', 'CONRY CRESCENT']],
  ];

  it.each(cases)('%s splits onto its assessor row', (address, streetBase, streetShort, streetLong, streetForms) => {
    const id = buildIdentity({ ...base, address });
    expect(id.streetBase).toBe(streetBase);
    expect(id.streetShort).toBe(streetShort);
    expect(id.streetLong).toBe(streetLong);
    expect(id.streetForms).toEqual(streetForms);
  });

  it('gives a typed Way the same street fields as the assessor Wy', () => {
    const typed = buildIdentity({ ...base, address: '9 Grampian Way' });
    const assessor = buildIdentity({ ...base, address: '9 Grampian Wy' });
    for (const field of ['streetBase', 'streetShort', 'streetLong', 'streetForms'] as const) {
      expect(typed[field]).toEqual(assessor[field]);
    }
  });

  it('abbreviates the directional once the new suffix is split off', () => {
    expect(buildIdentity({ ...base, address: '566 W Roxbury Pw' }).streetBase).toBe('W ROXBURY');
  });

  it('throws on a bare new suffix word', () => {
    expect(() => buildIdentity({ ...base, address: '5 Wy' })).toThrow(/degenerate/i);
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
