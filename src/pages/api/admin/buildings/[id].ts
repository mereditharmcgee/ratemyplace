import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';

export async function PATCH(context: APIContext): Promise<Response> {
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

  const buildingId = context.params.id;
  if (!buildingId) {
    return new Response(JSON.stringify({ error: 'Building ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const {
      address,
      neighborhood,
      city,
      state,
      zip_code,
      year_built,
      unit_count,
      building_type,
      landlord_id,
      property_manager_id,
    } = body;

    const db = getDB((context.locals as any).runtime);

    // Check if building exists
    const building = await db.prepare('SELECT id FROM buildings WHERE id = ?').bind(buildingId).first();
    if (!building) {
      return new Response(JSON.stringify({ error: 'Building not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (address !== undefined) {
      updates.push('address = ?');
      values.push(address);
    }
    if (neighborhood !== undefined) {
      updates.push('neighborhood = ?');
      values.push(neighborhood || null);
    }
    if (city !== undefined) {
      updates.push('city = ?');
      values.push(city || null);
    }
    if (state !== undefined) {
      updates.push('state = ?');
      values.push(state || null);
    }
    if (zip_code !== undefined) {
      updates.push('zip_code = ?');
      values.push(zip_code || null);
    }
    if (year_built !== undefined) {
      updates.push('year_built = ?');
      values.push(year_built || null);
    }
    if (unit_count !== undefined) {
      updates.push('unit_count = ?');
      values.push(unit_count || null);
    }
    if (building_type !== undefined) {
      updates.push('building_type = ?');
      values.push(building_type || null);
    }
    if (landlord_id !== undefined) {
      updates.push('landlord_id = ?');
      values.push(landlord_id || null);
    }
    if (property_manager_id !== undefined) {
      updates.push('property_manager_id = ?');
      values.push(property_manager_id || null);
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: 'No fields to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    updates.push('updated_at = unixepoch()');
    values.push(buildingId);

    await db.prepare(`
      UPDATE buildings
      SET ${updates.join(', ')}
      WHERE id = ?
    `).bind(...values).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating building:', error);
    return new Response(JSON.stringify({ error: 'Failed to update building' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

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

  const buildingId = context.params.id;
  if (!buildingId) {
    return new Response(JSON.stringify({ error: 'Building ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const building = await db.prepare(`
      SELECT
        b.*,
        l.name as landlord_name,
        pm.name as property_manager_name
      FROM buildings b
      LEFT JOIN landlords l ON b.landlord_id = l.id
      LEFT JOIN property_managers pm ON b.property_manager_id = pm.id
      WHERE b.id = ?
    `).bind(buildingId).first();

    if (!building) {
      return new Response(JSON.stringify({ error: 'Building not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get reviews for this building
    const reviews = await db.prepare(`
      SELECT
        r.id,
        r.review_title,
        r.status,
        r.overall_score,
        r.created_at,
        u.email as user_email
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.building_id = ?
      ORDER BY r.created_at DESC
    `).bind(buildingId).all();

    return new Response(JSON.stringify({
      building,
      reviews: reviews.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching building:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch building' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
