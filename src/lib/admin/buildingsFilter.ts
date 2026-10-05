import { escapeLikePattern } from '../validation';
import { orphanBuildingsWhere } from './orphanBuildings';

export const ADMIN_BUILDINGS_Q_MAX = 200;

export interface AdminBuildingsFilter {
  /** Exact `buildings.landlord_id`, or null for every landlord. */
  landlord: string | null;
  /** Trimmed search text (at most 200 chars), or null for no search. */
  q: string | null;
  /** Only orphans (see `orphanBuildingsWhere`). */
  orphans: boolean;
}

/** Reads the admin buildings list filters from a query string; unknown values are ignored. */
export function parseAdminBuildingsFilter(params: URLSearchParams): AdminBuildingsFilter {
  const landlord = params.get('landlord')?.trim() || null;
  const q = params.get('q')?.trim().slice(0, ADMIN_BUILDINGS_Q_MAX).trim() || null;
  return { landlord, q, orphans: params.get('filter') === 'orphans' };
}

/**
 * The WHERE clause (with its leading keyword, or '' when nothing is active) and its binds,
 * over `buildings b`. Search is a substring match on address, city, or ZIP with LIKE
 * wildcards escaped, so "100%" means the characters, not "100 then anything".
 */
export function adminBuildingsWhere(filter: AdminBuildingsFilter): { sql: string; binds: string[] } {
  const clauses: string[] = [];
  const binds: string[] = [];

  if (filter.landlord) {
    clauses.push('b.landlord_id = ?');
    binds.push(filter.landlord);
  }
  if (filter.q) {
    const pattern = `%${escapeLikePattern(filter.q)}%`;
    clauses.push("(b.address LIKE ? ESCAPE '\\' OR b.city LIKE ? ESCAPE '\\' OR b.zip_code LIKE ? ESCAPE '\\')");
    binds.push(pattern, pattern, pattern);
  }
  if (filter.orphans) {
    const orphans = orphanBuildingsWhere();
    clauses.push(orphans.sql);
    binds.push(...orphans.binds);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', binds };
}

/** The list URL the admin buildings table fetches. Inactive filters are left off. */
export function adminBuildingsUrl(page: { limit: number; offset: number }, filter: AdminBuildingsFilter): string {
  const params = new URLSearchParams({ limit: String(page.limit), offset: String(page.offset) });
  if (filter.landlord) params.set('landlord', filter.landlord);
  if (filter.q) params.set('q', filter.q);
  if (filter.orphans) params.set('filter', 'orphans');
  return `/api/admin/buildings?${params.toString()}`;
}
