import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { generateIdFromEntropySize } from 'lucia';

export async function GET(context: APIContext): Promise<Response> {
  const query = context.url.searchParams.get('q') || '';
  const placeId = context.url.searchParams.get('placeId') || '';

  // Look up by Google Place ID
  if (placeId) {
    try {
      const db = getDB((context.locals as any).runtime);
      const building = await db.prepare(`
        SELECT id, address, neighborhood, city, state, slug, google_place_id
        FROM buildings
        WHERE google_place_id = ?
      `).bind(placeId).first();

      return new Response(JSON.stringify({ building: building || null }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Building lookup error:', error);
      return new Response(JSON.stringify({ error: 'Lookup failed', building: null }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (!query) {
    return new Response(JSON.stringify({ buildings: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const result = await db.prepare(`
      SELECT id, address, neighborhood, city, state, slug
      FROM buildings
      WHERE address LIKE ? OR neighborhood LIKE ?
      ORDER BY address
      LIMIT 10
    `).bind(`%${query}%`, `%${query}%`).all();

    return new Response(JSON.stringify({ buildings: result.results || [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Buildings search error:', error);
    return new Response(JSON.stringify({ error: 'Search failed', buildings: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Create a new building from Google Places data
export async function POST(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const {
      placeId,
      streetAddress,
      neighborhood,
      city,
      state,
      zipCode,
      latitude,
      longitude
    } = body;

    if (!placeId || !streetAddress || !city) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB((context.locals as any).runtime);

    // Check if building already exists with this place ID
    const existing = await db.prepare(
      'SELECT id, slug FROM buildings WHERE google_place_id = ?'
    ).bind(placeId).first<{ id: string; slug: string }>();

    if (existing) {
      return new Response(JSON.stringify({
        building: existing,
        created: false
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Generate slug from address
    const slug = streetAddress
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + city.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const buildingId = generateIdFromEntropySize(10);

    await db.prepare(`
      INSERT INTO buildings (
        id, address, slug, neighborhood, city, state, zip_code,
        latitude, longitude, google_place_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      buildingId,
      streetAddress,
      slug,
      neighborhood || null,
      city,
      state || 'MA',
      zipCode || null,
      latitude || null,
      longitude || null,
      placeId
    ).run();

    return new Response(JSON.stringify({
      building: { id: buildingId, slug },
      created: true
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Building creation error:', error);
    return new Response(JSON.stringify({ error: 'Failed to create building' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
