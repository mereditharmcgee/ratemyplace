import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { generateIdFromEntropySize } from 'lucia';

export async function GET(context: APIContext): Promise<Response> {
  const query = context.url.searchParams.get('q') || '';
  const placeId = context.url.searchParams.get('placeId') || '';

  // Look up by Google Place ID
  if (placeId) {
    try {
      const db = getDB(context);
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
    const db = getDB(context);

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

    // placeId is optional — manual address entries (fallback when Google
    // Places fails or the user's address isn't found) are accepted without one.
    if (!streetAddress || !city) {
      return new Response(JSON.stringify({ error: 'Street address and city are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB(context);

    // For Google-sourced submissions, dedupe by place ID
    if (placeId) {
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
    } else {
      // Manual entry: dedupe by exact (address, city) match — case-insensitive
      const existing = await db.prepare(
        'SELECT id, slug FROM buildings WHERE LOWER(address) = LOWER(?) AND LOWER(city) = LOWER(?) LIMIT 1'
      ).bind(streetAddress, city).first<{ id: string; slug: string }>();

      if (existing) {
        return new Response(JSON.stringify({
          building: existing,
          created: false
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Truncate address to prevent excessively long values
    const safeAddress = streetAddress.slice(0, 500);

    // Generate slug from address
    let slug = safeAddress
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + city.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Check for slug collision and append suffix if needed
    const existingSlug = await db.prepare(
      'SELECT id FROM buildings WHERE slug = ?'
    ).bind(slug).first();

    if (existingSlug) {
      slug = slug + '-' + Date.now().toString(36);
    }

    const buildingId = generateIdFromEntropySize(10);

    await db.prepare(`
      INSERT INTO buildings (
        id, address, slug, neighborhood, city, state, zip_code,
        latitude, longitude, google_place_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      buildingId,
      safeAddress,
      slug,
      neighborhood || null,
      city,
      state || null,
      zipCode || null,
      latitude || null,
      longitude || null,
      placeId || null
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
