import { beforeEach, describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { POST } from '../../pages/api/buildings';

const suite = sqliteAvailable ? describe : describe.skip;

function createContext(db: TestD1Database, body: unknown, contentType: string | null = 'application/json'): APIContext {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  const request = new Request('https://ratemyplace.org/api/buildings', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { request, locals: { user: { id: 'user-1' }, runtime: { env: { DB: db } } } } as unknown as APIContext;
}

interface BuildingRow { id: string; slug: string; source: string; street_key: string | null; st_num_lo: number | null; st_num_hi: number | null; google_place_id: string | null; latitude: number | null; longitude: number | null }

async function rows(db: TestD1Database): Promise<BuildingRow[]> {
  const { results } = await db.prepare('SELECT id, slug, source, street_key, st_num_lo, st_num_hi, google_place_id, latitude, longitude FROM buildings ORDER BY id').all<BuildingRow>();
  return results;
}

suite('POST /api/buildings with seeded dedupe', () => {
  let db: TestD1Database;
  beforeEach(async () => {
    db = createRecordsTestDb();
    await db.prepare("INSERT INTO users (id, email) VALUES ('user-1', 'u@example.com')").run();
    await insertBuilding(db, { id: 'seed-1', address: '23-27 Lanark Rd', slug: '23-27-lanark-rd-boston', source: 'seed', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27, parcel_id: '1', latitude: null, longitude: null });
  });

  it('415 on a non-JSON body and 400 on a non-object body', async () => {
    expect((await POST(createContext(db, 'x', 'text/plain'))).status).toBe(415);
    expect((await POST(createContext(db, 'null'))).status).toBe(400);
  });

  it('a Google place inside a seeded range lands on the seeded row and stamps place id and coordinates', async () => {
    const res = await POST(createContext(db, { placeId: 'gp-1', streetAddress: '25 Lanark Rd', neighborhood: 'Brighton', city: 'Boston', state: 'MA', zipCode: '02135', latitude: 42.34, longitude: -71.15 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ building: { id: 'seed-1', slug: '23-27-lanark-rd-boston' }, created: false });
    const [seed] = await rows(db);
    expect(seed.google_place_id).toBe('gp-1');
    expect(seed.latitude).toBe(42.34);
    expect(seed.longitude).toBe(-71.15);
  });

  it('a manual entry with a comma-less city tail lands on the seeded row', async () => {
    const res = await POST(createContext(db, { streetAddress: '27 Lanark Road Boston', city: 'Boston', state: 'MA', zipCode: null }));
    expect(res.status).toBe(200);
    expect((await res.json()).building.id).toBe('seed-1');
    expect((await rows(db)).length).toBe(1);
  });

  it('a Boston address with no seeded match is created with its key columns', async () => {
    const res = await POST(createContext(db, { placeId: 'gp-2', streetAddress: '5 Oak St', city: 'Dorchester', state: 'MA', zipCode: '02122', latitude: 42.3, longitude: -71.06 }));
    expect(res.status).toBe(201);
    const created = (await rows(db)).find((r) => r.id !== 'seed-1');
    expect(created).toMatchObject({ source: 'user', street_key: 'OAK ST', st_num_lo: 5, st_num_hi: 5, slug: '5-oak-st-dorchester' });
  });

  it('a non-Boston address keeps the old behaviour and still gets key columns', async () => {
    const res = await POST(createContext(db, { streetAddress: '1 Elm St', city: 'New Haven', state: 'CT', zipCode: '06511' }));
    expect(res.status).toBe(201);
    const created = (await rows(db)).find((r) => r.id !== 'seed-1');
    expect(created).toMatchObject({ street_key: 'ELM ST', st_num_lo: 1, st_num_hi: 1 });
  });

  it('a second exact manual entry still dedupes by address and city', async () => {
    await POST(createContext(db, { streetAddress: '1 Elm St', city: 'New Haven', state: 'CT', zipCode: null }));
    const res = await POST(createContext(db, { streetAddress: '1 elm st', city: 'new haven', state: 'CT', zipCode: null }));
    expect(res.status).toBe(200);
    expect((await rows(db)).length).toBe(2);
  });

  it('a slug collision gets -2, -3', async () => {
    await insertBuilding(db, { id: 'taken', address: '9 Pine St', slug: '9-pine-st-cambridge', city: 'Cambridge' });
    const res = await POST(createContext(db, { streetAddress: '9 Pine St.', city: 'Cambridge', state: 'MA', zipCode: null }));
    expect(res.status).toBe(201);
    expect((await res.json()).building.slug).toBe('9-pine-st-cambridge-2');
  });
});
