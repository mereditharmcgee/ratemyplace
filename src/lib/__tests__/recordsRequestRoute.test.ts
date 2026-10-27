import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull, pendingReasons } from './helpers/recordsDb';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { MAX_ATTEMPTS, completeRow, enqueue, planRefresh } from '../records/queue';
import { DEEPER_SOURCE_IDS, recordsRequestState } from '../records/coverage';
import { REFRESH_BUTTON_LABEL, REQUEST_BUTTON_LABEL } from '../records/display';
import {
  REQUEST_CAP_WINDOW_SECONDS,
  REQUEST_DAILY_CAP,
  REQUEST_PER_IP,
  buttonRequestsSince,
} from '../records/request';
import type { RecordsDb } from '../records/types';

// Mock Turnstile BEFORE importing the route so it picks up the mock instead of making a
// real network call. Token 'good' succeeds; anything else fails.
vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) =>
    token === 'good'
      ? { success: true }
      : { success: false, error: 'Bot verification failed. Please try again.' }),
}));

import { POST } from '../../pages/api/records/request';

const suite = sqliteAvailable ? describe : describe.skip;

interface ContextOptions {
  ip?: string;
  body?: unknown;
  contentType?: string | null;
}

function createContext(db: TestD1Database, options: ContextOptions = {}): APIContext {
  const { ip = '203.0.113.10', body, contentType = 'application/json' } = options;
  const headers: Record<string, string> = { 'CF-Connecting-IP': ip };
  if (contentType !== null) headers['Content-Type'] = contentType;
  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const request = new Request('https://ratemyplace.org/api/records/request', init);
  return {
    request,
    locals: { user: null, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

/** Enqueue exactly the cap's worth of button rows, timestamped now, on other buildings. */
async function fillDailyCap(db: TestD1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < REQUEST_DAILY_CAP; i += 1) {
    const other = await insertBuilding(db, {
      id: `cap-${i}`,
      parcel_id: `21023960${String(i).padStart(2, '0')}`,
    });
    await enqueue(db, { buildingId: other, reason: 'button', now });
  }
}

suite('POST /api/records/request', () => {
  let db: TestD1Database;
  let id: string;
  const good = (buildingId: string) => ({ buildingId, turnstileToken: 'good' });

  beforeEach(async () => {
    db = createRecordsTestDb();
    id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
  });
  afterEach(() => vi.clearAllMocks());

  it('415 on a non-JSON content type, before anything else', async () => {
    const res = await POST(createContext(db, { contentType: 'text/plain', body: 'x' }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Unsupported Media Type' });
    // "Before anything else" means the rate limiter never ran either.
    expect(((await db.prepare('SELECT COUNT(*) AS n FROM rate_limits').first<{ n: number }>()) ?? { n: 0 }).n).toBe(0);
  });

  it('429 after three requests from one IP in an hour', async () => {
    for (let i = 0; i < REQUEST_PER_IP; i += 1) await POST(createContext(db, { body: good(id) }));
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too many requests. Please try again later.' });
    expect(res.headers.get('Retry-After')).not.toBeNull();
  });

  it('400 on a body that is not an object', async () => {
    const res = await POST(createContext(db, { body: 'null' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Validation failed',
      details: [{ field: 'buildingId', message: 'Building is required.' }],
    });
  });

  it('400 on a body that is not JSON at all, with no log line', async () => {
    // `{` with a JSON content type used to throw SyntaxError into the generic catch: a 500
    // and a logError line per attempt, for what is a client error and nothing of ours.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(createContext(db, { body: '{' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Validation failed',
        details: [{ field: 'body', message: 'Request body must be JSON.' }],
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('a malformed body still consumes a per-IP slot', async () => {
    for (let i = 0; i < REQUEST_PER_IP; i += 1) {
      const rejected = await POST(createContext(db, { body: 'null' }));
      expect(rejected.status).toBe(400);
    }
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too many requests. Please try again later.' });
  });

  it('429 with its own message once 300 button rows were created in the last 24 hours', async () => {
    await fillDailyCap(db);
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: 'The daily limit for city-records requests has been reached. Please try again later.',
    });
    // Retry-After is when the oldest counted row leaves the window — the rows above were
    // enqueued with `now`, so that is a positive number of seconds no larger than the window.
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(REQUEST_CAP_WINDOW_SECONDS);
    // The per-IP headers would have claimed remaining presses on a refusal.
    expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
  });

  it('the daily cap is checked before Turnstile', async () => {
    await fillDailyCap(db);
    const res = await POST(createContext(db, { body: { buildingId: id, turnstileToken: 'bad' } }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: 'The daily limit for city-records requests has been reached. Please try again later.',
    });
    expect(await pendingReasons(db, id)).toEqual([]);
  });

  it('Turnstile is checked before field validation', async () => {
    const res = await POST(createContext(db, { body: { turnstileToken: 'bad' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bot verification failed. Please try again.' });
  });

  it('400 on a failed Turnstile check', async () => {
    const res = await POST(createContext(db, { body: { buildingId: id, turnstileToken: 'bad' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bot verification failed. Please try again.' });
  });

  it('400 when buildingId is missing', async () => {
    const res = await POST(createContext(db, { body: { turnstileToken: 'good' } }));
    expect(res.status).toBe(400);
  });

  it('404 for an unknown, non-Boston, or parcel-less building', async () => {
    const noParcel = await insertBuilding(db, { id: 'np', parcel_id: null });
    const ct = await insertBuilding(db, { id: 'ct', city: 'New Haven', state: 'CT', parcel_id: '123456789' });
    for (const target of ['nope', noParcel, ct]) {
      const res = await POST(createContext(db, { body: good(target) }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Building not found' });
    }
  });

  it('409 when a deeper pull already exists', async () => {
    await insertPull(db, id, PERMITS_RESOURCE_ID);
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'City records for this building have already been retrieved.',
    });
    expect(await pendingReasons(db, id)).toEqual([]);
  });

  it('202 queued, then 202 already_queued on a second press, with one pending row', async () => {
    const first = await POST(createContext(db, { body: good(id) }));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ data: { status: 'queued' } });
    expect(first.headers.get('X-RateLimit-Limit')).toBe(String(REQUEST_PER_IP));

    const second = await POST(createContext(db, { body: good(id) }));
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ data: { status: 'already_queued' } });
    expect(await pendingReasons(db, id)).toEqual(['button']);
  });

  it('replaces a pending fill row with a button row', async () => {
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ data: { status: 'queued' } });
    expect(await pendingReasons(db, id)).toEqual(['button']);
  });

  // `parked` is a page state, not a refusal: the panel stops offering the button, but a
  // press that arrives anyway (a stale page, a direct POST) must not 404 or 409. It falls
  // through to `enqueue` exactly as `requested` does.
  it('a parked pending row answers 202 already_queued rather than 404 or 409', async () => {
    await enqueue(db, { buildingId: id, reason: 'button', now: 1_000 });
    await db
      .prepare('UPDATE records_queue SET attempts = ? WHERE building_id = ? AND done_at IS NULL')
      .bind(MAX_ATTEMPTS, id)
      .run();
    expect(await recordsRequestState(db, id)).toBe('parked');

    const res = await POST(createContext(db, { body: good(id) }));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ data: { status: 'already_queued' } });
    expect(await pendingReasons(db, id)).toEqual(['button']);
  });
});

/**
 * "Ask for newer records": the same route on a building whose deeper records are in. It may
 * queue one `button` row once the newest deeper pull is more than 30 days old, and nothing
 * else: one pending row per building, the same daily cap, no pull inside the request.
 */
suite('POST /api/records/request on a building whose records are in', () => {
  const DAY = 86_400;
  let db: TestD1Database;
  let id: string;
  const good = (buildingId: string) => ({ buildingId, turnstileToken: 'good' });

  /** Moves every pull row for the building back by `days`, as time passing would. */
  async function agePulls(days: number): Promise<void> {
    await db
      .prepare('UPDATE record_pulls SET retrieved_at = retrieved_at - ? WHERE building_id = ?')
      .bind(days * DAY, id)
      .run();
  }

  async function count(sql: string): Promise<number> {
    return (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  }

  beforeEach(async () => {
    db = createRecordsTestDb();
    id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
    await insertPull(db, id, PERMITS_RESOURCE_ID);
  });
  afterEach(() => vi.clearAllMocks());

  it('409 while the newest deeper pull is 30 days old or less, with no row written', async () => {
    for (const days of [0, 29]) {
      if (days) await agePulls(days);
      const res = await POST(createContext(db, { ip: `203.0.113.${20 + days}`, body: good(id) }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'City records for this building have already been retrieved.' });
    }
    expect(await count('SELECT COUNT(*) AS n FROM records_queue')).toBe(0);
  });

  it('202 queued once the pull is older than 30 days, then already_queued, with one button row', async () => {
    await agePulls(45);
    expect(await recordsRequestState(db, id)).toBe('stale');

    const first = await POST(createContext(db, { body: good(id) }));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ data: { status: 'queued' } });
    expect(await recordsRequestState(db, id)).toBe('refresh_requested');

    // A second press, and one from another address, find the row and add nothing.
    for (const ip of ['203.0.113.10', '198.51.100.7']) {
      const again = await POST(createContext(db, { ip, body: good(id) }));
      expect(again.status).toBe(202);
      expect(await again.json()).toEqual({ data: { status: 'already_queued' } });
    }
    expect(await pendingReasons(db, id)).toEqual(['button']);
    expect(await count('SELECT COUNT(*) AS n FROM records_queue')).toBe(1);
  });

  it('never pulls inside the request: no pull row and no record row is written', async () => {
    await agePulls(45);
    const pulls = await count('SELECT COUNT(*) AS n FROM record_pulls');
    const records = await count('SELECT COUNT(*) AS n FROM building_records');

    const res = await POST(createContext(db, { body: good(id) }));

    expect(res.status).toBe(202);
    expect(await count('SELECT COUNT(*) AS n FROM record_pulls')).toBe(pulls);
    expect(await count('SELECT COUNT(*) AS n FROM building_records')).toBe(records);
  });

  it('spends one slot of the same daily cap, and is refused once the cap is reached', async () => {
    await agePulls(45);
    const since = Math.floor(Date.now() / 1000) - REQUEST_CAP_WINDOW_SECONDS;
    expect((await buttonRequestsSince(db, since)).count).toBe(0);
    await POST(createContext(db, { body: good(id) }));
    expect((await buttonRequestsSince(db, since)).count).toBe(1);

    const other = await insertBuilding(db, { id: 'other', parcel_id: '2102396999' });
    await insertPull(db, other, PERMITS_RESOURCE_ID, 'ok', Math.floor(Date.now() / 1000) - 45 * DAY);
    await fillDailyCap(db);
    const res = await POST(createContext(db, { ip: '198.51.100.8', body: good(other) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: 'The daily limit for city-records requests has been reached. Please try again later.',
    });
    expect(await pendingReasons(db, other)).toEqual([]);
  });

  it('answers already_queued with no write against a pending planner refresh row', async () => {
    await agePulls(45);
    await enqueue(db, { buildingId: id, reason: 'refresh', now: Math.floor(Date.now() / 1000) });

    const res = await POST(createContext(db, { body: good(id) }));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ data: { status: 'already_queued' } });
    // Still the planner's row: not replaced by a button row, and no cap slot spent.
    expect(await pendingReasons(db, id)).toEqual(['refresh']);
    expect(await count("SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'button'")).toBe(0);
  });

  it('replaces a pending fill row on an old pull with a button row', async () => {
    await agePulls(45);
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });

    const res = await POST(createContext(db, { body: good(id) }));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ data: { status: 'queued' } });
    expect(await pendingReasons(db, id)).toEqual(['button']);
  });

  it('puts the building on the monthly refresh cycle once the queued pull finishes', async () => {
    const now = Math.floor(Date.now() / 1000);
    const plan = (at: number) => planRefresh(db, { now: at, deeperSourceIds: DEEPER_SOURCE_IDS });
    await agePulls(45);
    // No review, no follower, no earlier press: the monthly cycle does not know this building.
    expect(await plan(now)).toBe(0);

    await POST(createContext(db, { body: good(id) }));
    // What the Worker does with the row: the pull writes fresh rows, then the row completes.
    const row = await db
      .prepare('SELECT id FROM records_queue WHERE building_id = ? AND done_at IS NULL')
      .bind(id)
      .first<{ id: number }>();
    await db.prepare('UPDATE record_pulls SET retrieved_at = ? WHERE building_id = ?').bind(now, id).run();
    await completeRow(db, row!.id, now);
    expect(await recordsRequestState(db, id, now)).toBe('pulled');

    expect(await plan(now)).toBe(0);
    expect(await plan(now + 31 * DAY)).toBe(1);
    expect(await pendingReasons(db, id)).toEqual(['refresh']);
  });
});

