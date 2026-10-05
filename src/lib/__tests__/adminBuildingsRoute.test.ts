import { beforeEach, describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { insertBuilding } from './helpers/recordsDb';
import { adminContext, createAdminTestDb, insertLandlord, insertReview, insertSave } from './helpers/adminDb';
import { GET } from '../../pages/api/admin/buildings/index';
import { orphanBuildingsWhere } from '../admin/orphanBuildings';

const suite = sqliteAvailable ? describe : describe.skip;

interface ListBody {
  buildings: Array<{ id: string; admin_notes: string | null; owner_name: string | null; owner_entity: string | null; owner_website: string | null }>;
  total: number;
  stats: { total_buildings: number };
  filter?: { landlord: { id: string; name: string } | null };
}

async function list(db: TestD1Database, query: string): Promise<ListBody> {
  const res = await GET(adminContext(db, `https://ratemyplace.org/api/admin/buildings${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
}

const ids = (body: ListBody) => body.buildings.map((b) => b.id).sort();

describe('orphanBuildingsWhere', () => {
  it('binds the locality list instead of interpolating it', () => {
    const { sql, binds } = orphanBuildingsWhere();
    expect(binds).toContain('boston');
    expect(binds).toContain('hyde park');
    expect(binds).toContain('new haven');
    expect(new Set(binds).size).toBe(binds.length);
    expect(sql.match(/\?/g)?.length).toBe(binds.length);
    expect(sql).not.toMatch(/'boston'|'new haven'/i);
  });
});

suite('GET /api/admin/buildings filters', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createAdminTestDb();
    await insertLandlord(db, 'll-aa', 'AA Management');
    await insertLandlord(db, 'll-other', 'Other Co');
    await insertBuilding(db, { id: 'b-aa-1', address: '12 Lanark Rd', city: 'Boston' });
    await insertBuilding(db, { id: 'b-aa-2', address: '333 Humphrey St', city: 'New Haven', state: 'CT', zip_code: '06511' });
    await insertBuilding(db, { id: 'b-other', address: '9 Oak St', city: 'Boston' });
    await db.prepare("UPDATE buildings SET landlord_id = 'll-aa' WHERE id IN ('b-aa-1', 'b-aa-2')").run();
    await db.prepare("UPDATE buildings SET landlord_id = 'll-other' WHERE id = 'b-other'").run();
  });

  it('rejects a non-admin', async () => {
    const res = await GET(adminContext(db, 'https://ratemyplace.org/api/admin/buildings', { isAdmin: false }));
    expect(res.status).toBe(403);
  });

  it('landlord filter returns only that landlord rows, the filtered total, and the landlord name', async () => {
    const body = await list(db, '?landlord=ll-aa');
    expect(ids(body)).toEqual(['b-aa-1', 'b-aa-2']);
    expect(body.total).toBe(2);
    expect(body.stats.total_buildings).toBe(3);
    expect(body.filter).toEqual({ landlord: { id: 'll-aa', name: 'AA Management' } });
  });

  it('an unknown landlord id yields no rows and a null landlord filter', async () => {
    const body = await list(db, '?landlord=nope');
    expect(body.buildings).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.filter).toEqual({ landlord: null });
  });

  it('omits the filter key when no landlord is asked for', async () => {
    const body = await list(db, '');
    expect(body.filter).toBeUndefined();
    expect(body.total).toBe(3);
  });

  it('q matches an address substring, a city, or a ZIP', async () => {
    expect(ids(await list(db, '?q=humphrey'))).toEqual(['b-aa-2']);
    expect(ids(await list(db, '?q=new%20haven'))).toEqual(['b-aa-2']);
    expect(ids(await list(db, '?q=06511'))).toEqual(['b-aa-2']);
    expect((await list(db, '?q=lanark')).total).toBe(1);
  });

  it('q treats % and _ literally', async () => {
    await insertBuilding(db, { id: 'b-pct', address: '100% Real Ave', city: 'Boston' });
    expect(ids(await list(db, '?q=100%25'))).toEqual(['b-pct']);
    // An unescaped % would match every row.
    expect((await list(db, '?q=%25')).total).toBe(1);
    expect((await list(db, '?q=_')).total).toBe(0);
  });

  it('q is trimmed, and a blank q is no filter', async () => {
    expect(ids(await list(db, '?q=%20%20humphrey%20'))).toEqual(['b-aa-2']);
    expect((await list(db, '?q=%20%20')).total).toBe(3);
  });

  it('landlord and q combine', async () => {
    expect(ids(await list(db, '?landlord=ll-aa&q=lanark'))).toEqual(['b-aa-1']);
    expect(ids(await list(db, '?landlord=ll-other&q=lanark'))).toEqual([]);
  });

  it('the row SELECT carries admin notes and owner fields so an edit can round-trip them', async () => {
    await db
      .prepare("UPDATE buildings SET admin_notes = 'keep me', owner_name = 'Jane Owner', owner_entity = 'llc', owner_website = 'https://owner.example' WHERE id = 'b-other'")
      .run();
    const body = await list(db, '?landlord=ll-other');
    expect(body.buildings[0]).toMatchObject({
      admin_notes: 'keep me',
      owner_name: 'Jane Owner',
      owner_entity: 'llc',
      owner_website: 'https://owner.example',
    });
  });
});

suite('GET /api/admin/buildings?filter=orphans', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createAdminTestDb();
    await insertBuilding(db, { id: 'seed-1', address: '1 Seed St', city: 'Chicago', state: 'IL', source: 'seed' });
    await insertBuilding(db, { id: 'reviewed', address: '2 Review St', city: 'Chicago', state: 'IL' });
    await insertReview(db, 'r-1', 'reviewed', 'rejected');
    await insertBuilding(db, { id: 'saved', address: '3 Saved St', city: 'Chicago', state: 'IL' });
    await insertSave(db, 'saved');
    await insertBuilding(db, { id: 'boston', address: '4 Boston St', city: 'Boston' });
    await insertBuilding(db, { id: 'allston', address: '5 Allston St', city: 'Allston, MA' });
    await insertBuilding(db, { id: 'jp', address: '6 Centre St', city: '  jamaica plain ' });
    await insertBuilding(db, { id: 'new-haven', address: '7 Elm St', city: 'New Haven', state: 'CT' });
    await insertBuilding(db, { id: 'chicago', address: '8 Lake St', city: 'Chicago', state: 'IL' });
    await insertBuilding(db, { id: 'chicago-st', address: '9 Lake St', city: 'Chicago, IL', state: 'IL' });
  });

  it('includes only user-added, unreviewed, unsaved rows outside Boston and New Haven', async () => {
    const body = await list(db, '?filter=orphans');
    expect(ids(body)).toEqual(['chicago', 'chicago-st']);
    expect(body.total).toBe(2);
  });

  it('combines with q', async () => {
    expect(ids(await list(db, '?filter=orphans&q=8%20lake'))).toEqual(['chicago']);
  });

  it('ignores an unknown filter value', async () => {
    expect((await list(db, '?filter=everything')).total).toBe(9);
  });
});

suite('GET /api/admin/buildings paging', () => {
  it('orders by created_at then id so rows sharing a created_at are neither repeated nor skipped', async () => {
    const db = createAdminTestDb();
    for (const id of ['p-a', 'p-b', 'p-c', 'p-d', 'p-e']) {
      await insertBuilding(db, { id, address: `${id} St` });
    }
    await db.prepare('UPDATE buildings SET created_at = 1000').run();
    await db.prepare("UPDATE buildings SET created_at = 2000 WHERE id = 'p-c'").run();

    const seen: string[] = [];
    for (let offset = 0; offset < 5; offset += 2) {
      const body = await list(db, `?limit=2&offset=${offset}`);
      seen.push(...body.buildings.map((b) => b.id));
    }
    expect(seen).toEqual(['p-c', 'p-e', 'p-d', 'p-b', 'p-a']);
  });
});
