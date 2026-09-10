import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { logError } from '../../../../lib/logger';
import { buildRateLimitHeaders, checkRateLimit } from '../../../../lib/rateLimit';
import { errorMessage } from '../../../../lib/records/errors';
import { recordsRequestState } from '../../../../lib/records/coverage';
import { enqueue } from '../../../../lib/records/queue';

export async function POST(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { id: buildingId } = context.params;
  if (!buildingId) {
    return new Response(JSON.stringify({ error: 'Building ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    // Rate limit: 20 saves per hour per user, the same budget as `building-create`. A save
    // is not just a bookmark any more — the follower enqueue below is a priority-0 queue
    // row, and unlike the reader-facing button it asks for no Turnstile and counts against
    // no daily cap. So the save itself is the only thing that can bound that path, and it
    // has to. DELETE is left alone: unsaving enqueues nothing.
    const rateLimit = await checkRateLimit(db, context.locals.user.id, 'building-save', 20, 3600);
    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many requests. Please try again later.';
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 20) }
      });
    }

    // Check building exists
    const building = await db.prepare('SELECT id FROM buildings WHERE id = ?')
      .bind(buildingId)
      .first<{ id: string }>();

    if (!building) {
      return new Response(JSON.stringify({ error: 'Building not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Insert — ignore UNIQUE constraint violation (already saved is fine)
    try {
      await db.prepare(
        'INSERT INTO saved_buildings (user_id, building_id) VALUES (?, ?)'
      ).bind(context.locals.user.id, buildingId).run();
    } catch (err: any) {
      // UNIQUE constraint — already saved, return idempotent success
      if (err?.message?.includes('UNIQUE') || err?.cause?.message?.includes('UNIQUE')) {
        return new Response(JSON.stringify({ saved: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw err;
    }

    // A save is a follow: the building's records now matter to someone, so ask the Worker
    // for them — once, and only when the building is eligible, has no deeper records yet,
    // and nobody (button, follower, or the city-wide pass) has asked already. A pending
    // fill row is deliberately not promoted: a save bypasses the button's per-IP limit and
    // daily cap, so promotion would be an uncapped path to priority 0. Isolated so a queue
    // hiccup cannot turn a saved row into a 500.
    try {
      if ((await recordsRequestState(db, buildingId)) === 'never_pulled') {
        await enqueue(db, { buildingId, reason: 'follower', now: Math.floor(Date.now() / 1000) });
      }
    } catch (err) {
      logError('records_follower_enqueue_failed', { buildingId, error: errorMessage(err) });
    }

    return new Response(JSON.stringify({ saved: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Error saving building:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { id: buildingId } = context.params;
  if (!buildingId) {
    return new Response(JSON.stringify({ error: 'Building ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    await db.prepare(
      'DELETE FROM saved_buildings WHERE user_id = ? AND building_id = ?'
    ).bind(context.locals.user.id, buildingId).run();

    return new Response(JSON.stringify({ saved: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Error unsaving building:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
