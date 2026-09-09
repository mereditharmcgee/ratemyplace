import { describe, expect, it } from 'vitest';
import { normalizeSearchQuery } from '../searchQuery';
import { SUFFIX_SPELLINGS } from '../records/identity';

describe('normalizeSearchQuery', () => {
  it('returns the term first, then every other spelling in its suffix row', () => {
    expect(normalizeSearchQuery('1027 comm ave')).toEqual([['1027'], ['comm'], ['ave', 'av', 'avenue']]);
    expect(normalizeSearchQuery('st james')).toEqual([['st', 'street'], ['james']]);
    expect(normalizeSearchQuery('rowes wh')).toEqual([['rowes'], ['wh', 'wharf', 'whf']]);
  });
  it('strips punctuation and collapses spaces', () => {
    expect(normalizeSearchQuery('  Beacon St., #3 ')).toEqual([['beacon'], ['st', 'street'], ['3']]);
  });
  it('keeps a hyphenated range as one term and strips stray hyphens', () => {
    expect(normalizeSearchQuery('23-27 Lanark')).toEqual([['23-27'], ['lanark']]);
    expect(normalizeSearchQuery('-23-27-')).toEqual([['23-27']]);
  });
  it('returns an empty list for an empty or punctuation-only query', () => {
    expect(normalizeSearchQuery('')).toEqual([]);
    expect(normalizeSearchQuery('...')).toEqual([]);
    expect(normalizeSearchQuery('---')).toEqual([]);
  });
  it('drops a single-character alphabetic term but keeps a single digit', () => {
    // The apostrophe in "St Mary's" leaves a stray 's' that would match everything.
    expect(normalizeSearchQuery("St Mary's St")).toEqual([['st', 'street'], ['mary']]);
    expect(normalizeSearchQuery('5 Beacon')).toEqual([['5'], ['beacon']]);
  });
  it('removes duplicate terms before applying the cap', () => {
    expect(normalizeSearchQuery('aa aa bb cc dd ee ff gg hh ii')).toEqual([
      ['aa'], ['bb'], ['cc'], ['dd'], ['ee'], ['ff'], ['gg'], ['hh'],
    ]);
  });
  it('caps the number of terms at 8', () => {
    expect(normalizeSearchQuery('aa bb cc dd ee ff gg hh ii jj')).toEqual([
      ['aa'], ['bb'], ['cc'], ['dd'], ['ee'], ['ff'], ['gg'], ['hh'],
    ]);
  });
  // SUFFIX_SPELLINGS has two consumers (records identity keys and this search
  // expansion). This is the guardrail that stops them drifting.
  it('offers every spelling in the row for each row of SUFFIX_SPELLINGS', () => {
    for (const row of SUFFIX_SPELLINGS) {
      const alternatives = normalizeSearchQuery(row[0].toLowerCase())[0];
      for (const spelling of row) {
        expect(alternatives).toContain(spelling.toLowerCase());
      }
    }
  });
});
