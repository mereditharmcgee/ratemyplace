import { SUFFIX_SPELLINGS } from './records/identity';

/** Longest spelling per row: 'AVE' -> 'avenue'. Stored addresses use the long form. */
const LONG_SPELLING = new Map<string, string>(
  SUFFIX_SPELLINGS.flatMap((row) => {
    const longest = row.reduce((a, b) => (b.length > a.length ? b : a)).toLowerCase();
    return row.map((spelling) => [spelling.toLowerCase(), longest] as const);
  }),
);

const MAX_TERMS = 8;

/**
 * Turns a free-text search into lowercase terms for one LIKE clause each. Punctuation
 * other than the hyphen inside a house-number range is dropped; a suffix abbreviation
 * becomes its long spelling so 'comm ave' matches 'Commonwealth Avenue'.
 */
export function normalizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .map((term) => LONG_SPELLING.get(term) ?? term)
    .slice(0, MAX_TERMS);
}
