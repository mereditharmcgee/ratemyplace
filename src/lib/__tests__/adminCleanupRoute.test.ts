import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { insertBuilding, insertPull } from './helpers/recordsDb';
import { adminContext, createAdminTestDb, insertReview, insertSave } from './helpers/adminDb';
import { GET, POST } from '../../pages/api/admin/cleanup';

// Lets one test swap in a predicate looser than the real one, to prove the route's own
// safety check refuses rather than trusting whatever `orphanBuildingsWhere` returns.
const predicate = vi.hoisted(() => ({ loose: false }));
vi.mock('../admin/orphanBuildings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../admin/orphanBuildings')>();
  return {
    ...actual,
    orphanBuildingsWhere: () => (predicate.loose ? { sql: '(1 = 1)', binds: [] } : actual.orphanBuildingsWhere()),
  };
});

const suite = sqliteAvailable ? describe : describe.skip;
const URL_ = 'https://ratemyplace.org/api/admin/cleanup';

async function buildingIds(db: TestD1Database): Promise<string[]> {
  const { results } = await db.prepare('SELECT id FROM buildings ORDER BY id').all<{ id: string }>();
  return results.map((r) => r.id);
}

suite('admin orphan cleanup', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createAdminTestDb();
    await insertBuilding(db, { id: 'seed-boston', address: '1 Seed St', city: 'Boston', source: 'seed', parcel_id: '0100001000' });
    await insertBuilding(db, { id: 'seed-chicago', address: '2 Seed St', city: 'Chicago', state: 'IL', source: 'seed' });
    await insertBuilding(db, { id: 'reviewed-chicago', address: '3 Review St', city: 'Chicago', state: 'IL' });
    await insertReview(db, 'r-1', 'reviewed-chicago', 'pending');
    await insertBuilding(db, { id: 'saved-chicago', address: '4 Saved St', city: 'Chicago', state: 'IL' });
    await insertSave(db, 'saved-chicago');
    await insertBuilding(db, { id: 'user-brighton', address: '5 Market St', city: 'Brighton' });
    await insertBuilding(db, { id: 'user-new-haven', address: '6 Elm St', city: 'New Haven, CT', state: 'CT' });
    await insertBuilding(db, { id: 'orphan-chicago', address: '7 Lake St', city: 'Chicago', state: 'IL' });
    await insertBuilding(db, { id: 'orphan-cambridge', address: '8 Mass Ave', city: 'Cambridge' });
  });

  afterEach(() => {
    predicate.loose = false;
  });

  it('requires an admin for both verbs', async () => {
    expect((await GET(adminContext(db, URL_, { isAdmin: false }))).status).toBe(403);
    expect((await POST(adminContext(db, URL_, { method: 'POST', isAdmin: false }))).status).toBe(403);
    expect(await buildingIds(db)).toHaveLength(8);
  });

  it('GET previews only orphans, with a count and a sample', async () => {
    const res = await GET(adminContext(db, URL_));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { count: number; sample: Array<{ id: string; address: string }> } };
    expect(body.data.count).toBe(2);
    expect(body.data.sample.map((b) => b.id).sort()).toEqual(['orphan-cambridge', 'orphan-chicago']);
  });

  it('GET caps the sample at 50 while counting everything', async () => {
    for (let i = 0; i < 55; i += 1) {
      await insertBuilding(db, { id: `bulk-${i}`, address: `${i} Bulk St`, city: 'Chicago', state: 'IL' });
    }
    const body = (await (await GET(adminContext(db, URL_))).json()) as { data: { count: number; sample: unknown[] } };
    expect(body.data.count).toBe(57);
    expect(body.data.sample).toHaveLength(50);
  });

  it('POST deletes only orphans; seeded, reviewed, saved, Boston and New Haven rows survive', async () => {
    await insertPull(db, 'orphan-chicago', 'src-1');
    await db
      .prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at) VALUES ('orphan-chicago', 'fill', 2, unixepoch())")
      .run();

    const res = await POST(adminContext(db, URL_, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { deleted: 2 } });

    expect(await buildingIds(db)).toEqual([
      'reviewed-chicago',
      'saved-chicago',
      'seed-boston',
      'seed-chicago',
      'user-brighton',
      'user-new-haven',
    ]);

    // FK cascades clear the queue and pull rows of a deleted building.
    const queue = await db.prepare("SELECT COUNT(*) AS n FROM records_queue WHERE building_id = 'orphan-chicago'").first<{ n: number }>();
    const pulls = await db.prepare("SELECT COUNT(*) AS n FROM record_pulls WHERE building_id = 'orphan-chicago'").first<{ n: number }>();
    expect(queue?.n).toBe(0);
    expect(pulls?.n).toBe(0);
  });

  interface AuditOldValue {
    deleted: number;
    listed: number;
    buildings: Array<{ id: string; address: string }>;
  }

  async function auditOldValue(): Promise<AuditOldValue> {
    const { results } = await db
      .prepare("SELECT entity_type, old_value FROM audit_logs WHERE action_type = 'buildings_bulk_deleted'")
      .all<{ entity_type: string; old_value: string }>();
    expect(results).toHaveLength(1);
    expect(results[0].entity_type).toBe('building');
    return JSON.parse(results[0].old_value) as AuditOldValue;
  }

  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

  it('POST writes one buildings_bulk_deleted audit row naming what it deleted', async () => {
    await POST(adminContext(db, URL_, { method: 'POST' }));
    const oldValue = await auditOldValue();
    expect(oldValue.deleted).toBe(2);
    expect(oldValue.listed).toBe(2);
    expect([...oldValue.buildings].sort(byId)).toEqual([
      { id: 'orphan-cambridge', address: '8 Mass Ave' },
      { id: 'orphan-chicago', address: '7 Lake St' },
    ]);
  });

  it('POST audits every deleted building, not a 50-row sample, when there are more than 50', async () => {
    for (let i = 0; i < 60; i += 1) {
      await insertBuilding(db, { id: `bulk-${i}`, address: `${i} Bulk St`, city: 'Chicago', state: 'IL' });
    }
    const res = await POST(adminContext(db, URL_, { method: 'POST' }));
    expect(await res.json()).toEqual({ data: { deleted: 62 } });

    const oldValue = await auditOldValue();
    expect(oldValue.deleted).toBe(62);
    expect(oldValue.listed).toBe(62);
    const expected = [
      { id: 'orphan-cambridge', address: '8 Mass Ave' },
      { id: 'orphan-chicago', address: '7 Lake St' },
      ...Array.from({ length: 60 }, (_, i) => ({ id: `bulk-${i}`, address: `${i} Bulk St` })),
    ];
    expect([...oldValue.buildings].sort(byId)).toEqual(expected.sort(byId));
  });

  it('POST refuses with 409 and deletes nothing when the predicate would reach seeded or reviewed rows', async () => {
    predicate.loose = true;
    const res = await POST(adminContext(db, URL_, { method: 'POST' }));
    expect(res.status).toBe(409);
    expect(await buildingIds(db)).toHaveLength(8);
    const audit = await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<{ n: number }>();
    expect(audit?.n).toBe(0);
  });

  it('a user-added building with a blank or missing city and no reviews is not an orphan', async () => {
    await insertBuilding(db, { id: 'blank-city', address: '9 Nowhere St', city: '  ' });
    await insertBuilding(db, { id: 'null-city', address: '10 Nowhere St' });
    await db.prepare("UPDATE buildings SET city = NULL WHERE id = 'null-city'").run();

    const preview = (await (await GET(adminContext(db, URL_))).json()) as { data: { count: number } };
    expect(preview.data.count).toBe(2);
    await POST(adminContext(db, URL_, { method: 'POST' }));
    const ids = await buildingIds(db);
    expect(ids).toContain('blank-city');
    expect(ids).toContain('null-city');
  });

  it('POST with nothing to delete deletes nothing and writes no audit row', async () => {
    await db.prepare("DELETE FROM buildings WHERE id LIKE 'orphan-%'").run();
    const res = await POST(adminContext(db, URL_, { method: 'POST' }));
    expect(await res.json()).toEqual({ data: { deleted: 0 } });
    const audit = await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<{ n: number }>();
    expect(audit?.n).toBe(0);
    expect(await buildingIds(db)).toHaveLength(6);
  });
});
