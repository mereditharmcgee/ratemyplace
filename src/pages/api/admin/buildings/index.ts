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

    const buildings = await db.prepare(`
      SELECT
        b.id,
        b.address,
        b.slug,
        b.neighborhood,
        b.city,
        b.state,
        b.zip_code,
        b.latitude,
        b.longitude,
        b.year_built,
        b.unit_count,
        b.building_type,
        b.landlord_id,
        l.name as landlord_name,
        b.property_manager_id,
        pm.name as property_manager_name,
        b.created_at,
        COUNT(r.id) as review_count,
        AVG(r.overall_score) as avg_score
      FROM buildings b
      LEFT JOIN landlords l ON b.landlord_id = l.id
      LEFT JOIN property_managers pm ON b.property_manager_id = pm.id
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `).all();

    return new Response(JSON.stringify({
      buildings: buildings.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching buildings:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch buildings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
