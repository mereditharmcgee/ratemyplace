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

    const landlords = await db.prepare(`
      SELECT
        l.id,
        l.name,
        l.slug,
        l.description,
        l.website,
        l.phone,
        l.email,
        l.created_at,
        COUNT(DISTINCT b.id) as building_count,
        COUNT(DISTINCT r.id) as review_count,
        AVG(r.overall_score) as avg_score
      FROM landlords l
      LEFT JOIN buildings b ON l.id = b.landlord_id
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      GROUP BY l.id
      ORDER BY l.name ASC
    `).all();

    return new Response(JSON.stringify({
      landlords: landlords.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching landlords:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch landlords' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
