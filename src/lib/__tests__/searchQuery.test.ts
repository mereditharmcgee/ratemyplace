import { describe, expect, it } from 'vitest';
import { normalizeSearchQuery } from '../searchQuery';

describe('normalizeSearchQuery', () => {
  it('splits on whitespace and expands suffix abbreviations to the long spelling', () => {
    expect(normalizeSearchQuery('1027 comm ave')).toEqual(['1027', 'comm', 'avenue']);
    expect(normalizeSearchQuery('Lanark Rd')).toEqual(['lanark', 'road']);
  });
  it('strips punctuation and collapses spaces', () => {
    expect(normalizeSearchQuery('  Beacon St., #3 ')).toEqual(['beacon', 'street', '3']);
  });
  it('keeps a hyphenated range as one term', () => {
    expect(normalizeSearchQuery('23-27 Lanark')).toEqual(['23-27', 'lanark']);
  });
  it('returns an empty list for an empty or punctuation-only query', () => {
    expect(normalizeSearchQuery('')).toEqual([]);
    expect(normalizeSearchQuery('...')).toEqual([]);
  });
  it('caps the number of terms at 8', () => {
    expect(normalizeSearchQuery('a b c d e f g h i j')).toHaveLength(8);
  });
});
