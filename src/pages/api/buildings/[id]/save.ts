import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';

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
