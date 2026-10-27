import { describe, expect, it } from 'vitest';
import { isAreaSearch, normalizeSearchQuery, parseSearchQuery, withoutHouseNumber } from '../searchQuery';
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
  it('expands the assessor suffixes added in October 2026 both ways', () => {
    expect(normalizeSearchQuery('grampian way')).toEqual([['grampian'], ['way', 'wy']]);
    expect(normalizeSearchQuery('grampian wy')).toEqual([['grampian'], ['wy', 'way']]);
    expect(normalizeSearchQuery('cummins highway')).toEqual([['cummins'], ['highway', 'hw', 'hwy']]);
    expect(normalizeSearchQuery('radford lane')).toEqual([['radford'], ['lane', 'la', 'ln']]);
    expect(normalizeSearchQuery('conry crescent')).toEqual([['conry'], ['crescent', 'cr', 'cres']]);
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

describe('parseSearchQuery', () => {
  const street = (query: string): string[] => parseSearchQuery(query).terms.map((term) => term[0]);

  it('takes the neighborhood, city, state and ZIP out of a full address', () => {
    const parsed = parseSearchQuery('12 Example St, Allston, MA 02134');
    expect(parsed.terms).toEqual([['example'], ['st', 'street']]);
    expect(parsed.houseNumber).toEqual({ lo: 12, hi: 12 });
    expect(parsed.places).toEqual(['allston']);
    expect(parsed.zips).toEqual(['02134']);
  });

  it('strips without commas too', () => {
    expect(street('12 Example St Brighton')).toEqual(['example', 'st']);
    expect(street('12 Example Road Brighton MA 02135')).toEqual(['example', 'road']);
    expect(street('12 Example Rd Boston Massachusetts')).toEqual(['example', 'rd']);
    expect(parseSearchQuery('12 Example Rd Boston Massachusetts').places).toEqual(['boston']);
  });

  it('strips multiword place names as a unit', () => {
    const parsed = parseSearchQuery('12 Sample Ter Jamaica Plain');
    expect(parsed.terms.map((term) => term[0])).toEqual(['sample', 'ter']);
    expect(parsed.places).toEqual(['jamaica plain']);
    expect(parseSearchQuery('5 Sample St, Hyde Park').places).toEqual(['hyde park']);
    expect(parseSearchQuery('5 Sample St, South Boston').places).toEqual(['south boston']);
  });

  it('reads a ZIP+4 as its five-digit ZIP', () => {
    const parsed = parseSearchQuery('12 Example Rd 02135-1234');
    expect(parsed.zips).toEqual(['02135']);
    expect(parsed.houseNumber).toEqual({ lo: 12, hi: 12 });
    expect(street('12 Example Rd 02135-1234')).toEqual(['example', 'rd']);
  });

  it('keeps a place word that is part of a street name: the next word is a suffix', () => {
    expect(street('Brighton Ave')).toEqual(['brighton', 'ave']);
    expect(street('40 Allston St')).toEqual(['allston', 'st']);
    expect(street('7 Boston Street')).toEqual(['boston', 'street']);
    expect(street('12 Hyde Park Ave')).toEqual(['hyde', 'park', 'ave']);
    expect(parseSearchQuery('Brighton Ave').places).toEqual([]);
    // Any spelling in SUFFIX_SPELLINGS counts, not only the common ones.
    expect(street('3 Roxbury Ter')).toEqual(['roxbury', 'ter']);
  });

  it('keeps the street word and strips the place after it', () => {
    const parsed = parseSearchQuery('Brighton Ave Allston');
    expect(parsed.terms.map((term) => term[0])).toEqual(['brighton', 'ave']);
    expect(parsed.places).toEqual(['allston']);
    expect(street('10 Dorchester Ave, Dorchester')).toEqual(['dorchester', 'ave']);
  });

  it('does not look across a comma for the suffix', () => {
    const parsed = parseSearchQuery('12 Example St, Brighton, St Example');
    expect(parsed.places).toEqual(['brighton']);
  });

  it('keeps a place word after "the", a street on its own', () => {
    expect(street('1 The Fenway')).toEqual(['the', 'fenway']);
  });

  it('reads the first number as the house number and drops unit numbers', () => {
    expect(parseSearchQuery('12 Example Rd Apt 3').houseNumber).toEqual({ lo: 12, hi: 12 });
    expect(street('12 Example Rd Apt 3B')).toEqual(['example', 'rd']);
    expect(street('12 Example Rd Unit 2, Brighton')).toEqual(['example', 'rd']);
    expect(street('12 Example Rd #4')).toEqual(['example', 'rd']);
    expect(parseSearchQuery('12 Example Rd 4').houseNumber).toEqual({ lo: 12, hi: 12 });
  });

  it('reads a range as a house number, low end first', () => {
    expect(parseSearchQuery('14-18 Example Rd').houseNumber).toEqual({ lo: 14, hi: 18 });
    expect(parseSearchQuery('18-14 Example Rd').houseNumber).toEqual({ lo: 14, hi: 18 });
  });

  it('keeps a lettered number as a street word', () => {
    expect(parseSearchQuery('12A Example Rd').houseNumber).toBeNull();
    expect(street('12A Example Rd')).toEqual(['12a', 'example', 'rd']);
  });

  it('marks a query that is only a place or a ZIP as an area search', () => {
    expect(isAreaSearch(parseSearchQuery('Brighton'))).toBe(true);
    expect(isAreaSearch(parseSearchQuery('02135'))).toBe(true);
    expect(isAreaSearch(parseSearchQuery('Allston, MA 02134'))).toBe(true);
    expect(isAreaSearch(parseSearchQuery('Jamaica Plain'))).toBe(true);
    expect(isAreaSearch(parseSearchQuery('Brighton Ave'))).toBe(false);
    expect(isAreaSearch(parseSearchQuery('12 Example Rd, Brighton'))).toBe(false);
    // A state on its own names no area.
    expect(isAreaSearch(parseSearchQuery('MA'))).toBe(false);
  });

  it('keeps the words as typed for the fallback', () => {
    expect(parseSearchQuery('Allston').rawTerms).toEqual([['allston']]);
    expect(parseSearchQuery('Allston').terms).toEqual([]);
    expect(parseSearchQuery('Allston, MA 02134').placeTerms).toEqual([['allston']]);
  });

  it('adds the neighborhood a postal name sits in', () => {
    expect(parseSearchQuery('Dorchester Center').places).toEqual(['dorchester center', 'dorchester']);
  });

  it('bounds how many places and ZIPs reach the SQL', () => {
    const parsed = parseSearchQuery('Allston Brighton Roxbury Mattapan Fenway 02134 02135 02136');
    expect(parsed.places).toHaveLength(3);
    expect(parsed.zips).toEqual(['02134', '02135']);
  });

  it('reads the place as the street when a house number is the only other thing typed', () => {
    // "7 Allston" names a building on a street called Allston, not every 7 in the city.
    const parsed = parseSearchQuery('7 Allston');
    expect(parsed.terms).toEqual([['allston']]);
    expect(parsed.houseNumber).toEqual({ lo: 7, hi: 7 });
    // Still a place for ranking.
    expect(parsed.places).toEqual(['allston']);
    expect(isAreaSearch(parsed)).toBe(false);
    expect(street('7 Jamaica Plain, MA 02130')).toEqual(['jamaica', 'plain']);
    // A street word typed means the place is a place again.
    expect(street('7 Example Rd Allston')).toEqual(['example', 'rd']);
    // A state alone is no street.
    expect(parseSearchQuery('7 MA').terms).toEqual([]);
  });

  it('splits a hyphenated place name into its words, and keeps a range or ZIP+4 whole', () => {
    const parsed = parseSearchQuery('12 Example St, Allston-Brighton');
    expect(parsed.terms.map((term) => term[0])).toEqual(['example', 'st']);
    expect(parsed.places).toEqual(['allston', 'brighton']);
    const area = parseSearchQuery('Allston-Brighton');
    expect(area.places).toEqual(['allston', 'brighton']);
    expect(isAreaSearch(area)).toBe(true);
    const full = parseSearchQuery('14-18 Example Rd, Allston-Brighton, MA 02135-1234');
    expect(full.houseNumber).toEqual({ lo: 14, hi: 18 });
    expect(full.zips).toEqual(['02135']);
    expect(full.terms.map((term) => term[0])).toEqual(['example', 'rd']);
  });
});

describe('withoutHouseNumber', () => {
  it('takes out the house number and keeps the rest as typed', () => {
    expect(withoutHouseNumber('16 Example Rd, Brighton')).toBe('Example Rd, Brighton');
    expect(withoutHouseNumber('14-18 Example Rd')).toBe('Example Rd');
    expect(withoutHouseNumber('Example Rd 16')).toBe('Example Rd');
    expect(withoutHouseNumber('16, Example Rd')).toBe('Example Rd');
  });
  it('leaves ZIPs, unit numbers and lettered numbers alone', () => {
    expect(withoutHouseNumber('Example Rd 02135')).toBeNull();
    expect(withoutHouseNumber('Example Rd #3')).toBeNull();
    expect(withoutHouseNumber('Example Rd Apt 3')).toBeNull();
    expect(withoutHouseNumber('12A Example Rd')).toBeNull();
    expect(withoutHouseNumber('12 Example Rd Apt 3')).toBe('Example Rd Apt 3');
  });
  it('returns null when nothing but the number was typed', () => {
    expect(withoutHouseNumber('16')).toBeNull();
    expect(withoutHouseNumber('Brighton')).toBeNull();
  });
});
