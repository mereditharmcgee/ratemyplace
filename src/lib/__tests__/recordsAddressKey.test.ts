import { describe, expect, it } from 'vitest';
import { SUFFIX_SPELLINGS, addressKey, splitSuffix, streetKey, stripTrailingLocality } from '../records/identity';

describe('splitSuffix', () => {
  it('splits a known suffix and returns its spellings', () => {
    expect(splitSuffix('Commonwealth Avenue')).toEqual({ base: 'COMMONWEALTH', spellings: ['AV', 'AVE', 'AVENUE'] });
  });
  it('keeps a street with no suffix', () => {
    expect(splitSuffix('The Fenway')).toEqual({ base: 'THE FENWAY', spellings: null });
  });
  it('abbreviates a leading directional only when a name follows', () => {
    expect(splitSuffix('West Broadway')).toEqual({ base: 'W BROADWAY', spellings: null });
    expect(splitSuffix('North St')).toEqual({ base: 'NORTH', spellings: ['ST', 'STREET'] });
  });
});

describe('streetKey', () => {
  it('uses the assessor spelling of the suffix', () => {
    expect(streetKey('Tarnwick Place')).toBe('TARNWICK PL');
    expect(streetKey('Tarnwick Pl')).toBe('TARNWICK PL');
    expect(streetKey('TARNWICK PL')).toBe('TARNWICK PL');
  });
  it('drops units and punctuation', () => {
    expect(streetKey('Beacon St., Apt 3')).toBe('BEACON ST');
  });
  it('returns null for a degenerate street', () => {
    expect(streetKey('Ave')).toBeNull();
    expect(streetKey('')).toBeNull();
  });
});

