import { describe, expect, it } from 'vitest';
import {
  enqueue, errorRateBySource, getFillPaused, planRefresh, purgeFinished, queueStats, setFillPaused, topUpFill,
  REFRESH_AFTER_SECONDS, FINISHED_RETENTION_SECONDS, FILL_TARGET, FILL_INSERT_BATCH,
} from '../records/queue';
import type { RecordsDb, RecordsPreparedStatement } from '../records/types';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import type { TestD1Database } from './helpers/sqliteD1';

const NOW = 1_800_000_000;
const DAY = 86_400;
const DEEPER = ['permits-res', '311-res'];

async function pull(db: ReturnType<typeof createRecordsTestDb>, buildingId: string, sourceId: string, status: 'ok' | 'empty' | 'error', at: number) {
  await db
    .prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, retrieved_at) VALUES (?, ?, 'boston', ?, ?, 'q', ?, 0, ?)")
    .bind(`${buildingId}-${sourceId}-${at}`, buildingId, sourceId, sourceId, status, at)
    .run();
}

async function seeded(db: ReturnType<typeof createRecordsTestDb>, id: string, neighborhood: string | null, street: string, num: number) {
  await insertBuilding(db, { id, slug: id, city: 'Boston' });
  await db.prepare("UPDATE buildings SET source = 'seed', neighborhood = ?, street_key = ?, st_num_lo = ?, st_num_hi = ? WHERE id = ?").bind(neighborhood, street, num, num, id).run();
}

/**
 * Wraps the test db so `race` runs exactly once, immediately before the first
 * `INSERT INTO records_queue` — the window in which another writer queues the building a
 * planner has just decided to queue. The racing write goes through the raw db, outside the
 * wrapper, so it is not itself intercepted.
 */
function raceBeforeInsert(db: TestD1Database, race: () => Promise<unknown>): RecordsDb {
  let fired = false;
  return {
    prepare(sql: string): RecordsPreparedStatement {
      const inner = db.prepare(sql);
      const self: RecordsPreparedStatement = {
        bind(...values: unknown[]) {
          inner.bind(...(values as never[]));
          return self;
        },
        first: <T>() => inner.first<T>(),
        all: <T>() => inner.all<T>(),
        async run() {
          if (!fired && sql.startsWith('INSERT INTO records_queue')) {
            fired = true;
            await race();
          }
          return inner.run();
        },
      };
      return self;
    },
    batch: (statements: RecordsPreparedStatement[]) => db.batch(statements as never),
  };
}

/** Wraps the test db and records how many statements each `batch` call carried. */
function countingBatch(db: TestD1Database): { db: RecordsDb; sizes: number[] } {
  const sizes: number[] = [];
  return {
    sizes,
    db: {
      prepare: (sql: string) => db.prepare(sql) as unknown as RecordsPreparedStatement,
      batch(statements: RecordsPreparedStatement[]) {
        sizes.push(statements.length);
        return db.batch(statements as never);
      },
    },
  };
}

