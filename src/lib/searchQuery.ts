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
 * rewriting each abbreviation to its long form could only do one of those.
 *
 * A single-character alphabetic term is dropped: it is almost always debris from an
 * apostrophe ("St Mary's" -> "st mary s") and as a LIKE clause it matches everything.
 * Single digits are kept — "5 Beacon" is a real address.
 *
 * Scope note: a manual-entry address with no comma ("1027 Commonwealth Ave Boston") is not
 * this module's problem. Search terms are ANDed, so a trailing city token only narrows.
 * The dedupe path strips a trailing city/state token before keying.
 */
export function normalizeSearchQuery(query: string): string[][] {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter((term) => term.length > 0 && !/^[a-z]$/.test(term));

  // Dedupe before the cap: a repeated term is a redundant clause, and letting it consume
  // one of the eight slots would drop a term that actually narrows the search.
  return Array.from(new Set(terms))
    .slice(0, MAX_TERMS)
    .map((term) => [term, ...(OTHER_SPELLINGS.get(term) ?? [])]);
}
