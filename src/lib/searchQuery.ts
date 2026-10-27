import { BOSTON_LOCALITY_NAMES, BOSTON_SUB_AREAS } from './bostonLocalities';
import { SUFFIX_SPELLINGS } from './records/identity';

/**
 * Every other spelling in a term's suffix row, in table order: 'ave' -> ['av', 'avenue'].
 * A term that is not a suffix has no alternatives.
 */
const OTHER_SPELLINGS = new Map<string, readonly string[]>(
  SUFFIX_SPELLINGS.flatMap((row) => {
    const lower = row.map((spelling) => spelling.toLowerCase());
    return lower.map((spelling) => [spelling, lower.filter((other) => other !== spelling)] as const);
  }),
);

const MAX_TERMS = 8;

/**
 * Turns a free-text search into terms, each expanded to the spellings that mean the same
 * thing. Punctuation other than the hyphen inside a house-number range is dropped.
 *
 * Each inner array is one term: the typed spelling first, then every other spelling of its
 * suffix row. A caller ORs within a term and ANDs across them, so 'comm ave' matches
 * 'Commonwealth Avenue' while 'st' still matches 'St James' — the old behavior of
 * rewriting each abbreviation to its long form could only do one of those. Index 0 is the
 * typed spelling: `searchSql.ts` matches it as a substring and the rest as whole words.
 *
 * A single-character alphabetic term is dropped: it is almost always debris from an
 * apostrophe ("St Mary's" -> "st mary s") and as a LIKE clause it matches everything.
 * Single digits are kept — "5 Beacon" is a real address.
 *
 * This is the raw tokenizer: it keeps every word typed, place names and ZIPs included.
 * The building search reads `parseSearchQuery` below, which takes those out first; this
 * output is its fallback when the query was nothing but a place.
 */
export function normalizeSearchQuery(query: string): string[][] {
  return expand(tokens(query));
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter((term) => term.length > 0 && !/^[a-z]$/.test(term));
}

function expand(terms: readonly string[]): string[][] {
  // Dedupe before the cap: a repeated term is a redundant clause, and letting it consume
  // one of the eight slots would drop a term that actually narrows the search.
  return Array.from(new Set(terms))
    .slice(0, MAX_TERMS)
    .map((term) => [term, ...(OTHER_SPELLINGS.get(term) ?? [])]);
}

/** A house number as typed: one number (lo === hi) or a range, low end first. */
export interface HouseNumber {
  lo: number;
  hi: number;
}

export interface ParsedSearch {
  /** Street words, with place names, state, ZIP and unit taken out. Same shape as `normalizeSearchQuery`. */
  terms: string[][];
  /** The first number typed, matched against the building's house number or range. */
  houseNumber: HouseNumber | null;
  /**
   * Boston place names taken out of the street match, lowercase ('allston', 'jamaica plain',
   * 'boston'), plus the neighborhood a postal name sits in ('dorchester center' adds
   * 'dorchester'). They rank results; they never filter them.
   */
  places: string[];
  /** Five-digit ZIPs typed (a ZIP+4 is cut to five). */
  zips: string[];
  /**
   * The typed place names as street words ('allston' -> [['allston']]), so a search for a
   * place also finds a street named after it ("Allston St"), ranked after the place itself.
   */
  placeTerms: string[][];
  /** Every word typed, as `normalizeSearchQuery` reads it. The fallback when nothing else is left. */
  rawTerms: string[][];
}

/** Street suffixes in every spelling, lowercase: the word after a place name that makes it a street name. */
const SUFFIXES: ReadonlySet<string> = new Set(OTHER_SPELLINGS.keys());

/** Boston's locality vocabulary ('boston' included), lowercase, as typed phrases. */
const PLACE_NAMES: ReadonlySet<string> = new Set(BOSTON_LOCALITY_NAMES.map((name) => name.toLowerCase()));

/** State and country words. Stripped like a place, but they say nothing about where in Boston. */
const STATE_WORDS: ReadonlySet<string> = new Set(['ma', 'massachusetts', 'usa']);

const MAX_PLACE_WORDS = Math.max(...[...PLACE_NAMES].map((name) => name.split(' ').length));

/** A postal name that is not itself a neighborhood ('dorchester center') and the neighborhood it is in. */
const PARENT_PLACE: ReadonlyMap<string, string> = new Map(
  Object.entries(BOSTON_SUB_AREAS)
    .filter(([name]) => PLACE_NAMES.has(name.toLowerCase()))
    .map(([name, parent]) => [name.toLowerCase(), parent.toLowerCase()]),
);

/** Unit designators. The word and the one after it ("apt 2", "unit 3b") are dropped. */
const UNIT_WORDS: ReadonlySet<string> = new Set(['apt', 'apartment', 'unit']);

const ZIP = /^\d{5}(?:-\d{4})?$/;
const HOUSE_NUMBER = /^(\d{1,5})(?:-(\d{1,5}))?$/;
const STREET_ARTICLES: ReadonlySet<string> = new Set(['the']);

