import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/runtime';
import { getDB } from '../../../lib/db';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';
import { fetchPlaceDetails } from '../../../lib/places';
import { logError } from '../../../lib/logger';

export async function GET(context: APIContext): Promise<Response> {
  const placeId = context.url.searchParams.get('placeId') || '';
  const sessionToken = context.url.searchParams.get('sessionToken') || '';

  if (!placeId) {
    return new Response(JSON.stringify({ error: 'placeId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Rate limit — this proxies a paid Google API, so cap per-IP abuse (60/min).
  const rateLimit = await checkRateLimit(getDB(context), getClientIP(context), 'places-details', 60, 60);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
      status: rateLimit.error ? 503 : 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = getEnv(context).GOOGLE_PLACES_API_KEY || getEnv(context).GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'Maps API not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // The client, the field mask, the Referer and the Boston sub-area mapping live in
    // lib/places.ts, shared with the /review/new?placeId= handoff.
    const place = await fetchPlaceDetails(placeId, apiKey, { sessionToken: sessionToken || undefined });
    if (!place) {
      return new Response(JSON.stringify({ error: 'Place details error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ place }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logError('places_details_failed', { error: error instanceof Error ? error.message : String(error) });
    return new Response(JSON.stringify({ error: 'Failed to get place details' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
