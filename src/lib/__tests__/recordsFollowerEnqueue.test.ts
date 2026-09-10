import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
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

/** A finished pull row for one source, so `recordsRequestState` can see coverage. */
async function insertPull(db: TestD1Database, buildingId: string, sourceId: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (?, ?, 'boston', ?, 'label', 'q', 'ok', 0, NULL, NULL, NULL, 'seed')",
    )
    .bind(`${buildingId}-${sourceId}`, buildingId, sourceId)
    .run();
}

async function pending(db: TestD1Database, buildingId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT reason FROM records_queue WHERE building_id = ? AND done_at IS NULL')
    .bind(buildingId)
    .all<{ reason: string }>();
  return results.map((r) => r.reason);
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
    expect(await pending(db, id)).toEqual(['follower']);
  });

  it('does not enqueue when a deeper pull exists', async () => {
    await insertPull(db, id, PERMITS_RESOURCE_ID);
    await POST(createContext(db, id));
    expect(await pending(db, id)).toEqual([]);
  });

  it('leaves a pending fill row alone', async () => {
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    await POST(createContext(db, id));
    expect(await pending(db, id)).toEqual(['fill']);
  });

  it('a second save is idempotent and still leaves one pending row', async () => {
    await POST(createContext(db, id));
    const res = await POST(createContext(db, id));
    expect(res.status).toBe(200);
    expect(await pending(db, id)).toEqual(['follower']);
  });

  it('does not enqueue for a building without a parcel', async () => {
    const other = await insertBuilding(db, { id: 'plain', parcel_id: null });
    await POST(createContext(db, other));
    expect(await pending(db, other)).toEqual([]);
  });

  it('still 401s without a session and 404s for an unknown building', async () => {
    expect((await POST(createContext(db, id, null))).status).toBe(401);
    expect((await POST(createContext(db, 'nope'))).status).toBe(404);
  });

  it('a queue failure does not turn a successful save into an error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.prepare('DROP TABLE records_queue').run();

    const res = await POST(createContext(db, id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(await savedCount(db, id)).toBe(1);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
