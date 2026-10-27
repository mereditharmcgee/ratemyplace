import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/runtime';
import { getDB } from '../../../lib/db';
import { checkRateLimit, getClientIP } from '../../../lib/rateLimit';
import { logError } from '../../../lib/logger';
import {
  autocompleteRequestBody,
  autocompleteScopeFrom,
  bostonScopePredictions,
  parseAutocompleteSuggestions,
  PLACES_AUTOCOMPLETE_URL,
  type AutocompleteRequestBody,
  type GoogleAutocompleteResponse,
} from '../../../lib/places';
import { matchPredictionsToBuildings, type MatchedPrediction } from '../../../lib/homeSearchMatch';

// Two callers. The review form's AddressAutocomplete sends no scope and gets any US address,
// exactly as before. The homepage's HomeSearch sends `scope=boston`: Google is biased to
// Boston's box, each suggestion carries the building page it already has, if any
// (`existing`), results outside Massachusetts are dropped unless they are one of those
// buildings, and Boston comes first.
export async function GET(context: APIContext): Promise<Response> {
  const input = context.url.searchParams.get('input') || '';
  const sessionToken = context.url.searchParams.get('sessionToken') || '';
  const scope = autocompleteScopeFrom(context.url.searchParams.get('scope'));

  if (!input || input.length < 3) {
    return new Response(JSON.stringify({ predictions: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Rate limit — this proxies a paid Google API, so cap per-IP abuse (120/min).
  const db = getDB(context);
  const rateLimit = await checkRateLimit(db, getClientIP(context), 'places-autocomplete', 120, 60);
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
    const callGoogle = async (body: AutocompleteRequestBody): Promise<GoogleAutocompleteResponse> => {
      const response = await fetch(
        PLACES_AUTOCOMPLETE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'Referer': 'https://ratemyplace.org/',
          },
          body: JSON.stringify(body),
        }
      );
      return (await response.json()) as GoogleAutocompleteResponse;
    };

    let data = await callGoogle(autocompleteRequestBody(input, { sessionToken, scope }));

    // The Boston bias cannot be exercised on preview (no key there). If Google ever refuses
    // the request because of it, ask once more without it rather than leave the homepage with
    // no suggestions; the Massachusetts filter below still applies.
    if (data.error && scope === 'boston') {
      logError('places_autocomplete_bias_refused', {
        endpoint: '/api/places/autocomplete',
        status: data.error.status,
      });
      data = await callGoogle(autocompleteRequestBody(input, { sessionToken }));
    }

    if (data.error) {
      console.error('Places API error:', JSON.stringify(data.error));
      return new Response(JSON.stringify({ error: 'Places API error', predictions: [] }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const predictions = parseAutocompleteSuggestions(data);

    if (scope !== 'boston') {
      return new Response(JSON.stringify({ predictions }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Matched before the Massachusetts filter: a suggestion from another state stays when it
    // is a building we already have (by exact place id; see homeSearchMatch.ts), and is
    // dropped otherwise.
    let matched: MatchedPrediction[];
    try {
      matched = await matchPredictionsToBuildings(db, predictions);
    } catch (error) {
      // The suggestions still work without the match: the review handoff resolves the
      // building on click. With no match, nothing from outside Massachusetts is kept. Never
      // log the input, an address or a place id.
      logError('places_autocomplete_match_error', {
        endpoint: '/api/places/autocomplete',
        error: error instanceof Error ? error.name : 'unknown',
      });
      matched = predictions.map((p) => ({ ...p, existing: null }));
    }
    const scoped = bostonScopePredictions(matched, (p) => p.existing !== null);

    return new Response(JSON.stringify({ predictions: scoped }), {
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
