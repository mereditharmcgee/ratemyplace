import { describe, it, expect } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import {
  createRecordsTestDb,
  insertBuilding,
  createRecordsStubDb,
  applyRecordsMigrations,
  auditActionTypesFrom0028,
} from './helpers/recordsDb';

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

  it('keeps every action type 0028 allowed, plus the two new ones', async () => {
    const db = createRecordsTestDb();
    const legacy = auditActionTypesFrom0028();
    expect(legacy.length).toBe(22);
    for (const action of [...legacy, 'records_pulled', 'record_correction_resolved']) {
      await db
        .prepare("INSERT INTO audit_logs (admin_user_id, admin_ip, action_type, entity_type, entity_id) VALUES ('admin', '1.1.1.1', ?, 'building', 'b1')")
        .bind(action)
        .run();
    }
    const count = await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<{ n: number }>();
    expect(count?.n).toBe(24);
  });

  it('0030 preserves existing audit rows and their ids across the rebuild', async () => {
    const db = createRecordsStubDb();
    for (const id of [1, 2, 5]) {
      await db
        .prepare("INSERT INTO audit_logs (id, admin_user_id, admin_ip, action_type, entity_type, entity_id, notes) VALUES (?, 'admin', '1.1.1.1', 'building_updated', 'building', 'b1', ?)")
        .bind(id, `note ${id}`)
        .run();
    }
    applyRecordsMigrations(db);
    const rows = await db.prepare('SELECT id, notes FROM audit_logs ORDER BY id').all<{ id: number; notes: string }>();
    expect(rows.results).toEqual([{ id: 1, notes: 'note 1' }, { id: 2, notes: 'note 2' }, { id: 5, notes: 'note 5' }]);
    const indexes = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_logs' AND name LIKE 'idx_audit_%' ORDER BY name").all<{ name: string }>();
    expect(indexes.results.map((i) => i.name)).toEqual(['idx_audit_action', 'idx_audit_admin', 'idx_audit_created', 'idx_audit_entity']);
  });
});
