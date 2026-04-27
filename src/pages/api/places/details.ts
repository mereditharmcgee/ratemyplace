import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/runtime';

export async function GET(context: APIContext): Promise<Response> {
  const placeId = context.url.searchParams.get('placeId') || '';

  if (!placeId) {
    return new Response(JSON.stringify({ error: 'placeId required' }), {
      status: 400,
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
    // Use Places API (New) - Place Details
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}`, {
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
