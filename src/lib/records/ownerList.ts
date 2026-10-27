// The read side of `building_owners` (migration 0034): the owner link in the records panel,
// the owner of record list page (`/owner-of-record`), and the owner half of landlord search.
// The write side is `owners.ts`; the rules every function here applies are `ownerOfRecord.ts`.
//
// Privacy rules, each enforced here on the server and not only by hiding a link:
// - Group by the exact normalized owner name (`owner_key`), never by mailing address.
// - An entity owner links only when two or more buildings in our data carry its name, so the list
//   always shows at least one building besides the one the reader came from. A person links
//   only when two or more distinct residential parcels in
//   our data carry the same name, so no list is ever built for someone who owns one home. The
//   list page and landlord search apply that to a typed name too: `/owner-of-record?name=` is a
//   public URL, and a person below the count gets the same 404 as a name with no buildings.
// - A condominium parcel has no row, so it never links and never appears in a list.
//
// Everything here works before the migration has run and while the table is empty: a missing
// table reads as no row, the owner stays plain text and nothing answers 500.
import { escapeLikePattern, fitsLikePattern } from '../validation';
import { logError } from '../logger';
import { ledgerModel } from './ledger';
import { getRecordsViews, type BuildingRecordsView } from './query';
import { MIN_PARCELS_FOR_PERSON, isEntityOwner, linkableOwnerKey, ownerKey } from './ownerOfRecord';
import type { AssessmentPayload, RecordKind, RecordsDb } from './types';

export const OWNER_LIST_PATH = '/owner-of-record';
export const OWNER_LIST_PAGE_SIZE = 20;
export const OWNER_SEARCH_LIMIT = 10;
/** An entity owner links, and is found by landlord search, only at this many buildings here. */
export const MIN_BUILDINGS_FOR_ENTITY_LINK = 2;
/** A typed name longer than this is no owner name; the page answers 404 without a query. */
export const MAX_OWNER_NAME_LENGTH = 200;

/** The record kinds behind the list's counts. The assessor and RentSmart rows count nothing there. */
const COUNTED_KINDS: readonly RecordKind[] = ['permit', 'violation', 'enforcement_ticket', 'service_request'];

/** `/owner-of-record?name=<key>`, plus `&page=N` past the first page. */
export function ownerListHref(key: string, page = 1): string {
  const params = new URLSearchParams({ name: key });
  if (page > 1) params.set('page', String(page));
  return `${OWNER_LIST_PATH}?${params.toString()}`;
}

/** Before migration 0034 has run. Expected, so it is not logged as a failure. */
function isMissingTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*building_owners/i.test(error.message);
}

function logReadFailure(event: string, error: unknown, context: Record<string, string>): void {
  if (isMissingTable(error)) return;
  logError(event, { ...context, error: error instanceof Error ? error.message : String(error) });
}

interface OwnerGate {
  buildings: number;
  residential_parcels: number;
}

// The statements, exported so the tests run EXPLAIN QUERY PLAN on exactly what ships. Every
// one is a seek on `idx_building_owners_key` except landlord search's name match, which scans
// that index (about 38,000 short entries) rather than the table.

/** All rows and distinct residential parcels under one key, from the index alone. Binds: key. */
export const OWNER_GATE_SQL =
  'SELECT COUNT(*) AS buildings, COUNT(DISTINCT CASE WHEN residential = 1 THEN parcel_id END) AS residential_parcels ' +
  'FROM building_owners WHERE owner_key = ?';

/** This building's key, with the key's distinct residential parcels. Binds: building id. */
export const OWNER_LINK_SQL =
  'SELECT bo.owner_key, (SELECT COUNT(*) FROM building_owners a WHERE a.owner_key = bo.owner_key) AS buildings, ' +
  '(SELECT COUNT(DISTINCT o.parcel_id) FROM building_owners o ' +
  'WHERE o.owner_key = bo.owner_key AND o.residential = 1) AS residential_parcels ' +
  'FROM building_owners bo WHERE bo.building_id = ?';

/** The spelling most rows under a key carry. Binds: key. */
export const OWNER_SPELLING_SQL =
  'SELECT owner, COUNT(*) AS n FROM building_owners WHERE owner_key = ? GROUP BY owner ORDER BY n DESC, owner LIMIT 1';

/**
 * One page of the list. Grouped by street, then by house number as a number, so a portfolio
 * on one street reads in order; `b.id` last keeps pages from overlapping. Binds: key, limit,
 * offset.
 */
