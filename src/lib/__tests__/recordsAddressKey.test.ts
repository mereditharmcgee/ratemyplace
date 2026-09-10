import { describe, expect, it } from 'vitest';
import { addressKey, splitSuffix, streetKey, stripTrailingLocality } from '../records/identity';

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
    expect(streetKey('Lanark Road')).toBe('LANARK RD');
    expect(streetKey('Lanark Rd')).toBe('LANARK RD');
    expect(streetKey('LANARK RD')).toBe('LANARK RD');
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
    expect(addressKey('23-27 Lanark Rd')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 27 });
  });
  it('drops a letter suffix on the number', () => {
    expect(addressKey('12A Beacon St')).toEqual({ streetKey: 'BEACON ST', numLo: 12, numHi: 12 });
  });
  it('parses a lettered range', () => {
    expect(addressKey('12A-14 Beacon St')).toEqual({ streetKey: 'BEACON ST', numLo: 12, numHi: 14 });
  });
  it('orders a reversed range', () => {
    expect(addressKey('27-23 Lanark Rd')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 27 });
  });
  it('drops a trailing unit designator', () => {
    expect(addressKey('23 Lanark Rd Apt 3')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 23 });
  });
  it('returns null when there is no number or the street is degenerate', () => {
    expect(addressKey('Lanark Rd')).toBeNull();
    expect(addressKey('5 Ave')).toBeNull();
    // Street strips to nothing but a unit designator.
    expect(addressKey('23 Apt 3')).toBeNull();
    // Spaced range: only '23' parses as the number, leaving a street that starts with punctuation.
    expect(addressKey('23 - 27 Lanark Rd')).toBeNull();
  });
  // The fact the whole cross-source dedupe design rests on: a geocoded long form and a
  // hand-typed short form of the same building produce the same street key.
  it('keys a geocoded address and a hand-typed one identically', () => {
    expect(addressKey('23 Lanark Rd, Boston, MA 02135')!.streetKey).toBe(addressKey('23-27 Lanark Road')!.streetKey);
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
  });

  it('leaves a street whose name or suffix merely resembles a locality token', () => {
    expect(stripTrailingLocality('BOSTON ST')).toBe('BOSTON ST');
    expect(stripTrailingLocality('LANARK CT')).toBe('LANARK CT');
    expect(stripTrailingLocality('BEACON ST')).toBe('BEACON ST');
    expect(stripTrailingLocality('DORCHESTER AVE')).toBe('DORCHESTER AVE');
  });

  it('never strips the whole street away', () => {
    expect(stripTrailingLocality('BOSTON')).toBe('BOSTON');
    expect(stripTrailingLocality('SOUTH BOSTON')).toBe('SOUTH BOSTON');
    expect(stripTrailingLocality('02135')).toBe('02135');
  });

  it('only treats MA as a state when a ZIP or a locality sits beside it', () => {
    expect(stripTrailingLocality('LANARK RD MA')).toBe('LANARK RD MA');
    expect(stripTrailingLocality('LANARK RD BOSTON MA')).toBe('LANARK RD');
  });
});

describe('addressKey with a trailing locality', () => {
  it('keys a comma-less manual entry the same as the assessor', () => {
    expect(addressKey('1027 Commonwealth Ave Boston')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
    expect(addressKey('1027 Commonwealth Ave Boston MA 02215')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
    expect(addressKey('10 Centre St Jamaica Plain MA 02130')).toEqual({ streetKey: 'CENTRE ST', numLo: 10, numHi: 10 });
  });

  it('still keys the comma form and the plain form', () => {
    expect(addressKey('23-27 Lanark Rd, Boston, MA 02135')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 27 });
    expect(addressKey('5 Boston St')).toEqual({ streetKey: 'BOSTON ST', numLo: 5, numHi: 5 });
    expect(addressKey('12 Lanark Ct')).toEqual({ streetKey: 'LANARK CT', numLo: 12, numHi: 12 });
  });
});
