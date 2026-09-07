import { describe, it, expect } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const suite = sqliteAvailable ? describe : describe.skip;

suite('migrations 0029 and 0030', () => {
  it('adds parcel_id to buildings and creates the three records tables', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { parcel_id: '2102098000' });
    const row = await db.prepare('SELECT parcel_id, sam_id FROM buildings').first<{ parcel_id: string; sam_id: string | null }>();
    expect(row).toEqual({ parcel_id: '2102098000', sam_id: null });

    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('record_pulls','building_records','record_corrections') ORDER BY name")
      .all<{ name: string }>();
    expect(tables.results.map((t) => t.name)).toEqual(['building_records', 'record_corrections', 'record_pulls']);
  });

  it('rejects an unknown pull status and a duplicate record key', async () => {
    const db = createRecordsTestDb();
    const buildingId = await insertBuilding(db);
    await expect(
      db.prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status) VALUES ('p1', ?, 'boston', 'r1', 'Assessor', 'q', 'weird')").bind(buildingId).run(),
    ).rejects.toThrow();

    await db.prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status) VALUES ('p1', ?, 'boston', 'r1', 'Assessor', 'q', 'ok')").bind(buildingId).run();
    await db.prepare("INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload) VALUES ('r1', ?, 'p1', 'permit', 'A1', '{}')").bind(buildingId).run();
    await expect(
      db.prepare("INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload) VALUES ('r2', ?, 'p1', 'permit', 'A1', '{}')").bind(buildingId).run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('accepts the two new audit action types', async () => {
    const db = createRecordsTestDb();
    for (const action of ['records_pulled', 'record_correction_resolved']) {
      await db
        .prepare("INSERT INTO audit_logs (admin_user_id, admin_ip, action_type, entity_type, entity_id) VALUES ('admin', '1.1.1.1', ?, 'building', 'b1')")
        .bind(action)
        .run();
    }
    const count = await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});