export const OWNER_LIST_ROWS_SQL =
  'SELECT bo.building_id, bo.fiscal_year, bo.owner, b.slug, b.address, b.neighborhood, b.city, b.state ' +
  'FROM building_owners bo JOIN buildings b ON b.id = bo.building_id ' +
  'WHERE bo.owner_key = ? ' +
  "ORDER BY ltrim(b.address, '0123456789- ') COLLATE NOCASE, CAST(b.address AS INTEGER), b.address, b.id " +
  'LIMIT ? OFFSET ?';

/**
 * Landlord search's owner names: keys containing the typed name (`like`), or equal to it when
 * the name is too long for D1's LIKE, kept only when the key is an entity or has
 * `MIN_PARCELS_FOR_PERSON` distinct residential parcels. Binds: pattern or key, the parcel
 * minimum, limit.
 */
export function ownerSearchSql(like: boolean): string {
  return (
    'SELECT owner_key, MIN(owner) AS owner, COUNT(*) AS buildings, ' +
    'COUNT(DISTINCT CASE WHEN residential = 1 THEN parcel_id END) AS residential_parcels, ' +
    'COUNT(*) OVER () AS total ' +
    'FROM building_owners ' +
    (like ? "WHERE owner_key LIKE ? ESCAPE '\\' " : 'WHERE owner_key = ? ') +
    'GROUP BY owner_key ' +
    `HAVING (MAX(is_entity) = 1 AND COUNT(*) >= ${MIN_BUILDINGS_FOR_ENTITY_LINK}) ` +
    'OR COUNT(DISTINCT CASE WHEN residential = 1 THEN parcel_id END) >= ? ' +
    'ORDER BY buildings DESC, owner_key LIMIT ?'
  );
}

/**
 * The panel's owner link for a building, or null to leave the owner as plain text. `current`
 * is the assessor row the panel shows. Links only when this building's own owner row exists
 * and carries the same key, so the list it opens always includes the building the reader came
 * from, and only when the rules allow the key. Never throws.
 */
export async function ownerOfRecordHref(
  db: RecordsDb,
  buildingId: string,
  current: Pick<AssessmentPayload, 'owner' | 'condominium'> | null,
): Promise<string | null> {
  if (!current || current.condominium) return null;
  const key = ownerKey(current.owner);
  if (key === null) return null;
  try {
    const row = await db
      .prepare(OWNER_LINK_SQL)
      .bind(buildingId)
      .first<{ owner_key: string; buildings: number; residential_parcels: number }>();
    if (!row || row.owner_key !== key) return null;
    const linkable = linkableOwnerKey(current, Number(row.residential_parcels) || 0);
    // A company with only this building would open a list of one: leave it plain text.
    if (linkable !== null && isEntityOwner(linkable) && (Number(row.buildings) || 0) < MIN_BUILDINGS_FOR_ENTITY_LINK) return null;
    return linkable === null ? null : ownerListHref(linkable);
  } catch (error) {
    logReadFailure('owner_of_record_link_failed', error, { buildingId });
    return null;
  }
}

/**
 * One building's counts on the list, read off the same ledger the building's panel renders,
 * so the two cannot disagree. A count is the panel's string: a number, or the panel's dash
 * for a source with nothing to count.
 */
export interface OwnerRecordCounts {
  /** False when none of the city feeds has been pulled for the building, only its assessor row. */
  pulled: boolean;
  living: string;
  isdCases: string;
  buildingRequests: string;
  permits: string;
  publicWorksTickets: string;
  upkeepRequests: string;
}

export function ownerRecordCounts(view: BuildingRecordsView | undefined, now: Date): OwnerRecordCounts {
  if (!view) {
    return { pulled: false, living: '', isdCases: '', buildingRequests: '', permits: '', publicWorksTickets: '', upkeepRequests: '' };
  }
  const ledger = ledgerModel(view, now);
  return {
    pulled: [ledger.living, ledger.violations, ledger.permits, ledger.enforcement].some((section) => section.status !== null),
    living: ledger.living.count,
    isdCases: ledger.violations.count,
    buildingRequests: ledger.buildingRequests.count,
    permits: ledger.permits.count,
    publicWorksTickets: ledger.enforcement.count,
    upkeepRequests: ledger.upkeepRequests.count,
  };
}

export interface OwnerListBuilding {
  id: string;
  slug: string;
  address: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  /** The assessor fiscal year this building's owner was read from. */
  fiscalYear: string;
  /** The owner as recorded on this building's assessor row. */
  owner: string;
  counts: OwnerRecordCounts;
}

