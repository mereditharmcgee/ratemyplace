import type { FetchLike } from '../../../records/types';

export interface FixtureRoute {
  /** CKAN resource id the SQL must reference. */
  resourceId: string;
  /** Optional substring the SQL must also contain. */
  sqlIncludes?: string;
  records?: unknown[];
  /** When set, respond with this HTTP status and a CKAN error envelope. */
  errorStatus?: number;
  errorMessage?: string;
  /** With errorStatus, respond with this exact recorded body instead of a synthetic envelope. */
  rawBody?: string;
}

export function fixtureFetch(routes: FixtureRoute[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = async (input: string) => {
    const sql = decodeURIComponent(input.split('sql=')[1] ?? '');
    calls.push(sql);
    const route = routes.find((r) => sql.includes(r.resourceId) && (!r.sqlIncludes || sql.includes(r.sqlIncludes)));
    if (!route) {
      return new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });
    }
    if (route.errorStatus) {
      const body = route.rawBody ?? JSON.stringify({ success: false, error: { info: { orig: [route.errorMessage ?? 'error'] } } });
      return new Response(body, { status: route.errorStatus });
    }
    return new Response(JSON.stringify({ success: true, result: { records: route.records ?? [] } }), { status: 200 });
  };
  return Object.assign(impl, { calls });
}
