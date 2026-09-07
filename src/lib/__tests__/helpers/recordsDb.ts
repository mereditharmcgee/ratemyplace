import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryDatabase, TestD1Database } from './sqliteD1';

/**
 * Minimal schema for records tests: the parent tables the 0029/0030 migrations
 * reference, then the real migration files. Keeps tests honest about the SQL
 * that ships without applying all 30 migrations.
 */
export function createRecordsTestDb(): TestD1Database {
  const db = new TestD1Database(createMemoryDatabase());
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, is_admin INTEGER DEFAULT 0);
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      landlord_id TEXT,
      property_manager_id TEXT,
      address TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      neighborhood TEXT,
      city TEXT,
      state TEXT,
      zip_code TEXT,
      year_built INTEGER,
      unit_count INTEGER,
      building_type TEXT,
      owner_name TEXT,
      owner_entity TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rate_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      admin_user_id TEXT NOT NULL,
      admin_ip TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('building_updated')),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('review','dispute','landlord','building','manager','verification','user','bug_report')),
      entity_id TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      notes TEXT
    );
  `);
  for (const file of ['0029_building_records.sql', '0030_audit_records_actions.sql']) {
    db.exec(readFileSync(join(process.cwd(), 'migrations', file), 'utf8'));
  }
  return db;
}

export async function insertBuilding(
  db: TestD1Database,
  overrides: Partial<{ id: string; address: string; slug: string; city: string; zip_code: string; parcel_id: string | null }> = {},
): Promise<string> {
  const id = overrides.id ?? 'bldg-lanark';
  await db
    .prepare('INSERT INTO buildings (id, address, slug, city, state, zip_code, parcel_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      overrides.address ?? '23-27 Lanark Rd, Boston, MA 02135',
      overrides.slug ?? id,
      overrides.city ?? 'Boston',
      'MA',
      overrides.zip_code ?? '02135',
      overrides.parcel_id ?? null,
    )
    .run();
  return id;
}
