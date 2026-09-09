import { describe, expect, it } from 'vitest';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

describe('migration 0031 (Boston coverage)', () => {
  it('adds source, street key, and number range to buildings with a user default', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { id: 'b1' });
    const row = await db
      .prepare('SELECT source, street_key, st_num_lo, st_num_hi FROM buildings WHERE id = ?')
      .bind(id)
      .first<{ source: string; street_key: string | null; st_num_lo: number | null; st_num_hi: number | null }>();
    expect(row).toEqual({ source: 'user', street_key: null, st_num_lo: null, st_num_hi: null });
  });

  it('rejects a source outside user/seed', async () => {
    const db = createRecordsTestDb();
    await expect(async () =>
      db.prepare("INSERT INTO buildings (id, address, slug, city, source) VALUES ('b2', '1 A St', 'b2', 'Boston', 'import')").run(),
    ).rejects.toThrow(/CHECK/);
  });

  it('creates records_queue with one pending row per building and a reason check', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await insertBuilding(db, { id: 'b2', slug: 'b2' });
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b1', 'button', 0)").run();
    await expect(async () =>
      db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b1', 'fill', 2)").run(),
    ).rejects.toThrow(/UNIQUE/);
    await expect(async () =>
      db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b2', 'view', 0)").run(),
    ).rejects.toThrow(/CHECK/);
  });

  it('allows a second pending row once the first is done', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, done_at) VALUES ('b1', 'fill', 2, 1)").run();
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b1', 'button', 0)").run();
    const n = await db.prepare("SELECT COUNT(*) AS n FROM records_queue WHERE building_id = 'b1'").first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it('creates the two non-unique indexes the queue and dedupe rely on', async () => {
    const db = createRecordsTestDb();
    const rows = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_buildings_street', 'idx_records_queue_pending') ORDER BY name")
      .all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual(['idx_buildings_street', 'idx_records_queue_pending']);
  });

  it('creates app_settings and record_pulls.trigger_reason', async () => {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO app_settings (key, value) VALUES ('records_fill_paused', '1')").run();
    const setting = await db.prepare("SELECT value FROM app_settings WHERE key = 'records_fill_paused'").first<{ value: string }>();
    expect(setting?.value).toBe('1');
    await insertBuilding(db, { id: 'b1' });
    await db
      .prepare(
        "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, triggered_by, trigger_reason) VALUES ('p1', 'b1', 'boston', 'src', 'Src', 'q', 'ok', 1, NULL, 'seed')",
      )
      .run();
    const pull = await db.prepare("SELECT trigger_reason FROM record_pulls WHERE id = 'p1'").first<{ trigger_reason: string }>();
    expect(pull?.trigger_reason).toBe('seed');
  });
});
