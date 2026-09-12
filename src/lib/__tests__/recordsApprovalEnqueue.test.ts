import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull, pendingReasons } from './helpers/recordsDb';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { enqueue } from '../records/queue';
import { PATCH } from '../../pages/api/admin/reviews/[id]';

const suite = sqliteAvailable ? describe : describe.skip;

type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

function createContext(db: TestD1Database, reviewId: string, status: ReviewStatus): APIContext {
  const request = new Request(`https://ratemyplace.org/api/admin/reviews/${reviewId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return {
    request,
    params: { id: reviewId },
    locals: { user: { id: 'admin-1', isAdmin: true }, runtime: { env: { DB: db } } },
  } as unknown as APIContext;
}

async function insertPendingReview(db: TestD1Database, id: string, buildingId: string): Promise<string> {
  await db
    .prepare("INSERT INTO reviews (id, user_id, building_id, status) VALUES (?, 'tenant-1', ?, 'pending')")
    .bind(id, buildingId)
    .run();
  return id;
}

async function reviewStatus(db: TestD1Database, reviewId: string): Promise<string | undefined> {
  const row = await db.prepare('SELECT status FROM reviews WHERE id = ?').bind(reviewId).first<{ status: string }>();
  return row?.status;
}

suite('PATCH /api/admin/reviews/[id] enqueues a first records pull on approval', () => {
  let db: TestD1Database;
  let buildingId: string;
  let reviewId: string;

  beforeEach(async () => {
    db = createRecordsTestDb();
    // The notification the approval writes joins reviews -> users, and audit_logs takes the
    // admin's id, so both users are real rows as they are in production.
    await db.prepare("INSERT INTO users (id, email, is_admin) VALUES ('admin-1', 'admin@example.com', 1)").run();
    await db.prepare("INSERT INTO users (id, email) VALUES ('tenant-1', 't@example.com')").run();
    buildingId = await insertBuilding(db, { parcel_id: '2102396000' });
    // The seed wrote an assessor row for every seeded building, so this is what
    // "never pulled" looks like in production: assessor only, nothing deeper.
    await insertPull(db, buildingId, FY2026_RESOURCE_ID);
    reviewId = await insertPendingReview(db, 'rev-1', buildingId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('approves and enqueues a follower row for a never-pulled Boston building', async () => {
    const res = await PATCH(createContext(db, reviewId, 'approved'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await reviewStatus(db, reviewId)).toBe('approved');
    expect(await pendingReasons(db, buildingId)).toEqual(['follower']);
  });

  it('does not enqueue when a deeper pull exists', async () => {
    await insertPull(db, buildingId, PERMITS_RESOURCE_ID);
    await PATCH(createContext(db, reviewId, 'approved'));
    expect(await pendingReasons(db, buildingId)).toEqual([]);
  });

  it('leaves a pending fill row alone', async () => {
    await enqueue(db, { buildingId, reason: 'fill', now: 1_000 });
    await PATCH(createContext(db, reviewId, 'approved'));
    expect(await pendingReasons(db, buildingId)).toEqual(['fill']);
  });

  it('does not enqueue for a building without a parcel', async () => {
    const plain = await insertBuilding(db, { id: 'plain', parcel_id: null });
    const plainReview = await insertPendingReview(db, 'rev-plain', plain);
    const res = await PATCH(createContext(db, plainReview, 'approved'));
    expect(res.status).toBe(200);
    expect(await pendingReasons(db, plain)).toEqual([]);
  });

  it('does not enqueue for a building outside Boston', async () => {
    const elsewhere = await insertBuilding(db, { id: 'nh', city: 'New Haven', state: 'CT', zip_code: '06511', parcel_id: '123456789' });
    const review = await insertPendingReview(db, 'rev-nh', elsewhere);
    const res = await PATCH(createContext(db, review, 'approved'));
    expect(res.status).toBe(200);
    expect(await pendingReasons(db, elsewhere)).toEqual([]);
  });

  it('enqueues nothing when the review is rejected', async () => {
    const res = await PATCH(createContext(db, reviewId, 'rejected'));
    expect(res.status).toBe(200);
    expect(await reviewStatus(db, reviewId)).toBe('rejected');
    expect(await pendingReasons(db, buildingId)).toEqual([]);
  });

  it('enqueues nothing when the review is only flagged or sent back to pending', async () => {
    await PATCH(createContext(db, reviewId, 'flagged'));
    expect(await pendingReasons(db, buildingId)).toEqual([]);
    await PATCH(createContext(db, reviewId, 'pending'));
    expect(await pendingReasons(db, buildingId)).toEqual([]);
  });

  // A moderator re-approving an already-approved review must not stack a second row. The
  // `never_pulled` guard stops it first (the first row reads `requested`), and `enqueue`
  // would refuse an equal-priority row anyway, so this pins the behaviour, not the guard.
  it('a second approval still leaves one pending row', async () => {
    await PATCH(createContext(db, reviewId, 'approved'));
    const res = await PATCH(createContext(db, reviewId, 'approved'));
    expect(res.status).toBe(200);
    expect(await pendingReasons(db, buildingId)).toEqual(['follower']);
  });

  it('a records read or queue failure does not turn a completed approval into an error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dropping the table breaks the coverage read before `enqueue` is even reached, so this
    // covers the whole isolated block rather than the enqueue call alone.
    await db.prepare('DROP TABLE records_queue').run();

    const res = await PATCH(createContext(db, reviewId, 'approved'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await reviewStatus(db, reviewId)).toBe('approved');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logged.mock.calls[0][0] as string)).toMatchObject({
      level: 'error',
      event: 'records_review_approval_enqueue_failed',
      buildingId,
      reviewId,
    });
  });
});
