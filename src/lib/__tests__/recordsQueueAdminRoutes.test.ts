import type { APIContext } from 'astro';
import { describe, expect, it } from 'vitest';
import { GET } from '../../pages/api/admin/records/queue/index';
import { POST as PAUSE } from '../../pages/api/admin/records/queue/pause';
import { POST as RETRY } from '../../pages/api/admin/records/queue/retry';
import { LOCK_TTL_SECONDS, MAX_ATTEMPTS } from '../records/queue';
import { SETTING_KEYS } from '../records/settings';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import type { RecordsQueueFixtureResult, RecordsQueueParkedRow, RecordsQueueStats } from '../api-types';

const suite = sqliteAvailable ? describe : describe.skip;

/** The routes stamp `now` from the real clock, so the fixture timestamps hang off it too. */
const NOW = Math.floor(Date.now() / 1000);

interface QueuePayload {
  stats: RecordsQueueStats;
  parked: RecordsQueueParkedRow[];
  lastFixture: RecordsQueueFixtureResult | null;
}

/** Every success on these routes is a `{ data }` envelope; every failure is a bare `{ error }`. */
async function data<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data: T };
  expect(payload).toHaveProperty('data');
  return payload.data;
}

interface ContextOptions {
  user?: { id: string; isAdmin: boolean } | null;
  body?: unknown;
  method?: string;
  /** Omit to send `application/json`; pass a string to exercise the content-type guard. */
  contentType?: string | null;
}

