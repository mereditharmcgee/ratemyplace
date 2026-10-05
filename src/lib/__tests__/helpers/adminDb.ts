import type { APIContext } from 'astro';
import { createRecordsTestDb } from './recordsDb';
import type { TestD1Database } from './sqliteD1';

/**
 * The records test database plus the columns the admin list routes select and the records
 * stub leaves out: building admin/owner fields (0009), landlord contact and note columns
 * (0001, 0009), and the review fields the admin reviews list reads (0001, 0004, 0017, 0019).
 * Built on `createRecordsTestDb()` so the FK cascades (record_pulls, records_queue) and the
 * full 0030 audit CHECK list are the real ones.
 *
 * `landlords.created_at` defaults to 0 here: SQLite's ALTER TABLE cannot add a column whose
 * default is an expression such as `unixepoch()`.
 */
export function createAdminTestDb(): TestD1Database {
  const db = createRecordsTestDb();
  db.exec(`
    ALTER TABLE buildings ADD COLUMN admin_notes TEXT;
    ALTER TABLE buildings ADD COLUMN owner_website TEXT;

    ALTER TABLE landlords ADD COLUMN description TEXT;
    ALTER TABLE landlords ADD COLUMN website TEXT;
    ALTER TABLE landlords ADD COLUMN phone TEXT;
    ALTER TABLE landlords ADD COLUMN email TEXT;
    ALTER TABLE landlords ADD COLUMN admin_notes TEXT;
    ALTER TABLE landlords ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE landlords ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE reviews ADD COLUMN landlord_name TEXT;
    ALTER TABLE reviews ADD COLUMN review_title TEXT;
    ALTER TABLE reviews ADD COLUMN review_text TEXT;
    ALTER TABLE reviews ADD COLUMN comments TEXT;
    ALTER TABLE reviews ADD COLUMN is_verified INTEGER DEFAULT 0;
    ALTER TABLE reviews ADD COLUMN move_in_year INTEGER;
    ALTER TABLE reviews ADD COLUMN move_in_season TEXT;
    ALTER TABLE reviews ADD COLUMN unit_type TEXT;
    ALTER TABLE reviews ADD COLUMN unit_number TEXT;
    ALTER TABLE reviews ADD COLUMN rent_amount INTEGER;
    ALTER TABLE reviews ADD COLUMN would_recommend_new TEXT;
  `);
  return db;
}

/** An admin request against `db`. A body makes it a JSON request with the given method. */
export function adminContext(
  db: TestD1Database,
  url: string,
  init: { method?: string; body?: unknown; params?: Record<string, string>; isAdmin?: boolean } = {},
): APIContext {
  const method = init.method ?? 'GET';
  const request = new Request(url, {
    method,
    headers: init.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return {
    request,
    url: new URL(url),
    params: init.params ?? {},
    locals: {
      user: { id: 'admin-1', isAdmin: init.isAdmin ?? true },
      runtime: { env: { DB: db } },
    },
  } as unknown as APIContext;
}

export async function insertLandlord(db: TestD1Database, id: string, name: string): Promise<void> {
  await db.prepare('INSERT INTO landlords (id, name, slug) VALUES (?, ?, ?)').bind(id, name, id).run();
}

export async function insertReview(
  db: TestD1Database,
  id: string,
  buildingId: string,
  status: 'pending' | 'approved' | 'rejected' | 'flagged' = 'approved',
): Promise<void> {
  await db
    .prepare('INSERT INTO reviews (id, building_id, status, overall_score) VALUES (?, ?, ?, 4)')
    .bind(id, buildingId, status)
    .run();
}

export async function insertSave(db: TestD1Database, buildingId: string, userId = 'saver-1'): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind(userId, `${userId}@example.com`).run();
  await db.prepare('INSERT INTO saved_buildings (user_id, building_id) VALUES (?, ?)').bind(userId, buildingId).run();
}