describe('migration 0032 indexes', () => {
  it('creates the three lookup indexes the planner and the breaker depend on', async () => {
    const db = createRecordsTestDb();
    const rows = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_records_queue_building','idx_saved_buildings_building','idx_record_pulls_retrieved') ORDER BY name")
      .all<{ name: string }>();
    expect(rows.results.map((r) => r.name)).toEqual([
      'idx_record_pulls_retrieved',
      'idx_records_queue_building',
      'idx_saved_buildings_building',
    ]);
  });
});

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

  it('leaves an interesting stale building alone when it already has a pending row', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r1', 'b1', 'approved')").run();
    await pull(db, 'b1', DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    // Someone pressed the button an hour ago and it has not been drained yet. A refresh row
    // would be a second pending row for the building, which 0031's partial unique index
    // rejects outright, and the pull it is waiting for is the one it wanted anyway.
    await enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW - 3600 });
    expect(await planRefresh(db, { now: NOW, deeperSourceIds: DEEPER })).toBe(0);
    const rows = await db.prepare('SELECT reason FROM records_queue').all<{ reason: string }>();
    expect(rows.results.map((r) => r.reason)).toEqual(['button']);
  });

  it('counts what it actually enqueued, not what it planned to', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO reviews (id, building_id, status) VALUES ('r1', 'b1', 'approved')").run();
    await pull(db, 'b1', DEEPER[0], 'ok', NOW - REFRESH_AFTER_SECONDS - 1);
    // A reader presses the button between our SELECT and our INSERT: the row we planned is
    // not ours to claim credit for, and the button row that won is the better one anyway.
    const raced = raceBeforeInsert(db, () => enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW }));
    expect(await planRefresh(raced, { now: NOW, deeperSourceIds: DEEPER })).toBe(0);
    const rows = await db.prepare('SELECT reason FROM records_queue').all<{ reason: string }>();
    expect(rows.results.map((r) => r.reason)).toEqual(['button']);
  });

  it('refuses to run with no deeper sources rather than treating the city as fresh', async () => {
    const db = createRecordsTestDb();
    await expect(planRefresh(db, { now: NOW, deeperSourceIds: [] })).rejects.toThrow(/deeperSourceIds/);
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

  it('re-enters an error-only building behind every never-pulled one, and leaves an empty pull alone', async () => {
    const db = createRecordsTestDb();
    await seeded(db, 'errored', 'Allston', 'A ST', 1);
    await seeded(db, 'never', 'Roxbury', 'Z ST', 9);
    await seeded(db, 'emptied', 'Allston', 'A ST', 3);
    // Every deeper source threw for this one: nothing was learned about the building, so it
    // is still uncovered and has to come back round — but behind buildings nobody has tried.
    for (const source of DEEPER) await pull(db, 'errored', source, 'error', NOW - 100);
    // 'empty' is an answer: the city has no permits for it. That building is done.
    await pull(db, 'emptied', DEEPER[0], 'empty', NOW - 100);
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 10 })).toBe(2);
    const rows = await db.prepare("SELECT building_id FROM records_queue WHERE reason = 'fill' ORDER BY id").all<{ building_id: string }>();
    // 'never' sorts after 'errored' by neighborhood, but has_any_pull leads the ORDER BY.
    expect(rows.results.map((r) => r.building_id)).toEqual(['never', 'errored']);
  });

  it('sorts a seeded building with no neighborhood last', async () => {
    const db = createRecordsTestDb();
    await seeded(db, 'unplaced', null, 'A ST', 1);
    await seeded(db, 'placed', 'Roxbury', 'Z ST', 99);
    expect(await topUpFill(db, { now: NOW, deeperSourceIds: DEEPER, target: 10 })).toBe(2);
    const rows = await db.prepare("SELECT building_id FROM records_queue WHERE reason = 'fill' ORDER BY id").all<{ building_id: string }>();
    expect(rows.results.map((r) => r.building_id)).toEqual(['placed', 'unplaced']);
  });

  it('counts what it actually enqueued, not what it planned to', async () => {
    const db = createRecordsTestDb();
    await seeded(db, 's1', 'Allston', 'A ST', 1);
    const raced = raceBeforeInsert(db, () => enqueue(db, { buildingId: 's1', reason: 'button', now: NOW }));
    expect(await topUpFill(raced, { now: NOW, deeperSourceIds: DEEPER, target: 10 })).toBe(0);
    const rows = await db.prepare('SELECT reason FROM records_queue').all<{ reason: string }>();
    expect(rows.results.map((r) => r.reason)).toEqual(['button']);
  });

  it('inserts in batches of FILL_INSERT_BATCH and counts the rows that landed', async () => {
    const db = createRecordsTestDb();
    const total = 250;
    for (let i = 0; i < total; i += 1) await seeded(db, `s${String(i).padStart(3, '0')}`, 'Allston', 'A ST', i + 1);

    // A day's top-up is up to FILL_TARGET rows. One round trip per row is 2,000 of them
    // against D1 in a Worker's daily tick; these are 3.
    const counted = countingBatch(db);
    expect(await topUpFill(counted.db, { now: NOW, deeperSourceIds: DEEPER, target: total })).toBe(total);
    expect(counted.sizes).toEqual([FILL_INSERT_BATCH, FILL_INSERT_BATCH, total - 2 * FILL_INSERT_BATCH]);

    const rows = await db
      .prepare("SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'fill' AND done_at IS NULL")
      .first<{ n: number }>();
    expect(rows?.n).toBe(total);
  });

  it('skips a building that gained a pending row after the SELECT, without duplicating it', async () => {
    const db = createRecordsTestDb();
    await seeded(db, 's1', 'Allston', 'A ST', 1);
    await seeded(db, 's2', 'Allston', 'A ST', 2);
    // The button row lands after the candidate SELECT and before the insert. The partial
    // unique index would reject a second pending row outright, so the insert has to skip it
    // — and skipping it means it is not this run's work to count.
    const raced = raceBeforeInsert(db, () => enqueue(db, { buildingId: 's1', reason: 'button', now: NOW }));
    expect(await topUpFill(raced, { now: NOW, deeperSourceIds: DEEPER, target: 10 })).toBe(1);

    const rows = await db
      .prepare('SELECT building_id, reason FROM records_queue ORDER BY building_id')
      .all<{ building_id: string; reason: string }>();
    expect(rows.results).toEqual([
      { building_id: 's1', reason: 'button' },
      { building_id: 's2', reason: 'fill' },
    ]);
  });

  it('refuses to run with no deeper sources rather than queueing the whole city', async () => {
    const db = createRecordsTestDb();
    await expect(topUpFill(db, { now: NOW, deeperSourceIds: [], target: 10 })).rejects.toThrow(/deeperSourceIds/);
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

  it('reports nothing when no pull landed in the window, rather than a zero-attempt row', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await pull(db, 'b1', 'permits-res', 'error', NOW - 2 * DAY);
    // An empty list is what the breaker needs to see: a source with no attempts has no rate,
    // and inventing a 0-of-0 row would give it something to compare against MIN_ATTEMPTS.
    expect(await errorRateBySource(db, { now: NOW, windowSeconds: DAY })).toEqual([]);
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

  it('reports a null oldest age on an empty queue rather than an age since the epoch', async () => {
    const db = createRecordsTestDb();
    expect(await queueStats(db, { now: NOW })).toEqual({
      pendingByReason: { button: 0, follower: 0, refresh: 0, fill: 0 },
      parked: 0,
      // MIN() over no rows is NULL, and `now - null` would render as an age of 55 years.
      oldestPendingAgeSeconds: null,
      completedLast24h: 0,
      fillPaused: false,
    });
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
