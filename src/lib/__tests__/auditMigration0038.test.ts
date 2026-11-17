import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previousMigration, schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// Migration 0038 rebuilds `audit_logs` (the 0028/0030 pattern) so its action_type CHECK also
// allows `verification_viewed`, the entry an admin's view of a proof-of-address document
// writes. Nothing else may change: every row, every allowed action and entity type, every
// column, default and index comes through as 0030 left it.

const suite = sqliteAvailable ? describe : describe.skip;
const MIGRATION = '0038_audit_verification_viewed.sql';

function migrationSql(): string {
  return readFileSync(join(process.cwd(), 'migrations', MIGRATION), 'utf8');
}

async function seeded(): Promise<TestD1Database> {
  const db = schemaDb({ through: previousMigration(MIGRATION) });
  const rows: Array<[number, number, string, string, string, string, string, string | null, string | null, string | null]> = [
    [1, 1767225600, 'admin-1', '203.0.113.10', 'review_approved', 'review', 'rev-1', '{"status":"pending"}', '{"status":"approved"}', null],
    [2, 1767225700, 'admin-1', '203.0.113.10', 'verification_rejected', 'verification', 'ver-1', null, '{"review_id":"rev-1"}', 'Too blurry to read.'],
    [9, 1767225800, 'admin-2', 'unknown', 'records_pulled', 'building', 'bldg-a', null, null, null],
  ];
  for (const row of rows) {
    await db
      .prepare(
        'INSERT INTO audit_logs (id, created_at, admin_user_id, admin_ip, action_type, entity_type, entity_id, old_value, new_value, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(...row)
      .run();
  }
  return db;
}

async function all<T>(db: TestD1Database, sql: string): Promise<T[]> {
  return (await db.prepare(sql).all<T>()).results;
}

async function shape(db: TestD1Database) {
  return {
    columns: await all(db, 'PRAGMA table_xinfo(audit_logs)'),
    foreignKeys: await all(db, 'PRAGMA foreign_key_list(audit_logs)'),
    indexes: await all(db, "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_logs' ORDER BY name"),
  };
}

async function tableSql(db: TestD1Database): Promise<string> {
  const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'").first<{ sql: string }>();
  return row?.sql ?? '';
}

/** The quoted values of one CHECK list. `))` closes it; a comment inside may hold one `)`. */
async function allowed(db: TestD1Database, column: 'action_type' | 'entity_type'): Promise<string[]> {
  const block = (await tableSql(db)).match(new RegExp(`${column} TEXT NOT NULL CHECK \\(${column} IN \\(([\\s\\S]*?)\\)\\)`));
  if (!block) throw new Error(`no ${column} CHECK on audit_logs`);
  return Array.from(block[1].matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

const ROWS_SQL = 'SELECT * FROM audit_logs ORDER BY id';

suite('migration 0038 adds verification_viewed to the audit CHECK', () => {
  it('keeps every row exactly, ids included', async () => {
    const db = await seeded();
    const before = await all(db, ROWS_SQL);
    db.exec(migrationSql());
    expect(await all(db, ROWS_SQL)).toEqual(before);
    expect(before).toHaveLength(3);
  });

  it('keeps every column, default and index exactly', async () => {
    const db = await seeded();
    const before = await shape(db);
    db.exec(migrationSql());
    expect(await shape(db)).toEqual(before);
    expect(/AUTOINCREMENT/i.test(await tableSql(db))).toBe(true);
    expect((before.indexes as Array<{ name: string }>).map((i) => i.name)).toEqual([
      'idx_audit_action',
      'idx_audit_admin',
      'idx_audit_created',
      'idx_audit_entity',
    ]);
  });

  it('keeps every allowed action and entity type and adds only verification_viewed', async () => {
    const db = await seeded();
    const actionsBefore = await allowed(db, 'action_type');
    const entitiesBefore = await allowed(db, 'entity_type');
    expect(actionsBefore).toContain('records_pulled');
    db.exec(migrationSql());
    expect(await allowed(db, 'action_type')).toEqual([...actionsBefore, 'verification_viewed']);
    expect(await allowed(db, 'entity_type')).toEqual(entitiesBefore);
    expect(entitiesBefore).toContain('verification');
  });

  it('accepts a verification_viewed entry and still refuses an unknown action', async () => {
    const db = await seeded();
    const insert = (action: string) =>
      db
        .prepare("INSERT INTO audit_logs (admin_user_id, admin_ip, action_type, entity_type, entity_id) VALUES ('admin-1', '203.0.113.10', ?, 'verification', 'ver-1')")
        .bind(action)
        .run();
    await expect(insert('verification_viewed')).rejects.toThrow(/CHECK/);
    db.exec(migrationSql());
    await insert('verification_viewed');
    await expect(insert('verification_peeked')).rejects.toThrow(/CHECK/);
    const row = await db
      .prepare("SELECT id, created_at FROM audit_logs WHERE action_type = 'verification_viewed'")
      .first<{ id: number; created_at: number }>();
    expect(row?.id).toBe(10);
    expect(row?.created_at).toBeGreaterThan(1767225800);
  });

  it('leaves no copy table behind and is safe to run twice', async () => {
    const db = await seeded();
    db.exec(migrationSql());
    const once = await all(db, ROWS_SQL);
    const shapeOnce = await shape(db);
    db.exec(migrationSql());
    expect(await all(db, ROWS_SQL)).toEqual(once);
    expect(await shape(db)).toEqual(shapeOnce);
    expect(await all(db, "SELECT name FROM sqlite_master WHERE name LIKE 'audit_logs_%'")).toEqual([]);
  });
});
