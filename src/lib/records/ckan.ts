import { SourceError, type FetchLike } from './types';

export const CKAN_SQL_ENDPOINT = 'https://data.boston.gov/api/3/action/datastore_search_sql';
export const FETCH_TIMEOUT_MS = 10_000;
export const ROW_CAP = 500;

/** Quote a string for embedding in CKAN SQL. Doubles single quotes. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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
