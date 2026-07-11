import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/runtime';
import { getDB } from '../../../lib/db';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';

export async function GET(context: APIContext): Promise<Response> {
  const input = context.url.searchParams.get('input') || '';
  const sessionToken = context.url.searchParams.get('sessionToken') || '';

  if (!input || input.length < 3) {
    return new Response(JSON.stringify({ predictions: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Rate limit — this proxies a paid Google API, so cap per-IP abuse (120/min).
  const rateLimit = await checkRateLimit(getDB(context), getClientIP(context), 'places-autocomplete', 120, 60);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.', predictions: [] }), {
      status: rateLimit.error ? 503 : 429,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = getEnv(context).GOOGLE_PLACES_API_KEY || getEnv(context).GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'Maps API not configured', predictions: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Use Places API (New) - Autocomplete
    const body: Record<string, any> = {
      input,
      includedPrimaryTypes: ['street_address', 'subpremise', 'premise'],
      includedRegionCodes: ['us'],
    };

    if (sessionToken) {
      body.sessionToken = sessionToken;
    }

    const response = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'Referer': 'https://ratemyplace.org/',
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error('Places API error:', JSON.stringify(data.error));
      return new Response(JSON.stringify({ error: 'Places API error', predictions: [] }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Map new API response to our expected format
    const predictions = (data.suggestions || [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => {
        const p = s.placePrediction;
        return {
          placeId: p.placeId,
          description: p.text?.text || '',
          mainText: p.structuredFormat?.mainText?.text || '',
          secondaryText: p.structuredFormat?.secondaryText?.text || '',
        };
      });

    return new Response(JSON.stringify({ predictions }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Places autocomplete error:', error);
    return new Response(JSON.stringify({ error: 'Search failed', predictions: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
