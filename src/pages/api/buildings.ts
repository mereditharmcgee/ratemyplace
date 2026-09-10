import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { generateIdFromEntropySize } from 'lucia';
import { checkRateLimit, buildRateLimitHeaders, getClientIP } from '../../lib/rateLimit';
import { escapeLikePattern, sanitizeText, isValidZipCode } from '../../lib/validation';
import { findBuildingByAddress } from '../../lib/records/dedupe';
import { addressKey } from '../../lib/records/identity';

export async function GET(context: APIContext): Promise<Response> {
  const query = (context.url.searchParams.get('q') || '').trim();
  const placeId = context.url.searchParams.get('placeId') || '';
  const db = getDB(context);

  // Rate limit: 120 lookups a minute per IP. This is the review form's address typeahead,
  // so it fires per keystroke and has to allow a real burst — but it is unauthenticated and
  // runs a double `LIKE '%…%'` over 38,000 seeded buildings, which is not something an
  // anonymous caller may do without a ceiling. Both branches are covered: the place-id
  // lookup is cheap, and one budget per IP is simpler to reason about than two.
  const rateLimit = await checkRateLimit(db, getClientIP(context), 'building-lookup', 120, 60);
  if (!rateLimit.allowed) {
    const status = rateLimit.error ? 503 : 429;
    const message = rateLimit.error
      ? 'Service temporarily unavailable. Please try again in a few minutes.'
      : 'Too many requests. Please try again later.';
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 120) }
    });
  }

  // Look up by Google Place ID
  if (placeId) {
    try {
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

  // A one-character `q` matches most of the city, so the LIKE scan does its full work to
  // return ten arbitrary rows nobody typed toward. Two characters is the shortest prefix
  // that means anything as an address fragment, and an empty answer here is the same shape
  // the caller already handles for "no matches".
  if (query.length < 2) {
    return new Response(JSON.stringify({ buildings: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const pattern = `%${escapeLikePattern(query)}%`;
    const result = await db.prepare(`
      SELECT id, address, neighborhood, city, state, slug
      FROM buildings
      WHERE address LIKE ? ESCAPE '\\' OR neighborhood LIKE ? ESCAPE '\\'
      ORDER BY address
      LIMIT 10
    `).bind(pattern, pattern).all();

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

  // Content-type guard — MUST come before request.json() (which throws SyntaxError on
  // non-JSON) and before the rate limit, so a wrong content type does not spend a slot.
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return new Response(JSON.stringify({ error: 'Unsupported Media Type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    // Rate limit: 20 building creations per hour per user (anti-abuse; legit
    // users create at most a handful when their address isn't already listed).
    const rateLimit = await checkRateLimit(db, context.locals.user.id, 'building-create', 20, 3600);
    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many requests. Please try again later.';
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 20) }
      });
    }

    const body = await context.request.json();

    // A JSON body of `null`, an array, or a primitive parses fine but has no fields to
    // destructure — `body.streetAddress` on `null` throws and falls through to the generic
    // 500 handler instead of the clean 400 a malformed request deserves.
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: 'Street address and city are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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
    if (!streetAddress || !city || typeof streetAddress !== 'string' || typeof city !== 'string') {
      return new Response(JSON.stringify({ error: 'Street address and city are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Type/length validation + sanitization. These fields are user-supplied on
    // manual entry and flow to the public map/search (where address/neighborhood
    // are rendered), so strip markup, cap lengths, and reject non-numeric
    // coordinates before anything reaches the DB.
    const cleanAddress = sanitizeText(streetAddress).slice(0, 500);
    const cleanCity = sanitizeText(city).slice(0, 120);
    const cleanNeighborhood = typeof neighborhood === 'string' && neighborhood.trim()
      ? sanitizeText(neighborhood).slice(0, 120)
      : null;
    const cleanState = typeof state === 'string' && state.trim()
      ? state.trim().slice(0, 2).toUpperCase()
      : null;
    const cleanZip = typeof zipCode === 'string' && isValidZipCode(zipCode.trim())
      ? zipCode.trim()
      : null;

    // sanitizeText can empty out an all-markup input (e.g. "<b></b>") that passed
    // the truthy check above — re-verify after cleaning.
    if (!cleanAddress || !cleanCity) {
      return new Response(JSON.stringify({ error: 'Street address and city are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Coordinates: accept only finite numbers within valid lat/lng ranges; a bad
    // coordinate becomes null (building simply won't appear on the map) rather
    // than poisoning map.ts for every visitor.
    const parseCoord = (raw: unknown, min: number, max: number): number | null => {
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= min && n <= max ? n : null;
    };
    const cleanLatitude = parseCoord(latitude, -90, 90);
    const cleanLongitude = parseCoord(longitude, -180, 180);

    const found = (building: { id: string; slug: string }): Response =>
      new Response(JSON.stringify({ building, created: false }), {
        headers: { 'Content-Type': 'application/json' }
      });

    // Google-sourced: the place id is exact.
    if (placeId) {
      const existing = await db.prepare(
        'SELECT id, slug FROM buildings WHERE google_place_id = ?'
      ).bind(placeId).first<{ id: string; slug: string }>();

      if (existing) return found(existing);
    }

    // Boston, any source: land on the seeded (or earlier user) page for this address so one
    // building never gets two pages. Writes the place id and coordinates the seeded row lacks.
    const seeded = await findBuildingByAddress(db, { address: cleanAddress, city: cleanCity, zip: cleanZip });
    if (seeded) {
      // Only stamp when there is something to stamp, and only onto a row still missing one of
      // the three. COALESCE never overwrites: the first place id wins, and a later different
      // place id lands on this same row through the address tier, so the outcome is
      // idempotent. The extra WHERE clause is about the clock rather than the columns —
      // `updated_at` feeds the sitemap's `lastmod`, so an abandoned form (or a repeat visit
      // to an already-stamped row) must not republish the page as freshly changed.
      const hasSomethingToStamp = Boolean(placeId) || cleanLatitude !== null || cleanLongitude !== null;
      if (hasSomethingToStamp) {
        await db.prepare(
          'UPDATE buildings SET google_place_id = COALESCE(google_place_id, ?), latitude = COALESCE(latitude, ?), ' +
          'longitude = COALESCE(longitude, ?), updated_at = unixepoch() WHERE id = ? ' +
          'AND (google_place_id IS NULL OR latitude IS NULL OR longitude IS NULL)'
        ).bind(placeId || null, cleanLatitude, cleanLongitude, seeded.id).run();
      }

      return found(seeded);
    }

    // Manual entry anywhere: exact (address, city), case-insensitive, as before.
    if (!placeId) {
      const existing = await db.prepare(
        'SELECT id, slug FROM buildings WHERE LOWER(address) = LOWER(?) AND LOWER(city) = LOWER(?) LIMIT 1'
      ).bind(cleanAddress, cleanCity).first<{ id: string; slug: string }>();

      if (existing) return found(existing);
    }

    // Already sanitized + length-capped above.
    const safeAddress = cleanAddress;

    // Generate slug from address plus city. `[^a-z0-9]+` is greedy, so each part can only
    // carry a single leading or trailing hyphen for the second replace to peel.
    const slugPart = (value: string): string =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const baseSlug = `${slugPart(safeAddress)}-${slugPart(cleanCity)}`;

    // Collision suffix counts up (`-2`, `-3`, …) rather than appending a timestamp: slugs
    // are the public URL, and "9-pine-st-cambridge-2" is a readable second building at that
    // address where "9-pine-st-cambridge-mtv0094i" is noise. Bounded by the number of rows
    // already holding the base slug.
    const nextFreeSlug = async (from: string): Promise<string> => {
      let candidate = from;
      // `from` is either the base slug (attempt 1) or a `-N` the race below just lost.
      let attempt = from === baseSlug ? 1 : Number(from.slice(baseSlug.length + 1)) || 1;
      while (await db.prepare('SELECT 1 FROM buildings WHERE slug = ?').bind(candidate).first()) {
        attempt += 1;
        candidate = `${baseSlug}-${attempt}`;
      }
      return candidate;
    };
    let slug = await nextFreeSlug(baseSlug);

    const buildingId = generateIdFromEntropySize(10);
    // Reviewer dedupe (and the seed's existing-row matching) look up on (city, street_key)
    // then range-contain, so every row this endpoint creates carries its own key columns.
    // Null when the address has no leading number or a degenerate street — the row is still
    // created, it just cannot be found by key.
    const key = addressKey(safeAddress);

    const insertWithSlug = (withSlug: string): Promise<unknown> => db.prepare(`
      INSERT INTO buildings (
        id, address, slug, neighborhood, city, state, zip_code,
        latitude, longitude, google_place_id, street_key, st_num_lo, st_num_hi
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      buildingId,
      safeAddress,
      withSlug,
      cleanNeighborhood,
      cleanCity,
      cleanState,
      cleanZip,
      cleanLatitude,
      cleanLongitude,
      placeId || null,
      key?.streetKey ?? null,
      key?.numLo ?? null,
      key?.numHi ?? null
    ).run();

    try {
      await insertWithSlug(slug);
    } catch (error) {
      // Counting suffixes is a read followed by a write, so two concurrent creates at the
      // same address can both settle on `-2` and the loser trips the UNIQUE index on
      // `slug`. Re-count from the slug we just lost and insert once more; a second failure
      // falls through to the generic 500 rather than spinning under contention.
      //
      // Only a slug collision is retryable, hence the check on the constraint name as well
      // as on UNIQUE. `slug` is not the only unique column: 0002 adds a partial unique index
      // over `google_place_id`, and re-counting the slug would do nothing for a place-id
      // collision — the same insert would fail the same way, so it falls straight to the 500.
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE/i.test(message) || !/slug/i.test(message)) throw error;
      slug = await nextFreeSlug(slug);
      await insertWithSlug(slug);
    }

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
