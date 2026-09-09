import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import { LOCK_TTL_SECONDS, queueStats } from '../../../../../lib/records/queue';
import { json, readJsonBody } from './_json';

function validationError(field: string, message: string): Response {
  return json({ error: 'Validation failed', details: [{ field, message }] }, 400);
}

/**
 * The row is claimed, its pull is in flight, and clearing the lease now would let the
 * next cron tick start a second concurrent pull of the same building.
 */
const STILL_RUNNING = 'That pull is still running; retry after its lease expires';

/**
 * POST /api/admin/records/queue/retry  `{ id: number }`
 *
 * Un-parks one queue row: zero the attempts, drop the stale error and lock, and let
 * the next Worker run claim it again. Scoped to `done_at IS NULL` so a finished row
 * can never be reopened by id — a completed pull is history, not a work item.
 *
 * It is ALSO scoped to a lease that has expired, which is the subtle half. `attempts`
 * counts claims, not failures, so a row crosses MAX_ATTEMPTS at the moment of its last
 * CLAIM and shows up parked while that pull is still running — for up to
 * LOCK_TTL_SECONDS. Clearing `locked_at` unconditionally would hand the same building
 * to the very next tick alongside the pull already in flight. A row in that window is
 * refused with a 409 instead; the lease expires on its own and Retry works then.
 *
 * No audit entry: a retry is a non-destructive operational switch. It changes no
 * record anyone can read, and the pull it eventually causes writes its own
 * `record_pulls` rows with `trigger_reason`.
 *
 * CSRF: per AGENTS.md, an authenticated endpoint is covered by the SameSite=Lax
 * session cookie — a cross-site POST carries no session and fails the admin check
 * above. `readJsonBody` is the JSON-specific layer, and it runs the content-type
 * guard before `request.json()`, which throws a raw SyntaxError on non-JSON input.
 */
export const POST: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  const parsed = await readJsonBody(context);
  if (!parsed.ok) return parsed.response;

  try {
    const id = parsed.body.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      return validationError('id', 'Send the queue row id as a positive integer.');
    }

    const db = getDB(context);
    const now = Math.floor(Date.now() / 1000);
    const staleBefore = now - LOCK_TTL_SECONDS;

    const update = await db
      .prepare(
        'UPDATE records_queue SET attempts = 0, last_error = NULL, locked_at = NULL ' +
          'WHERE id = ? AND done_at IS NULL AND (locked_at IS NULL OR locked_at < ?)',
      )
      .bind(id, staleBefore)
      .run();

    // No change means one of three things, and they are different answers: no such row,
    // a row that has already finished, or a row whose lease is still live. Only the
    // last one is worth telling the admin to come back for.
    if (!Number(update.meta?.changes ?? 0)) {
      const row = await db
        .prepare('SELECT done_at FROM records_queue WHERE id = ?')
        .bind(id)
        .first<{ done_at: number | null }>();
      if (!row || row.done_at != null) return json({ error: 'Queue row not found' }, 404);
      return json({ error: STILL_RUNNING }, 409);
    }

    return json({ data: { stats: await queueStats(db, { now }) } }, 200);
  } catch (error) {
    logError('records_queue_retry_failed', {
      endpoint: 'admin/records/queue/retry',
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to retry the queue row' }, 500);
  }
};
