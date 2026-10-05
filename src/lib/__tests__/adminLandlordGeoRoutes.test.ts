import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { insertBuilding } from './helpers/recordsDb';
import { adminContext, createAdminTestDb, insertLandlord } from './helpers/adminDb';
import { GET as getLandlords, POST as postLandlord } from '../../pages/api/admin/landlords/index';
import { PATCH as patchLandlord } from '../../pages/api/admin/landlords/[id]';
import { GET as getReviews } from '../../pages/api/admin/reviews/index';

const suite = sqliteAvailable ? describe : describe.skip;
const BASE = 'https://ratemyplace.org/api/admin';

interface LandlordRow { id: string; cities: string[]; states: string[]; admin_notes: string | null }

async function landlords(db: TestD1Database): Promise<LandlordRow[]> {
  const res = await getLandlords(adminContext(db, `${BASE}/landlords?limit=500`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { landlords: LandlordRow[] }).landlords;
}

async function notesOf(db: TestD1Database, id: string): Promise<string | null> {
  return (await db.prepare('SELECT admin_notes FROM landlords WHERE id = ?').bind(id).first<{ admin_notes: string | null }>())?.admin_notes ?? null;
}

suite('admin landlord geography', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createAdminTestDb();
    await insertLandlord(db, 'll-aa', 'AA Management');
    await insertLandlord(db, 'll-empty', 'Empty Co');
    await insertBuilding(db, { id: 'b-1', address: '1 A St', city: 'Boston', state: 'MA' });
    await insertBuilding(db, { id: 'b-2', address: '2 A St', city: 'Boston, MA', state: 'ma' });
    await insertBuilding(db, { id: 'b-3', address: '3 A St', city: 'Allston', state: 'MA' });
    await insertBuilding(db, { id: 'b-4', address: '4 A St', city: 'Boston', state: 'MA' });
    await db.prepare("UPDATE buildings SET landlord_id = 'll-aa'").run();
  });

  it('GET /landlords returns distinct cities and upper-cased states as arrays', async () => {
    const rows = await landlords(db);
    const aa = rows.find((l) => l.id === 'll-aa');
    expect(aa?.cities.sort()).toEqual(['Allston', 'Boston', 'Boston, MA']);
    expect(aa?.states).toEqual(['MA']);
    const empty = rows.find((l) => l.id === 'll-empty');
    expect(empty).toMatchObject({ cities: [], states: [] });
  });

  it('GET /landlords returns admin_notes', async () => {
    await db.prepare("UPDATE landlords SET admin_notes = 'kept separate' WHERE id = 'll-aa'").run();
    expect((await landlords(db)).find((l) => l.id === 'll-aa')?.admin_notes).toBe('kept separate');
  });

  it('POST /landlords stores sanitized admin_notes', async () => {
    const res = await postLandlord(adminContext(db, `${BASE}/landlords`, {
      method: 'POST',
      body: { name: 'AA Management', admin_notes: '  Same name as landlord ll-aa (Boston, MA); <b>kept</b> separate 2026-10-05 ' },
    }));
    expect(res.status).toBe(201);
    const { landlord } = (await res.json()) as { landlord: { id: string } };
    expect(await notesOf(db, landlord.id)).toBe('Same name as landlord ll-aa (Boston, MA); kept separate 2026-10-05');
  });

  it('POST /landlords rejects admin_notes over 1000 characters', async () => {
    const res = await postLandlord(adminContext(db, `${BASE}/landlords`, { method: 'POST', body: { name: 'X', admin_notes: 'x'.repeat(1001) } }));
    expect(res.status).toBe(400);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM landlords WHERE name = 'X'").first<{ n: number }>())?.n).toBe(0);
  });

  it('PATCH /landlords/[id] sets, and clears, admin_notes', async () => {
    const ctx = (body: unknown) => adminContext(db, `${BASE}/landlords/ll-aa`, { method: 'PATCH', body, params: { id: 'll-aa' } });
    expect((await patchLandlord(ctx({ admin_notes: 'checked 2026-10-05' }))).status).toBe(200);
    expect(await notesOf(db, 'll-aa')).toBe('checked 2026-10-05');
    expect((await patchLandlord(ctx({ admin_notes: '' }))).status).toBe(200);
    expect(await notesOf(db, 'll-aa')).toBeNull();
    expect((await patchLandlord(ctx({ admin_notes: 'y'.repeat(1001) }))).status).toBe(400);
  });

  it('GET /reviews returns the building state', async () => {
    await db.prepare("INSERT INTO users (id, email) VALUES ('u-1', 'u@example.com')").run();
    await db.prepare("INSERT INTO reviews (id, user_id, building_id, status, landlord_name) VALUES ('r-1', 'u-1', 'b-3', 'pending', 'AA Management')").run();
    const res = await getReviews(adminContext(db, `${BASE}/reviews`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviews: Array<{ id: string; building_city: string; building_state: string }> };
    expect(body.reviews[0]).toMatchObject({ id: 'r-1', building_city: 'Allston', building_state: 'MA' });
  });
});
