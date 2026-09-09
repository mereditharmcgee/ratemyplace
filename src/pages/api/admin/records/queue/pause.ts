import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import { queueStats, setFillPaused } from '../../../../../lib/records/queue';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
 * above. The content-type guard below is the JSON-specific layer, and it must come
 * before `request.json()`, which throws a raw SyntaxError on non-JSON input.
 */
export const POST: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  const contentType = context.request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return json({ error: 'Expected application/json' }, 400);
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await context.request.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }

    // Strictly boolean: a missing or string `paused` would otherwise resume the fill
    // by accident, which is the expensive direction to get wrong.
    if (typeof body.paused !== 'boolean') {
      return validationError('paused', 'Send paused as true or false.');
    }

    const db = getDB(context);
    const now = Math.floor(Date.now() / 1000);

    await setFillPaused(db, body.paused, now);

    return json({ stats: await queueStats(db, { now }) }, 200);
  } catch (error) {
    logError('records_queue_pause_failed', {
      endpoint: 'admin/records/queue/pause',
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to update the fill pause switch' }, 500);
  }
};
