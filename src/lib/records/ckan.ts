import { SourceError, type BuildingIdentity, type FetchLike } from './types';

export const CKAN_SQL_ENDPOINT = 'https://data.boston.gov/api/3/action/datastore_search_sql';
export const FETCH_TIMEOUT_MS = 10_000;
export const ROW_CAP = 500;

/** Quote a string for embedding in CKAN SQL. Doubles single quotes. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Escape `!`, `%`, and `_` for a LIKE pattern using `!` as the escape character
 * (escaping `!` itself first, so a literal `!` in the input round-trips correctly).
 *
 * Boston's CKAN `datastore_search_sql` rejects any query containing `ESCAPE '\'`
 * with `HTTP 409 Query is not a single statement` — its statement splitter treats
 * the backslash-quote as an unterminated string. Verified live 2026-09-07 against
 * the permits resource: `ESCAPE '!'` returns 200 and works correctly
 * (`LIKE '55!_65 LANARK%' ESCAPE '!'` matches nothing, `LIKE '55-65 LANARK%' ESCAPE '!'`
 * matches). `!` is not a SQL metacharacter and is not used elsewhere in these
 * address forms, so it is safe to use as the escape character here.
 */
function escapeLikeForCkan(value: string): string {
  return value.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

/**
 * `upper("<column>") LIKE '<form>%' ESCAPE '!'` for every unique short and long address
 * form on `identity`. `column` must be a code constant, never user input — it is
 * interpolated as an identifier and only checked against a conservative shape.
 *
 * The trailing `%` is intentionally loose: `'55 LANARK RD%'` also matches
 * `55 LANARK RD REAR`, which is desired, but it cannot exclude an unrelated address that
 * happens to share a short form, e.g. `10 UNION PARK ST` when the short form is
 * `UNION PK`. That residual false-positive risk is accepted here; the correction
 * workflow is how a wrongly attached record gets detached.
 */
export function addressLikeClauses(column: string, identity: BuildingIdentity): string[] {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`Unsafe column name for LIKE clause: ${column}`);
  const forms = Array.from(new Set([...identity.addressFormsShort, ...identity.addressFormsLong]));
  return forms.map((f) => `upper("${column}") LIKE ${sqlLiteral(`${escapeLikeForCkan(f)}%`)} ESCAPE '!'`);
}

/**
 * '6,720,200' | '6780500' | '$6,649,200.00 ' -> integer dollars; null when absent.
 * Assumes non-negative assessor values; a leading minus or accounting parentheses are not interpreted.
 */
export function parseMoney(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (cleaned === '') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * A CKAN cell as trimmed text, or null when it is absent or blank. Every source adapter
 * reads its columns through this: the datastore returns numbers for some columns and
 * whitespace-padded strings for others, and a blank cell means "not recorded", not `''`.
 */
export function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function parseIntOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  const cleaned = value.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

interface CkanEnvelope<T> {
  success: boolean;
  result?: { records?: T[] };
  error?: unknown;
}

function describeError(error: unknown): string {
  try {
    return JSON.stringify(error).slice(0, 300);
  } catch {
    return String(error);
  }
}

/**
 * Run one SQL statement against Boston's CKAN datastore. Always resolves to at
 * most ROW_CAP rows or throws a SourceError that carries the query for provenance.
 */
export async function ckanSql<T>(sql: string, fetchImpl: FetchLike): Promise<T[]> {
  const url = `${CKAN_SQL_ENDPOINT}?sql=${encodeURIComponent(sql)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const timedOut = () => controller.signal.aborted;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      if (timedOut()) throw new SourceError(`timed out after ${FETCH_TIMEOUT_MS}ms`, sql, { cause: err });
      throw new SourceError(`fetch failed: ${err instanceof Error ? err.message : String(err)}`, sql, { cause: err });
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      if (timedOut()) throw new SourceError(`timed out after ${FETCH_TIMEOUT_MS}ms reading body`, sql, { cause: err });
      throw new SourceError(`HTTP ${response.status}: body read failed`, sql, { cause: err });
    }
    let body: CkanEnvelope<T>;
    try {
      body = JSON.parse(text) as CkanEnvelope<T>;
    } catch {
      throw new SourceError(`HTTP ${response.status} with non-JSON body: ${text.slice(0, 200)}`, sql);
    }
    if (!response.ok || !body.success) {
      throw new SourceError(`HTTP ${response.status}: ${describeError(body.error ?? 'request failed')}`, sql, undefined, body.error);
    }
    return (body.result?.records ?? []).slice(0, ROW_CAP);
  } finally {
    clearTimeout(timer);
  }
}

export const CKAN_SEARCH_ENDPOINT = 'https://data.boston.gov/api/3/action/datastore_search';
/** data.boston.gov caps datastore_search at 32,000 rows per request (verified 2026-09-09). */
export const CKAN_MAX_PAGE = 32_000;

export interface FetchAllRowsOptions {
  /** Columns to return; omit for all. Always name them: `_full_text` alone doubles the payload. */
  fields?: string[];
  /** Equality filters; an array value means IN. Sent as CKAN's JSON `filters` parameter. */
  filters?: Record<string, string | string[]>;
  pageSize?: number;
  onPage?: (rowsSoFar: number) => void;
}

/**
 * Bulk download of one datastore resource through the paged `datastore_search` action.
 * Used by the seed script, never by a request handler. `filters` and `fields` are
 * parameters, not interpolated SQL, so nothing here needs sqlLiteral.
 */
export async function fetchAllRows<T>(resourceId: string, options: FetchAllRowsOptions, fetchImpl: FetchLike): Promise<T[]> {
  const pageSize = options.pageSize ?? CKAN_MAX_PAGE;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({ resource_id: resourceId, limit: String(pageSize), offset: String(offset) });
    if (options.fields) params.set('fields', options.fields.join(','));
    if (options.filters) params.set('filters', JSON.stringify(options.filters));
    const response = await fetchImpl(`${CKAN_SEARCH_ENDPOINT}?${params.toString()}`, { method: 'GET' });
    const body = (await response.json()) as { success?: boolean; result?: { records?: T[] }; error?: { message?: string } };
    if (!response.ok || !body.success || !body.result?.records) {
      throw new Error(`CKAN datastore_search failed for ${resourceId} at offset ${offset}: ${body.error?.message ?? response.status}`);
    }
    rows.push(...body.result.records);
    // A resource whose row count is an exact multiple of the page size ends with one
    // empty page; that page is how the loop learns it is done, not progress to report.
    if (body.result.records.length > 0) options.onPage?.(rows.length);
    if (body.result.records.length < pageSize) break;
  }
  return rows;
}
