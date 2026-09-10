import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull, pendingReasons } from './helpers/recordsDb';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { enqueue } from '../records/queue';
import { POST } from '../../pages/api/buildings/[id]/save';

const suite = sqliteAvailable ? describe : describe.skip;

function createContext(db: TestD1Database, buildingId: string, userId: string | null = 'user-1'): APIContext {
  const request = new Request(`https://ratemyplace.org/api/buildings/${buildingId}/save`, { method: 'POST' });
  return {
    request,
    params: { id: buildingId },
    locals: { user: userId ? { id: userId } : null, runtime: { env: { DB: db } } },
  } as unknown as APIContext;
}

async function savedCount(db: TestD1Database, buildingId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM saved_buildings WHERE building_id = ?')
    .bind(buildingId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

suite('POST /api/buildings/[id]/save enqueues a follower pull', () => {
  let db: TestD1Database;
  let id: string;

  beforeEach(async () => {
    db = createRecordsTestDb();
    // saved_buildings.user_id is a real FK to users(id), enforced by node:sqlite as by D1.
    await db.prepare("INSERT INTO users (id, email) VALUES ('user-1', 'u@example.com')").run();
    id = await insertBuilding(db, { parcel_id: '2102396000' });
    // The seed wrote an assessor row for every seeded building, so this is what
    // "never pulled" looks like in production: assessor only, nothing deeper.
    await insertPull(db, id, FY2026_RESOURCE_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves and enqueues a follower row for a never-pulled Boston building', async () => {
    const res = await POST(createContext(db, id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(await pendingReasons(db, id)).toEqual(['follower']);
  });

  it('does not enqueue when a deeper pull exists', async () => {
    await insertPull(db, id, PERMITS_RESOURCE_ID);
    await POST(createContext(db, id));
    expect(await pendingReasons(db, id)).toEqual([]);
  });

  it('leaves a pending fill row alone', async () => {
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    await POST(createContext(db, id));
    expect(await pendingReasons(db, id)).toEqual(['fill']);
  });

  it("another requester's pending row is respected", async () => {
    await db.prepare("INSERT INTO users (id, email) VALUES ('user-2', 'u2@example.com')").run();
    await enqueue(db, { buildingId: id, reason: 'button', now: 1_000 });
    const res = await POST(createContext(db, id, 'user-2'));
    expect(res.status).toBe(200);
    expect(await pendingReasons(db, id)).toEqual(['button']);
  });

  // Priority-sensitive where the case above is not: follower (0) outranks refresh (1), so
  // `enqueue` on its own would replace this row. What keeps it is the save path's guard —
  // it enqueues only from `never_pulled`, and a pending refresh row reads `requested`.
  it('does not promote a pending refresh row to a follower', async () => {
    await enqueue(db, { buildingId: id, reason: 'refresh', now: 1_000 });
    const res = await POST(createContext(db, id));
    expect(res.status).toBe(200);
    expect(await pendingReasons(db, id)).toEqual(['refresh']);
  });

  it('a second save is idempotent and still leaves one pending row', async () => {
    await POST(createContext(db, id));
    const res = await POST(createContext(db, id));
    expect(res.status).toBe(200);
    expect(await pendingReasons(db, id)).toEqual(['follower']);
  });

  it('does not enqueue for a building without a parcel', async () => {
    const other = await insertBuilding(db, { id: 'plain', parcel_id: null });
    await POST(createContext(db, other));
    expect(await pendingReasons(db, other)).toEqual([]);
  });

  it('still 401s without a session and 404s for an unknown building', async () => {
    expect((await POST(createContext(db, id, null))).status).toBe(401);
    expect((await POST(createContext(db, 'nope'))).status).toBe(404);
  });

  // The follower enqueue is a priority-0 queue row asked for with no Turnstile and no daily
  // cap, so the save is the only place that can bound it. 20 an hour per user, the same
  // budget as `building-create`.
  it('429s the 21st save in an hour, after 20 distinct buildings went through', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const other = await insertBuilding(db, {
        id: `save-${i}`,
        parcel_id: `31023960${String(i).padStart(2, '0')}`,
      });
      await insertPull(db, other, FY2026_RESOURCE_ID);
      ids.push(other);
      const res = await POST(createContext(db, other));
      expect(res.status).toBe(200);
    }

    const refused = await POST(createContext(db, id));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'Too many requests. Please try again later.' });
    expect(refused.headers.get('Retry-After')).not.toBeNull();
    expect(refused.headers.get('X-RateLimit-Limit')).toBe('20');
    // Refused before the insert: nothing was saved and nothing was queued for it.
    expect(await savedCount(db, id)).toBe(0);
    expect(await pendingReasons(db, id)).toEqual([]);

    // The twenty that were allowed each got their follower row.
    for (const allowed of ids) expect(await pendingReasons(db, allowed)).toEqual(['follower']);
  });

  it('a records read or queue failure does not turn a successful save into an error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dropping the table breaks the coverage read before `enqueue` is even reached, so this
    // covers the whole isolated block rather than the enqueue call alone.
    await db.prepare('DROP TABLE records_queue').run();

    const res = await POST(createContext(db, id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(await savedCount(db, id)).toBe(1);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logged.mock.calls[0][0] as string)).toMatchObject({
      level: 'error',
      event: 'records_follower_enqueue_failed',
      buildingId: id,
    });
  });
});
