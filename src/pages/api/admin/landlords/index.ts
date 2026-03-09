import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
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

    const db = getDB((context.locals as any).runtime);
    const id = generateIdFromEntropySize(10);

    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existingSlug = await db.prepare('SELECT id FROM landlords WHERE slug = ?').bind(slug).first();
    if (existingSlug) {
      slug = slug + '-' + Date.now().toString(36);
    }

    await db.prepare(`
      INSERT INTO landlords (id, name, slug, description, website, phone, email)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, name, slug,
      body.description || null,
      body.website || null,
      body.phone || null,
      body.email || null
    ).run();

    return new Response(JSON.stringify({
      landlord: { id, name, slug, building_count: 0, review_count: 0, avg_score: null }
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error creating landlord:', error);
    return new Response(JSON.stringify({ error: 'Failed to create landlord' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