function createContext(db: TestD1Database, options: ContextOptions = {}): APIContext {
  const { user = { id: 'admin', isAdmin: true }, body, method = 'POST', contentType } = options;

  const url = 'https://ratemyplace.org/api/admin/records/queue';
  const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.10' };
  const resolvedType = contentType === undefined ? 'application/json' : contentType;
  if (resolvedType !== null) headers['Content-Type'] = resolvedType;

  const init: RequestInit = { method, headers };
  if (method !== 'GET' && body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  return {
    params: {},
    request: new Request(url, init),
    url: new URL(url),
    locals: { user, runtime: { env: { DB: db } } },
  } as unknown as APIContext;
}

/** A pending row with `attempts` already spent, so a parked row is one call away. */
async function insertQueueRow(
  db: TestD1Database,
  row: {
    buildingId: string;
    reason?: string;
    priority?: number;
    requestedAt?: number;
    attempts?: number;
    lastError?: string | null;
    lockedAt?: number | null;
    doneAt?: number | null;
  },
): Promise<number> {
  await db
    .prepare(
      'INSERT INTO records_queue (building_id, reason, priority, requested_at, attempts, last_error, locked_at, done_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      row.buildingId,
      row.reason ?? 'fill',
      row.priority ?? 2,
      row.requestedAt ?? NOW - 500,
      row.attempts ?? 0,
      row.lastError ?? null,
      row.lockedAt ?? null,
      row.doneAt ?? null,
    )
    .run();
  const inserted = await db
    .prepare('SELECT id FROM records_queue WHERE building_id = ? ORDER BY id DESC LIMIT 1')
    .bind(row.buildingId)
    .first<{ id: number }>();
  return inserted!.id;
}

async function readRow(db: TestD1Database, id: number) {
  return db
    .prepare('SELECT attempts, last_error, locked_at, done_at FROM records_queue WHERE id = ?')
    .bind(id)
    .first<{ attempts: number; last_error: string | null; locked_at: number | null; done_at: number | null }>();
}

suite('admin records queue routes', () => {
  describe('auth', () => {
    it('403s a non-admin on all three routes', async () => {
      const db = createRecordsTestDb();
      const nonAdmin = { user: { id: 'user-1', isAdmin: false } };

      const get = await GET(createContext(db, { ...nonAdmin, method: 'GET' }));
      const pause = await PAUSE(createContext(db, { ...nonAdmin, body: { paused: true } }));
      const retry = await RETRY(createContext(db, { ...nonAdmin, body: { id: 1 } }));

      for (const response of [get, pause, retry]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Admin access required' });
      }
    });

    it('403s a signed-out visitor', async () => {
      const db = createRecordsTestDb();
      const response = await GET(createContext(db, { user: null, method: 'GET' }));
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/admin/records/queue', () => {
    it('returns stats, only the parked rows, and a null lastFixture when nothing has run', async () => {
      const db = createRecordsTestDb();
      await insertBuilding(db, { id: 'parked', slug: 'parked', address: '1 Parked St, Boston, MA 02135' });
      await insertBuilding(db, { id: 'healthy', slug: 'healthy', address: '2 Healthy St, Boston, MA 02135' });
      await insertQueueRow(db, {
        buildingId: 'parked',
        reason: 'fill',
        priority: 2,
        requestedAt: NOW - 900,
        attempts: MAX_ATTEMPTS,
        lastError: 'network down',
        lockedAt: NOW - 30,
      });
      await insertQueueRow(db, { buildingId: 'healthy', reason: 'button', priority: 0, requestedAt: NOW - 100 });

      const response = await GET(createContext(db, { method: 'GET' }));
      const payload = await data<QueuePayload>(response);

      expect(response.status).toBe(200);
      expect(payload.stats.pendingByReason).toEqual({ button: 1, follower: 0, refresh: 0, fill: 0 });
      expect(payload.stats.parked).toBe(1);
      expect(payload.stats.completedLast24h).toBe(0);
      expect(payload.stats.fillPaused).toBe(false);
      // The parked row is older but not claimable, so the healthy row is the oldest pending.
      expect(payload.stats.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(100);
      expect(payload.stats.oldestPendingAgeSeconds).toBeLessThan(900);

      // The healthy pending row is in the counts but not in the parked list.
      expect(payload.parked).toHaveLength(1);
      expect(payload.parked[0]).toMatchObject({
        reason: 'fill',
        attempts: MAX_ATTEMPTS,
        last_error: 'network down',
        requested_at: NOW - 900,
        // The panel needs the lease to tell a parked row from one whose pull is still running.
        locked_at: NOW - 30,
        address: '1 Parked St, Boston, MA 02135',
        slug: 'parked',
      });
      expect(typeof payload.parked[0].id).toBe('number');

      expect(payload.lastFixture).toBeNull();
    });

    it('orders parked rows oldest request first, breaking ties by id', async () => {
      const db = createRecordsTestDb();
      await insertBuilding(db, { id: 'newer', slug: 'newer', address: '3 Newer St, Boston, MA 02135' });
      await insertBuilding(db, { id: 'older', slug: 'older', address: '4 Older St, Boston, MA 02135' });
      await insertQueueRow(db, { buildingId: 'newer', requestedAt: NOW - 100, attempts: MAX_ATTEMPTS });
      await insertQueueRow(db, { buildingId: 'older', requestedAt: NOW - 900, attempts: MAX_ATTEMPTS });

      const payload = await data<QueuePayload>(await GET(createContext(db, { method: 'GET' })));

      expect(payload.parked.map((row) => row.slug)).toEqual(['older', 'newer']);
    });

    it('parses the stored records_fixture_last setting', async () => {
      const db = createRecordsTestDb();
      const fixture: RecordsQueueFixtureResult = {
        at: NOW,
        failures: 2,
        checksFailed: 1,
        checksTotal: 6,
        failed: ['assessor parcel'],
        sourceErrors: [{ label: '311 requests', message: 'HTTP 500' }],
        rowsBySource: { 'Assessor FY2026': 3 },
      };
      await db
        .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .bind(SETTING_KEYS.fixtureLast, JSON.stringify(fixture), NOW)
        .run();

      const response = await GET(createContext(db, { method: 'GET' }));
      const payload = await data<QueuePayload>(response);

      expect(response.status).toBe(200);
      expect(payload.lastFixture).toEqual(fixture);
    });

    it('reports an unparseable fixture setting as null rather than failing the panel', async () => {
      const db = createRecordsTestDb();
      await db
        .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .bind(SETTING_KEYS.fixtureLast, 'not json', NOW)
        .run();

      const response = await GET(createContext(db, { method: 'GET' }));

      expect(response.status).toBe(200);
      expect((await data<QueuePayload>(response)).lastFixture).toBeNull();
    });

    it('reports a fixture setting in an unrecognized shape as null', async () => {
      const db = createRecordsTestDb();
      await db
        .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .bind(SETTING_KEYS.fixtureLast, JSON.stringify({ at: 'yesterday', failures: 'some' }), NOW)
        .run();

      const response = await GET(createContext(db, { method: 'GET' }));

      expect(response.status).toBe(200);
      expect((await data<QueuePayload>(response)).lastFixture).toBeNull();
    });

    // Half a fixture is worse than none: the panel would render a headline off a row whose
    // lists it cannot read, so every field is checked, not only the two the headline needs.
    it('reports a fixture row whose later fields are the wrong shape as null', async () => {
      const db = createRecordsTestDb();
      await db
        .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .bind(SETTING_KEYS.fixtureLast, JSON.stringify({ at: 1, failures: 0, failed: 'nope' }), NOW)
        .run();

      const response = await GET(createContext(db, { method: 'GET' }));

      expect(response.status).toBe(200);
      expect((await data<QueuePayload>(response)).lastFixture).toBeNull();
    });

    it.each([
      ['checksFailed missing', { at: 1, failures: 0, checksTotal: 0, failed: [], sourceErrors: [], rowsBySource: {} }],
      ['checksTotal missing', { at: 1, failures: 0, checksFailed: 0, failed: [], sourceErrors: [], rowsBySource: {} }],
      [
        'a sourceErrors entry without a message',
        {
          at: 1,
          failures: 1,
          checksFailed: 0,
          checksTotal: 1,
          failed: [],
          sourceErrors: [{ label: 'RentSmart' }],
          rowsBySource: {},
        },
      ],
      [
        'rowsBySource holding something other than numbers',
        {
          at: 1,
          failures: 0,
          checksFailed: 0,
          checksTotal: 1,
          failed: [],
          sourceErrors: [],
          rowsBySource: { RentSmart: 'four' },
        },
      ],
    ])('reports a fixture row with %s as null', async (_label, stored) => {
      const db = createRecordsTestDb();
      await db
        .prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
        .bind(SETTING_KEYS.fixtureLast, JSON.stringify(stored), NOW)
        .run();

      const response = await GET(createContext(db, { method: 'GET' }));

      expect(response.status).toBe(200);
      expect((await data<QueuePayload>(response)).lastFixture).toBeNull();
    });
  });

  describe('POST /api/admin/records/queue/pause', () => {
    it('415s a body that is not application/json', async () => {
      const db = createRecordsTestDb();
      const response = await PAUSE(
        createContext(db, { contentType: 'text/plain', body: JSON.stringify({ paused: true }) }),
      );

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: 'Unsupported Media Type' });
    });

    it('400s a body that is not a JSON object', async () => {
      const db = createRecordsTestDb();

      const broken = await PAUSE(createContext(db, { body: '{ not json' }));
      expect(broken.status).toBe(400);
      expect(await broken.json()).toMatchObject({ error: 'Invalid JSON body' });

      const array = await PAUSE(createContext(db, { body: [1, 2, 3] }));
      expect(array.status).toBe(400);
      expect(await array.json()).toMatchObject({ error: 'Invalid JSON body' });
    });

    it('400s a non-boolean paused value', async () => {
      const db = createRecordsTestDb();
      const response = await PAUSE(createContext(db, { body: { paused: 'yes' } }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'Validation failed' });
    });

    it('round-trips the flag and returns the new stats', async () => {
      const db = createRecordsTestDb();

      const paused = await PAUSE(createContext(db, { body: { paused: true } }));
      expect(paused.status).toBe(200);
      expect((await data<{ stats: RecordsQueueStats }>(paused)).stats.fillPaused).toBe(true);
      const stored = await db
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .bind('records_fill_paused')
        .first<{ value: string }>();
      expect(stored?.value).toBe('1');

      const resumed = await PAUSE(createContext(db, { body: { paused: false } }));
      expect(resumed.status).toBe(200);
      expect((await data<{ stats: RecordsQueueStats }>(resumed)).stats.fillPaused).toBe(false);
    });
  });

  describe('POST /api/admin/records/queue/retry', () => {
    it('415s a body that is not application/json', async () => {
      const db = createRecordsTestDb();
      const response = await RETRY(createContext(db, { contentType: 'text/plain', body: JSON.stringify({ id: 1 }) }));

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: 'Unsupported Media Type' });
    });

    it('400s an id that is not a positive integer', async () => {
      const db = createRecordsTestDb();
      for (const id of ['x', 0, -1, 1.5]) {
        const response = await RETRY(createContext(db, { body: { id } }));
        expect(response.status, `id ${JSON.stringify(id)}`).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'Validation failed' });
      }
    });

    it('clears the attempts, error and lock of a parked row and returns the new stats', async () => {
      const db = createRecordsTestDb();
      await insertBuilding(db, { id: 'parked', slug: 'parked' });
      const id = await insertQueueRow(db, {
        buildingId: 'parked',
        attempts: MAX_ATTEMPTS,
        lastError: 'network down',
      });

      const response = await RETRY(createContext(db, { body: { id } }));
      const payload = await data<{ stats: RecordsQueueStats }>(response);

      expect(response.status).toBe(200);
      expect(payload.stats.parked).toBe(0);
      expect(payload.stats.pendingByReason.fill).toBe(1);

      expect(await readRow(db, id)).toMatchObject({ attempts: 0, last_error: null, locked_at: null, done_at: null });
    });

    it('409s a parked row whose pull is still in flight, and leaves it alone', async () => {
      const db = createRecordsTestDb();
      await insertBuilding(db, { id: 'running', slug: 'running' });
      const id = await insertQueueRow(db, {
        buildingId: 'running',
        attempts: MAX_ATTEMPTS,
        lastError: 'network down',
        lockedAt: NOW - 10,
      });

      const response = await RETRY(createContext(db, { body: { id } }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'That pull is still running; retry after its lease expires' });
      expect(await readRow(db, id)).toMatchObject({
        attempts: MAX_ATTEMPTS,
        last_error: 'network down',
        locked_at: NOW - 10,
      });
    });

    it('retries a parked row whose lease has expired', async () => {
      const db = createRecordsTestDb();
      await insertBuilding(db, { id: 'expired', slug: 'expired' });
      const id = await insertQueueRow(db, {
        buildingId: 'expired',
        attempts: MAX_ATTEMPTS,
        lastError: 'network down',
        lockedAt: NOW - LOCK_TTL_SECONDS - 1,
      });

      const response = await RETRY(createContext(db, { body: { id } }));

      expect(response.status).toBe(200);
      expect(await readRow(db, id)).toMatchObject({ attempts: 0, last_error: null, locked_at: null });
    });

    it('404s an unknown id', async () => {
      const db = createRecordsTestDb();
      const response = await RETRY(createContext(db, { body: { id: 4242 } }));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Queue row not found' });
    });

    it('404s a finished row rather than reopening it', async () => {
      const db = createRecordsTestDb();
      await insertBuilding(db, { id: 'done', slug: 'done' });
      const id = await insertQueueRow(db, {
        buildingId: 'done',
        attempts: MAX_ATTEMPTS,
        lastError: 'network down',
        doneAt: NOW - 5,
      });

      const response = await RETRY(createContext(db, { body: { id } }));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Queue row not found' });
      expect(await readRow(db, id)).toMatchObject({ attempts: MAX_ATTEMPTS, done_at: NOW - 5 });
    });
  });
});
