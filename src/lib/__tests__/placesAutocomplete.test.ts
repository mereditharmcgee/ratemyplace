import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { GET as autocompleteGET } from '../../pages/api/places/autocomplete';
import { BOSTON_BOX } from '../bostonBox';
import { addressKey } from '../records/identity';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import {
  autocompleteRequestBody,
  autocompleteScopeFrom,
  bostonBiasRectangle,
  bostonScopePredictions,
  isBostonPrediction,
  isMassachusettsPrediction,
  parseAutocompleteSuggestions,
  predictionPlace,
  type AutocompletePrediction,
  type GoogleAutocompleteResponse,
} from '../places';

// Places Autocomplete behind GET /api/places/autocomplete. The review form calls it with no
// scope and must keep getting any US address; the homepage alone sends scope=boston.

function prediction(mainText: string, secondaryText: string, placeId = `gp-${mainText}-${secondaryText}`): AutocompletePrediction {
  return { placeId, description: `${mainText}, ${secondaryText}`, mainText, secondaryText };
}

function googleBody(predictions: AutocompletePrediction[]): GoogleAutocompleteResponse {
  return {
    suggestions: predictions.map((p) => ({
      placePrediction: {
        placeId: p.placeId,
        text: { text: p.description },
        structuredFormat: { mainText: { text: p.mainText }, secondaryText: { text: p.secondaryText } },
      },
    })),
  };
}

describe('autocompleteScopeFrom', () => {
  it('is boston only for the exact opt-in value', () => {
    expect(autocompleteScopeFrom('boston')).toBe('boston');
    expect(autocompleteScopeFrom(null)).toBe('default');
    expect(autocompleteScopeFrom('')).toBe('default');
    expect(autocompleteScopeFrom('Boston')).toBe('default');
    expect(autocompleteScopeFrom('ma')).toBe('default');
  });
});

describe('autocompleteRequestBody', () => {
  it('sends the review form exactly the body it has always sent', () => {
    expect(autocompleteRequestBody('12 Example Rd', { sessionToken: 'tok' })).toEqual({
      input: '12 Example Rd',
      includedPrimaryTypes: ['street_address', 'subpremise', 'premise'],
      includedRegionCodes: ['us'],
      sessionToken: 'tok',
    });
    expect(autocompleteRequestBody('12 Example Rd', { sessionToken: 'tok', scope: 'default' })).not.toHaveProperty('locationBias');
  });

  it('leaves out an empty session token', () => {
    expect(autocompleteRequestBody('12 Example Rd', { sessionToken: '' })).not.toHaveProperty('sessionToken');
  });

  it('biases the Boston scope to the Boston box, as a bias and not a restriction', () => {
    const body = autocompleteRequestBody('12 Example Rd', { sessionToken: 'tok', scope: 'boston' });
    expect(body.locationBias).toEqual({
      rectangle: {
        low: { latitude: BOSTON_BOX.minLat, longitude: BOSTON_BOX.minLon },
        high: { latitude: BOSTON_BOX.maxLat, longitude: BOSTON_BOX.maxLon },
      },
    });
    expect(body).not.toHaveProperty('locationRestriction');
    expect(body.includedRegionCodes).toEqual(['us']);
  });

  it('puts the south-west corner in low', () => {
    const { low, high } = bostonBiasRectangle();
    expect(low.latitude).toBeLessThan(high.latitude);
    expect(low.longitude).toBeLessThan(high.longitude);
  });
});

describe('parseAutocompleteSuggestions', () => {
  it('maps place predictions and skips query predictions', () => {
    const data: GoogleAutocompleteResponse = {
      suggestions: [
        googleBody([prediction('12 Example Road', 'Brighton, MA, USA', 'gp-1')]).suggestions![0],
        {},
      ],
    };
    expect(parseAutocompleteSuggestions(data)).toEqual([
      { placeId: 'gp-1', description: '12 Example Road, Brighton, MA, USA', mainText: '12 Example Road', secondaryText: 'Brighton, MA, USA' },
    ]);
  });

  it('reads missing text as empty strings and a missing body as no predictions', () => {
    expect(parseAutocompleteSuggestions({ suggestions: [{ placePrediction: { placeId: 'gp-2' } }] })).toEqual([
      { placeId: 'gp-2', description: '', mainText: '', secondaryText: '' },
    ]);
    expect(parseAutocompleteSuggestions({})).toEqual([]);
  });
});

describe('predictionPlace', () => {
  it('reads the locality, state and ZIP from the secondary text', () => {
    expect(predictionPlace(prediction('12 Example Road', 'Brighton, MA, USA'))).toEqual({ locality: 'Brighton', state: 'MA', zip: null });
    expect(predictionPlace(prediction('12 Example Road', 'Boston, MA 02135, USA'))).toEqual({ locality: 'Boston', state: 'MA', zip: '02135' });
    expect(predictionPlace(prediction('12 Example Road', 'Jamaica Plain, Boston, MA, USA'))).toEqual({
      locality: 'Jamaica Plain',
      state: 'MA',
      zip: null,
    });
    expect(predictionPlace(prediction('12 Example Road', 'Springfield, Massachusetts, USA')).state).toBe('MA');
    expect(predictionPlace(prediction('12 Example Road', 'Brighton, MI, USA')).state).toBe('MI');
  });

  it('falls back to the description when the secondary text is empty', () => {
    expect(
      predictionPlace({ secondaryText: '', description: '12 Example Road, Dorchester, MA, USA' }),
    ).toEqual({ locality: 'Dorchester', state: 'MA', zip: null });
  });

  it('finds no state when there is none to find', () => {
    expect(predictionPlace(prediction('12 Example Road', '')).state).toBeNull();
    expect(predictionPlace(prediction('12 Example Road', 'Somewhere, USA')).state).toBeNull();
  });
});

