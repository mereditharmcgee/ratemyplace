import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryDatabase, TestD1Database } from './sqliteD1';

/**
 * Minimal schema for records tests: the parent tables the 0029/0030 migrations
 * reference, plus the two tables the queue planner reads (`reviews.building_id`
 * and `status`, `saved_buildings.building_id`), plus what the review-moderation
 * route touches on its way to the approval enqueue (`reviews.user_id`,
 * `moderation_notes`, `updated_at`, and `notifications`). Column names mirror the
 * real migrations (0001, 0021, 0023); the unused columns are left out. Keeps tests
 * honest about the SQL that ships without applying all 33 migrations.
 */
export function createRecordsStubDb(): TestD1Database {
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
      latitude REAL,
      longitude REAL,
      google_place_id TEXT,
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
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      -- Nullable where 0001 has it NOT NULL: the planner and sitemap tests insert reviews by
      -- name without an author, and only the moderation route needs the join to users.
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'flagged')),
      moderation_notes TEXT,
      overall_score REAL,
      move_out_year_new TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    -- Mirrors migration 0021. The moderation route notifies the review's author on approve
    -- and reject, and createNotification swallows its own errors — without the table the
    -- approval still succeeds but logs, which would mask the records log a test asserts on.
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'review_approved', 'review_rejected', 'review_disputed', 'dispute_resolved'
      )),
      review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      read_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE landlords (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL);
    CREATE TABLE property_managers (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL);
    CREATE TABLE saved_buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(user_id, building_id)
    );
    -- Mirrors migration 0024. The sitemap and the queue planner both count approved reviews
    -- per building and their comments claim this index; without it here the claim is not
    -- exercisable against the double.
    CREATE INDEX idx_reviews_building_status ON reviews(building_id, status);
  `);
  return db;
}

/**
 * 0032 indexes `saved_buildings(building_id)`, a table the real 0023 creates and the stub
 * above stands in for, so the stub has to exist before this runs — `createRecordsTestDb`
 * is the only correct order. The other two indexes are over tables 0029 and 0031 create.
 * 0033's index is over `records_queue`, which 0031 creates, so it follows for the same reason.
 */
export function applyRecordsMigrations(db: TestD1Database): void {
  for (const file of [
    '0029_building_records.sql',
    '0030_audit_records_actions.sql',
    '0031_boston_coverage.sql',
    '0032_records_queue_indexes.sql',
    '0033_records_queue_reason_requested.sql',
  ]) {
    db.exec(readFileSync(join(process.cwd(), 'migrations', file), 'utf8'));
  }
}

export function createRecordsTestDb(): TestD1Database {
  const db = createRecordsStubDb();
  applyRecordsMigrations(db);
  return db;
}

/** Every action_type 0028 allows, parsed from the migration file so the list cannot drift from the source of truth. */
export function auditActionTypesFrom0028(): string[] {
  const sql = readFileSync(join(process.cwd(), 'migrations', '0028_audit_expand_action_types.sql'), 'utf8');
  const block = sql.match(/action_type TEXT NOT NULL CHECK \(action_type IN \(([\s\S]*?)\)\)/);
  if (!block) throw new Error('could not find action_type CHECK in 0028');
  return Array.from(block[1].matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

type BuildingRow = {
  id: string;
  address: string;
  slug: string;
  neighborhood: string | null;
  city: string;
  state: string;
  zip_code: string;
  parcel_id: string | null;
  sam_id: string | null;
  google_place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  source: 'user' | 'seed';
  street_key: string | null;
  st_num_lo: number | null;
  st_num_hi: number | null;
};

/**
 * One list drives both the INSERT's column names and its bind order, so the two cannot
 * drift apart the way three hand-maintained lists could.
 */
const BUILDING_COLUMNS = [
  'id',
  'address',
  'slug',
  'neighborhood',
  'city',
  'state',
  'zip_code',
  'parcel_id',
  'sam_id',
  'google_place_id',
  'latitude',
  'longitude',
  'source',
  'street_key',
  'st_num_lo',
  'st_num_hi',
] as const;

export async function insertBuilding(db: TestD1Database, overrides: Partial<BuildingRow> = {}): Promise<string> {
  // An explicitly-undefined key (`{ slug: undefined }`) must not win the spread and bind
  // undefined into the statement, so drop those keys before the defaults are applied.
  const given = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<BuildingRow>;
  const row: BuildingRow = {
    id: 'bldg-lanark',
    address: '23-27 Lanark Rd, Boston, MA 02135',
    // Mirrors the old helper's `overrides.slug ?? id`: an override id becomes the slug too, so
    // a second building in one test does not collide on the UNIQUE column.
    slug: given.id ?? 'bldg-lanark',
    neighborhood: null,
    city: 'Boston',
    state: 'MA',
    zip_code: '02135',
    parcel_id: null,
    sam_id: null,
    google_place_id: null,
    latitude: null,
    longitude: null,
    source: 'user',
    street_key: null,
    st_num_lo: null,
    st_num_hi: null,
    ...given,
  };
  await db
    .prepare(
      `INSERT INTO buildings (${BUILDING_COLUMNS.join(', ')}) VALUES (${BUILDING_COLUMNS.map(() => '?').join(', ')})`,
    )
    .bind(...BUILDING_COLUMNS.map((column) => row[column]))
    .run();
  return row.id;
}

/**
 * A finished pull row for one source, so the coverage reads can see it. The id folds in
 * `status` so one building can hold both an `ok` and an `error` row for the same source.
 * `trigger_reason` is fixed: nothing asserts it, and any value the union allows will do.
 */
export async function insertPull(
  db: TestD1Database,
  buildingId: string,
  sourceId: string,
  status: 'ok' | 'empty' | 'error' = 'ok',
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, ' +
        'row_count, error_message, triggered_by, correction_id, trigger_reason) ' +
        "VALUES (?, ?, 'boston', ?, 'label', 'q', ?, 0, NULL, NULL, NULL, 'admin')",
    )
    .bind(`${buildingId}-${sourceId}-${status}`, buildingId, sourceId, status)
    .run();
}

/** The `reason` of every queue row still waiting on the Worker, for the building asked about. */
export async function pendingReasons(db: TestD1Database, buildingId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT reason FROM records_queue WHERE building_id = ? AND done_at IS NULL')
    .bind(buildingId)
    .all<{ reason: string }>();
  return results.map((row) => row.reason);
}
