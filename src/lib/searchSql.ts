// The one place the buildings search query is spelled. `search.astro` (SSR first page) and
// `api/search/results.ts` (Load more) both build from these, which is what keeps their
// counts, rows, and order in step — a parity that used to be a comment.
//
// Scope: the query-mode buildings query only. Browse mode (no query) and every landlord
// query stay reviewed-only and keep their own SQL, because a landing page listing 38,000
// unreviewed seeded buildings is not a product.
import { normalizeSearchQuery } from './searchQuery';
import { recencyWeightedOverallSql } from './scoring-sql';
import { escapeLikePattern } from './validation';

export interface SqlFragment {
  sql: string;
  binds: string[];
}

const LIKE = "LIKE ? ESCAPE '\\'";

function contains(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

/**
 * WHERE body for a non-empty query. Every term must appear in the address under one of its
 * spellings ("comm ave" matches an address stored as "Ave" or "Avenue", and still needs
 * "comm"); failing that, the whole query names a neighborhood or a landlord. Table aliases
 * are fixed: `b` buildings, `l` landlords.
 *
 * The whole body is parenthesized so a caller can compose it — `WHERE ${sql} AND ...` —
 * without the trailing ORs swallowing the added condition.
 */
export function buildingSearchWhere(query: string): SqlFragment {
  const whole = contains(query.trim());
  const terms = normalizeSearchQuery(query);
  const binds: string[] = [];
  const clauses = terms.map((spellings) => {
    for (const spelling of spellings) binds.push(contains(spelling));
    return `(${spellings.map(() => `b.address ${LIKE}`).join(' OR ')})`;
  });
  let addressClause: string;
  if (clauses.length > 0) {
    addressClause = clauses.join(' AND ');
  } else {
    // Nothing survived normalization ("...", a lone letter). Fall back to the raw query so
    // the clause still has a bind rather than the literal `%%` pattern that matches every
    // row. Not a load guard — a one-letter query still matches most addresses in the city;
    // it only keeps the degenerate case from being spelled as "no filter at all".
    addressClause = `b.address ${LIKE}`;
    binds.push(whole);
  }
  binds.push(whole, whole);
  return { sql: `((${addressClause}) OR b.neighborhood ${LIKE} OR l.name ${LIKE})`, binds };
}

/**
 * Column list for a buildings result row. Explicit — never `b.*` (admin_notes, owner_*).
 *
 * `has_records` restates in SQL the city test `jurisdictionForCity` applies in TypeScript:
 * case-insensitive, and tolerant of a trailing ", MA" at any spacing. A restatement, not a
 * proof of character-for-character agreement — it decides whether a search row shows a
 * records badge, and the building page re-asks `jurisdictionForCity` before pulling
 * anything. It is restated rather than imported for the plain reason that SQL cannot call
 * TypeScript: the test has to run inside D1 so the query can filter and sort on it in one
 * pass, instead of reading every row back and deciding in JS. (The bundle argument that
 * used to sit here — that `records/jurisdictions.ts` drags in six CKAN adapters — no longer
 * applies: `jurisdictionForCity` now lives in the leaf `records/jurisdiction.ts`. It still
 * cannot run in SQLite.) `COALESCE(..., 0)` keeps a NULL city from yielding a NULL column,
 * so the value the client sees is always 0 or 1.
 *
 * The review alias is fixed at `r`: both call sites join reviews as `r`, and
 * `BUILDING_SEARCH_ORDER` hardcodes it, so a parameter here could only ever disagree with
 * the ORDER BY.
 */
export function buildingSearchSelect(currentYear: number): string {
  return `b.slug, b.address, b.neighborhood, b.city, b.state,
    COUNT(r.id) AS review_count,
    ${recencyWeightedOverallSql('r', currentYear)} AS avg_overall,
    l.name AS landlord_name,
    COALESCE(b.parcel_id IS NOT NULL AND (LOWER(TRIM(b.city)) = 'boston' OR LOWER(REPLACE(TRIM(b.city), ' ', '')) LIKE 'boston,__'), 0) AS has_records`;
}

/**
 * Reviewed buildings first in their existing order; everything else by address.
 *
 * The leading term is what `COUNT(r.id) DESC` already gives on its own. It is spelled out
 * anyway so the product rule — a reviewed building never sorts below a seeded one — is
 * stated in the SQL and survives a later change to the tiebreakers behind it.
 */
export const BUILDING_SEARCH_ORDER = 'ORDER BY (COUNT(r.id) > 0) DESC, COUNT(r.id) DESC, avg_overall DESC, b.address ASC, b.id ASC';
