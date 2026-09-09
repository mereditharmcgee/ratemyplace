import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import { queueStats, setFillPaused } from '../../../../../lib/records/queue';
import { json, readJsonBody } from './_json';

function validationError(field: string, message: string): Response {
  return json({ error: 'Validation failed', details: [{ field, message }] }, 400);
}

/**
 * POST /api/admin/records/queue/pause  `{ paused: boolean }`
 *
 * Flips the city-wide fill on or off (`app_settings.records_fill_paused`). Priority
 * rows — a reader pressing the button, a follower, a refresh — are never paused;
 * only the background fill is.
 *
 * No audit entry: pausing and unpausing are non-destructive operational switches,
 * not admin actions on someone's data. Nothing is written, deleted or published,
 * and the flag's own `updated_at` records when it last moved.
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
    // Strictly boolean: a missing or string `paused` would otherwise resume the fill
    // by accident, which is the expensive direction to get wrong.
    if (typeof parsed.body.paused !== 'boolean') {
      return validationError('paused', 'Send paused as true or false.');
    }

    const db = getDB(context);
    const now = Math.floor(Date.now() / 1000);

    await setFillPaused(db, parsed.body.paused, now);

    // The flag write and the stats read are two statements, not one transaction: if
    // `queueStats` throws after `setFillPaused` succeeded, the caller sees a 500 while
    // the flag HAS moved. That is the safe direction — the switch is idempotent and the
    // panel's next poll shows the real state — so this is left as is rather than papered
    // over with a rollback that could itself fail.
    return json({ data: { stats: await queueStats(db, { now }) } }, 200);
  } catch (error) {
    logError('records_queue_pause_failed', {
      endpoint: 'admin/records/queue/pause',
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to update the fill pause switch' }, 500);
  }
};
