import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { recencyWeightedOverallSql, currentReviewYear } from '../../../../lib/scoring-sql';
import { generateIdFromEntropySize } from 'lucia';

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
    const db = getDB(context);
    const currentYear = currentReviewYear();

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
        ${recencyWeightedOverallSql('r', currentYear)} as avg_score
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

export async function POST(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const name = (body.name as string || '').trim();

    if (!name) {
      return new Response(JSON.stringify({ error: 'Name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB(context);
    const id = generateIdFromEntropySize(10);

    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existingSlug = await db.prepare('SELECT id FROM property_managers WHERE slug = ?').bind(slug).first();
    if (existingSlug) {
      slug = slug + '-' + Date.now().toString(36);
    }

    await db.prepare(`
      INSERT INTO property_managers (id, name, slug, company_name, description, website, phone, email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, name, slug,
      body.company_name || null,
      body.description || null,
      body.website || null,
      body.phone || null,
      body.email || null
    ).run();

    return new Response(JSON.stringify({
      manager: { id, name, slug, building_count: 0, review_count: 0, avg_score: null }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating property manager:', error);
    return new Response(JSON.stringify({ error: 'Failed to create property manager' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
