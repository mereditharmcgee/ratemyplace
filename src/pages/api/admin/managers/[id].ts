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

  const managerId = context.params.id;
  if (!managerId) {
    return new Response(JSON.stringify({ error: 'Property manager ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const { name, company_name, description, website, phone, email } = body;

    const db = getDB((context.locals as any).runtime);

    // Check if property manager exists
    const manager = await db.prepare('SELECT id FROM property_managers WHERE id = ?').bind(managerId).first();
    if (!manager) {
      return new Response(JSON.stringify({ error: 'Property manager not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (company_name !== undefined) {
      updates.push('company_name = ?');
      values.push(company_name || null);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description || null);
    }
    if (website !== undefined) {
      updates.push('website = ?');
      values.push(website || null);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      values.push(phone || null);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email || null);
    }

    if (updates.length === 0) {
      return new Response(JSON.stringify({ error: 'No fields to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    updates.push('updated_at = unixepoch()');
    values.push(managerId);

    await db.prepare(`
      UPDATE property_managers
      SET ${updates.join(', ')}
      WHERE id = ?
    `).bind(...values).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating property manager:', error);
    return new Response(JSON.stringify({ error: 'Failed to update property manager' }), {
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

  const managerId = context.params.id;
  if (!managerId) {
    return new Response(JSON.stringify({ error: 'Property manager ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const manager = await db.prepare(`
      SELECT * FROM property_managers WHERE id = ?
    `).bind(managerId).first();

    if (!manager) {
      return new Response(JSON.stringify({ error: 'Property manager not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get buildings for this property manager
    const buildings = await db.prepare(`
      SELECT
        b.id,
        b.address,
        b.city,
        b.neighborhood,
        COUNT(r.id) as review_count,
        AVG(r.overall_score) as avg_score
      FROM buildings b
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      WHERE b.property_manager_id = ?
      GROUP BY b.id
      ORDER BY b.address ASC
    `).bind(managerId).all();

    return new Response(JSON.stringify({
      manager,
      buildings: buildings.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching property manager:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch property manager' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
