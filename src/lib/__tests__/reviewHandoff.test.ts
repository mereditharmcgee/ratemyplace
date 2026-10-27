import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import type { ParsedPlace } from '../places';
import {
  HANDOFF_COPY,
  loadReviewFormBuilding,
  resolveReviewHandoff,
  type HandoffDeps,
} from '../reviewHandoff';

// The homepage hands a Google place to /review/new?placeId=. Resolving it is read-only: it
// either names an existing building (the page then redirects to ?building=) or returns the
// parsed place for the address step to confirm, whose Continue POSTs as it always has.

const suite = sqliteAvailable ? describe : describe.skip;

function place(overrides: Partial<ParsedPlace> = {}): ParsedPlace {
  return {
    placeId: 'ChIJcrawford',
    formattedAddress: '86 Crawford St, Boston, MA 02121, USA',
    streetAddress: '86 Crawford Street',
    neighborhood: 'Dorchester',
    city: 'Boston',
    state: 'MA',
    zipCode: '02121',
    latitude: 42.31,
    longitude: -71.08,
    ...overrides,
  };
}

async function snapshot(db: TestD1Database) {
  return db
    .prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS maxUpdated, group_concat(google_place_id) AS placeIds FROM buildings')
    .first();
}

suite('resolveReviewHandoff', () => {
  let db: TestD1Database;
  let before: unknown;
  let fetchPlace: ReturnType<typeof vi.fn>;
  let allowPlacesLookup: ReturnType<typeof vi.fn>;

  function deps(overrides: Partial<HandoffDeps> = {}): HandoffDeps {
    return {
      db,
      fetchPlace: fetchPlace as unknown as HandoffDeps['fetchPlace'],
      allowPlacesLookup: allowPlacesLookup as unknown as HandoffDeps['allowPlacesLookup'],
      ...overrides,
    };
  }

  beforeEach(async () => {
    db = createRecordsTestDb();
    db.exec('ALTER TABLE buildings ADD COLUMN admin_notes TEXT');
    await insertBuilding(db, {
      id: 'seed-1202188000',
      address: '86-88 Crawford Street',
      slug: '86-88-crawford-street-boston',
      city: 'Boston',
      zip_code: '02121',
      source: 'seed',
      street_key: 'CRAWFORD ST',
      st_num_lo: 86,
      st_num_hi: 88,
    });
    await insertBuilding(db, {
      id: 'seed-wb',
      address: '100 W Broadway',
      slug: '100-w-broadway-boston',
      city: 'Boston',
      zip_code: '02127',
      source: 'seed',
      street_key: 'W BROADWAY',
      st_num_lo: 100,
      st_num_hi: 100,
    });
    await insertBuilding(db, { id: 'known', address: '45 Melnea Cass Blvd', slug: '45-melnea-cass-blvd-boston', zip_code: '02119', google_place_id: 'gp-known' });
    await db.prepare("UPDATE buildings SET updated_at = 1788983774, admin_notes = 'internal' WHERE id = 'seed-1202188000'").run();
    fetchPlace = vi.fn(async () => place());
    allowPlacesLookup = vi.fn(async () => true);
    before = await snapshot(db);
  });

  afterEach(async () => {
    // Whatever the outcome, the handoff never writes a building.
    expect(await snapshot(db)).toEqual(before);
    vi.restoreAllMocks();
  });

  it('refuses a malformed place id before touching anything', async () => {
    const prepare = vi.spyOn(db, 'prepare');
    expect(await resolveReviewHandoff(deps(), '../../x')).toEqual({ kind: 'error', message: HANDOFF_COPY.lookupFailed });
    expect(prepare).not.toHaveBeenCalled();
    expect(allowPlacesLookup).not.toHaveBeenCalled();
    expect(fetchPlace).not.toHaveBeenCalled();
  });

  it('a known place id is existing, without the limiter or Google', async () => {
    expect(await resolveReviewHandoff(deps(), 'gp-known')).toEqual({
      kind: 'existing',
      buildingId: 'known',
      matchedBy: 'place_id',
      partOf: false,
    });
    expect(allowPlacesLookup).not.toHaveBeenCalled();
    expect(fetchPlace).not.toHaveBeenCalled();
  });

  it('no API key is unavailable, and the limiter is not spent', async () => {
    expect(await resolveReviewHandoff(deps({ fetchPlace: null }), 'ChIJunknown')).toEqual({ kind: 'error', message: HANDOFF_COPY.unavailable });
    expect(allowPlacesLookup).not.toHaveBeenCalled();
  });

  it('a refused rate limit is unavailable and never calls Google', async () => {
    allowPlacesLookup.mockResolvedValueOnce(false);
    expect(await resolveReviewHandoff(deps(), 'ChIJunknown')).toEqual({ kind: 'error', message: HANDOFF_COPY.unavailable });
    expect(fetchPlace).not.toHaveBeenCalled();
  });

  it('a limiter that throws fails closed', async () => {
    allowPlacesLookup.mockRejectedValueOnce(new Error('d1 down'));
    expect(await resolveReviewHandoff(deps(), 'ChIJunknown')).toEqual({ kind: 'error', message: HANDOFF_COPY.unavailable });
    expect(fetchPlace).not.toHaveBeenCalled();
  });

  it('Google answering with an error is lookupFailed', async () => {
    fetchPlace.mockResolvedValueOnce(null);
    expect(await resolveReviewHandoff(deps(), 'ChIJunknown')).toEqual({ kind: 'error', message: HANDOFF_COPY.lookupFailed });
  });

  it('a Google call that throws is failed, and the log names neither the place nor the address', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchPlace.mockRejectedValueOnce(new Error('fetch failed: https://places.googleapis.com/v1/places/ChIJunknown'));
    expect(await resolveReviewHandoff(deps(), 'ChIJunknown')).toEqual({ kind: 'error', message: HANDOFF_COPY.failed });
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.flat().map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join('\n');
    expect(logged).not.toContain('ChIJunknown');
    expect(logged).not.toContain('86 Crawford');
    expect(logged).not.toContain('u-1');
  });

  it.each([[{ streetAddress: '' }], [{ city: '' }]])('an incomplete place %j is incomplete', async (overrides) => {
    fetchPlace.mockResolvedValueOnce(place(overrides));
    expect(await resolveReviewHandoff(deps(), 'ChIJunknown')).toEqual({ kind: 'error', message: HANDOFF_COPY.incomplete });
  });

  it('a number inside a seeded range is existing on the seed, part of a wider parcel', async () => {
    expect(await resolveReviewHandoff(deps(), 'ChIJcrawford')).toEqual({
      kind: 'existing',
      buildingId: 'seed-1202188000',
      matchedBy: 'address_key',
      partOf: true,
    });
  });

  it('a spelled-out directional on the same number is not "part of" anything', async () => {
    fetchPlace.mockResolvedValueOnce(place({ placeId: 'ChIJwb', streetAddress: '100 West Broadway', neighborhood: 'South Boston', zipCode: '02127' }));
    expect(await resolveReviewHandoff(deps(), 'ChIJwb')).toEqual({
      kind: 'existing',
      buildingId: 'seed-wb',
      matchedBy: 'address_key',
      partOf: false,
    });
  });

  it('a new address is confirm, with the parsed place for the address step', async () => {
    fetchPlace.mockResolvedValueOnce(place({ placeId: 'ChIJoak', streetAddress: '5 Oak St', neighborhood: 'Dorchester', zipCode: '02124' }));
    const result = await resolveReviewHandoff(deps(), 'ChIJoak');
    expect(result).toEqual({
      kind: 'confirm',
      place: {
        placeId: 'ChIJoak',
        streetAddress: '5 Oak St',
        neighborhood: 'Dorchester',
        city: 'Boston',
        state: 'MA',
        zipCode: '02124',
        latitude: 42.31,
        longitude: -71.08,
        existingBuilding: null,
      },
    });
  });
});

suite('loadReviewFormBuilding', () => {
  it('returns only the four columns the form renders', async () => {
    const db = createRecordsTestDb();
    db.exec('ALTER TABLE buildings ADD COLUMN admin_notes TEXT');
    await insertBuilding(db, { id: 'b1', address: '45 Melnea Cass Blvd', slug: 'b1', neighborhood: null });
    await db.prepare("UPDATE buildings SET admin_notes = 'internal', owner_name = 'someone' WHERE id = 'b1'").run();
    const building = await loadReviewFormBuilding(db, 'b1');
    expect(building).not.toBeNull();
    expect(Object.keys(building ?? {}).sort()).toEqual(['address', 'city', 'id', 'neighborhood']);
    expect(building).toEqual({ id: 'b1', address: '45 Melnea Cass Blvd', neighborhood: undefined, city: 'Boston' });
  });

  it('is null for an unknown id', async () => {
    expect(await loadReviewFormBuilding(createRecordsTestDb(), 'nope')).toBeNull();
  });
});
