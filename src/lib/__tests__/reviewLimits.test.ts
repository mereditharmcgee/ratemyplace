import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import {
  REVIEW_DAILY_LIMIT,
  REVIEW_DAILY_WINDOW_SECONDS,
  REVIEW_GUARD_SQL,
  REVIEW_LIMIT_COPY,
  REVIEW_SUBMIT_PAUSE_SECONDS,
  classifyReviewRefusal,
  ownReviewOfBuilding,
  reviewEditPath,
  reviewGuardBinds,
  reviewInserted,
  reviewRefusalResponse,
  type ReviewRefusal,
} from '../reviewLimits';
import { SUBMITTED_NO_LINK_COPY } from '../reviewSubmitOutcome';

/**
 * The guard is three predicates of the statement that writes a review: no review of this
 * building by this account, fewer than REVIEW_DAILY_LIMIT of its reviews in the rolling
 * window, none inside the pause. These run it against every migration. Earlier reviews are
 * seeded relative to D1's own clock (`unixepoch() - N`) and never closer than 5 seconds to a
 * boundary, so the test cannot race the clock.
 */

const suite = sqliteAvailable ? describe : describe.skip;

async function seed(db: TestD1Database): Promise<void> {
  await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'tenant1@example.com'), ('u2', 'tenant2@example.com')").run();
  for (let n = 1; n <= 8; n += 1) {
    await db
      .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES (?, ?, ?, 'Boston', 'MA')")
      .bind(`b${n}`, `${n} Example Rd`, `${n}-example-rd-boston`)
      .run();
  }
}

async function fresh(): Promise<TestD1Database> {
  const db = schemaDb();
  await seed(db);
  return db;
}

/** Writes one review through the guard, the way the route does; answers what happened. */
async function create(db: TestD1Database, id: string, userId: string, buildingId: string): Promise<string> {
  const result = await db
    .prepare(
      `INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, overall_score, status)
       SELECT ?, ?, ?, 2024, 'fall', '1br', 4, 'pending' WHERE ${REVIEW_GUARD_SQL}`,
    )
    .bind(id, userId, buildingId, ...reviewGuardBinds(userId, buildingId))
    .run();
  if (reviewInserted(result)) return 'ok';
  const refusal = await classifyReviewRefusal(db, userId, buildingId);
  return refusal.reason === 'already_reviewed' ? `already_reviewed:${refusal.reviewId}` : refusal.reason;
}

