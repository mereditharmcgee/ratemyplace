import { describe, expect, it } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull } from './helpers/recordsDb';
import { DEEPER_SOURCE_IDS, hasDeeperPull, pendingQueueReason, recordsRequestState } from '../records/coverage';
import { DEEPER_SOURCE_IDS as SCHEDULER_DEEPER } from '../records/scheduler';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { MAX_ATTEMPTS, enqueue, requireDeeperSourceIds } from '../records/queue';

const suite = sqliteAvailable ? describe : describe.skip;

suite('coverage', () => {
  it('lists the five non-assessor sources and scheduler re-exports the same array', () => {
    expect(DEEPER_SOURCE_IDS).toHaveLength(5);
    expect(DEEPER_SOURCE_IDS).not.toContain(FY2026_RESOURCE_ID);
    expect(SCHEDULER_DEEPER).toBe(DEEPER_SOURCE_IDS);
  });

  it('hasDeeperPull ignores assessor rows and counts an errored deeper row', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
    expect(await hasDeeperPull(db, id)).toBe(false);
    await insertPull(db, id, PERMITS_RESOURCE_ID, 'error');
    expect(await hasDeeperPull(db, id)).toBe(true);
  });

  it('scopes both reads to the building asked about', async () => {
    const db = createRecordsTestDb();
    const first = await insertBuilding(db, { id: 'b1', parcel_id: '2102396000' });
    const second = await insertBuilding(db, { id: 'b2', parcel_id: '2102396001' });
    await insertPull(db, first, PERMITS_RESOURCE_ID);
    expect(await hasDeeperPull(db, first)).toBe(true);
    expect(await hasDeeperPull(db, second)).toBe(false);
    expect(await recordsRequestState(db, first)).toBe('pulled');
    expect(await recordsRequestState(db, second)).toBe('never_pulled');
  });

  it('pendingQueueReason reports the pending row and ignores finished ones', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    expect(await pendingQueueReason(db, id)).toBeNull();
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    expect(await pendingQueueReason(db, id)).toBe('fill');
    await db.prepare('UPDATE records_queue SET done_at = 2000 WHERE building_id = ?').bind(id).run();
    expect(await pendingQueueReason(db, id)).toBeNull();
  });

  it('recordsRequestState walks the page-state table', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
    expect(await recordsRequestState(db, id)).toBe('never_pulled');

    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    expect(await recordsRequestState(db, id)).toBe('fill_queued');

    await enqueue(db, { buildingId: id, reason: 'button', now: 1_001 });
    expect(await recordsRequestState(db, id)).toBe('requested');

    await insertPull(db, id, PERMITS_RESOURCE_ID);
    expect(await recordsRequestState(db, id)).toBe('pulled');
  });

  it('reads a pending follower and a pending refresh row as requested', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    await enqueue(db, { buildingId: id, reason: 'follower', now: 1_000 });
    expect(await pendingQueueReason(db, id)).toBe('follower');
    expect(await recordsRequestState(db, id)).toBe('requested');

    // The follower row goes first: refresh is a worse priority, so against a pending
    // follower `enqueue` would answer `already_queued` and leave the follower in place.
    await db.prepare('DELETE FROM records_queue WHERE building_id = ?').bind(id).run();
    await enqueue(db, { buildingId: id, reason: 'refresh', now: 1_001 });
    expect(await pendingQueueReason(db, id)).toBe('refresh');
    expect(await recordsRequestState(db, id)).toBe('requested');
  });

  // A row that used its claims keeps `done_at IS NULL`, so without this branch the panel
  // would tell the reader to reload a page that will not change until a human looks.
  it('reads a pending row that used all its attempts as parked, and one attempt short as requested', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    await enqueue(db, { buildingId: id, reason: 'button', now: 1_000 });

    await db
      .prepare('UPDATE records_queue SET attempts = ? WHERE building_id = ? AND done_at IS NULL')
      .bind(MAX_ATTEMPTS - 1, id)
      .run();
    expect(await recordsRequestState(db, id)).toBe('requested');

    await db
      .prepare('UPDATE records_queue SET attempts = ? WHERE building_id = ? AND done_at IS NULL')
      .bind(MAX_ATTEMPTS, id)
      .run();
    expect(await recordsRequestState(db, id)).toBe('parked');
  });

  it('parked outranks fill_queued, and a deeper pull still outranks parked', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    await db
      .prepare('UPDATE records_queue SET attempts = ? WHERE building_id = ? AND done_at IS NULL')
      .bind(MAX_ATTEMPTS, id)
      .run();
    expect(await recordsRequestState(db, id)).toBe('parked');

    await insertPull(db, id, PERMITS_RESOURCE_ID);
    expect(await recordsRequestState(db, id)).toBe('pulled');
  });

  // The empty-list guard `queue.ts` already applies to both planners: an empty
  // `DEEPER_SOURCE_IDS` would make every coverage test here go silently false the same way.
  it('shares the queue module\'s empty-source-list guard', () => {
    expect(typeof requireDeeperSourceIds).toBe('function');
    expect(() => requireDeeperSourceIds('test', [])).toThrow(/must not be empty/);
  });

  it('recordsRequestState accepts the city spellings the pull path accepts', async () => {
    const db = createRecordsTestDb();
    const lower = await insertBuilding(db, { id: 'b1', city: 'boston', parcel_id: '2102396000' });
    const withState = await insertBuilding(db, { id: 'b2', city: 'Boston, MA', parcel_id: '2102396001' });
    await insertPull(db, lower, FY2026_RESOURCE_ID);
    await insertPull(db, withState, FY2026_RESOURCE_ID);
    expect(await recordsRequestState(db, lower)).toBe('never_pulled');
    expect(await recordsRequestState(db, withState)).toBe('never_pulled');
  });

  it('recordsRequestState is ineligible for a non-Boston, no-parcel, or unknown building', async () => {
    const db = createRecordsTestDb();
    const noParcel = await insertBuilding(db, { id: 'b1', parcel_id: null });
    const newHaven = await insertBuilding(db, { id: 'b2', city: 'New Haven', state: 'CT', parcel_id: '123456789' });
    expect(await recordsRequestState(db, noParcel)).toBe('ineligible');
    expect(await recordsRequestState(db, newHaven)).toBe('ineligible');
    expect(await recordsRequestState(db, 'nope')).toBe('ineligible');
  });
});
