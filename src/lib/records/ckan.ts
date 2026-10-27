import { SourceError, type BuildingIdentity, type FetchLike } from './types';

export const CKAN_SQL_ENDPOINT = 'https://data.boston.gov/api/3/action/datastore_search_sql';
export const FETCH_TIMEOUT_MS = 10_000;
export const ROW_CAP = 500;

/** Quote a string for embedding in CKAN SQL. Doubles single quotes. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * `"<column>" = '<zip>'` for one ZIP, `"<column>" IN ('<zip>','<zip>')` for more (the list
 * `recordZips` in identity.ts returns). One ZIP writes the query exactly as it was before the
 * parcel's ZIP was accepted. Interpolation invariant: `column` is a code constant checked against
 * a conservative shape, and every ZIP passes a five-digit guard (anything else throws) before it
 * goes through `sqlLiteral`.
 */
export function zipEqualsClause(column: string, zips: readonly string[]): string {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`Unsafe column name for ZIP clause: ${column}`);
  if (zips.length === 0 || zips.some((zip) => !/^\d{5}$/.test(zip))) throw new Error('ZIP clause needs one or more five-digit ZIPs');
  return zips.length === 1 ? `"${column}" = ${sqlLiteral(zips[0])}` : `"${column}" IN (${zips.map(sqlLiteral).join(',')})`;
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
 * form on `identity`, then every other street spelling not already prefix-covered. `column`
 * must be a code constant, never user input — it is interpolated as an identifier and only
 * checked against a conservative shape.
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
  // Every other spelling the street goes by: the feeds disagree (permits write RADFORD LN where the
  // assessor writes RADFORD LA; legacy 311 writes VFW PKWY). A form an earlier pattern already
  // prefixes (AVE behind AV, TER behind TE) adds nothing to LIKE 'x%' and is skipped, so a street
  // whose short form prefixes its other spellings queries exactly as before.
  const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
  for (const number of numberForms) {
    for (const street of identity.streetForms) {
      const form = `${number} ${street}`;
      if (!forms.some((covered) => form.startsWith(covered))) forms.push(form);
    }
  }
  return forms.map((f) => `upper("${column}") LIKE ${sqlLiteral(`${escapeLikeForCkan(f)}%`)} ESCAPE '!'`);
}

/**
 * Street spellings that can sit inside a POSIX regex as plain text: uppercase letters, digits,
 * spaces, apostrophes and hyphens, none of which is a regex metacharacter outside a bracket
 * expression. No backslash can ever be needed, which matters because CKAN's statement splitter
 * misreads a backslash before a quote (see `escapeLikeForCkan`).
 */
const REGEX_SAFE_STREET = /^[A-Z0-9 '-]+$/;

/** Digits only, so a number can be written into a regex alternation without escaping. */
const DIGITS = /^\d+$/;

function alternation(values: readonly string[]): string {
  return values.join('|');
}

export interface RangeClauseOptions {
  /**
   * Also find city records filed under a range that starts below the address
   * (`identity.enclosingLows`). Such a range may end below the address as well, so a caller that
   * sets this must keep only rows whose house-number token passes `houseNumberTokenMatches`.
   */
  enclosing: boolean;
}

/**
 * One regex clause, `upper("<column>") ~ '^(...) (<street spellings>)'`, for a free-text
 * address column. It finds what the as-written LIKE clauses cannot: every number inside a range
 * address (the 33 of a 31-35 address), a city record filed as a range that starts on one of the
 * address's numbers ('501-507 EXAMPLE AV' for 501), and, with `enclosing`, one that starts below
 * it ('501-507' for 503). One regex rather than one LIKE per number: each
 * LIKE re-runs `upper()` over the whole resource, and 50 of them took eight seconds against a
 * ten-second budget (measured live 2026-10-27), where this clause adds about 0.2 seconds.
 *
 * Interpolation invariant: every number passes a digits-only guard and every street spelling
 * the `REGEX_SAFE_STREET` guard before the whole pattern goes through `sqlLiteral`. Null when
 * there is nothing to add or no spelling passes, which leaves the LIKE clauses as they were.
 */
export function rangeAddressClause(column: string, identity: BuildingIdentity, options: RangeClauseOptions): string | null {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`Unsafe column name for regex clause: ${column}`);
  const streets = identity.streetForms.filter((s) => REGEX_SAFE_STREET.test(s));
  const own = identity.matchNumbers.filter((n) => DIGITS.test(n));
  const lows = options.enclosing ? identity.enclosingLows.filter((n) => DIGITS.test(n)) : [];
  if (streets.length === 0 || (own.length === 0 && lows.length === 0)) return null;
  const arms: string[] = [];
  if (own.length > 0) arms.push(`(${alternation(own)})(-[0-9]+[A-Z]?)?`);
  if (lows.length > 0) arms.push(`(${alternation(lows)})-[0-9]+[A-Z]?`);
  const pattern = `^(${arms.join('|')}) (${alternation(streets)})`;
  return `upper("${column}") ~ ${sqlLiteral(pattern)}`;
}