/** Bounds on what a place or ZIP can add to the SQL. A real query names one of each. */
const MAX_PLACES = 3;
const MAX_ZIPS = 2;

/** How many words starting at `i` spell a place or state name, longest first; 0 if none. */
function placeLengthAt(words: readonly string[], i: number): number {
  for (let n = MAX_PLACE_WORDS; n >= 1; n -= 1) {
    if (i + n > words.length) continue;
    const phrase = words.slice(i, i + n).join(' ');
    if (PLACE_NAMES.has(phrase) || STATE_WORDS.has(phrase)) return n;
  }
  return 0;
}

/**
 * Reads a search the way people type an address: "75 Example St, Allston, MA 02134".
 *
 * The stored address is the street line only, so the neighborhood, "Boston", "MA",
 * "Massachusetts" and the ZIP are taken out before the street words are matched. They are
 * kept as `places` and `zips`, which rank results but never filter them.
 *
 * A place word stays a street word when the next word is a street suffix in any spelling
 * (`SUFFIX_SPELLINGS`): "Brighton Ave", "Allston St", "Boston St" and
 * "Hyde Park Ave" are streets. So does one after "the" ("The Fenway"). A comma ends the
 * lookahead: in "12 Example St, Brighton, MA" nothing after a comma can make "Brighton"
 * part of a street.
 *
 * The first number is the house number. Later numbers are unit numbers and are dropped, as
 * are "apt", "apartment" and "unit" with the word after them and anything after a "#".
 */
export function parseSearchQuery(query: string): ParsedSearch {
  const kept: string[] = [];
  const places = new Set<string>();
  const zips = new Set<string>();
  let houseNumber: HouseNumber | null = null;

  const withoutUnits = query.replace(/#\s*[a-z0-9-]*/gi, ' ');
  for (const segment of withoutUnits.split(',')) {
    const words = tokens(segment);
    let previous: string | null = null;
    for (let i = 0; i < words.length; ) {
      const word = words[i];
      if (ZIP.test(word)) {
        zips.add(word.slice(0, 5));
        i += 1;
        continue;
      }
      if (UNIT_WORDS.has(word)) {
        i += 2;
        continue;
      }
      const placeLength = placeLengthAt(words, i);
      const next = words[i + placeLength];
      const partOfStreet = (next !== undefined && SUFFIXES.has(next)) || (previous !== null && STREET_ARTICLES.has(previous));
      if (placeLength > 0 && !partOfStreet) {
        const phrase = words.slice(i, i + placeLength).join(' ');
        if (!STATE_WORDS.has(phrase)) places.add(phrase);
        i += placeLength;
        previous = null;
        continue;
      }
      const number = HOUSE_NUMBER.exec(word);
      if (number) {
        if (houseNumber === null) {
          const a = Number(number[1]);
          const b = number[2] === undefined ? a : Number(number[2]);
          houseNumber = { lo: Math.min(a, b), hi: Math.max(a, b) };
        }
      } else {
        kept.push(word);
      }
      previous = word;
      i += 1;
    }
  }

  const typedPlaces = [...places].slice(0, MAX_PLACES);
  const withParents = typedPlaces.flatMap((place) => {
    const parent = PARENT_PLACE.get(place);
    return parent ? [place, parent] : [place];
  });
  return {
    terms: expand(kept),
    houseNumber,
    places: [...new Set(withParents)],
    zips: [...zips].slice(0, MAX_ZIPS),
    placeTerms: normalizeSearchQuery(typedPlaces.join(' ')),
    rawTerms: normalizeSearchQuery(query),
  };
}

/**
 * True when the search named only a place or ZIP ("Brighton", "02135", "Allston, MA"): no
 * street word and no house number survived. The building search then lists that area, and
 * the search page explains an empty result in those terms instead of suggesting a street.
 */
export function isAreaSearch(parsed: ParsedSearch): boolean {
  return parsed.terms.length === 0 && parsed.houseNumber === null && (parsed.places.length > 0 || parsed.zips.length > 0);
}

/**
 * The query with its house number taken out, as typed otherwise ("16 Example Rd, Brighton"
 * -> "Example Rd, Brighton"), for the no-match page to offer the street when a typed number
 * has no building. Null when the query has no house number or nothing but it.
 *
 * Tokens are read the way `parseSearchQuery` reads them: a five-digit token is a ZIP, and a
 * unit number ("#3", "apt 3") is not the house number.
 */
export function withoutHouseNumber(query: string): string | null {
  const words = query.trim().split(/\s+/);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.startsWith('#')) continue;
    if (i > 0 && UNIT_WORDS.has(words[i - 1].toLowerCase().replace(/[^a-z]/g, ''))) continue;
    const bare = word.replace(/[^0-9-]/g, '').replace(/^-+|-+$/g, '');
    if (bare !== word.replace(/[,.]+$/, '') || ZIP.test(bare) || !HOUSE_NUMBER.test(bare)) continue;
    const rest = [...words.slice(0, i), ...words.slice(i + 1)].join(' ').replace(/^[\s,]+/, '').trim();
    return /[a-z]/i.test(rest) ? rest : null;
  }
  return null;
}
