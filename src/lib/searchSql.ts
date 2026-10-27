// The one place the buildings search query is spelled. `search.astro` (SSR first page) and
// `api/search/results.ts` (Load more) both build from these, which is what keeps their
// counts, rows, and order in step — a parity that used to be a comment.
//
// Scope: the query-mode buildings query, plus the ORDER BY of browse mode. Browse mode (no
// query) and every landlord query stay reviewed-only and keep their own SQL, because a
// landing page listing 38,000 unreviewed seeded buildings is not a product; browse takes
// only its order from here (`BROWSE_BUILDINGS_ORDER`).
import { normalizeSearchQuery } from './searchQuery';
import { recencyWeightedOverallSql } from './scoring-sql';
import { escapeLikePattern } from './validation';

export interface SqlFragment {
  sql: string;
  binds: string[];
}

const LIKE = "LIKE ? ESCAPE '\\'";

/**
 * The address as space-delimited words, with a leading and trailing space and commas and
 * periods read as spaces. An alternative spelling is matched against this as `% <spelling> %`,
 * so it only ever hits a whole word: 'lane' finds "Radford La" but not the `la` in "Lanark"
 * or the `ln` in "Lincoln".
 */
const ADDRESS_WORDS = "(' ' || REPLACE(REPLACE(b.address, ',', ' '), '.', ' ') || ' ')";

function contains(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

function wholeWord(value: string): string {
  return `% ${escapeLikePattern(value)} %`;
}

/**
 * WHERE body for a non-empty query. Every term must appear in the address under one of its
 * spellings ("comm ave" matches an address stored as "Ave" or "Avenue", and still needs
 * "comm"); failing that, the whole query names a neighborhood or a landlord. Table aliases
 * are fixed: `b` buildings, `l` landlords.
 *
 * The typed spelling of a term matches anywhere in the address, so 'st' still finds "St James"
 * and 'comm' finds "Commonwealth". Every other spelling of its suffix row matches only as a
 * whole word (`ADDRESS_WORDS`): as substrings, 'la' found "Oakland" and 'st' found
 * "Dorchester", which turned 'lane' and 'dorchester street' into most of the city.
 *
 * The whole body is parenthesized so a caller can compose it — `WHERE ${sql} AND ...` —
 * without the trailing ORs swallowing the added condition.
 */
export function buildingSearchWhere(query: string): SqlFragment {
  const whole = contains(query.trim());
  const terms = normalizeSearchQuery(query);
  const binds: string[] = [];
  const clauses = terms.map(([typed, ...alternatives]) => {
    binds.push(contains(typed), ...alternatives.map(wholeWord));
    const ors = [`b.address ${LIKE}`, ...alternatives.map(() => `${ADDRESS_WORDS} ${LIKE}`)];
    return `(${ors.join(' OR ')})`;
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
 * "Is this building in Boston?", as a SQL condition on the buildings alias `b`. The one
 * spelling of the city test: `has_records` (below) and the browse order
 * (`BROWSE_BUILDINGS_ORDER`) both interpolate it, so the two cannot disagree about which
 * buildings are in Boston. It is NULL when `b.city` is NULL, so a caller that needs 0 or 1
 * wraps it in `COALESCE(..., 0)`. Why it restates `jurisdictionForCity` rather than calling
 * it: see `buildingSearchSelect`. `searchBrowseOrder.test.ts` checks the two agree on the
 * city spellings stored today.
 */
export const BOSTON_CITY_SQL =
  "(LOWER(TRIM(b.city)) = 'boston' OR LOWER(REPLACE(TRIM(b.city), ' ', '')) LIKE 'boston,__')";

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
    COALESCE(b.parcel_id IS NOT NULL AND ${BOSTON_CITY_SQL}, 0) AS has_records`;
}

/**
 * Reviewed buildings first in their existing order; everything else by address.
 *
 * The leading term is what `COUNT(r.id) DESC` already gives on its own. It is spelled out
 * anyway so the product rule — a reviewed building never sorts below a seeded one — is
 * stated in the SQL and survives a later change to the tiebreakers behind it.
 */
export const BUILDING_SEARCH_ORDER = 'ORDER BY (COUNT(r.id) > 0) DESC, COUNT(r.id) DESC, avg_overall DESC, b.address ASC, b.id ASC';

/**
 * Browse mode (no query): Boston first, most recently reviewed. Boston buildings come first,
 * each group ordered by its newest approved review, newest first, then by building id.
 *
 * - Boston is `BOSTON_CITY_SQL`, the city half of `has_records`, not the whole flag: a Boston
 *   building with no parcel id is still a Boston building. `COALESCE` puts a NULL city with
 *   everything else rather than in a third group.
 * - "Newest review" is `MAX(r.created_at)` over the joined rows, and both call sites join
 *   reviews `ON ... AND r.status = 'approved'`, so a pending or rejected review never moves a
 *   building. `created_at` (submission) rather than approval time because the reviews row
 *   has no approval time: `moderated_at` is never written, and `updated_at` moves again on
 *   any later moderation-note save or edit. The approval time exists only in the admin
 *   `audit_logs` table (`review_approved`), which a public query should not join, and
 *   submission and approval are days apart at most. The value orders rows only; it is never
 *   selected or shown.
 * - `b.id` is unique, so the order is total and LIMIT/OFFSET pages neither repeat nor skip
 *   a row. Browse rows are reviewed-only (`HAVING COUNT(r.id) > 0`), so the MAX is never NULL.
 *
 * Shared by `search.astro` (first page) and `api/search/results.ts` (Load more); the
 * review alias is fixed at `r` and the buildings alias at `b`, as in both.
 */
export const BROWSE_BUILDINGS_ORDER = `ORDER BY COALESCE(${BOSTON_CITY_SQL}, 0) DESC, MAX(r.created_at) DESC, b.id ASC`;
