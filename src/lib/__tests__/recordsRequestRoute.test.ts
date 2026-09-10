import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { enqueue } from '../records/queue';
import { REQUEST_CAP_WINDOW_SECONDS, REQUEST_DAILY_CAP, REQUEST_PER_IP } from '../records/request';

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

async function insertPull(db: TestD1Database, buildingId: string, sourceId: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, ' +
        "row_count, error_message, triggered_by, correction_id, trigger_reason) " +
        "VALUES (?, ?, 'boston', ?, 'label', 'q', 'ok', 0, NULL, NULL, NULL, 'seed')",
    )
    .bind(`${buildingId}-${sourceId}`, buildingId, sourceId)
    .run();
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

async function pendingRows(db: TestD1Database, buildingId: string): Promise<Array<{ reason: string }>> {
  const { results } = await db
    .prepare('SELECT reason FROM records_queue WHERE building_id = ? AND done_at IS NULL')
    .bind(buildingId)
    .all<{ reason: string }>();
  return results;
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

  it('a malformed body still consumes a per-IP slot', async () => {
    for (let i = 0; i < REQUEST_PER_IP; i += 1) {
      const rejected = await POST(createContext(db, { body: 'null' }));
      expect(rejected.status).toBe(400);
    }
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too many requests. Please try again later.' });
  });

  it('429 with its own message once 300 button rows were created today', async () => {
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
    expect(await pendingRows(db, id)).toEqual([]);
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
    expect(await pendingRows(db, id)).toEqual([]);
  });

  it('202 queued, then 202 already_queued on a second press, with one pending row', async () => {
    const first = await POST(createContext(db, { body: good(id) }));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ data: { status: 'queued' } });
    expect(first.headers.get('X-RateLimit-Limit')).toBe(String(REQUEST_PER_IP));

    const second = await POST(createContext(db, { body: good(id) }));
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ data: { status: 'already_queued' } });
    expect(await pendingRows(db, id)).toEqual([{ reason: 'button' }]);
  });

  it('replaces a pending fill row with a button row', async () => {
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ data: { status: 'queued' } });
    expect(await pendingRows(db, id)).toEqual([{ reason: 'button' }]);
  });
});
