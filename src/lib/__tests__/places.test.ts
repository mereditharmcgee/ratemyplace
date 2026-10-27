import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { GET as detailsGET } from '../../pages/api/places/details';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb } from './helpers/recordsDb';
import {
  fetchPlaceDetails,
  parsePlaceDetails,
  PLACE_DETAILS_FIELD_MASK,
  PLACE_ID_PATTERN,
  placeDetailsUrl,
  type GooglePlaceResponse,
} from '../places';

// The one Places (New) Details client, shared by /api/places/details and the
// /review/new?placeId= handoff, so both store the same neighborhood for the same place.

function component(type: string, longText: string, shortText = longText) {
  return { longText, shortText, types: [type] };
}

function bostonBody(overrides: Partial<GooglePlaceResponse> = {}): GooglePlaceResponse {
  return {
    id: 'ChIJ-returned',
    formattedAddress: '86 Crawford St, Boston, MA 02121, USA',
    addressComponents: [
      component('street_number', '86'),
      component('route', 'Crawford Street', 'Crawford St'),
      component('neighborhood', 'Aberdeen'),
      component('locality', 'Boston'),
      component('administrative_area_level_1', 'Massachusetts', 'MA'),
      component('postal_code', '02121'),
    ],
    location: { latitude: 42.31, longitude: -71.08 },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parsePlaceDetails', () => {
  it('turns a Boston sub-area into its neighborhood', () => {
    const place = parsePlaceDetails(bostonBody(), 'ChIJ-requested');
    expect(place).toEqual({
      placeId: 'ChIJ-returned',
      formattedAddress: '86 Crawford St, Boston, MA 02121, USA',
      streetAddress: '86 Crawford Street',
      neighborhood: 'Brighton',
      city: 'Boston',
      state: 'MA',
      zipCode: '02121',
      latitude: 42.31,
      longitude: -71.08,
    });
  });

  it('leaves a non-Boston "Aberdeen" alone', () => {
    const body = bostonBody({
      addressComponents: [
        component('street_number', '1'),
        component('route', 'Main Street'),
        component('neighborhood', 'Aberdeen'),
        component('locality', 'Cambridge'),
        component('administrative_area_level_1', 'Massachusetts', 'MA'),
      ],
    });
    expect(parsePlaceDetails(body, 'x')?.neighborhood).toBe('Aberdeen');
  });

  it('returns null for an error body', () => {
    expect(parsePlaceDetails({ error: { status: 'NOT_FOUND', message: 'nope' } }, 'x')).toBeNull();
  });

  it('gives empty strings, not null, when components are missing', () => {
    const place = parsePlaceDetails({ id: 'p' }, 'p');
    expect(place).toMatchObject({ streetAddress: '', neighborhood: '', city: '', state: '', zipCode: '', formattedAddress: '' });
  });

  it('falls back to the requested id when Google returns none', () => {
    expect(parsePlaceDetails(bostonBody({ id: undefined }), 'ChIJ-requested')?.placeId).toBe('ChIJ-requested');
  });
});

describe('placeDetailsUrl', () => {
  it('encodes the id and appends the session token', () => {
    expect(placeDetailsUrl('a/b c')).toBe('https://places.googleapis.com/v1/places/a%2Fb%20c');
    expect(placeDetailsUrl('abc', 's t')).toBe('https://places.googleapis.com/v1/places/abc?sessionToken=s%20t');
  });
});

describe('fetchPlaceDetails', () => {
  it('sends the key, the field mask and the Referer Google requires', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(bostonBody()), { status: 200 }));
    const place = await fetchPlaceDetails('ChIJabc', 'k', { sessionToken: 'tok', fetchImpl });
    expect(place?.streetAddress).toBe('86 Crawford Street');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJabc?sessionToken=tok');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 'k',
      'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
      Referer: 'https://ratemyplace.org/',
    });
  });

  it('returns null on an error body and logs neither the place id nor the address', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const placeId = 'ChIJNx18GtF744kR6W7CM_iVm58';
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: `Not a valid Place ID: ${placeId}` } }),
      { status: 400 },
    ));
    expect(await fetchPlaceDetails(placeId, 'k', { fetchImpl })).toBeNull();
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.flat().map(String).join('\n');
    expect(logged).toContain('places_details_error');
    expect(logged).toContain('INVALID_ARGUMENT');
    expect(logged).not.toContain(placeId);
    expect(logged).not.toContain('Crawford');
  });

  it('throws on a network failure, for the caller to handle', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchPlaceDetails('ChIJabc', 'k', { fetchImpl })).rejects.toThrow('offline');
  });
});

describe('PLACE_ID_PATTERN', () => {
  it.each([['ChIJNx18GtF744kR6W7CM_iVm58'], ['gp-1']])('accepts %s', (id) => {
    expect(PLACE_ID_PATTERN.test(id)).toBe(true);
  });

  it.each([['../x'], ['a b'], [''], ['a'.repeat(513)], ['ChIJ%2F']])('rejects %j', (id) => {
    expect(PLACE_ID_PATTERN.test(id)).toBe(false);
  });
});

const routeSuite = sqliteAvailable ? describe : describe.skip;

routeSuite('GET /api/places/details on the shared client', () => {
  function ctx(): APIContext {
    const url = 'https://ratemyplace.org/api/places/details?placeId=ChIJabc&sessionToken=tok';
    return {
      url: new URL(url),
      request: new Request(url, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
      locals: { runtime: { env: { DB: createRecordsTestDb(), GOOGLE_PLACES_API_KEY: 'k' } } },
    } as unknown as APIContext;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the { place } envelope and the Boston sub-area mapping', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(bostonBody()), { status: 200 })));
    const res = await detailsGET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.place).toMatchObject({ placeId: 'ChIJ-returned', streetAddress: '86 Crawford Street', neighborhood: 'Brighton' });
  });

  it('answers 500 "Place details error" on an error body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 })));
    const res = await detailsGET(ctx());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Place details error' });
  });

  it('answers 500 "Failed to get place details" when the call throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const res = await detailsGET(ctx());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to get place details' });
  });
});
