import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';

export async function GET(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Require admin
  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const reviews = await db.prepare(`
      SELECT
        r.id,
        r.user_id,
        u.email as user_email,
        r.building_id,
        b.address as building_address,
        b.city as building_city,
        r.review_title,
        r.review_text,
        r.overall_score,
        r.status,
        r.is_verified,
        r.created_at,
        r.move_in_year,
        r.move_in_season,
        r.unit_type,
        r.rent_amount
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      JOIN buildings b ON r.building_id = b.id
      ORDER BY r.created_at DESC
    `).all();

    return new Response(JSON.stringify({
      reviews: reviews.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch reviews' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