/** An earlier review, written directly, `secondsAgo` before D1's now. */
async function insertPast(
  db: TestD1Database,
  id: string,
  userId: string,
  buildingId: string,
  secondsAgo: number,
  status: 'approved' | 'rejected' = 'approved',
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, overall_score, status, created_at)
       VALUES (?, ?, ?, 2022, 'fall', '1br', 3, ?, unixepoch() - ?)`,
    )
    .bind(id, userId, buildingId, status, secondsAgo)
    .run();
}

async function reviewCount(db: TestD1Database): Promise<number> {
  return ((await db.prepare('SELECT COUNT(*) AS n FROM reviews').first<{ n: number }>()) ?? { n: -1 }).n;
}

/** Five earlier reviews by u1 on b1 to b5, inside the window and past the pause. */
async function fillWindow(db: TestD1Database, secondsAgo = 3_600, status: 'approved' | 'rejected' = 'approved'): Promise<void> {
  for (let n = 1; n <= 5; n += 1) await insertPast(db, `w${n}`, 'u1', `b${n}`, secondsAgo + n - 1, status);
}

suite('review guard: one review per account and building', () => {
  it('writes the first review and refuses a second of the same building', async () => {
    const db = await fresh();
    expect(await create(db, 'r1', 'u1', 'b1')).toBe('ok');
    expect(await create(db, 'r2', 'u1', 'b1')).toBe('already_reviewed:r1');
    expect(await reviewCount(db)).toBe(1);
  });

  it('lets another account review the same building', async () => {
    const db = await fresh();
    expect(await create(db, 'r1', 'u1', 'b1')).toBe('ok');
    expect(await create(db, 'r2', 'u2', 'b1')).toBe('ok');
  });

  it('leaves a legacy duplicate pair exactly as stored and points at the newer one', async () => {
    const db = await fresh();
    await insertPast(db, 'old-a', 'u2', 'b7', 400 * 86_400);
    await insertPast(db, 'old-b', 'u2', 'b7', 300 * 86_400);
    const dump = async () => (await db.prepare("SELECT * FROM reviews WHERE building_id = 'b7' ORDER BY id").all()).results;
    const before = await dump();
    expect(await create(db, 'r9', 'u2', 'b7')).toBe('already_reviewed:old-b');
    expect(await dump()).toEqual(before);
  });
});

suite('review guard: the pause between submissions', () => {
  it('refuses another building inside the pause', async () => {
    const db = await fresh();
    await insertPast(db, 'p1', 'u1', 'b1', REVIEW_SUBMIT_PAUSE_SECONDS - 5);
    expect(await create(db, 'r1', 'u1', 'b2')).toBe('submission_pause');
  });

  it('allows another building once the pause has passed', async () => {
    const db = await fresh();
    await insertPast(db, 'p1', 'u1', 'b1', REVIEW_SUBMIT_PAUSE_SECONDS + 5);
    expect(await create(db, 'r1', 'u1', 'b2')).toBe('ok');
  });
});

suite('review guard: the daily limit', () => {
  it(`refuses the review after ${REVIEW_DAILY_LIMIT} in the window`, async () => {
    const db = await fresh();
    await fillWindow(db);
    expect(await create(db, 'r6', 'u1', 'b6')).toBe('daily_limit');
  });

  it('does not count a review older than the window', async () => {
    const db = await fresh();
    for (let n = 1; n <= 4; n += 1) await insertPast(db, `w${n}`, 'u1', `b${n}`, 3_600 + n);
    await insertPast(db, 'w5', 'u1', 'b5', REVIEW_DAILY_WINDOW_SECONDS + 5);
    expect(await create(db, 'r6', 'u1', 'b6')).toBe('ok');
  });

  it('holds at the edge of the window from both sides', async () => {
    const inside = await fresh();
    await fillWindow(inside, REVIEW_DAILY_WINDOW_SECONDS - 30);
    expect(await create(inside, 'r6', 'u1', 'b6')).toBe('daily_limit');

    const outside = await fresh();
    await fillWindow(outside, REVIEW_DAILY_WINDOW_SECONDS + 5);
    expect(await create(outside, 'r6', 'u1', 'b6')).toBe('ok');
  });

  it('counts rejected reviews: a rejected review was still a submission', async () => {
    const db = await fresh();
    await fillWindow(db, 3_600, 'rejected');
    expect(await create(db, 'r6', 'u1', 'b6')).toBe('daily_limit');
  });
});

suite('review guard: which refusal wins', () => {
  it('names the existing review before the daily limit', async () => {
    const db = await fresh();
    await fillWindow(db);
    expect(await create(db, 'r1', 'u1', 'b1')).toBe('already_reviewed:w1');
  });

  it('names the daily limit before the pause', async () => {
    const db = await fresh();
    await fillWindow(db);
    await insertPast(db, 'p1', 'u1', 'b6', 10);
    expect(await create(db, 'r7', 'u1', 'b7')).toBe('daily_limit');
  });

  it('answers unknown when nothing is in the way', async () => {
    const db = await fresh();
    expect(await classifyReviewRefusal(db, 'u1', 'b1')).toEqual({ reason: 'unknown' });
  });
});

suite('review guard: concurrent submissions', () => {
  it('writes exactly one of two simultaneous reviews of one building', async () => {
    const db = await fresh();
    const outcomes = await Promise.all([create(db, 'ra', 'u1', 'b1'), create(db, 'rb', 'u1', 'b1')]);
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o.startsWith('already_reviewed:'))).toHaveLength(1);
    expect(await reviewCount(db)).toBe(1);
  });

  it('writes exactly one of two simultaneous reviews of different buildings', async () => {
    const db = await fresh();
    const outcomes = await Promise.all([create(db, 'ra', 'u1', 'b1'), create(db, 'rb', 'u1', 'b2')]);
    expect([...outcomes].sort()).toEqual(['ok', 'submission_pause']);
    expect(await reviewCount(db)).toBe(1);
  });
});

suite('ownReviewOfBuilding', () => {
  it('is null with no review, the id with one, and the newer of a legacy pair', async () => {
    const db = await fresh();
    expect(await ownReviewOfBuilding(db, 'u1', 'b1')).toBeNull();
    await insertPast(db, 'one', 'u1', 'b1', 3_600);
    expect(await ownReviewOfBuilding(db, 'u1', 'b1')).toBe('one');
    await insertPast(db, 'old-a', 'u1', 'b2', 400 * 86_400);
    await insertPast(db, 'old-b', 'u1', 'b2', 300 * 86_400);
    expect(await ownReviewOfBuilding(db, 'u1', 'b2')).toBe('old-b');
  });

  it("ignores another account's review of the building", async () => {
    const db = await fresh();
    await insertPast(db, 'theirs', 'u2', 'b1', 3_600);
    expect(await ownReviewOfBuilding(db, 'u1', 'b1')).toBeNull();
  });
});

describe('review guard source', () => {
  it('binds every number and has no trigger', () => {
    const placeholders = REVIEW_GUARD_SQL.match(/\?/g) ?? [];
    expect(placeholders).toHaveLength(reviewGuardBinds('u', 'b').length);
    expect(placeholders).toHaveLength(7);
    expect(reviewGuardBinds('u', 'b')).toEqual([
      'u', 'b', 'u', REVIEW_DAILY_WINDOW_SECONDS, REVIEW_DAILY_LIMIT, 'u', REVIEW_SUBMIT_PAUSE_SECONDS,
    ]);
    expect(REVIEW_GUARD_SQL).not.toMatch(/TRIGGER/i);
    expect(REVIEW_GUARD_SQL).not.toMatch(/\b(5|60|86400|86_400)\b/);
  });

  it('reads an insert as written only when exactly one row changed', () => {
    expect(reviewInserted({ meta: { changes: 1 } })).toBe(true);
    expect(reviewInserted({ meta: { changes: 0 } })).toBe(false);
    expect(reviewInserted({})).toBe(false);
    expect(reviewInserted(null)).toBe(false);
    expect(reviewInserted(undefined)).toBe(false);
  });

  it('encodes the review id in the edit path', () => {
    expect(reviewEditPath('a/b')).toBe('/review/edit/a%2Fb');
  });
});

describe('review refusal responses', () => {
  const cases: Array<[string, ReviewRefusal, number, unknown]> = [
    [
      'already_reviewed',
      { reason: 'already_reviewed', reviewId: 'r1' },
      409,
      { error: REVIEW_LIMIT_COPY.alreadyReviewed, details: { reason: 'already_reviewed', editPath: '/review/edit/r1' } },
    ],
    ['daily_limit', { reason: 'daily_limit' }, 429, { error: REVIEW_LIMIT_COPY.tooQuickly, details: { reason: 'daily_limit' } }],
    [
      'submission_pause',
      { reason: 'submission_pause' },
      429,
      { error: REVIEW_LIMIT_COPY.tooQuickly, details: { reason: 'submission_pause' } },
    ],
    ['unknown', { reason: 'unknown' }, 500, { error: 'Failed to submit review' }],
  ];

  it.each(cases)('%s', async (_name, refusal, status, body) => {
    const response = reviewRefusalResponse(refusal);
    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual(body);
    // No column, table or SQL reaches the client.
    for (const leak of ['user_id', 'building_id', 'created_at', 'SELECT', 'FROM reviews']) expect(text).not.toContain(leak);
  });
});

describe('review limit copy', () => {
  it('has no em dash and no exclamation point', () => {
    const EM_DASH = String.fromCharCode(0x2014);
    const EXCLAMATION = String.fromCharCode(0x21);
    for (const value of Object.values(REVIEW_LIMIT_COPY)) {
      expect(value).not.toBe('');
      expect(value).not.toContain(EM_DASH);
      expect(value).not.toContain(EXCLAMATION);
    }
  });

  it('reuses the strings the site already shows', () => {
    const SECOND_SENTENCE = 'You can find it on your profile.';
    expect(REVIEW_LIMIT_COPY.alreadyReviewed.endsWith(` ${SECOND_SENTENCE}`)).toBe(true);
    expect(SUBMITTED_NO_LINK_COPY.endsWith(` ${SECOND_SENTENCE}`)).toBe(true);

    // The hourly limiter's line, so the two cannot drift.
    const route = readFileSync(join(process.cwd(), 'src/pages/api/reviews.ts'), 'utf8');
    expect(route).toContain(`'${REVIEW_LIMIT_COPY.tooQuickly}'`);

    // The edit page's heading.
    expect(REVIEW_LIMIT_COPY.editLink).toBe('Edit Review');
    const editPage = readFileSync(join(process.cwd(), 'src/pages/review/edit/[id].astro'), 'utf8');
    expect(editPage).toContain(`>${REVIEW_LIMIT_COPY.editLink}</h1>`);
  });
});
