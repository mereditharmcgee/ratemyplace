// Google Places (New) Place Details: the one client, shared by `GET /api/places/details`
// (the review form's in-page search) and the `/review/new?placeId=` handoff, so both turn a
// place into the same street, city and neighborhood.
//
// SERVER ONLY. It holds the API endpoint and the key header; never import it into a React
// island (AGENTS.md: islands import only leaf modules from src/lib).
import { isBostonLocality, resolveBostonSubArea } from './locality';
import { logError } from './logger';

/** Google place ids are URL-safe base64-ish tokens. Anything else is refused before a lookup. */
export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
export const PLACE_DETAILS_FIELD_MASK = 'id,formattedAddress,addressComponents,location,displayName';

const PLACE_DETAILS_BASE = 'https://places.googleapis.com/v1/places/';

export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

export interface GooglePlaceResponse {
  id?: string;
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
  error?: { status?: string; message?: string };
}

export interface ParsedPlace {
  placeId: string;
  formattedAddress: string;
  streetAddress: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  latitude?: number;
  longitude?: number;
}

export function placeDetailsUrl(placeId: string, sessionToken?: string): string {
  // The same session token as the autocomplete calls lets Google bill autocomplete plus
  // details as one session instead of per keystroke.
  const base = PLACE_DETAILS_BASE + encodeURIComponent(placeId);
  return sessionToken ? `${base}?sessionToken=${encodeURIComponent(sessionToken)}` : base;
}

/** Null exactly when Google answered with an error body. Missing components read as ''. */
export function parsePlaceDetails(data: GooglePlaceResponse, requestedPlaceId: string): ParsedPlace | null {
  if (data.error) return null;
  const components = data.addressComponents ?? [];
  const find = (type: string) => components.find((c) => Array.isArray(c.types) && c.types.includes(type));
  const getComponent = (type: string): string => find(type)?.longText || '';
  const getComponentShort = (type: string): string => find(type)?.shortText || '';

  const streetNumber = getComponent('street_number');
  const streetName = getComponent('route');
  const streetAddress = streetNumber ? `${streetNumber} ${streetName}` : streetName;

  // Google names small Boston sub-areas ("Aberdeen") where a reader expects the
  // neighborhood ("Brighton"); store the neighborhood. Boston only — the names repeat
  // elsewhere.
  const city = getComponent('locality') || getComponent('sublocality');
  const rawNeighborhood = getComponent('neighborhood') || getComponent('sublocality_level_1');
  const neighborhood = rawNeighborhood && isBostonLocality(city) ? resolveBostonSubArea(rawNeighborhood) : rawNeighborhood;

  return {
    placeId: data.id || requestedPlaceId,
    formattedAddress: data.formattedAddress || '',
    streetAddress,
    neighborhood,
    city,
    state: getComponentShort('administrative_area_level_1'),
    zipCode: getComponent('postal_code'),
    latitude: data.location?.latitude,
    longitude: data.location?.longitude,
  };
}

/**
 * Fetch and parse one place. Null when Google answers with an error body (logged with
 * Google's status and message only); throws on a network or JSON failure, for the caller
 * to report.
 *
 * Logging rule: never the place id, the address or a user id. A log line that names the
 * place a signed-in user is about to review ties that user to the building.
 */
export async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
  opts: { sessionToken?: string; fetchImpl?: typeof fetch } = {},
): Promise<ParsedPlace | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const response = await fetchImpl(placeDetailsUrl(placeId, opts.sessionToken), {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
      // Places API (New) with a referrer-restricted key rejects a server call without it.
      Referer: 'https://ratemyplace.org/',
    },
  });
  const data = (await response.json()) as GooglePlaceResponse;
  if (data.error) {
    // Google's message can echo the id back ("Not a valid Place ID: ChIJ…"); scrub it.
    const message = typeof data.error.message === 'string' ? data.error.message.split(placeId).join('<placeId>') : undefined;
    logError('places_details_error', { status: data.error.status, message });
    return null;
  }
  return parsePlaceDetails(data, placeId);
}
