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

    const managers = await db.prepare(`
      SELECT
        pm.id,
        pm.name,
        pm.slug,
        pm.company_name,
        pm.description,
        pm.website,
        pm.phone,
        pm.email,
        pm.created_at,
        COUNT(DISTINCT b.id) as building_count,
        COUNT(DISTINCT r.id) as review_count,
        AVG(r.overall_score) as avg_score
      FROM property_managers pm
      LEFT JOIN buildings b ON pm.id = b.property_manager_id
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      GROUP BY pm.id
      ORDER BY pm.name ASC
    `).all();

    return new Response(JSON.stringify({
      managers: managers.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching property managers:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch property managers' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
