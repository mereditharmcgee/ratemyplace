import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previousMigration, schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// Migration 0037 rebuilds `notifications` so its event_type CHECK also allows the two
// proof-of-address outcomes. SQLite cannot alter a CHECK, so the table is copied, dropped and
// renamed, the way 0028 and 0030 rebuilt audit_logs. A rebuild is only safe if nothing but the
// CHECK changes: every row, column, default, foreign key and index must come through as it was.

const suite = sqliteAvailable ? describe : describe.skip;
const MIGRATION = '0037_notifications_verification_events.sql';

function migrationSql(): string {
  return readFileSync(join(process.cwd(), 'migrations', MIGRATION), 'utf8');
}

async function seeded(): Promise<TestD1Database> {
  const db = schemaDb({ through: previousMigration(MIGRATION) });
  for (const id of ['tenant-1', 'tenant-2']) {
    await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, `${id}@example.test`).run();
  }
  await db
    .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES ('bldg-a', 'Sample Building', 'sample-building', 'Boston', 'MA')")
    .run();
  for (const [id, user] of [['rev-1', 'tenant-1'], ['rev-2', 'tenant-2']]) {
    await db
      .prepare(
        "INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, status) VALUES (?, ?, 'bldg-a', 2022, 'fall', '1br', 'approved')",
      )
      .bind(id, user)
      .run();
  }
  const rows: Array<[number, string, string, string | null, string, number | null, number]> = [
    [1, 'tenant-1', 'review_approved', 'rev-1', 'Your review of Sample Building has been approved and is now live.', 1767225700, 1767225600],
    [2, 'tenant-1', 'review_disputed', 'rev-1', 'Your review of Sample Building has been disputed by the landlord.', null, 1767225800],
    [5, 'tenant-2', 'review_rejected', null, 'A notice with no review attached.', null, 1767225900],
    [6, 'tenant-2', 'dispute_resolved', 'rev-2', 'The dispute on your review of Sample Building has been resolved.', 1767226100, 1767226000],
  ];
  for (const row of rows) {
    await db
      .prepare('INSERT INTO notifications (id, user_id, event_type, review_id, message, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(...row)
      .run();
  }
  return db;
}

async function all<T>(db: TestD1Database, sql: string): Promise<T[]> {
  return (await db.prepare(sql).all<T>()).results;
}

/** Everything about the table's shape except the CHECK text. */
async function shape(db: TestD1Database) {
  return {
    columns: await all(db, 'PRAGMA table_xinfo(notifications)'),
    foreignKeys: await all(db, 'PRAGMA foreign_key_list(notifications)'),
    indexes: await all(
      db,
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications' ORDER BY name",
    ),
    autoincrement: /AUTOINCREMENT/i.test(
      (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").first<{ sql: string }>())?.sql ?? '',
    ),
  };
}

async function allowedEvents(db: TestD1Database): Promise<string[]> {
  const row = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'")
    .first<{ sql: string }>();
  // `))` closes the list; a comment inside it may hold a single `)`.
  const block = row?.sql.match(/event_type IN \(([\s\S]*?)\)\)/);
  if (!block) throw new Error('no event_type CHECK on notifications');
  return Array.from(block[1].matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

const ROWS_SQL = 'SELECT id, user_id, event_type, review_id, message, read_at, created_at FROM notifications ORDER BY id';

suite('migration 0037 widens the notifications event_type CHECK', () => {
  it('keeps every row exactly, ids included', async () => {
    const db = await seeded();
    const before = await all(db, ROWS_SQL);
    db.exec(migrationSql());
    expect(await all(db, ROWS_SQL)).toEqual(before);
    expect(before).toHaveLength(4);
  });

  it('keeps every column, default, foreign key and index exactly', async () => {
    const db = await seeded();
    const before = await shape(db);
    db.exec(migrationSql());
    const after = await shape(db);
    expect(after).toEqual(before);
    expect(after.autoincrement).toBe(true);
    expect(after.indexes.map((i) => (i as { name: string }).name)).toEqual(['idx_notifications_unread', 'idx_notifications_user']);
  });

  it('allows the two verification outcomes on top of the four review events', async () => {
    const db = await seeded();
    const before = await allowedEvents(db);
    db.exec(migrationSql());
    expect(await allowedEvents(db)).toEqual([...before, 'verification_approved', 'verification_rejected']);

    for (const event of ['verification_approved', 'verification_rejected']) {
      await db
        .prepare("INSERT INTO notifications (user_id, event_type, review_id, message) VALUES ('tenant-1', ?, 'rev-1', 'x')")
        .bind(event)
        .run();
    }
    await expect(
      db.prepare("INSERT INTO notifications (user_id, event_type, review_id, message) VALUES ('tenant-1', 'something_else', 'rev-1', 'x')").run(),
    ).rejects.toThrow(/CHECK/);
  });

  it('gives a new row an id above every kept one, with the created_at default', async () => {
    const db = await seeded();
    db.exec(migrationSql());
    await db
      .prepare("INSERT INTO notifications (user_id, event_type, review_id, message) VALUES ('tenant-1', 'verification_approved', 'rev-1', 'x')")
      .run();
    const row = await db
      .prepare("SELECT id, created_at, read_at FROM notifications WHERE event_type = 'verification_approved'")
      .first<{ id: number; created_at: number; read_at: number | null }>();
    expect(row?.id).toBe(7);
    expect(row?.created_at).toBeGreaterThan(1767226100);
    expect(row?.read_at).toBeNull();
  });

  it('still removes a review\'s and a user\'s notifications with them', async () => {
    const db = await seeded();
    db.exec(migrationSql());
    await db.prepare("DELETE FROM reviews WHERE id = 'rev-1'").run();
    expect((await all<{ id: number }>(db, ROWS_SQL)).map((r) => r.id)).toEqual([5, 6]);
    await db.prepare("DELETE FROM users WHERE id = 'tenant-2'").run();
    expect(await all(db, ROWS_SQL)).toEqual([]);
  });

  it('leaves no copy table behind and is safe to run twice', async () => {
    const db = await seeded();
    db.exec(migrationSql());
    const once = await all(db, ROWS_SQL);
    const shapeOnce = await shape(db);
    db.exec(migrationSql());
    expect(await all(db, ROWS_SQL)).toEqual(once);
    expect(await shape(db)).toEqual(shapeOnce);
    expect(await all(db, "SELECT name FROM sqlite_master WHERE name LIKE 'notifications_%'")).toEqual([]);
  });
});
