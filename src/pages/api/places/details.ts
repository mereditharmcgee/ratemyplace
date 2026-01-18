import type { APIContext } from 'astro';

export async function GET(context: APIContext): Promise<Response> {
  const placeId = context.url.searchParams.get('placeId') || '';
  const sessionToken = context.url.searchParams.get('sessionToken') || '';

  if (!placeId) {
    return new Response(JSON.stringify({ error: 'placeId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const runtime = (context.locals as any).runtime;
  const apiKey = runtime?.env?.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'Maps API not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const params = new URLSearchParams({
      place_id: placeId,
      key: apiKey,
      fields: 'place_id,formatted_address,address_components,geometry,name',
    });

    if (sessionToken) {
      params.append('sessiontoken', sessionToken);
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    );

    const data = await response.json();

    if (data.status !== 'OK') {
      console.error('Place Details API error:', data.status, data.error_message);
      return new Response(JSON.stringify({ error: 'Place details error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = data.result;
    const components = result.address_components || [];

    // Extract address components
    const getComponent = (type: string): string => {
      const comp = components.find((c: any) => c.types.includes(type));
      return comp?.long_name || '';
    };

    const getComponentShort = (type: string): string => {
      const comp = components.find((c: any) => c.types.includes(type));
      return comp?.short_name || '';
    };

    // Build street address
    const streetNumber = getComponent('street_number');
    const streetName = getComponent('route');
    const streetAddress = streetNumber ? `${streetNumber} ${streetName}` : streetName;

    const place = {
      placeId: result.place_id,
      formattedAddress: result.formatted_address,
      streetAddress,
      neighborhood: getComponent('neighborhood') || getComponent('sublocality_level_1'),
      city: getComponent('locality') || getComponent('sublocality'),
      state: getComponentShort('administrative_area_level_1'),
      zipCode: getComponent('postal_code'),
      latitude: result.geometry?.location?.lat,
      longitude: result.geometry?.location?.lng,
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
