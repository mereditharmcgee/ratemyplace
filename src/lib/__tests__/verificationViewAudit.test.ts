import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../pages/api/admin/verification/[id]';
import { VERIFICATION_ADMIN_COPY } from '../verificationNotice';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// Every time an admin opens a proof-of-address document, an audit entry records who opened
// which one. The promise is that every view is logged, so the route fails closed: if the
// entry cannot be written, the document is not served. The entry names the admin, the
// verification and its review, never the tenant's filename or the storage key, which name
// the tenant. Every name here is fictional.

const suite = sqliteAvailable ? describe : describe.skip;
const R2_KEY = 'users/author-1/verifications/rev-1/1767225600000.pdf';
const FILENAME = 'sample-lease-unit-9.pdf';

async function seed(db: TestD1Database): Promise<void> {
  await db.prepare("INSERT INTO users (id, email, is_admin) VALUES ('admin-1', 'admin@example.test', 1)").run();
  await db.prepare("INSERT INTO users (id, email) VALUES ('author-1', 'author@example.test')").run();
  await db
    .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES ('bldg-a', 'Sample Building', 'sample-building', 'Boston', 'MA')")
    .run();
  await db
    .prepare(
      "INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, status) VALUES ('rev-1', 'author-1', 'bldg-a', 2022, 'fall', '1br', 'approved')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO verification_images (id, review_id, user_id, r2_key, filename, content_type, size_bytes) VALUES ('ver-1', 'rev-1', 'author-1', ?, ?, 'application/pdf', 2048)",
    )
    .bind(R2_KEY, FILENAME)
    .run();
}

interface FakeBody {
  text: string;
  cancel: ReturnType<typeof vi.fn>;
}

function view(
  db: TestD1Database,
  options: { isAdmin?: boolean; stored?: boolean; body?: FakeBody } = {},
): Promise<Response> {
  const body = options.body ?? 'document bytes';
  return GET({
    params: { id: 'ver-1' },
    request: new Request('https://ratemyplace.org/api/admin/verification/ver-1', {
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
    }),
    url: new URL('https://ratemyplace.org/api/admin/verification/ver-1'),
    locals: {
      user: { id: 'admin-1', isAdmin: options.isAdmin ?? true },
      runtime: {
        env: {
          DB: db,
          VERIFICATION_BUCKET: { get: async () => (options.stored === false ? null : { body }) },
        },
      },
    },
  } as unknown as APIContext);
}

async function auditRows(db: TestD1Database) {
  const { results } = await db
    .prepare('SELECT admin_user_id, admin_ip, action_type, entity_type, entity_id, old_value, new_value, notes FROM audit_logs ORDER BY id')
    .all<Record<string, unknown>>();
  return results;
}

suite('GET /api/admin/verification/[id] logs every view', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = schemaDb();
    await seed(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one verification_viewed entry and serves the document', async () => {
    const res = await view(db);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('document bytes');
    expect(await auditRows(db)).toEqual([
      {
        admin_user_id: 'admin-1',
        admin_ip: '203.0.113.10',
        action_type: 'verification_viewed',
        entity_type: 'verification',
        entity_id: 'ver-1',
        old_value: null,
        new_value: JSON.stringify({ review_id: 'rev-1' }),
        notes: null,
      },
    ]);
  });

  it('writes one entry per view', async () => {
    await view(db);
    await view(db);
    expect((await auditRows(db)).map((r) => r.action_type)).toEqual(['verification_viewed', 'verification_viewed']);
  });

  it('never records the filename or the storage key', async () => {
    await view(db);
    const stored = JSON.stringify(await auditRows(db));
    expect(stored).not.toContain(FILENAME);
    expect(stored).not.toContain('sample-lease');
    expect(stored).not.toContain(R2_KEY);
    expect(stored).not.toContain('users/author-1');
  });

  it('logs nothing when the document is not in storage', async () => {
    const res = await view(db, { stored: false });
    expect(res.status).toBe(404);
    expect(await auditRows(db)).toEqual([]);
  });

  it('logs nothing for a signed-in person who is not an admin', async () => {
    const res = await view(db, { isAdmin: false });
    expect(res.status).toBe(403);
    expect(await auditRows(db)).toEqual([]);
  });
});

suite('the view fails closed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not serve the document when the entry cannot be written (before migration 0038)', async () => {
    const db = schemaDb({ through: '0037_notifications_verification_events.sql' });
    await seed(db);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body: FakeBody = { text: 'document bytes', cancel: vi.fn(async () => {}) };

    const res = await view(db, { body });

    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: VERIFICATION_ADMIN_COPY.viewNotLogged });
    expect(text).not.toContain('document bytes');
    // The stream R2 opened is released rather than left hanging.
    expect(body.cancel).toHaveBeenCalledOnce();
    expect(await auditRows(db)).toEqual([]);

    const logged = consoleSpy.mock.calls.map((call) => call.map(String).join(' ')).join(' ');
    expect(logged).toContain('audit_log_write_failed');
    expect(logged).toContain('verification_viewed');
    expect(logged).not.toContain(FILENAME);
    expect(logged).not.toContain(R2_KEY);
  });

  it('does not serve the document when the database throws on the write', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                return sql.includes('FROM verification_images')
                  ? { review_id: 'rev-1', r2_key: R2_KEY, content_type: 'application/pdf', filename: FILENAME }
                  : null;
              },
              async run() {
                throw new Error('D1 unavailable');
              },
            };
          },
        };
      },
    } as unknown as TestD1Database;

    const res = await view(db);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: VERIFICATION_ADMIN_COPY.viewNotLogged });
    expect(consoleSpy).toHaveBeenCalled();
  });
});