describe('addressKey', () => {
  it('parses a single number', () => {
    expect(addressKey('1027 Commonwealth Avenue')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
  });
  it('parses a range', () => {
    expect(addressKey('52-68 Tarnwick Pl')).toEqual({ streetKey: 'TARNWICK PL', numLo: 52, numHi: 68 });
  });
  it('drops a letter suffix on the number', () => {
    expect(addressKey('12A Beacon St')).toEqual({ streetKey: 'BEACON ST', numLo: 12, numHi: 12 });
  });
  it('parses a lettered range', () => {
    expect(addressKey('12A-14 Beacon St')).toEqual({ streetKey: 'BEACON ST', numLo: 12, numHi: 14 });
  });
  it('orders a reversed range', () => {
    expect(addressKey('68-52 Tarnwick Pl')).toEqual({ streetKey: 'TARNWICK PL', numLo: 52, numHi: 68 });
  });
  it('drops a trailing unit designator', () => {
    expect(addressKey('52 Tarnwick Pl Apt 3')).toEqual({ streetKey: 'TARNWICK PL', numLo: 52, numHi: 52 });
  });
  it('returns null when there is no number or the street is degenerate', () => {
    expect(addressKey('Tarnwick Pl')).toBeNull();
    expect(addressKey('5 Ave')).toBeNull();
    // Street strips to nothing but a unit designator.
    expect(addressKey('52 Apt 3')).toBeNull();
    // Spaced range: only '52' parses as the number, leaving a street that starts with punctuation.
    expect(addressKey('52 - 68 Tarnwick Pl')).toBeNull();
  });
  // The fact the whole cross-source dedupe design rests on: a geocoded long form and a
  // hand-typed short form of the same building produce the same street key.
  it('keys a geocoded address and a hand-typed one identically', () => {
    expect(addressKey('52 Tarnwick Pl, Boston, MA 02135')!.streetKey).toBe(addressKey('52-68 Tarnwick Place')!.streetKey);
    expect(addressKey('1027 Commonwealth Ave, Boston, MA 02215, USA')!.streetKey).toBe(
      addressKey('1027 Commonwealth Avenue')!.streetKey,
    );
  });
});

describe('stripTrailingLocality', () => {
  it('peels a trailing city, state, and ZIP written without commas', () => {
    expect(stripTrailingLocality('COMMONWEALTH AVE BOSTON')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE BOSTON MA')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE BOSTON MA 02215')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE 02215')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE MA 02215-1234')).toBe('COMMONWEALTH AVE');
  });

  it('peels a two-word neighborhood', () => {
    expect(stripTrailingLocality('CENTRE ST JAMAICA PLAIN')).toBe('CENTRE ST');
    expect(stripTrailingLocality('E BROADWAY SOUTH BOSTON MA')).toBe('E BROADWAY');
    expect(stripTrailingLocality('SOUTH BOSTON MA 02127')).toBe('SOUTH BOSTON');
  });

  it('peels a postal city name that is not the bare neighborhood name', () => {
    expect(stripTrailingLocality('MELVILLE AVE DORCHESTER CENTER MA 02124')).toBe('MELVILLE AVE');
    expect(stripTrailingLocality('SPRAGUE ST READVILLE MA 02136')).toBe('SPRAGUE ST');
  });

  it('takes an empty street as it finds it', () => {
    expect(stripTrailingLocality('')).toBe('');
  });

  it('leaves a street whose name or suffix merely resembles a locality token', () => {
    expect(stripTrailingLocality('BOSTON ST')).toBe('BOSTON ST');
    expect(stripTrailingLocality('TARNWICK CT')).toBe('TARNWICK CT');
    expect(stripTrailingLocality('BEACON ST')).toBe('BEACON ST');
    expect(stripTrailingLocality('DORCHESTER AVE')).toBe('DORCHESTER AVE');
  });

  it('never strips the whole street away', () => {
    expect(stripTrailingLocality('BOSTON')).toBe('BOSTON');
    expect(stripTrailingLocality('SOUTH BOSTON')).toBe('SOUTH BOSTON');
    // 'The Fenway' is a street; 'THE' alone would be a garbage key.
    expect(stripTrailingLocality('THE FENWAY')).toBe('THE FENWAY');
    expect(addressKey('123 The Fenway')).toEqual({ streetKey: 'THE FENWAY', numLo: 123, numHi: 123 });
    expect(stripTrailingLocality('02135')).toBe('02135');
  });

  it('only treats MA as a state when a ZIP or a locality sits beside it', () => {
    expect(stripTrailingLocality('TARNWICK PL MA')).toBe('TARNWICK PL MA');
    expect(stripTrailingLocality('TARNWICK PL BOSTON MA')).toBe('TARNWICK PL');
  });
});

