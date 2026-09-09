import { describe, expect, it } from 'vitest';
import {
  errorRateBySource, getFillPaused, planRefresh, purgeFinished, queueStats, setFillPaused, topUpFill,
  REFRESH_AFTER_SECONDS, FINISHED_RETENTION_SECONDS, FILL_TARGET,
} from '../records/queue';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const NOW = 1_800_000_000;
const DAY = 86_400;
const DEEPER = ['permits-res', '311-res'];

async function pull(db: ReturnType<typeof createRecordsTestDb>, buildingId: string, sourceId: string, status: 'ok' | 'empty' | 'error', at: number) {
  await db
    .prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, retrieved_at) VALUES (?, ?, 'boston', ?, ?, 'q', ?, 0, ?)")
    .bind(`${buildingId}-${sourceId}-${at}`, buildingId, sourceId, sourceId, status, at)
    .run();
}

async function seeded(db: ReturnType<typeof createRecordsTestDb>, id: string, neighborhood: string, street: string, num: number) {
  await insertBuilding(db, { id, slug: id, city: 'Boston' });
  await db.prepare("UPDATE buildings SET source = 'seed', neighborhood = ?, street_key = ?, st_num_lo = ?, st_num_hi = ? WHERE id = ?").bind(neighborhood, street, num, num, id).run();
}

describe('planRefresh', () => {
  it('enqueues refresh for a reviewed building whose deeper pulls are older than REFRESH_AFTER_SECONDS', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r1', 'b1', 'approved')").run();
    await pull(db, 'b1', DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(1);
    const row = await db.prepare("SELECT reason FROM records_queue WHERE building_id = 'b1' AND done_at IS NULL").first<{ reason: string }>();
    expect(row?.reason).toBe('refresh');
  });

  it('counts a saved building and a finished button pull as interest, and ignores a pending or fresh one', async () => {
    const db = createRecordsTestDb();
    for (const id of ['saved', 'pressed', 'fresh', 'nobody']) await insertBuilding(db, { id, slug: id });
    // saved_buildings.user_id is a real FK in the stub schema, so the user has to exist.
    await db.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
    await db.prepare("INSERT INTO saved_buildings (user_id, building_id) VALUES ('u1', 'saved')").run();
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, done_at) VALUES ('pressed', 'button', 0, ?, ?)").bind(NOW - 40 * DAY, NOW - 40 * DAY).run();
    for (const id of ['saved', 'pressed', 'fresh', 'nobody']) await pull(db, id, DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    await pull(db, 'fresh', DEEPER[1], 'ok', NOW - 10);
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r2', 'fresh', 'approved')").run();
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(2);
    const rows = await db.prepare("SELECT building_id FROM records_queue WHERE reason = 'refresh' ORDER BY building_id").all<{ building_id: string }>();
    expect(rows.results.map((r) => r.building_id)).toEqual(['pressed', 'saved']);
  });

  it('ignores a pending review and a building with no deeper pull at all', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r1', 'b1', 'pending')").run();
    await pull(db, 'b1', DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(0);
    await insertBuilding(db, { id: 'b2', slug: 'b2' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r2', 'b2', 'approved')").run();
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(0);
  });
});

describe('topUpFill', () => {
  it('fills up to FILL_TARGET pending fill rows from seeded buildings with no deeper pull, in neighborhood/street/number order', async () => {
    const db = createRecordsTestDb();
    await seeded(db, 's3', 'Dorchester', 'B ST', 5);
    await seeded(db, 's1', 'Allston', 'A ST', 10);
    await seeded(db, 's2', 'Allston', 'A ST', 2);
    await seeded(db, 'pulled', 'Allston', 'A ST', 1);
    await pull(db, 'pulled', DEEPER[0], 'ok', NOW - 1);
    await insertBuilding(db, { id: 'user1', slug: 'user1', city: 'Boston' });
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 2 })).toBe(2);
    const rows = await db.prepare("SELECT building_id FROM records_queue WHERE reason = 'fill' ORDER BY id").all<{ building_id: string }>();
    expect(rows.results.map((r) => r.building_id)).toEqual(['s2', 's1']);
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 2 })).toBe(0);
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 10 })).toBe(1);
    expect(FILL_TARGET).toBe(2000);
  });
});

describe('purgeFinished', () => {
  it('deletes finished refresh and fill rows older than the retention, keeps button rows and pending rows', async () => {
    const db = createRecordsTestDb();
    for (const id of ['a', 'b', 'c', 'd']) await insertBuilding(db, { id, slug: id });
    const old = NOW - FINISHED_RETENTION_SECONDS - 1;
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, done_at) VALUES ('a', 'fill', 2, ?, ?), ('b', 'button', 0, ?, ?), ('c', 'refresh', 1, ?, ?), ('d', 'fill', 2, ?, NULL)").bind(old, old, old, old, NOW - 10, NOW - 10, old).run();
    expect(await purgeFinished(db, { now: NOW })).toBe(1);
    const left = await db.prepare('SELECT building_id FROM records_queue ORDER BY building_id').all<{ building_id: string }>();
    expect(left.results.map((r) => r.building_id)).toEqual(['b', 'c', 'd']);
  });
});

describe('errorRateBySource', () => {
  it('reports attempts and errors per source over the window, ignoring older rows', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    for (let i = 0; i < 5; i += 1) await pull(db, 'b1', 'permits-res', i < 3 ? 'error' : 'ok', NOW - 100 - i);
    await pull(db, 'b1', 'permits-res', 'error', NOW - 2 * DAY);
    await pull(db, 'b1', '311-res', 'empty', NOW - 50);
    const rates = await errorRateBySource(db, { now: NOW, windowSeconds: DAY });
    expect(rates).toEqual([
      { sourceId: '311-res', attempts: 1, errors: 0, rate: 0 },
      { sourceId: 'permits-res', attempts: 5, errors: 3, rate: 0.6 },
    ]);
  });
});

describe('fill pause flag and stats', () => {
  it('defaults to not paused, round-trips, and stamps updated_at', async () => {
    const db = createRecordsTestDb();
    expect(await getFillPaused(db)).toBe(false);
    await setFillPaused(db, true, NOW);
    expect(await getFillPaused(db)).toBe(true);
    const row = await db.prepare("SELECT value, updated_at FROM app_settings WHERE key = 'records_fill_paused'").first<{ value: string; updated_at: number }>();
    expect(row).toEqual({ value: '1', updated_at: NOW });
    await setFillPaused(db, false, NOW + 1);
    expect(await getFillPaused(db)).toBe(false);
  });

  it('summarizes the queue for the admin panel', async () => {
    const db = createRecordsTestDb();
    for (const id of ['a', 'b', 'c']) await insertBuilding(db, { id, slug: id });
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, attempts, last_error) VALUES ('a', 'fill', 2, ?, 0, NULL), ('b', 'button', 0, ?, 3, 'boom')").bind(NOW - 500, NOW - 100).run();
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at, done_at) VALUES ('c', 'refresh', 1, ?, ?)").bind(NOW - 3000, NOW - 2000).run();
    const stats = await queueStats(db, { now: NOW });
    expect(stats).toEqual({
      // 'b' is a button row at MAX_ATTEMPTS: it is parked, not claimable, so it is counted
      // under `parked` and not under pendingByReason. The two are exclusive on purpose —
      // the panel's "pending" number is work the drain will actually pick up.
      pendingByReason: { button: 0, follower: 0, refresh: 0, fill: 1 },
      parked: 1,
      oldestPendingAgeSeconds: 500,
      completedLast24h: 1,
      fillPaused: false,
    });
  });
});
