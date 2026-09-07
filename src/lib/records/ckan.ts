import { SourceError, type FetchLike } from './types';

export const CKAN_SQL_ENDPOINT = 'https://data.boston.gov/api/3/action/datastore_search_sql';
export const FETCH_TIMEOUT_MS = 10_000;
export const ROW_CAP = 500;

/** Quote a string for embedding in CKAN SQL. Doubles single quotes. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** '6,720,200' | '6780500' | '$6,649,200.00 ' -> integer dollars; null when absent. */
export function parseMoney(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (cleaned === '') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseIntOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
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
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new SourceError(`fetch failed: ${err instanceof Error ? err.message : String(err)}`, sql);
    }
    let body: CkanEnvelope<T>;
    try {
      body = (await response.json()) as CkanEnvelope<T>;
    } catch {
      throw new SourceError(`HTTP ${response.status} with non-JSON body`, sql);
    }
    if (!response.ok || !body.success) {
      throw new SourceError(`HTTP ${response.status}: ${describeError(body.error ?? 'request failed')}`, sql);
    }
    return (body.result?.records ?? []).slice(0, ROW_CAP);
  } finally {
    clearTimeout(timer);
  }
}