describe('the Massachusetts filter and Boston-first order', () => {
  const brightonMa = prediction('12 Example Road', 'Brighton, MA, USA');
  const brightonMi = prediction('12 Example Road', 'Brighton, MI, USA');
  const brightonIa = prediction('12 Example Road', 'Brighton, IA, USA');
  const otherTownMa = prediction('12 Example Road', 'Groveland, MA, USA');
  const newHampshire = prediction('12 Example Road', 'Stoddard, NH, USA');
  const southCarolina = prediction('12 Example Alley', 'Charleston, SC, USA');
  const boston = prediction('12 Example Road', 'Boston, MA, USA');
  const noState = prediction('12 Example Road', 'Brighton');

  it('keeps Massachusetts and nothing else', () => {
    expect(isMassachusettsPrediction(brightonMa)).toBe(true);
    expect(isMassachusettsPrediction(otherTownMa)).toBe(true);
    for (const p of [brightonMi, brightonIa, newHampshire, southCarolina, noState]) {
      expect(isMassachusettsPrediction(p)).toBe(false);
    }
  });

  it('reads a Boston neighborhood as Boston only inside Massachusetts', () => {
    expect(isBostonPrediction(brightonMa)).toBe(true);
    expect(isBostonPrediction(boston)).toBe(true);
    expect(isBostonPrediction(brightonMi)).toBe(false);
    expect(isBostonPrediction(otherTownMa)).toBe(false);
  });

  it('drops other states and puts Boston first, Google order otherwise', () => {
    const result = bostonScopePredictions([otherTownMa, newHampshire, brightonMi, brightonMa, southCarolina, boston, brightonIa, noState]);
    expect(result).toEqual([brightonMa, boston, otherTownMa]);
  });
});

const routeSuite = sqliteAvailable ? describe : describe.skip;

routeSuite('GET /api/places/autocomplete', () => {
  let db: TestD1Database;

  function ctx(query: string): APIContext {
    const url = `https://ratemyplace.org/api/places/autocomplete?${query}`;
    return {
      url: new URL(url),
      request: new Request(url, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }),
      locals: { runtime: { env: { DB: db, GOOGLE_PLACES_API_KEY: 'k' } } },
    } as unknown as APIContext;
  }

  const ours = prediction('12 Example Road', 'Brighton, MA, USA', 'gp-ours');
  const otherTown = prediction('12 Example Road', 'Groveland, MA, USA', 'gp-town');
  const otherState = prediction('12 Example Road', 'Brighton, MI, USA', 'gp-mi');

  function stubGoogle(predictions: AutocompletePrediction[]) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(googleBody(predictions)), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function sentBody(fetchMock: ReturnType<typeof stubGoogle>): Record<string, unknown> {
    return JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function seedOurs() {
    db = createRecordsTestDb();
    await insertBuilding(db, {
      id: 'seed-0000000001',
      address: '12 Example Road',
      slug: '12-example-road-boston',
      neighborhood: 'Brighton',
      city: 'Boston',
      zip_code: '02135',
      source: 'seed',
      street_key: addressKey('12 Example Road')!.streetKey,
      st_num_lo: 12,
      st_num_hi: 12,
    });
  }

  it('the default scope sends no bias and passes every state through, with no building match', async () => {
    await seedOurs();
    const fetchMock = stubGoogle([ours, otherTown, otherState]);
    const res = await autocompleteGET(ctx('input=12+Example&sessionToken=tok'));
    expect(res.status).toBe(200);
    expect(sentBody(fetchMock)).toEqual({
      input: '12 Example',
      includedPrimaryTypes: ['street_address', 'subpremise', 'premise'],
      includedRegionCodes: ['us'],
      sessionToken: 'tok',
    });
    expect((await res.json()).predictions).toEqual([ours, otherTown, otherState]);
  });

  it('the Boston scope biases, drops other states, and names the building we already have', async () => {
    await seedOurs();
    const fetchMock = stubGoogle([otherTown, otherState, ours]);
    const res = await autocompleteGET(ctx('input=12+Example&sessionToken=tok&scope=boston'));
    expect(res.status).toBe(200);
    expect(sentBody(fetchMock).locationBias).toEqual({ rectangle: bostonBiasRectangle() });
    const { predictions } = await res.json();
    expect(predictions).toEqual([
      {
        ...ours,
        existing: {
          slug: '12-example-road-boston',
          title: '12 Example Road',
          subtitle: 'Brighton, Boston, MA',
          reviewCount: 0,
          avgScore: null,
        },
      },
      { ...otherTown, existing: null },
    ]);
  });

  it('still answers with the suggestions when the building lookup fails', async () => {
    await seedOurs();
    stubGoogle([ours]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.includes('rate_limits')) return original(sql);
      throw new Error('D1 down');
    }) as typeof db.prepare);
    const res = await autocompleteGET(ctx('input=12+Example&scope=boston'));
    expect(res.status).toBe(200);
    expect((await res.json()).predictions).toEqual([{ ...ours, existing: null }]);
  });

  it('keeps the error envelope on a Google error body', async () => {
    db = createRecordsTestDb();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }), { status: 403 })));
    const res = await autocompleteGET(ctx('input=12+Example&scope=boston'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Places API error', predictions: [] });
  });

  it('answers short input with nothing and calls no one', async () => {
    db = createRecordsTestDb();
    const fetchMock = stubGoogle([ours]);
    const res = await autocompleteGET(ctx('input=12&scope=boston'));
    expect(await res.json()).toEqual({ predictions: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