export type OwnerListResult =
  | { found: false }
  | {
      found: true;
      key: string;
      /** The spelling most of the list's rows carry, as recorded. */
      owner: string;
      total: number;
      page: number;
      pageCount: number;
      buildings: OwnerListBuilding[];
    };

interface OwnerListRow {
  building_id: string;
  fiscal_year: string;
  owner: string;
  slug: string;
  address: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

/**
 * The list behind `/owner-of-record?name=`. `name` is whatever was typed into the URL; it goes
 * through the same key and the same rules as the panel link, so a name the panel would not
 * link (a person under the parcel count, a name with no buildings, a blank) is `found: false`
 * and the page answers the same 404 for all of them. A page past the end shows the last page.
 */
export async function loadOwnerList(
  db: RecordsDb,
  name: string | null,
  requestedPage: number,
  now: Date,
): Promise<OwnerListResult> {
  if (name === null || name.length > MAX_OWNER_NAME_LENGTH) return { found: false };
  const key = ownerKey(name);
  if (key === null) return { found: false };
  try {
    const gate = await db.prepare(OWNER_GATE_SQL).bind(key).first<OwnerGate>();
    const total = Number(gate?.buildings ?? 0);
    if (total === 0) return { found: false };
    if (linkableOwnerKey({ owner: key, condominium: false }, Number(gate?.residential_parcels ?? 0)) === null) {
      return { found: false };
    }

    const pageCount = Math.max(1, Math.ceil(total / OWNER_LIST_PAGE_SIZE));
    const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.trunc(requestedPage) : 1), pageCount);

    const spelling = await db.prepare(OWNER_SPELLING_SQL).bind(key).first<{ owner: string }>();

    const rows = await db
      .prepare(OWNER_LIST_ROWS_SQL)
      .bind(key, OWNER_LIST_PAGE_SIZE, (page - 1) * OWNER_LIST_PAGE_SIZE)
      .all<OwnerListRow>();

    const views = await getRecordsViews(
      db,
      rows.results.map((row) => row.building_id),
      COUNTED_KINDS,
    );

    return {
      found: true,
      key,
      owner: spelling?.owner ?? key,
      total,
      page,
      pageCount,
      buildings: rows.results.map((row) => ({
        id: row.building_id,
        slug: row.slug,
        address: row.address,
        neighborhood: row.neighborhood,
        city: row.city,
        state: row.state,
        fiscalYear: row.fiscal_year,
        owner: row.owner,
        counts: ownerRecordCounts(views.get(row.building_id), now),
      })),
    };
  } catch (error) {
    logReadFailure('owner_of_record_list_failed', error, { key });
    return { found: false };
  }
}

export interface OwnerNameMatch {
  key: string;
  /** One recorded spelling of the name. */
  owner: string;
  buildings: number;
}

interface OwnerSearchRow {
  owner_key: string;
  owner: string;
  buildings: number;
  residential_parcels: number;
  total: number;
}

/**
 * Owner-of-record names for landlord search: the keys that contain the typed name (or equal
 * it, when the name is too long for D1's LIKE), and only keys the rules allow, so a typed
 * person's name below the parcel count matches nothing. Most buildings first. Never throws;
 * no table or no match is an empty answer.
 */
export async function searchOwnerNames(
  db: RecordsDb,
  query: string,
  limit = OWNER_SEARCH_LIMIT,
): Promise<{ matches: OwnerNameMatch[]; total: number }> {
  const none = { matches: [], total: 0 };
  if (query.length > MAX_OWNER_NAME_LENGTH) return none;
  const key = ownerKey(query);
  if (key === null) return none;
  const pattern = `%${escapeLikePattern(key)}%`;
  const like = fitsLikePattern(pattern);
  try {
    const rows = await db
      .prepare(ownerSearchSql(like))
      .bind(like ? pattern : key, MIN_PARCELS_FOR_PERSON, limit)
      .all<OwnerSearchRow>();
    // The stored is_entity is the rule as it stood when the row was written. The rule as it
    // stands now decides, so a row the current rule would not link is dropped here too.
    const allowed = rows.results.filter(
      (row) => linkableOwnerKey({ owner: row.owner_key, condominium: false }, Number(row.residential_parcels) || 0) !== null,
    );
    const total = Number(rows.results[0]?.total ?? 0) - (rows.results.length - allowed.length);
    return {
      matches: allowed.map((row) => ({ key: row.owner_key, owner: row.owner, buildings: Number(row.buildings) })),
      total: Math.max(total, allowed.length),
    };
  } catch (error) {
    logReadFailure('owner_of_record_search_failed', error, {});
    return none;
  }
}
