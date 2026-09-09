import { describe, expect, it } from 'vitest';
import { claimBatch, completeRow, enqueue, failRow, MAX_ATTEMPTS, LOCK_TTL_SECONDS } from '../records/queue';
import { MAX_ERROR_LENGTH } from '../records/errors';
import { buildIdentity } from '../records/identity';
import type { RecordsDb, RecordsPreparedStatement } from '../records/types';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import type { TestD1Database } from './helpers/sqliteD1';

const NOW = 1_800_000_000;

async function queueRows(db: TestD1Database) {
  const rows = await db
    .prepare('SELECT id, building_id, reason, priority, attempts, locked_at, done_at FROM records_queue ORDER BY id')
    .all<Record<string, unknown>>();
  return rows.results;
}

async function lastErrorOf(db: TestD1Database, id: number): Promise<string> {
  const row = await db.prepare('SELECT last_error FROM records_queue WHERE id = ?').bind(id).first<{ last_error: string }>();
  return row!.last_error;
}

/**
 * Wraps the test db so `race` runs exactly once, immediately before the first operation of
 * kind `when` — the window in which another Worker gets in ahead of us. `'update'` and
 * `'insert'` hook a single statement's `run()`; `'batch'` hooks the batch as a whole, so the
 * racing write lands OUTSIDE our transaction (inside it, our own ROLLBACK would undo the
 * other party's row and there would be no conflict left to observe).
 */
function raceBefore(db: TestD1Database, when: 'update' | 'insert' | 'batch', race: () => Promise<unknown>): RecordsDb {
  let fired = false;
  async function once(kind: 'update' | 'insert' | 'batch'): Promise<void> {
    if (fired || kind !== when) return;
    fired = true;
    await race();
  }
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
          if (sql.startsWith('UPDATE records_queue SET locked_at')) await once('update');
          if (sql.startsWith('INSERT INTO records_queue')) await once('insert');
          return inner.run();
        },
      };
      return self;
    },
    async batch(statements: RecordsPreparedStatement[]) {
      await once('batch');
      return db.batch(statements as never);
    },
  };
}

