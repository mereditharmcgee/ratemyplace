// The one place the buildings search query is spelled. `search.astro` (SSR first page) and
// `api/search/results.ts` (Load more) both build from these, which is what keeps their
// counts, rows, and order in step — a parity that used to be a comment.
//
// Scope: the query-mode buildings query, plus the ORDER BY of browse mode. Browse mode (no
// query) and every landlord query stay reviewed-only and keep their own SQL, because a
// landing page listing 38,000 unreviewed seeded buildings is not a product; browse takes
// only its order from here (`BROWSE_BUILDINGS_ORDER`).
import { isAreaSearch, parseSearchQuery, type HouseNumber, type ParsedSearch } from './searchQuery';
import { recencyWeightedOverallSql } from './scoring-sql';
import { escapeLikePattern, fitsLikePattern } from './validation';

export interface SqlFragment {
  sql: string;
  /** LIKE patterns and names are strings; house numbers are bound as numbers so they compare as numbers. */
  binds: Array<string | number>;
}

const LIKE = "LIKE ? ESCAPE '\\'";

/**
 * The address as space-delimited words, with a leading and trailing space and commas and
 * periods read as spaces. An alternative spelling is matched against this as `% <spelling> %`,
 * so it only ever hits a whole word: 'lane' finds "Radford La" but not the `la` in "Lanark"
 * or the `ln` in "Lincoln".
 */
const ADDRESS_WORDS = "(' ' || REPLACE(REPLACE(b.address, ',', ' '), '.', ' ') || ' ')";

/**
 * The building's house number, low and high end. Seeded rows (and user rows the address
 * keying has reached) carry `st_num_lo` / `st_num_hi`; for the rest they are read off the
 * front of `b.address`: `CAST` keeps the leading digits ("14-18 Example St" -> 14), and a
 * first word shaped like "14-18" gives the high end. An address with no leading number
 * reads as 0, which no typed number matches.
 */
const ADDRESS_FIRST_WORD = "substr(TRIM(b.address), 1, instr(TRIM(b.address) || ' ', ' ') - 1)";
const HOUSE_LO = 'COALESCE(b.st_num_lo, CAST(TRIM(b.address) AS INTEGER))';
const HOUSE_HI = `COALESCE(b.st_num_hi, CASE WHEN ${ADDRESS_FIRST_WORD} GLOB '[0-9]*-[0-9]*' THEN CAST(substr(${ADDRESS_FIRST_WORD}, instr(${ADDRESS_FIRST_WORD}, '-') + 1) AS INTEGER) ELSE CAST(TRIM(b.address) AS INTEGER) END)`;

