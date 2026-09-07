import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import type { RecordCorrection } from '../../../../../lib/api-types';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const STATUS_FILTERS = ['pending', 'resolved', 'all'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Columns listed explicitly rather than `c.*` — the join means a `SELECT *`
 * would also drag every buildings column into an admin JSON response.
 */
const SELECT_SQL =
  'SELECT c.id, c.building_id, c.record_kind, c.claim, c.contact_email, c.status, c.resolution, ' +
  'c.resolution_notes, c.resolved_by, c.resolved_at, c.created_at, ' +
  'b.address AS building_address, b.slug AS building_slug ' +
  'FROM record_corrections c JOIN buildings b ON b.id = c.building_id';

/**
 * GET /api/admin/records/corrections?status=pending|resolved|all
 *
 * The admin queue for public-record correction reports. Oldest first: this is a
 * work queue, and the oldest unanswered report is the one someone has been
 * waiting on longest. Capped at 200 — the queue is meant to be worked down, not
 * paginated.
 */
export const GET: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  const requested = context.url.searchParams.get('status') ?? 'pending';
  if (!(STATUS_FILTERS as readonly string[]).includes(requested)) {
    return json({ error: 'Invalid status' }, 400);
  }
  const status = requested as StatusFilter;

  try {
    const db = getDB(context);
    const sql =
      status === 'all'
        ? `${SELECT_SQL} ORDER BY c.created_at ASC LIMIT 200`
        : `${SELECT_SQL} WHERE c.status = ? ORDER BY c.created_at ASC LIMIT 200`;

    const statement = status === 'all' ? db.prepare(sql) : db.prepare(sql).bind(status);
    const rows = await statement.all<RecordCorrection>();

    return json({ data: rows.results }, 200);
  } catch (error) {
    logError('record_corrections_list_failed', {
      endpoint: 'admin/records/corrections',
      status,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to load corrections' }, 500);
  }
};