describe('enqueue', () => {
  it('inserts one pending row with the reason priority and reports queued', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW })).toEqual({ status: 'queued' });
    expect(await queueRows(db)).toMatchObject([{ building_id: 'b1', reason: 'fill', priority: 2, attempts: 0 }]);
  });

  it('reports already_queued for a second request of equal or lower priority', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW })).toEqual({ status: 'already_queued' });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW })).toEqual({ status: 'already_queued' });
    expect(await queueRows(db)).toHaveLength(1);
  });

  it('replaces a pending fill row with a button row, in one batch', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW + 5 })).toEqual({ status: 'queued' });
    expect(await queueRows(db)).toMatchObject([{ building_id: 'b1', reason: 'button', priority: 0 }]);
  });

  it('allows a new pending row once the previous one is done', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    await completeRow(db, row.id, NOW + 1);
    expect(await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW + 2 })).toEqual({ status: 'queued' });
    expect(await queueRows(db)).toHaveLength(2);
  });

  it('reports already_queued when another writer inserts the pending row between our SELECT and INSERT', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    const raced = raceBefore(db, 'insert', () => enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW }));
    expect(await enqueue(raced, { buildingId: 'b1', reason: 'fill', now: NOW })).toEqual({ status: 'already_queued' });
    expect(await queueRows(db)).toMatchObject([{ building_id: 'b1', reason: 'button' }]);
  });

  it('reports already_queued when another writer replaces the pending row before our replace batch', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    // The other writer wins the same upgrade first: our DELETE then matches nothing and our
    // INSERT hits the partial unique index.
    const raced = raceBefore(db, 'batch', () => enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW + 1 }));
    expect(await enqueue(raced, { buildingId: 'b1', reason: 'button', now: NOW + 2 })).toEqual({ status: 'already_queued' });
    expect(await queueRows(db)).toMatchObject([{ building_id: 'b1', reason: 'button', priority: 0 }]);
  });

  it('rethrows an insert failure that is not the pending-row conflict', async () => {
    const db = createRecordsTestDb();
    // No buildings row, so the building_id foreign key rejects the insert.
    await expect(enqueue(db, { buildingId: 'ghost', reason: 'fill', now: NOW })).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe('claimBatch', () => {
  it('claims oldest-first within priority, hands over the whole building row, and locks the rows', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b3', 'b4']) await insertBuilding(db, { id, slug: id });
    await insertBuilding(db, {
      id: 'b2',
      slug: 'b2',
      address: '23-27 Lanark Rd, Boston, MA 02135',
      city: 'Boston',
      state: 'MA',
      zip_code: '02135',
      parcel_id: '2201234000',
      sam_id: '123456',
    });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    await enqueue(db, { buildingId: 'b4', reason: 'follower', now: NOW + 1 });
    await enqueue(db, { buildingId: 'b2', reason: 'button', now: NOW + 2 });
    await enqueue(db, { buildingId: 'b3', reason: 'refresh', now: NOW + 3 });
    const claimed = await claimBatch(db, { now: NOW + 10, priorityMax: 1, limit: 5 });
    // follower and button share priority 0, so they come back in request order.
    expect(claimed.map((r) => r.buildingId)).toEqual(['b4', 'b2', 'b3']);
    expect(claimed.map((r) => r.reason)).toEqual(['follower', 'button', 'refresh']);
    expect(claimed[1].building).toEqual({
      id: 'b2',
      address: '23-27 Lanark Rd, Boston, MA 02135',
      city: 'Boston',
      state: 'MA',
      zip_code: '02135',
      parcel_id: '2201234000',
      sam_id: '123456',
    });
    expect(buildIdentity(claimed[1].building).streetShort).toBe('LANARK RD');
    const rows = await queueRows(db);
    expect(rows.filter((r) => r.locked_at !== null)).toHaveLength(3);
  });

  it('skips a row locked less than LOCK_TTL_SECONDS ago and reclaims an older lock', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    expect(await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 })).toHaveLength(1);
    expect(await claimBatch(db, { now: NOW + 60, priorityMax: 2, limit: 1 })).toHaveLength(0);
    expect(await claimBatch(db, { now: NOW + LOCK_TTL_SECONDS + 1, priorityMax: 2, limit: 1 })).toHaveLength(1);
  });

  it('treats the lock as live at exactly LOCK_TTL_SECONDS and reclaims one second later', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    expect(await claimBatch(db, { now: NOW + LOCK_TTL_SECONDS, priorityMax: 2, limit: 1 })).toHaveLength(0);
    expect(await queueRows(db)).toMatchObject([{ locked_at: NOW }]);
    const reclaim = NOW + LOCK_TTL_SECONDS + 1;
    expect(await claimBatch(db, { now: reclaim, priorityMax: 2, limit: 1 })).toHaveLength(1);
    expect(await queueRows(db)).toMatchObject([{ locked_at: reclaim }]);
  });

  it('skips a row another Worker locked between our SELECT and our UPDATE, and still fills the limit', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b2', 'b3']) await insertBuilding(db, { id, slug: id });
    for (const [i, id] of ['b1', 'b2', 'b3'].entries()) await enqueue(db, { buildingId: id, reason: 'fill', now: NOW + i });
    const contested = await db.prepare('SELECT id FROM records_queue ORDER BY id').first<{ id: number }>();
    // The other Worker runs the same conditional UPDATE, an instant earlier, on the row we
    // are about to take. Its lock is fresh relative to our `now`, so our UPDATE matches nothing.
    const raced = raceBefore(db, 'update', () => claimBatch(db, { now: NOW + 9, priorityMax: 2, limit: 1 }));
    const claimed = await claimBatch(raced, { now: NOW + 10, priorityMax: 2, limit: 2 });
    expect(claimed.map((r) => r.buildingId)).toEqual(['b2', 'b3']);
    expect(await queueRows(db)).toMatchObject([
      { id: contested!.id, building_id: 'b1', locked_at: NOW + 9, attempts: 1 },
      { building_id: 'b2', locked_at: NOW + 10, attempts: 1 },
      { building_id: 'b3', locked_at: NOW + 10, attempts: 1 },
    ]);
  });

  it('parks a row after MAX_ATTEMPTS claims, even when the runner never reports back', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const claimed = await claimBatch(db, { now: NOW + i * (LOCK_TTL_SECONDS + 1), priorityMax: 2, limit: 1 });
      expect(claimed).toHaveLength(1);
      expect(claimed[0].attempts).toBe(i + 1);
    }
    expect(await claimBatch(db, { now: NOW + 999 * LOCK_TTL_SECONDS, priorityMax: 2, limit: 1 })).toHaveLength(0);
    expect(await queueRows(db)).toMatchObject([{ attempts: MAX_ATTEMPTS, done_at: null }]);
  });

  it('honors priorityMax so a fill-only claim does not take a button row', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b2']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW });
    await enqueue(db, { buildingId: 'b2', reason: 'fill', now: NOW });
    const fillOnly = await claimBatch(db, { now: NOW, priorityMax: 2, priorityMin: 2, limit: 5 });
    expect(fillOnly.map((r) => r.buildingId)).toEqual(['b2']);
  });

  it('clamps a fractional or negative limit and rejects a non-finite one', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b2']) await insertBuilding(db, { id, slug: id });
    for (const id of ['b1', 'b2']) await enqueue(db, { buildingId: id, reason: 'fill', now: NOW });
    expect(await claimBatch(db, { now: NOW, priorityMax: 2, limit: 0 })).toHaveLength(0);
    expect(await claimBatch(db, { now: NOW, priorityMax: 2, limit: -5 })).toHaveLength(0);
    expect(await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1.9 })).toHaveLength(1);
    await expect(claimBatch(db, { now: NOW, priorityMax: 2, limit: Number.NaN })).rejects.toThrow(/finite/);
    await expect(claimBatch(db, { now: NOW, priorityMax: 2, limit: Number.POSITIVE_INFINITY })).rejects.toThrow(/finite/);
  });
});