function contains(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

function wholeWord(value: string): string {
  return `% ${escapeLikePattern(value)} %`;
}

/**
 * `column LIKE ?` with the pattern bound, or `0` when the pattern is longer than D1 accepts
 * (`fitsLikePattern`): sent anyway, it fails the whole statement and the page shows no
 * match. Every pattern here is one typed word or the whole query between wildcards, and no
 * address word, neighborhood or landlord name is long enough to hold one that size, so the
 * `0` loses no match.
 */
function like(column: string, pattern: string, binds: Array<string | number>): string {
  if (!fitsLikePattern(pattern)) return '0';
  binds.push(pattern);
  return `${column} ${LIKE}`;
}

/**
 * Every term under one of its spellings: the typed spelling anywhere in the address (so
 * 'comm' finds "Commonwealth" and 'st' finds "St James"), every other spelling of its suffix
 * row only as a whole word (as substrings, 'la' found "Oakland" and 'st' found "Dorchester",
 * which turned 'lane' and 'dorchester street' into most of the city). Null for no terms.
 */
function termsClause(terms: readonly string[][]): SqlFragment | null {
  if (terms.length === 0) return null;
  const binds: Array<string | number> = [];
  const clauses = terms.map(([typed, ...alternatives]) => {
    const ors = [
      like('b.address', contains(typed), binds),
      ...alternatives.map((spelling) => like(ADDRESS_WORDS, wholeWord(spelling), binds)),
    ];
    return `(${ors.join(' OR ')})`;
  });
  return { sql: clauses.join(' AND '), binds };
}

/** Every term as a whole word in one of its spellings, the typed one included: the street was named, not just touched. */
function wholeWordsClause(terms: readonly string[][]): SqlFragment | null {
  if (terms.length === 0) return null;
  const binds: Array<string | number> = [];
  const clauses = terms.map(
    (spellings) => `(${spellings.map((spelling) => like(ADDRESS_WORDS, wholeWord(spelling), binds)).join(' OR ')})`,
  );
  return { sql: clauses.join(' AND '), binds };
}

/**
 * The building's number or range contains the typed number (or typed range), under the
 * parity rule `rangeContains` (records/seed/match.ts) applies: a range whose two ends share
 * parity is one side of the street, so "14-18" holds 16 but not 15, and "6-9" holds both.
 * "16" therefore finds 16 and 14-18 but not 116-118, which the old substring match did.
 */
function houseNumberClause(number: HouseNumber): SqlFragment {
  const sql = `(${HOUSE_LO} <= ? AND ? <= ${HOUSE_HI} AND (${HOUSE_LO} = ${HOUSE_HI} OR ${HOUSE_LO} % 2 <> ${HOUSE_HI} % 2 OR (? % 2 = ${HOUSE_LO} % 2 AND ? % 2 = ${HOUSE_LO} % 2)))`;
  return { sql, binds: [number.lo, number.hi, number.lo, number.hi] };
}

/**
 * The building is in a place or ZIP the search named. A neighborhood or postal name matches
 * the stored neighborhood or city exactly (case-insensitive); "Boston" matches the city
 * test `BOSTON_CITY_SQL`, and only when nothing narrower was typed, since every Boston
 * building would otherwise match "Allston, Boston". Null when the search named no place.
 */
function placeClause(parsed: ParsedSearch): SqlFragment | null {
  const named = parsed.places.filter((place) => place !== 'boston');
  const bostonOnly = named.length === 0 && parsed.zips.length === 0 && parsed.places.includes('boston');
  const ors: string[] = [];
  const binds: string[] = [];
  if (named.length > 0) {
    const marks = named.map(() => '?').join(', ');
    ors.push(`LOWER(TRIM(b.neighborhood)) IN (${marks})`, `LOWER(TRIM(b.city)) IN (${marks})`);
    binds.push(...named, ...named);
  }
  if (parsed.zips.length > 0) {
    ors.push(`b.zip_code IN (${parsed.zips.map(() => '?').join(', ')})`);
    binds.push(...parsed.zips);
  }
  if (bostonOnly) ors.push(BOSTON_CITY_SQL);
  return ors.length > 0 ? { sql: ors.join(' OR '), binds } : null;
}

/**
 * WHERE body for a non-empty query. Table aliases are fixed: `b` buildings, `l` landlords.
 *
 * - An address ("75 Example St, Allston, MA 02134"): the place, state and ZIP are taken out
 *   (`parseSearchQuery`), every street word must appear in the address under one of its
 *   spellings, and the house number must be the building's number or inside its range.
 * - A place or ZIP on its own ("Brighton", "02135", "Allston, MA"): buildings in that
 *   neighborhood or ZIP, plus addresses carrying the place name, so "Allston" still finds
 *   an Allston St address (ranked after the Allston buildings by `buildingSearchOrder`).
 * - Anything else that leaves no street word ("MA", "#3"): the words as typed, as before.
 *
 * Failing all of that, the whole query names a neighborhood or a landlord, when it is short
 * enough for D1 to match at all (`like`). The body is parenthesized so a caller can compose
 * it — `WHERE ${sql} AND ...` — without the trailing ORs swallowing the added condition.
 */
export function buildingSearchWhere(query: string): SqlFragment {
  const parsed = parseSearchQuery(query);
  const whole = contains(query.trim());
  const parts: SqlFragment[] = [];
  let joiner = ' AND ';

  const terms = termsClause(parsed.terms);
  if (terms || parsed.houseNumber) {
    if (terms) parts.push(terms);
    if (parsed.houseNumber) parts.push(houseNumberClause(parsed.houseNumber));
  } else {
    const area = isAreaSearch(parsed);
    const place = area ? placeClause(parsed) : null;
    const words = termsClause(area ? parsed.placeTerms : parsed.rawTerms);
    if (place) parts.push(place);
    if (words) parts.push(words);
    joiner = ' OR ';
  }

  let addressClause: string;
  const binds: Array<string | number> = [];
  if (parts.length > 0) {
    addressClause = parts.map((part) => `(${part.sql})`).join(joiner);
    for (const part of parts) binds.push(...part.binds);
  } else {
    // Nothing survived normalization ("...", a lone letter). Fall back to the raw query so
    // the clause still has a bind rather than the literal `%%` pattern that matches every
    // row. Not a load guard — a one-letter query still matches most addresses in the city;
    // it only keeps the degenerate case from being spelled as "no filter at all".
    addressClause = like('b.address', whole, binds);
  }
  const neighborhood = like('b.neighborhood', whole, binds);
  const landlord = like('l.name', whole, binds);
  return { sql: `((${addressClause}) OR ${neighborhood} OR ${landlord})`, binds };
}

/**
 * ORDER BY for the query-mode buildings query, built from the same query as the WHERE.
 * The review alias is fixed at `r` and the buildings alias at `b`, as in both call sites,
 * and `avg_overall` is the column `buildingSearchSelect` names.
 *
 * The order, first key first:
 *
 * 1. The exact address: the house number matches (whole, or inside a range) and every street
 *    word matches as a whole word. Among those, one in the place or ZIP the search named
 *    comes first. This is the one tier that ranks above reviewed buildings: a renter who
 *    types a full address wants that building, reviewed or not.
 * 2. Every other reviewed building, then every other unreviewed one. Reviewed buildings never
 *    sort below unreviewed (seeded) ones outside tier 1. Inside each group, a building whose
 *    street words all match as whole words ("Example St") comes before one that only
 *    contains them ("Lexample St").
 * 3. A building in the place or ZIP the search named ("Allston" lists Allston buildings
 *    before an Allston St address elsewhere).
 * 4. More reviews, then the higher score.
 * 5. House number as a number (98, 100, 103, 1008, not 100, 1008, 103, 98), then the
 *    address, then the unique id, so Load more pages never repeat or skip a row.
 */
export function buildingSearchOrder(query: string): SqlFragment {
  const parsed = parseSearchQuery(query);
  const words = wholeWordsClause(parsed.terms);
  const place = placeClause(parsed);
  const reviewed = 'COUNT(r.id) > 0';
  const inPlace: SqlFragment = place
    ? { sql: `(CASE WHEN ${place.sql} THEN 1 ELSE 0 END)`, binds: place.binds }
    : { sql: '0', binds: [] };

  // 7/6 the exact address (in the typed place or not), 4/3 reviewed (street named as whole
  // words or not), 2/1 unreviewed (the same). Binds follow the `?`s in text order.
  let tier: SqlFragment;
  if (!words) {
    tier = { sql: `CASE WHEN ${reviewed} THEN 3 ELSE 1 END`, binds: [] };
  } else if (!parsed.houseNumber) {
    tier = {
      sql: `CASE WHEN ${words.sql} THEN (CASE WHEN ${reviewed} THEN 4 ELSE 2 END) WHEN ${reviewed} THEN 3 ELSE 1 END`,
      binds: words.binds,
    };
  } else {
    const number = houseNumberClause(parsed.houseNumber);
    tier = {
      sql: `CASE WHEN ${words.sql} THEN (CASE WHEN ${number.sql} THEN 6 + ${inPlace.sql} WHEN ${reviewed} THEN 4 ELSE 2 END) WHEN ${reviewed} THEN 3 ELSE 1 END`,
      binds: [...words.binds, ...number.binds, ...inPlace.binds],
    };
  }

  const keys: SqlFragment[] = [{ sql: `${tier.sql} DESC`, binds: tier.binds }];
  if (place) keys.push({ sql: `${inPlace.sql} DESC`, binds: inPlace.binds });
  for (const key of ['COUNT(r.id) DESC', 'avg_overall DESC', `${HOUSE_LO} ASC`, 'b.address ASC', 'b.id ASC']) {
    keys.push({ sql: key, binds: [] });
  }
  return { sql: `ORDER BY ${keys.map((key) => key.sql).join(', ')}`, binds: keys.flatMap((key) => key.binds) };
}

/**
 * "Is this building in Boston?", as a SQL condition on the buildings alias `b`. The one
 * spelling of the city test: `has_records` (below), the browse order
 * (`BROWSE_BUILDINGS_ORDER`) and a search for "Boston" all interpolate it, so they cannot
 * disagree about which buildings are in Boston. It is NULL when `b.city` is NULL, so a caller
 * that needs 0 or 1 wraps it in `COALESCE(..., 0)`. Why it restates `jurisdictionForCity`
 * rather than calling it: see `buildingSearchSelect`. `searchBrowseOrder.test.ts` checks the
 * two agree on the city spellings stored today.
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
 * `buildingSearchOrder` hardcodes it, so a parameter here could only ever disagree with
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