describe('addressKey with a trailing locality', () => {
  it('keys a comma-less manual entry the same as the assessor', () => {
    expect(addressKey('1027 Commonwealth Ave Boston')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
    expect(addressKey('1027 Commonwealth Ave Boston MA 02215')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
    expect(addressKey('10 Centre St Jamaica Plain MA 02130')).toEqual({ streetKey: 'CENTRE ST', numLo: 10, numHi: 10 });
  });

  it('still keys the comma form and the plain form', () => {
    expect(addressKey('52-68 Tarnwick Pl, Boston, MA 02135')).toEqual({ streetKey: 'TARNWICK PL', numLo: 52, numHi: 68 });
    expect(addressKey('5 Boston St')).toEqual({ streetKey: 'BOSTON ST', numLo: 5, numHi: 5 });
    expect(addressKey('12 Tarnwick Ct')).toEqual({ streetKey: 'TARNWICK CT', numLo: 12, numHi: 12 });
  });

  it('keeps a street that is a locality behind an article whole', () => {
    expect(addressKey('12 The Fenway Boston MA 02215')).toEqual({ streetKey: 'THE FENWAY', numLo: 12, numHi: 12 });
  });

  it('leaves a non-Boston city in the key, since the stripper is deliberately Boston-only', () => {
    expect(addressKey('5 Beacon St Brookline MA 02446')).toEqual({ streetKey: 'BEACON ST BROOKLINE', numLo: 5, numHi: 5 });
  });
});

// The October 2026 additions: the assessor writes GRAMPIAN WY, CUMMINS HW, VFW PW, MAMELON CI,
// RADFORD LA, HOLDEN RO, BOARD AL and CONRY CR, and 311 writes the USPS forms. Each row's first
// spelling is the assessor's, so the stored key is unchanged and every other spelling folds into it.
describe('the assessor suffix spellings added in October 2026', () => {
  it('splits a long form onto its assessor row, and keeps a suffix word inside the base', () => {
    expect(splitSuffix('Grampian Way')).toEqual({ base: 'GRAMPIAN', spellings: ['WY', 'WAY'] });
    expect(splitSuffix('Cedar Lane Wy').base).toBe('CEDAR LANE');
  });

  it.each([
    ['Grampian Way', 'GRAMPIAN WY'],
    ['Grampian Wy', 'GRAMPIAN WY'],
    ['Cummins Highway', 'CUMMINS HW'],
    ['Cummins Hwy', 'CUMMINS HW'],
    ['VFW Parkway', 'VFW PW'],
    ['VFW Pkwy', 'VFW PW'],
    ['Mamelon Circle', 'MAMELON CI'],
    ['Mamelon Cir', 'MAMELON CI'],
    ['Radford Lane', 'RADFORD LA'],
    ['Radford Ln', 'RADFORD LA'],
    ['Holden Row', 'HOLDEN RO'],
    ['Bakers Alley', 'BAKERS AL'],
    ['Bakers Aly', 'BAKERS AL'],
    ['Conry Crescent', 'CONRY CR'],
    ['Conry Cres', 'CONRY CR'],
  ])('streetKey(%s) is %s', (street, key) => {
    expect(streetKey(street)).toBe(key);
  });

  it('re-keys a stored key: the assessor form is stable, the one LN key moves to LA', () => {
    expect(streetKey('GRAMPIAN WY')).toBe('GRAMPIAN WY');
    expect(streetKey('NEPONSET FIELD LN')).toBe('NEPONSET FIELD LA');
  });

  it('treats a bare new spelling as degenerate', () => {
    expect(streetKey('Way')).toBeNull();
    expect(streetKey('Wy')).toBeNull();
    expect(streetKey('Crescent')).toBeNull();
    expect(streetKey('Alley')).toBeNull();
    expect(streetKey('La')).toBeNull();
    expect(addressKey('5 Wy')).toBeNull();
  });

  it('keys a typed Way, a locality tail and a Lane onto the assessor spelling', () => {
    expect(addressKey('9 Appian Way')).toEqual({ streetKey: 'APPIAN WY', numLo: 9, numHi: 9 });
    expect(addressKey('9-11 Appian Wy')).toEqual({ streetKey: 'APPIAN WY', numLo: 9, numHi: 11 });
    expect(addressKey('9 Appian Way Allston MA 02134')!.streetKey).toBe('APPIAN WY');
    expect(addressKey('1 Greenough Ln')!.streetKey).toBe('GREENOUGH LA');
  });

  it('pins the key spelling (first entry) of every suffix row', () => {
    // The first spelling is what every stored `buildings.street_key` ends in. Changing one
    // re-keys stored rows: only change this together with a `records:suffix-backfill` run.
    expect(SUFFIX_SPELLINGS.map((row) => row[0])).toEqual(
      ['AV', 'ST', 'RD', 'DR', 'PL', 'TE', 'CT', 'LA', 'BLVD', 'PW', 'HW', 'SQ', 'CI', 'PK', 'WHARF', 'RO', 'WY', 'AL', 'CR'],
    );
  });

  it('puts no spelling in two rows', () => {
    // SUFFIX_ROW_BY_SPELLING is a Map, so a duplicate would silently let the later row win.
    const all = SUFFIX_SPELLINGS.flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