describe('completeRow / failRow', () => {
  it('complete sets done_at, clears the lock, and resets the claim count', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    expect(row.attempts).toBe(1);
    await completeRow(db, row.id, NOW + 3);
    expect(await queueRows(db)).toMatchObject([{ attempts: 0, locked_at: null, done_at: NOW + 3 }]);
  });

  it('fail records the error and clears the lock without touching the claim count', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    await failRow(db, row.id, 'boom');
    expect(await queueRows(db)).toMatchObject([{ attempts: 1, locked_at: null, done_at: null }]);
    expect(await lastErrorOf(db, row.id)).toBe('boom');
    // The lock is gone, so the next claim is immediate - and it counts as the second claim.
    const [again] = await claimBatch(db, { now: NOW + 2, priorityMax: 2, limit: 1 });
    expect(again.attempts).toBe(2);
  });

  it('truncates a long error to exactly MAX_ERROR_LENGTH characters, ellipsis included', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    await failRow(db, row.id, 'x'.repeat(2000));
    const stored = await lastErrorOf(db, row.id);
    expect(stored.length).toBe(500);
    expect(stored.length).toBe(MAX_ERROR_LENGTH);
    expect(stored.endsWith('…')).toBe(true);
    expect(stored).toBe(`${'x'.repeat(MAX_ERROR_LENGTH - 1)}…`);
  });

  it('drops a split surrogate pair at the cut rather than storing half a character', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    // The cut at MAX_ERROR_LENGTH - 1 lands in the middle of the first emoji.
    await failRow(db, row.id, `${'x'.repeat(MAX_ERROR_LENGTH - 2)}\u{1F600}\u{1F600}`);
    const stored = await lastErrorOf(db, row.id);
    expect(stored).toBe(`${'x'.repeat(MAX_ERROR_LENGTH - 2)}…`);
    expect(stored.length).toBe(MAX_ERROR_LENGTH - 1);
    expect(/[\uD800-\uDBFF]/.test(stored)).toBe(false);
  });

  it('stores a short error unmodified', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    const short = 'Assessor timed out after 10s \u{1F600}';
    await failRow(db, row.id, short);
    expect(await lastErrorOf(db, row.id)).toBe(short);
  });
});
