import type { APIContext } from 'astro';

export async function GET(context: APIContext): Promise<Response> {
  const input = context.url.searchParams.get('input') || '';
  const sessionToken = context.url.searchParams.get('sessionToken') || '';

  if (!input || input.length < 3) {
    return new Response(JSON.stringify({ predictions: [] }), {
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
    // Use Google Places Autocomplete API
    const params = new URLSearchParams({
      input,
      key: apiKey,
      types: 'address',
      components: 'country:us',
    });

    if (sessionToken) {
      params.append('sessiontoken', sessionToken);
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );

    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Places API error:', data.status, data.error_message);
      return new Response(JSON.stringify({ error: 'Places API error', predictions: [] }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Return simplified predictions
    const predictions = (data.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text || '',
      secondaryText: p.structured_formatting?.secondary_text || '',
    }));

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
