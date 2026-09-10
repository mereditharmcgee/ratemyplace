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
    // the clause still has a bind and the query is not silently every building.
    addressClause = `b.address ${LIKE}`;
    binds.push(whole);
  }
  binds.push(whole, whole);
  return { sql: `(${addressClause}) OR b.neighborhood ${LIKE} OR l.name ${LIKE}`, binds };
}

/** Column list for a buildings result row. Explicit — never `b.*` (admin_notes, owner_*). */
export function buildingSearchSelect(reviewAlias: string, currentYear: number): string {
  return `b.slug, b.address, b.neighborhood, b.city, b.state,
    COUNT(${reviewAlias}.id) AS review_count,
    ${recencyWeightedOverallSql(reviewAlias, currentYear)} AS avg_overall,
    l.name AS landlord_name,
    (b.city = 'Boston' AND b.parcel_id IS NOT NULL) AS has_records`;
}

/**
 * Reviewed buildings first in their existing order; everything else by address.
 *
 * The leading term is what `COUNT(r.id) DESC` already gives on its own. It is spelled out
 * anyway so the product rule — a reviewed building never sorts below a seeded one — is
 * stated in the SQL and survives a later change to the tiebreakers behind it.
 *
 * The review alias is fixed at `r` rather than taken as a parameter: both call sites join
 * reviews as `r`, and a mismatch would be a SQL error at the first request, not a silent
 * reorder.
 */
export const BUILDING_SEARCH_ORDER = 'ORDER BY (COUNT(r.id) > 0) DESC, COUNT(r.id) DESC, avg_overall DESC, b.address ASC, b.id ASC';
