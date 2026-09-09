import { describe, expect, it } from 'vitest';
import { addressKey, splitSuffix, streetKey } from '../records/identity';

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
  it('orders a reversed range', () => {
    expect(addressKey('27-23 Lanark Rd')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 27 });
  });
  it('returns null when there is no number or the street is degenerate', () => {
    expect(addressKey('Lanark Rd')).toBeNull();
    expect(addressKey('5 Ave')).toBeNull();
  });
});
