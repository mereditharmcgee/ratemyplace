import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import { MAX_ATTEMPTS, queueStats } from '../../../../../lib/records/queue';
import type { RecordsQueueParkedRow } from '../../../../../lib/api-types';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Key the scheduler stamps with its last circuit-breaker fixture run (0031 `app_settings`). */
const FIXTURE_LAST_KEY = 'records_fixture_last';

/**
 * Columns listed explicitly rather than `q.*`/`b.*` — the join means a `SELECT *`
 * would drag every buildings column into an admin JSON response. Capped at 100:
 * the parked list is a work queue meant to be emptied, not paginated, and a
 * hundred parked pulls already means something upstream is broken.
 */
const PARKED_SQL =
  'SELECT q.id, q.reason, q.attempts, q.last_error, q.requested_at, b.address, b.slug ' +
  'FROM records_queue q JOIN buildings b ON b.id = q.building_id ' +
  'WHERE q.done_at IS NULL AND q.attempts >= ? ORDER BY q.requested_at LIMIT 100';

/**
 * GET /api/admin/records/queue
 *
 * What the pull queue is doing right now: the counts the panel shows, the rows
 * that have failed their way out of the queue, and the last circuit-breaker
 * fixture result. Read-only, so no audit entry.
 */
export const GET: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  try {
    const db = getDB(context);
    const now = Math.floor(Date.now() / 1000);

    const stats = await queueStats(db, { now });
    const parked = await db.prepare(PARKED_SQL).bind(MAX_ATTEMPTS).all<RecordsQueueParkedRow>();
    const fixture = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(FIXTURE_LAST_KEY)
      .first<{ value: string }>();

    // A settings row the scheduler wrote in a shape this build does not understand
    // must not take the whole panel down with it — the counts still matter.
    let lastFixture: unknown = null;
    if (fixture?.value) {
      try {
        lastFixture = JSON.parse(fixture.value);
      } catch {
        lastFixture = null;
      }
    }

    return json({ stats, parked: parked.results, lastFixture }, 200);
  } catch (error) {
    logError('records_queue_stats_failed', {
      endpoint: 'admin/records/queue',
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to load the queue' }, 500);
  }
};
