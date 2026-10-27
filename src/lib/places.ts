// Google Places (New) Place Details: the one client, shared by `GET /api/places/details`
// (the review form's in-page search) and the `/review/new?placeId=` handoff, so both turn a
// place into the same street, city and neighborhood.
//
// Also the request and response shaping for Places Autocomplete, behind
// `GET /api/places/autocomplete`. Two islands call that endpoint: the review form's
// AddressAutocomplete (default scope, any US address, unchanged) and the homepage's
// HomeSearch, which alone opts in to the Boston scope with `scope=boston`.
//
// SERVER ONLY. It holds the API endpoint and the key header; never import it into a React
// island (AGENTS.md: islands import only leaf modules from src/lib).
import { BOSTON_BOX } from './bostonBox';
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

// ---------------------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------------------

export const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
export const AUTOCOMPLETE_PRIMARY_TYPES: readonly string[] = ['street_address', 'subpremise', 'premise'];

/**
 * `default` is any US address: the review form, where people still review buildings
 * outside Boston. `boston` is the homepage: biased to Boston's box, Massachusetts only,
 * Boston first. Only an explicit `scope=boston` selects it.
 */
export type AutocompleteScope = 'default' | 'boston';

export function autocompleteScopeFrom(value: string | null | undefined): AutocompleteScope {
  return value === 'boston' ? 'boston' : 'default';
}

interface LatLng {
  latitude: number;
  longitude: number;
}

export interface AutocompleteRequestBody {
  input: string;
  includedPrimaryTypes: string[];
  includedRegionCodes: string[];
  sessionToken?: string;
  locationBias?: { rectangle: { low: LatLng; high: LatLng } };
}

/** BOSTON_BOX in the Places (New) rectangle shape: `low` is the south-west corner. */
export function bostonBiasRectangle(): { low: LatLng; high: LatLng } {
  return {
    low: { latitude: BOSTON_BOX.minLat, longitude: BOSTON_BOX.minLon },
    high: { latitude: BOSTON_BOX.maxLat, longitude: BOSTON_BOX.maxLon },
  };
}

/**
 * The autocomplete request. The default scope is byte-for-byte the body the endpoint has
 * always sent. The Boston scope adds a location bias, not a restriction: a restriction
 * would also drop Massachusetts addresses outside the box, and only out-of-state results
 * are dropped (by `bostonScopePredictions`, after the response).
 */
export function autocompleteRequestBody(
  input: string,
  opts: { sessionToken?: string; scope?: AutocompleteScope } = {},
): AutocompleteRequestBody {
  const body: AutocompleteRequestBody = {
    input,
    includedPrimaryTypes: [...AUTOCOMPLETE_PRIMARY_TYPES],
    includedRegionCodes: ['us'],
  };
  if (opts.sessionToken) body.sessionToken = opts.sessionToken;
  if (opts.scope === 'boston') body.locationBias = { rectangle: bostonBiasRectangle() };
  return body;
}

interface GoogleText {
  text?: string;
}

export interface GoogleAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: GoogleText;
      structuredFormat?: { mainText?: GoogleText; secondaryText?: GoogleText };
    };
  }>;
  error?: { status?: string; message?: string };
}

export interface AutocompletePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

/** Google's suggestions in the shape both islands read. Query predictions are skipped. */
export function parseAutocompleteSuggestions(data: GoogleAutocompleteResponse): AutocompletePrediction[] {
  return (data.suggestions ?? [])
    .filter((s) => s.placePrediction)
    .map((s) => {
      const p = s.placePrediction ?? {};
      return {
        placeId: p.placeId ?? '',
        description: p.text?.text || '',
        mainText: p.structuredFormat?.mainText?.text || '',
        secondaryText: p.structuredFormat?.secondaryText?.text || '',
      };
    });
}

const STATE_SEGMENT = /^([A-Za-z]{2}|[A-Za-z][A-Za-z ]+?)(?:\s+(\d{5})(?:-\d{4})?)?$/;

export interface PredictionPlace {
  /** The first part of the secondary text: the city, or the Boston neighborhood Google names. */
  locality: string;
  /** Two-letter state code when one is present, upper-cased; 'MA' for "Massachusetts". */
  state: string | null;
  zip: string | null;
}

/**
 * Read city, state and ZIP from a prediction. The secondary text is "Brighton, MA, USA" or
 * "Boston, MA 02135, USA"; the description ("12 Example Rd, Brighton, MA, USA") is the
 * fallback when Google leaves the secondary text empty.
 */
export function predictionPlace(p: Pick<AutocompletePrediction, 'secondaryText' | 'description'>): PredictionPlace {
  let segments = p.secondaryText.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    // The description leads with the street part; the rest is the secondary text.
    segments = p.description.split(',').map((s) => s.trim()).filter(Boolean).slice(1);
  }
  const locality = segments[0] ?? '';
  let state: string | null = null;
  let zip: string | null = null;
  for (const segment of segments.slice(1)) {
    const m = STATE_SEGMENT.exec(segment);
    if (!m) continue;
    const name = m[1].trim().toUpperCase();
    if (name === 'USA' || name === 'US' || name === 'UNITED STATES') continue;
    state = name === 'MASSACHUSETTS' ? 'MA' : name.length === 2 ? name : state;
    if (m[2]) zip = m[2];
  }
  return { locality, state, zip };
}

export function isMassachusettsPrediction(p: AutocompletePrediction): boolean {
  return predictionPlace(p).state === 'MA';
}

/** Massachusetts and named by a Boston locality ("Boston", "Brighton", "Jamaica Plain"). */
export function isBostonPrediction(p: AutocompletePrediction): boolean {
  const place = predictionPlace(p);
  return place.state === 'MA' && isBostonLocality(place.locality);
}

/**
 * The homepage's Google rows: Massachusetts only, Boston first, Google's order otherwise.
 * A prediction whose state cannot be read is dropped too: the rule is "keep what is in
 * Massachusetts", not "drop what is visibly elsewhere".
 */
export function bostonScopePredictions<T extends AutocompletePrediction>(predictions: T[]): T[] {
  const inState = predictions.filter(isMassachusettsPrediction);
  return [...inState.filter(isBostonPrediction), ...inState.filter((p) => !isBostonPrediction(p))];
}
