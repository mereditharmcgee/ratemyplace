import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { recencyWeightedOverallSql, currentReviewYear } from '../../../../lib/scoring-sql';
import { generateIdFromEntropySize } from 'lucia';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

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

  // Pagination params
  const url = new URL(context.request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const requestedLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));

  try {
    const db = getDB(context);
    const currentYear = currentReviewYear();

    // Aggregate stats across the WHOLE dataset (not the paginated slice) so the
    // four stat cards stay accurate when the user has only loaded the first page.
    const statsRow = await db.prepare(`
      SELECT
        COUNT(DISTINCT l.id) as total_landlords,
        COUNT(DISTINCT b.id) as total_buildings,
        COUNT(DISTINCT r.id) as total_reviews,
        COUNT(DISTINCT CASE WHEN per_landlord.avg_score >= 4 THEN per_landlord.id END) as high_rated
      FROM landlords l
      LEFT JOIN buildings b ON l.id = b.landlord_id
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      LEFT JOIN (
        SELECT l2.id, ${recencyWeightedOverallSql('r2', currentYear)} as avg_score
        FROM landlords l2
        LEFT JOIN buildings b2 ON l2.id = b2.landlord_id
        LEFT JOIN reviews r2 ON b2.id = r2.building_id AND r2.status = 'approved'
        GROUP BY l2.id
      ) per_landlord ON per_landlord.id = l.id
    `).first<{ total_landlords: number; total_buildings: number; total_reviews: number; high_rated: number }>();

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
        ${recencyWeightedOverallSql('r', currentYear)} as avg_score
      FROM landlords l
      LEFT JOIN buildings b ON l.id = b.landlord_id
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      GROUP BY l.id
      ORDER BY l.name ASC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    return new Response(JSON.stringify({
      landlords: landlords.results,
      total: statsRow?.total_landlords ?? 0,
      offset,
      limit,
      stats: {
        total_landlords: statsRow?.total_landlords ?? 0,
        total_buildings: statsRow?.total_buildings ?? 0,
        total_reviews: statsRow?.total_reviews ?? 0,
        high_rated: statsRow?.high_rated ?? 0,
      }
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

    const db = getDB(context);
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
