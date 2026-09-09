import { describe, expect, it } from 'vitest';
import { claimBatch, completeRow, enqueue, failRow, MAX_ATTEMPTS, LOCK_TTL_SECONDS } from '../records/queue';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const NOW = 1_800_000_000;

async function pending(db: ReturnType<typeof createRecordsTestDb>) {
  const rows = await db
    .prepare('SELECT building_id, reason, priority, attempts, locked_at, done_at FROM records_queue ORDER BY id')
    .all<Record<string, unknown>>();
  return rows.results;
}

describe('enqueue', () => {
  it('inserts one pending row with the reason priority and reports queued', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW })).toEqual({ status: 'queued' });
    expect(await pending(db)).toMatchObject([{ building_id: 'b1', reason: 'fill', priority: 2, attempts: 0 }]);
  });

  it('reports already_queued for a second request of equal or lower priority', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW })).toEqual({ status: 'already_queued' });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW })).toEqual({ status: 'already_queued' });
    expect(await pending(db)).toHaveLength(1);
  });

  it('replaces a pending fill row with a button row, in one batch', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    expect(await enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW + 5 })).toEqual({ status: 'queued' });
    expect(await pending(db)).toMatchObject([{ building_id: 'b1', reason: 'button', priority: 0 }]);
  });

  it('allows a new pending row once the previous one is done', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    await completeRow(db, row.id, NOW + 1);
    expect(await enqueue(db, { buildingId: 'b1', reason: 'refresh', now: NOW + 2 })).toEqual({ status: 'queued' });
    expect(await pending(db)).toHaveLength(2);
  });
});

describe('claimBatch', () => {
  it('claims oldest-first within priority and locks the rows', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b2', 'b3']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    await enqueue(db, { buildingId: 'b2', reason: 'button', now: NOW + 1 });
    await enqueue(db, { buildingId: 'b3', reason: 'refresh', now: NOW + 2 });
    const claimed = await claimBatch(db, { now: NOW + 10, priorityMax: 1, limit: 5 });
    expect(claimed.map((r) => r.buildingId)).toEqual(['b2', 'b3']);
    expect(claimed[0].building.address).toBeTruthy();
    const rows = await pending(db);
    expect(rows.filter((r) => r.locked_at !== null)).toHaveLength(2);
  });

  it('skips a row locked less than LOCK_TTL_SECONDS ago and reclaims an older lock', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    expect(await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 })).toHaveLength(1);
    expect(await claimBatch(db, { now: NOW + 60, priorityMax: 2, limit: 1 })).toHaveLength(0);
    expect(await claimBatch(db, { now: NOW + LOCK_TTL_SECONDS + 1, priorityMax: 2, limit: 1 })).toHaveLength(1);
  });

  it('never claims a parked row (attempts >= MAX_ATTEMPTS)', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const [row] = await claimBatch(db, { now: NOW + i * 1000, priorityMax: 2, limit: 1 });
      await failRow(db, row.id, `boom ${i}`);
    }
    expect(await claimBatch(db, { now: NOW + 99_999, priorityMax: 2, limit: 1 })).toHaveLength(0);
    expect(await pending(db)).toMatchObject([{ attempts: MAX_ATTEMPTS, done_at: null }]);
  });

  it('honors priorityMax so a fill-only claim does not take a button row', async () => {
    const db = createRecordsTestDb();
    for (const id of ['b1', 'b2']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'b1', reason: 'button', now: NOW });
    await enqueue(db, { buildingId: 'b2', reason: 'fill', now: NOW });
    const fillOnly = await claimBatch(db, { now: NOW, priorityMax: 2, priorityMin: 2, limit: 5 });
    expect(fillOnly.map((r) => r.buildingId)).toEqual(['b2']);
  });
});

describe('completeRow / failRow', () => {
  it('complete sets done_at and clears the lock; fail increments attempts, records the error, clears the lock', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await enqueue(db, { buildingId: 'b1', reason: 'fill', now: NOW });
    const [row] = await claimBatch(db, { now: NOW, priorityMax: 2, limit: 1 });
    await failRow(db, row.id, 'x'.repeat(2000));
    let [r] = await pending(db);
    expect(r).toMatchObject({ attempts: 1, locked_at: null, done_at: null });
    const err = await db
      .prepare('SELECT last_error FROM records_queue WHERE id = ?')
      .bind(row.id)
      .first<{ last_error: string }>();
    expect(err!.last_error.length).toBeLessThanOrEqual(500);
    const [again] = await claimBatch(db, { now: NOW + 2, priorityMax: 2, limit: 1 });
    await completeRow(db, again.id, NOW + 3);
    [r] = await pending(db);
    expect(r).toMatchObject({ locked_at: null, done_at: NOW + 3 });
  });
});
