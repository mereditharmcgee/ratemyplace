import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/runtime';
import { getDB } from '../../../lib/db';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';

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
    // Pass the same sessionToken used in autocomplete so Google bills
    // Autocomplete-as-You-Type + Details as a single $0.005 session instead
    // of charging Autocomplete per keystroke. Big cost reduction.
    const detailsUrl = sessionToken
      ? `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`
      : `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;

    // Use Places API (New) - Place Details
    const response = await fetch(
      detailsUrl, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,formattedAddress,addressComponents,location,displayName',
          'Referer': 'https://ratemyplace.org/',
        },
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error('Place Details API error:', data.error.status, data.error.message);
      return new Response(JSON.stringify({ error: 'Place details error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const components = data.addressComponents || [];

    // Extract address components from new API format
    const getComponent = (type: string): string => {
      const comp = components.find((c: any) => c.types.includes(type));
      return comp?.longText || '';
    };

    const getComponentShort = (type: string): string => {
      const comp = components.find((c: any) => c.types.includes(type));
      return comp?.shortText || '';
    };

    // Build street address
    const streetNumber = getComponent('street_number');
    const streetName = getComponent('route');
    const streetAddress = streetNumber ? `${streetNumber} ${streetName}` : streetName;

    const place = {
      placeId: data.id,
      formattedAddress: data.formattedAddress,
      streetAddress,
      neighborhood: getComponent('neighborhood') || getComponent('sublocality_level_1'),
      city: getComponent('locality') || getComponent('sublocality'),
      state: getComponentShort('administrative_area_level_1'),
      zipCode: getComponent('postal_code'),
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
    };

    return new Response(JSON.stringify({ place }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Place details error:', error);
    return new Response(JSON.stringify({ error: 'Failed to get place details' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
