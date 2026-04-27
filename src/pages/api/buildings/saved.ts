import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import type { SavedBuildingsResponse } from '../../../lib/api-types';

export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    const { results } = await db.prepare(`
      SELECT
        sb.id,
        sb.created_at as saved_at,
        b.id as building_id,
        b.address as building_address,
        b.slug as building_slug,
        b.neighborhood,
        b.city,
        b.state,
        (SELECT COUNT(*) FROM reviews r WHERE r.building_id = b.id AND r.status = 'approved') as review_count,
        (SELECT ROUND(AVG(r.overall_score), 1) FROM reviews r WHERE r.building_id = b.id AND r.status = 'approved') as avg_overall
      FROM saved_buildings sb
      JOIN buildings b ON sb.building_id = b.id
      WHERE sb.user_id = ?
      ORDER BY sb.created_at DESC
    `).bind(context.locals.user.id).all();

    const response: SavedBuildingsResponse = {
      buildings: results as any
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Error fetching saved buildings:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
