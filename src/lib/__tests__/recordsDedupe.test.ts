import { describe, expect, it } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { CITY_CANDIDATES, findBuildingByAddress } from '../records/dedupe';
import { BOSTON_NEIGHBORHOODS, isBostonLocality } from '../locality';
import { BOSTON_LOCALITY_NAMES } from '../bostonLocalities';
import { TRAILING_LOCALITIES } from '../records/identity';

const suite = sqliteAvailable ? describe : describe.skip;

suite('findBuildingByAddress', () => {
  it('matches a single number inside a seeded range, under any suffix spelling', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'seed-1', address: '23-27 Lanark Rd', slug: '23-27-lanark-rd-boston', source: 'seed', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27, parcel_id: '1' });
    const hit = await findBuildingByAddress(db, { address: '25 Lanark Road', city: 'Boston', zip: null });
    expect(hit).toEqual({ id: 'seed-1', slug: '23-27-lanark-rd-boston' });
  });

  it('respects street-side parity', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'odd', address: '61-69 Chiswick Rd', source: 'seed', street_key: 'CHISWICK RD', st_num_lo: 61, st_num_hi: 69 });
    expect(await findBuildingByAddress(db, { address: '66 Chiswick Rd', city: 'Boston', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: '65 Chiswick Rd', city: 'Boston', zip: null })).toEqual({ id: 'odd', slug: 'odd' });
  });

  it('breaks a two-building tie with the ZIP and refuses to guess without one', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'g1', address: '15 Gordon St', zip_code: '02134', source: 'seed', street_key: 'GORDON ST', st_num_lo: 15, st_num_hi: 15 });
    await insertBuilding(db, { id: 'g2', address: '15 Gordon St', slug: 'g2-slug', zip_code: '02135', source: 'seed', street_key: 'GORDON ST', st_num_lo: 15, st_num_hi: 15 });
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: '02135' })).toEqual({ id: 'g2', slug: 'g2-slug' });
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: '02136' })).toBeNull();
  });

  it('rejects a lone candidate whose ZIP disagrees, and accepts it when a ZIP is absent on either side', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'g1', address: '15 Gordon St', slug: 'g1-slug', zip_code: '02134', source: 'seed', street_key: 'GORDON ST', st_num_lo: 15, st_num_hi: 15 });
    // A different ZIP on a single candidate means a different neighborhood's Gordon St, so
    // the caller creates its own row rather than merging onto this one.
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: '02135' })).toBeNull();
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: '02134' })).toEqual({ id: 'g1', slug: 'g1-slug' });
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: null })).toEqual({ id: 'g1', slug: 'g1-slug' });
  });

  it('ignores a user-entered candidate whose number span is implausibly wide', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'wide', address: '2-9998 Washington St', slug: 'wide-slug', source: 'user', street_key: 'WASHINGTON ST', st_num_lo: 2, st_num_hi: 9998 });
    await insertBuilding(db, { id: 'real', address: '100 Washington St', slug: 'real-slug', source: 'seed', street_key: 'WASHINGTON ST', st_num_lo: 100, st_num_hi: 100 });
    expect(await findBuildingByAddress(db, { address: '100 Washington St', city: 'Boston', zip: null })).toEqual({ id: 'real', slug: 'real-slug' });
  });

  it('keeps a seeded parcel whose span is wider than the user-row bound', async () => {
    // The widest real parcel in the seed: 628 numbers of subsidized housing on one parcel.
    // Bounding it would strand every reviewer who lives there on a duplicate page.
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'georgetowne', address: '10-638 Georgetowne Dr', slug: '10-638-georgetowne-dr-boston', source: 'seed', street_key: 'GEORGETOWNE DR', st_num_lo: 10, st_num_hi: 638 });
    expect(await findBuildingByAddress(db, { address: '300 Georgetowne Dr', city: 'Boston', zip: null })).toEqual({ id: 'georgetowne', slug: '10-638-georgetowne-dr-boston' });
  });

  it('prefers a user row over a seeded twin on the same range and ZIP, even without a ZIP in the input', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'seed-x', address: '10 Elm St', source: 'seed', street_key: 'ELM ST', st_num_lo: 10, st_num_hi: 10 });
    await insertBuilding(db, { id: 'user-x', address: '10 Elm St', slug: 'user-x', source: 'user', street_key: 'ELM ST', st_num_lo: 10, st_num_hi: 10 });
    expect((await findBuildingByAddress(db, { address: '10 Elm Street', city: 'Boston', zip: null }))?.id).toBe('user-x');
  });

  it('prefers the more specific parcel among same-source candidates', async () => {
    // A wide mixed-parity parcel and a single-number parcel both contain 100 and agree on
    // the ZIP, so neither the source nor the ZIP separates them. The narrower parcel is the
    // better page: it is about that address, not about the 198 numbers around it.
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'wide', address: '2-200 Main St', slug: 'wide-slug', zip_code: '02135', source: 'seed', street_key: 'MAIN ST', st_num_lo: 2, st_num_hi: 200 });
    await insertBuilding(db, { id: 'exact', address: '100 Main St', slug: 'exact-slug', zip_code: '02135', source: 'seed', street_key: 'MAIN ST', st_num_lo: 100, st_num_hi: 100 });
    expect(await findBuildingByAddress(db, { address: '100 Main St', city: 'Boston', zip: '02135' })).toEqual({ id: 'exact', slug: 'exact-slug' });
  });

  it('keys a comma-less city tail and a neighborhood city', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'c', address: '1027 Commonwealth Av', source: 'seed', street_key: 'COMMONWEALTH AV', st_num_lo: 1027, st_num_hi: 1027 });
    expect((await findBuildingByAddress(db, { address: '1027 Commonwealth Ave Boston', city: 'Allston', zip: null }))?.id).toBe('c');
  });

  it('sees a building stored under a Boston neighborhood as its city', async () => {
    // The seed writes city 'Boston'; `POST /api/buildings` stores what Google Places hands
    // back, which for this street is 'Dorchester'. The old `city = 'Boston'` predicate made
    // the user row invisible and the route created a duplicate page for it.
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'seed-oak', address: '1 Oak St', slug: 'seed-oak', source: 'seed', city: 'Boston', street_key: 'OAK ST', st_num_lo: 1, st_num_hi: 1 });
    await insertBuilding(db, { id: 'user-oak', address: '5 Oak St', slug: 'user-oak', source: 'user', city: 'Dorchester', street_key: 'OAK ST', st_num_lo: 5, st_num_hi: 5 });
    expect(await findBuildingByAddress(db, { address: '5 Oak St', city: 'Boston', zip: null })).toEqual({
      id: 'user-oak',
      slug: 'user-oak',
    });
  });

  it('finds a row stored under a lowercase city too', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'lower', address: '5 Elm St', slug: 'lower', source: 'user', city: 'boston', street_key: 'ELM ST', st_num_lo: 5, st_num_hi: 5 });
    expect((await findBuildingByAddress(db, { address: '5 Elm St', city: 'Boston', zip: null }))?.id).toBe('lower');
  });

  /**
   * The city predicate is an `IN` over 28 spellings rather than a `LOWER(city)` precisely so
   * it stays index-seekable: `idx_buildings_street` is `(city, street_key)`, and an `IN` on
   * the leading column is a series of seeks where a function call on it would scan all 38k
   * seeded rows. Asserted against the statement the module actually prepares.
   */
  it('seeks idx_buildings_street rather than scanning buildings', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'plan', address: '5 Oak St', slug: 'plan', source: 'seed', street_key: 'OAK ST', st_num_lo: 5, st_num_hi: 5 });

    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const capturing = {
      prepare(sql: string) {
        const inner = db.prepare(sql);
        const self = {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            inner.bind(...(values as never[]));
            return self;
          },
          first: <T>() => inner.first<T>(),
          all: <T>() => inner.all<T>(),
          run: () => inner.run(),
        };
        return self;
      },
    } as unknown as Parameters<typeof findBuildingByAddress>[0];

    await findBuildingByAddress(capturing, { address: '5 Oak St', city: 'Boston', zip: null });
    const call = calls.find((c) => c.sql.includes('FROM buildings'));
    expect(call).toBeDefined();
    // The whole locality vocabulary is bound, not interpolated.
    expect(call?.values.slice(0, CITY_CANDIDATES.length)).toEqual([...CITY_CANDIDATES]);

    const rows = await db
      .prepare(`EXPLAIN QUERY PLAN ${call?.sql}`)
      .bind(...((call?.values ?? []) as never[]))
      .all<{ detail: string }>();
    const plan = rows.results.map((row) => row.detail).join('\n');
    expect(plan).toContain('idx_buildings_street');
    expect(plan).not.toContain('SCAN buildings');
  });

  it('returns null outside Boston, for an unparseable address, or with no candidate', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'c', address: '1 Lanark Rd', source: 'seed', street_key: 'LANARK RD', st_num_lo: 1, st_num_hi: 1 });
    expect(await findBuildingByAddress(db, { address: '1 Lanark Rd', city: 'New Haven', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: 'Lanark Rd', city: 'Boston', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: '3 Lanark Rd', city: 'Boston', zip: null })).toBeNull();
  });
});

