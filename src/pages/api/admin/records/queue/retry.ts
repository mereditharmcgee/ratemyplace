import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import { queueStats } from '../../../../../lib/records/queue';

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
 * POST /api/admin/records/queue/retry  `{ id: number }`
 *
 * Un-parks one queue row: zero the attempts, drop the stale error and lock, and let
 * the next Worker run claim it again. Scoped to `done_at IS NULL` so a finished row
 * can never be reopened by id — a completed pull is history, not a work item.
 *
 * No audit entry: a retry is a non-destructive operational switch. It changes no
 * record anyone can read, and the pull it eventually causes writes its own
 * `record_pulls` rows with `trigger_reason`.
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

    const id = body.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      return validationError('id', 'Send the queue row id as a positive integer.');
    }

    const db = getDB(context);

    const update = await db
      .prepare('UPDATE records_queue SET attempts = 0, last_error = NULL, locked_at = NULL WHERE id = ? AND done_at IS NULL')
      .bind(id)
      .run();

    // Fail closed: a missing or zero change count means no pending row by that id.
    if (!Number(update.meta?.changes ?? 0)) {
      return json({ error: 'Queue row not found' }, 404);
    }

    return json({ stats: await queueStats(db, { now: Math.floor(Date.now() / 1000) }) }, 200);
  } catch (error) {
    logError('records_queue_retry_failed', {
      endpoint: 'admin/records/queue/retry',
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to retry the queue row' }, 500);
  }
};
