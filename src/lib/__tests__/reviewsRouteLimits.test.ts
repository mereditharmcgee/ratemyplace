import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeD1, type FakeCall } from './helpers/fakeD1';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { REVIEW_LIMIT_COPY, REVIEW_SUBMIT_PAUSE_SECONDS } from '../reviewLimits';

/**
 * POST /api/reviews writes a review only through the guard in src/lib/reviewLimits.ts: one
 * review per account and building (409), five a rolling day and a pause between submissions
 * (429). These run the real route against every migration. Earlier reviews are seeded
 * relative to D1's clock, never closer than 5 seconds to a boundary.
 */

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) =>
    token === 'good' ? { success: true } : { success: false, error: 'Bot verification failed. Please try again.' },
  ),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

import { queueOwnerNotice } from '../ownerNotify';
import { POST } from '../../pages/api/reviews';

const queued = vi.mocked(queueOwnerNotice);
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  queued.mockClear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The structured logError events written during the test. */
function loggedEvents(): Array<Record<string, unknown>> {
  return consoleError.mock.calls.flatMap((args: unknown[]) => {
    if (typeof args[0] !== 'string') return [];
    try {
      const parsed = JSON.parse(args[0]) as unknown;
      return typeof parsed === 'object' && parsed !== null && 'event' in parsed ? [parsed as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

const suite = sqliteAvailable ? describe : describe.skip;

async function fresh(): Promise<TestD1Database> {
  const db = schemaDb();
  await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'tenant1@example.com'), ('u2', 'tenant2@example.com')").run();
  for (let n = 1; n <= 7; n += 1) {
    await db
      .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES (?, ?, ?, 'Boston', 'MA')")
      .bind(`b${n}`, `${n} Example Rd`, `${n}-example-rd-boston`)
      .run();
  }
  return db;
}

function context(db: unknown, request: Request, userId = 'u1'): APIContext {
  return {
    request,
    params: {},
    locals: { user: { id: userId, emailVerified: true }, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

function post(db: unknown, buildingId: string, options: { userId?: string; token?: string; bedrooms?: string } = {}): Promise<Response> {
  const form = new FormData();
  const fields: Record<string, string> = {
    building_id: buildingId,
    unit_structural: '4',
    'cf-turnstile-response': options.token ?? 'good',
  };
  if (options.bedrooms) fields.bedrooms = options.bedrooms;
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return POST(context(db, new Request('https://ratemyplace.org/api/reviews', { method: 'POST', body: form }), options.userId));
}

async function insertPast(db: TestD1Database, id: string, userId: string, buildingId: string, secondsAgo: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, overall_score, status, created_at)
       VALUES (?, ?, ?, 2022, 'fall', '1br', 3, 'approved', unixepoch() - ?)`,
    )
    .bind(id, userId, buildingId, secondsAgo)
    .run();
}

async function reviewCount(db: TestD1Database): Promise<number> {
  return ((await db.prepare('SELECT COUNT(*) AS n FROM reviews').first<{ n: number }>()) ?? { n: -1 }).n;
}

suite('POST /api/reviews limits', () => {
  it('writes the first review with the legacy body', async () => {
    const db = await fresh();
    const response = await post(db, 'b1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(typeof body.reviewId).toBe('string');
    expect(body.buildingSlug).toBe('1-example-rd-boston');
    expect(body).toHaveProperty('domainScores');
    expect(await reviewCount(db)).toBe(1);
  });

  it('answers a second review of the same building with 409 and the existing review', async () => {
    const db = await fresh();
    const first = (await (await post(db, 'b1')).json()) as { reviewId: string };
    const response = await post(db, 'b1');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: REVIEW_LIMIT_COPY.alreadyReviewed,
      details: { reason: 'already_reviewed', editPath: `/review/edit/${first.reviewId}` },
    });
    expect(await reviewCount(db)).toBe(1);
  });

  it('answers another building right after with 429 submission_pause', async () => {
    const db = await fresh();
    expect((await post(db, 'b1')).status).toBe(200);
    const response = await post(db, 'b2');
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: REVIEW_LIMIT_COPY.tooQuickly, details: { reason: 'submission_pause' } });
    expect(await reviewCount(db)).toBe(1);
  });

  it('writes another building once the pause has passed', async () => {
    const db = await fresh();
    await insertPast(db, 'earlier', 'u1', 'b1', REVIEW_SUBMIT_PAUSE_SECONDS + 5);
    expect((await post(db, 'b2')).status).toBe(200);
  });

  it('answers the sixth review in a day with 429 daily_limit', async () => {
    const db = await fresh();
    for (let n = 1; n <= 5; n += 1) await insertPast(db, `w${n}`, 'u1', `b${n}`, 3_600 + n);
    const response = await post(db, 'b6');
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: REVIEW_LIMIT_COPY.tooQuickly, details: { reason: 'daily_limit' } });
    expect(await reviewCount(db)).toBe(5);
  });

  it('writes exactly one of two simultaneous submissions', async () => {
    const same = await fresh();
    expect((await Promise.all([post(same, 'b1'), post(same, 'b1')])).map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await reviewCount(same)).toBe(1);

    const different = await fresh();
    expect((await Promise.all([post(different, 'b1'), post(different, 'b2')])).map((r) => r.status).sort()).toEqual([200, 429]);
    expect(await reviewCount(different)).toBe(1);
  });

  it('leaves a legacy duplicate pair as stored and points at the newer review', async () => {
    const db = await fresh();
    await insertPast(db, 'old-a', 'u1', 'b7', 400 * 86_400);
    await insertPast(db, 'old-b', 'u1', 'b7', 300 * 86_400);
    const dump = async () => (await db.prepare("SELECT * FROM reviews WHERE building_id = 'b7' ORDER BY id").all()).results;
    const before = await dump();
    const response = await post(db, 'b7');
    expect(response.status).toBe(409);
    expect(((await response.json()) as { details: { editPath: string } }).details.editPath).toBe('/review/edit/old-b');
    expect(await dump()).toEqual(before);
  });

  it('queues the owner notice once on a write and never on a refusal', async () => {
    const db = await fresh();
    expect((await post(db, 'b1')).status).toBe(200);
    expect(queued).toHaveBeenCalledTimes(1);
    expect((await post(db, 'b1')).status).toBe(409);
    expect((await post(db, 'b2')).status).toBe(429);
    expect(queued).toHaveBeenCalledTimes(1);
  });

  it('refuses a failed Turnstile check before the guard runs', async () => {
    const db = await fresh();
    expect((await post(db, 'b1', { token: 'bad' })).status).toBe(400);
    expect(await reviewCount(db)).toBe(0);
  });

  it('answers a refusal it cannot name with the generic 500 and logs no ids', async () => {
    const db = await fresh();
    // An insert that reports no change and writes nothing, with nothing in the way.
    const silent = {
      prepare(sql: string) {
        if (!sql.trim().startsWith('INSERT INTO reviews')) return db.prepare(sql);
        return { bind: () => ({ run: async () => ({ success: true, meta: { changes: 0 } }) }) };
      },
      batch: (statements: Parameters<TestD1Database['batch']>[0]) => db.batch(statements),
    };
    const response = await post(silent, 'b1');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to submit review' });
    expect(await reviewCount(db)).toBe(0);
    const events = loggedEvents().filter((event) => event.event === 'review_create_unclassified');
    expect(events).toHaveLength(1);
    for (const key of ['user_id', 'userId', 'building_id', 'buildingId']) expect(events[0]).not.toHaveProperty(key);
    expect(queued).not.toHaveBeenCalled();
  });
});

describe('POST /api/reviews guarded insert binds', () => {
  it('appends the guard binds after the review values, under D1 limit of 100', async () => {
    const { db, calls } = fakeD1((call: FakeCall) => {
      if (call.sql.includes('SELECT id, slug FROM buildings')) return { id: 'b1', slug: 'b1-slug' };
      return undefined;
    });
    expect((await post(db, 'b1', { bedrooms: '2' })).status).toBe(200);
    const insert = calls.find((call) => call.sql.trim().startsWith('INSERT INTO reviews'));
    if (!insert) throw new Error('no review insert');
    expect(insert.binds).toHaveLength(71);
    expect(insert.binds.length).toBeLessThanOrEqual(100);
    // The positions reviewsRouteUnitType.test.ts reads: unit_type 6, bedrooms 8.
    expect(insert.binds[6]).toBe('2br');
    expect(insert.binds[8]).toBe('2');
    expect(insert.sql).toContain('SELECT');
    expect(insert.sql).not.toContain('VALUES');
  });
});