describe('isBostonLocality', () => {
  it('accepts Boston and its neighborhoods in any case, rejects other cities', () => {
    for (const city of ['Boston', 'boston', 'BOSTON ', 'Allston', 'Jamaica Plain', 'Hyde Park', 'Dorchester', 'Boston, MA']) expect(isBostonLocality(city)).toBe(true);
    for (const city of ['New Haven', 'Cambridge', 'Westville', '', null]) expect(isBostonLocality(city)).toBe(false);
  });

  /**
   * One Boston vocabulary in two spellings: `identity.ts` keeps it uppercase and
   * space-preserving to strip a trailing locality off a street, `locality.ts` keeps it
   * lowercase and squashed to recognise a city field. Both are now derived from
   * `bostonLocalities.ts`, so this can no longer fail by drift — it stands as the guard that
   * the derivations stay derivations, and pins the sizes so a name deleted from the source
   * list is not silently lost. 'boston' is in the identity set and not the neighborhood one,
   * because a neighborhood list that contained the city would be a different thing.
   */
  it('derives both Boston lookup sets from the one vocabulary', () => {
    const squashed = new Set([...TRAILING_LOCALITIES].map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')));
    expect(squashed).toEqual(new Set([...BOSTON_NEIGHBORHOODS, 'boston']));
    expect(BOSTON_LOCALITY_NAMES).toHaveLength(26);
    expect(TRAILING_LOCALITIES.size).toBe(26);
    expect(BOSTON_NEIGHBORHOODS.size).toBe(25);
    expect(TRAILING_LOCALITIES.has('HYDE PARK')).toBe(true);
    expect(BOSTON_NEIGHBORHOODS.has('hydepark')).toBe(true);
    expect(BOSTON_NEIGHBORHOODS.has('boston')).toBe(false);
  });
});