/**
 * The same idea for a column that holds the house number alone (311's new-system
 * `street_number`): a record filed as a range starting on one of the address's numbers or, with
 * `enclosing`, below it. Plain numbers are matched by the caller's exact `IN` list. Callers that
 * set `enclosing` filter with `houseNumberTokenMatches`. Digits-only guard, then `sqlLiteral`.
 */
export function rangeNumberClause(column: string, identity: BuildingIdentity, options: RangeClauseOptions): string | null {
  if (!/^[a-z_]+$/.test(column)) throw new Error(`Unsafe column name for regex clause: ${column}`);
  const starts = [
    ...identity.matchNumbers.filter((n) => DIGITS.test(n)),
    ...(options.enclosing ? identity.enclosingLows.filter((n) => DIGITS.test(n)) : []),
  ];
  if (starts.length === 0) return null;
  return `upper("${column}") ~ ${sqlLiteral(`^(${alternation(starts)})[A-Z]?-`)}`;
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
/**
 * A 32,000-row page is megabytes of JSON over a slow municipal endpoint, so it gets its
 * own budget: `FETCH_TIMEOUT_MS` is sized for the single-building pulls a request handler
 * makes, and would abort a healthy bulk page long before it finished arriving.
 */
export const CKAN_PAGE_TIMEOUT_MS = 120_000;
/** Attempts per page, including the first. */
export const CKAN_PAGE_ATTEMPTS = 3;
/** Backoff before attempt 2 and attempt 3. */
const CKAN_RETRY_DELAYS_MS = [1_000, 4_000];

export interface FetchAllRowsOptions {
  /** Columns to return; omit for all. Always name them: `_full_text` alone doubles the payload. */
  fields?: string[];
  /** Equality filters; an array value means IN. Sent as CKAN's JSON `filters` parameter. */
  filters?: Record<string, string | string[]>;
  /**
   * CKAN's `sort` parameter, e.g. `'_id'`. Without it the datastore does not promise a
   * stable order across the requests of one download, so a row can appear on two pages or
   * on none — which a resumed run then turns into buildings that moved between batch
   * files. `_id` is CKAN's own insertion key and is present on every datastore resource.
   */
  sort?: string;
  pageSize?: number;
  onPage?: (rowsSoFar: number) => void;
  /** Per-request timeout; defaults to `CKAN_PAGE_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injected so tests exercise the retry path without waiting out the backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A failed page attempt. `retryable` is decided where the failure is known — a 5xx, a
 * network error, or a timeout is worth another attempt; a 4xx will fail identically
 * forever and is thrown straight through.
 */
class CkanPageError extends Error {
  constructor(message: string, readonly retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CkanPageError';
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One `datastore_search` request. Returns the page's records or throws a `CkanPageError`. */
async function fetchPage<T>(url: string, where: string, timeoutMs: number, fetchImpl: FetchLike): Promise<T[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const timedOut = (): boolean => controller.signal.aborted;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      if (timedOut()) throw new CkanPageError(`${where}: timed out after ${timeoutMs}ms`, true, { cause: err });
      throw new CkanPageError(`${where}: fetch failed: ${err instanceof Error ? err.message : String(err)}`, true, { cause: err });
    }
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      if (timedOut()) throw new CkanPageError(`${where}: timed out after ${timeoutMs}ms reading body`, true, { cause: err });
      throw new CkanPageError(`${where}: HTTP ${response.status}: body read failed`, true, { cause: err });
    }
    // Read as text first: a gateway in front of CKAN answers an outage with HTML, and
    // `response.json()` would throw a bare SyntaxError naming neither resource nor status.
    let body: CkanEnvelope<T>;
    try {
      body = JSON.parse(text) as CkanEnvelope<T>;
    } catch {
      throw new CkanPageError(`${where}: HTTP ${response.status} with non-JSON body: ${text.slice(0, 200)}`, response.status >= 500);
    }
    if (!response.ok || !body.success || !body.result?.records) {
      throw new CkanPageError(`${where}: HTTP ${response.status}: ${describeError(body.error ?? 'request failed')}`, response.status >= 500);
    }
    return body.result.records;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bulk download of one datastore resource through the paged `datastore_search` action.
 * Used by the seed script, never by a request handler. `filters` and `fields` are
 * parameters, not interpolated SQL, so nothing here needs sqlLiteral.
 *
 * A full seed is hundreds of thousands of rows across a dozen-plus requests, so one
 * blip must not cost the whole download: each page is retried up to
 * `CKAN_PAGE_ATTEMPTS` times on a transient failure before the run gives up.
 */
export async function fetchAllRows<T>(resourceId: string, options: FetchAllRowsOptions, fetchImpl: FetchLike): Promise<T[]> {
  const pageSize = options.pageSize ?? CKAN_MAX_PAGE;
  // A page size below 1 never advances the offset and never returns a short page: the
  // loop below would run forever against a healthy endpoint.
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`fetchAllRows pageSize must be a positive integer, got ${pageSize}`);
  }
  const timeoutMs = options.timeoutMs ?? CKAN_PAGE_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({ resource_id: resourceId, limit: String(pageSize), offset: String(offset) });
    if (options.fields) params.set('fields', options.fields.join(','));
    if (options.filters) params.set('filters', JSON.stringify(options.filters));
    if (options.sort) params.set('sort', options.sort);
    const url = `${CKAN_SEARCH_ENDPOINT}?${params.toString()}`;
    const where = `CKAN datastore_search failed for ${resourceId} at offset ${offset}`;

    let records: T[] | undefined;
    for (let attempt = 1; records === undefined; attempt += 1) {
      try {
        records = await fetchPage<T>(url, where, timeoutMs, fetchImpl);
      } catch (err) {
        const retryable = err instanceof CkanPageError && err.retryable;
        if (!retryable || attempt >= CKAN_PAGE_ATTEMPTS) throw err;
        await sleep(CKAN_RETRY_DELAYS_MS[attempt - 1] ?? CKAN_RETRY_DELAYS_MS[CKAN_RETRY_DELAYS_MS.length - 1]);
      }
    }

    // Spreading a page into push() passes one argument per row, and a 32,000-row page is
    // close enough to V8's argument limit that a caller-chosen pageSize could blow the stack.
    for (const record of records) rows.push(record);
    // A resource whose row count is an exact multiple of the page size ends with one
    // empty page; that page is how the loop learns it is done, not progress to report.
    if (records.length > 0) options.onPage?.(rows.length);
    if (records.length < pageSize) break;
  }
  return rows;
}
