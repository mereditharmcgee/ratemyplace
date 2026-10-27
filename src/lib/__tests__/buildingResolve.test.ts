import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import {
  findBuildingByPlaceId,
  findExistingBuilding,
  resolveInputFrom,
  type ResolveInput,
} from '../buildingResolve';

// The read-only half of `POST /api/buildings`: the three tiers it runs before it creates a
// row, in the route's order, shared with the /review/new?placeId= handoff so a GET can find
// the right building without ever writing one.

const suite = sqliteAvailable ? describe : describe.skip;

async function snapshot(db: TestD1Database) {
  return db
    .prepare(
      'SELECT COUNT(*) AS n, MAX(updated_at) AS maxUpdated, group_concat(google_place_id) AS placeIds, ' +
        '(SELECT COUNT(*) FROM rate_limits) AS limits FROM buildings',
    )
    .first();
}

function input(overrides: Partial<ResolveInput>): ResolveInput {
  return { placeId: null, address: '', city: 'Boston', zip: null, ...overrides };
}

suite('findExistingBuilding', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createRecordsTestDb();
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
    // insertBuilding has no updated_at column; pin it the way stampSeed does.
    await db.prepare('UPDATE buildings SET updated_at = 1788983774 WHERE id = ?').bind('seed-1202188000').run();
  });

  async function resolveWithoutWriting(value: ResolveInput) {
    const before = await snapshot(db);
    const hit = await findExistingBuilding(db, value);
    expect(await snapshot(db)).toEqual(before);
    return hit;
  }

  it('an exact place id wins, as place_id', async () => {
    await insertBuilding(db, { id: 'u-dup', address: '1 Other St', slug: '1-other-st-boston', google_place_id: 'gp-dup' });
    const hit = await resolveWithoutWriting(input({ placeId: 'gp-dup', address: '86 Crawford Street', zip: '02121' }));
    expect(hit).toEqual({ id: 'u-dup', slug: '1-other-st-boston', tier: 'place_id' });
  });

  it('a number inside a seeded range resolves to the seed, as address_key', async () => {
    const hit = await resolveWithoutWriting(input({ placeId: 'gp-new', address: '86 Crawford Street', zip: '02121' }));
    expect(hit).toEqual({ id: 'seed-1202188000', slug: '86-88-crawford-street-boston', tier: 'address_key' });
  });

  it('an exact (address, city) match counts only when there is no place id', async () => {
    await insertBuilding(db, { id: 'nh-elm', address: '1 Elm St', slug: '1-elm-st-new-haven', city: 'New Haven', state: 'CT', zip_code: '06511' });
    expect(await resolveWithoutWriting(input({ address: '1 elm st', city: 'new haven' }))).toEqual({
      id: 'nh-elm',
      slug: '1-elm-st-new-haven',
      tier: 'exact_address',
    });
    expect(await resolveWithoutWriting(input({ placeId: 'gp-elm', address: '1 Elm St', city: 'New Haven' }))).toBeNull();
  });

  it('an unparseable address and a non-Boston miss both resolve to nothing', async () => {
    expect(await resolveWithoutWriting(input({ placeId: 'gp-x', address: 'Crawford Street', zip: '02121' }))).toBeNull();
    expect(await resolveWithoutWriting(input({ placeId: 'gp-y', address: '5 Main St', city: 'Gilbert', zip: '85233' }))).toBeNull();
  });

  it('known gap: an odd assessor suffix misses the address tier', async () => {
    await insertBuilding(db, {
      id: 'seed-appian',
      address: '9-11 Appian Wy',
      slug: '9-11-appian-wy-boston',
      city: 'Boston',
      zip_code: '02134',
      source: 'seed',
      street_key: 'APPIAN WY',
      st_num_lo: 9,
      st_num_hi: 11,
    });
    const hit = await resolveWithoutWriting(input({ placeId: 'gp-app', address: '9 Appian Way', zip: '02134' }));
    // Pins the gap until fix/street-suffix-search adds WY. When that is on main, rebase
    // this branch and change the line below to
    //   expect(hit).toEqual({ id: 'seed-appian', slug: '9-11-appian-wy-boston', tier: 'address_key' });
    // A green CI run from before that rebase does not cover the merged tree.
    expect(hit).toBeNull();
  });
});

suite('findBuildingByPlaceId', () => {
  it('finds a row by its place id, and nothing otherwise', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1', slug: 'b1-slug', google_place_id: 'gp-1' });
    expect(await findBuildingByPlaceId(db, 'gp-1')).toEqual({ id: 'b1', slug: 'b1-slug' });
    expect(await findBuildingByPlaceId(db, 'gp-2')).toBeNull();
  });
});

describe('resolveInputFrom', () => {
  it('strips markup and keeps a valid zip and place id', () => {
    expect(resolveInputFrom({ placeId: 'ChIJabc', streetAddress: ' <b>86</b> Crawford Street ', city: 'Boston', zipCode: '02121' })).toEqual({
      placeId: 'ChIJabc',
      address: '86 Crawford Street',
      city: 'Boston',
      zip: '02121',
    });
  });

  it('drops an invalid zip and a non-string or malformed place id', () => {
    expect(resolveInputFrom({ placeId: 42, streetAddress: '1 A St', city: 'Boston', zipCode: 'abc' })).toEqual({
      placeId: null,
      address: '1 A St',
      city: 'Boston',
      zip: null,
    });
    expect(resolveInputFrom({ placeId: '../x', streetAddress: '1 A St', city: 'Boston' })?.placeId).toBeNull();
  });

  it('is null when the address or city is empty after cleaning', () => {
    expect(resolveInputFrom({ streetAddress: '<b></b>', city: 'Boston' })).toBeNull();
    expect(resolveInputFrom({ streetAddress: '1 A St', city: '  ' })).toBeNull();
  });
});