/** The public pages that describe the button name both of its labels and the refresh rule. */
describe('public copy about the records button', () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('the privacy page names both labels', () => {
    const privacy = read('src/pages/privacy.astro');
    expect(privacy).toContain(`"${REQUEST_BUTTON_LABEL}"`);
    expect(privacy).toContain(`"${REFRESH_BUTTON_LABEL}"`);
  });

  it('the methodology page says a reader request puts a building on the monthly cycle', () => {
    const methodology = read('src/pages/methodology.astro');
    expect(methodology).toContain("a reader's request for newer records, which puts it on the monthly cycle above");
    expect(methodology).toContain('once a building\'s records are more than 30 days old');
  });
});

/**
 * The daily cap runs on every unauthenticated press, and button rows are never purged, so
 * the count behind it is the one read in this route that grows without bound. Migration
 * 0033 is the index that keeps it a range seek. `EXPLAIN QUERY PLAN` over the statement the
 * module actually prepares, in the style of `recordsQueuePlanner.test.ts`, so a rewrite of
 * the query cannot leave this test passing about the old one.
 */
suite('migration 0033 covers the daily-cap count', () => {
  it('creates idx_records_queue_reason_requested', async () => {
    const db = createRecordsTestDb();
    const row = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_records_queue_reason_requested'")
      .first<{ name: string }>();
    expect(row?.name).toBe('idx_records_queue_reason_requested');
  });

  it('answers the cap count from that index rather than a table scan', async () => {
    const db = createRecordsTestDb();
    let captured: { sql: string; values: unknown[] } | null = null;
    const capturing = {
      prepare(sql: string) {
        const inner = db.prepare(sql);
        const self = {
          bind(...values: unknown[]) {
            captured = { sql, values };
            inner.bind(...(values as never[]));
            return self;
          },
          first: <T>() => inner.first<T>(),
          all: <T>() => inner.all<T>(),
          run: () => inner.run(),
        };
        return self;
      },
      batch: (statements: unknown[]) => db.batch(statements as never),
    } as unknown as RecordsDb;

    await buttonRequestsSince(capturing, 1_000);
    if (!captured) throw new Error('buttonRequestsSince prepared no statement');
    const call: { sql: string; values: unknown[] } = captured;

    const plan = await db
      .prepare(`EXPLAIN QUERY PLAN ${call.sql}`)
      .bind(...(call.values as never[]))
      .all<{ detail: string }>();
    const detail = plan.results.map((r) => r.detail).join('\n');

    expect(detail).toContain('idx_records_queue_reason_requested');
    expect(detail).not.toContain('SCAN records_queue');
  });
});
