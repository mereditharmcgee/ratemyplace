import { describe, expect, it } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { DEEPER_SOURCE_IDS, hasDeeperPull, pendingQueueReason, recordsRequestState } from '../records/coverage';
import { DEEPER_SOURCE_IDS as SCHEDULER_DEEPER } from '../records/scheduler';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { enqueue } from '../records/queue';

const suite = sqliteAvailable ? describe : describe.skip;

async function insertPull(
  db: ReturnType<typeof createRecordsTestDb>,
  buildingId: string,
  sourceId: string,
  status = 'ok',
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (?, ?, 'boston', ?, 'label', 'q', ?, 0, NULL, NULL, NULL, 'admin')",
    )
    .bind(`${buildingId}-${sourceId}-${status}`, buildingId, sourceId, status)
    .run();
}

suite('coverage', () => {
  it('lists the five non-assessor sources and scheduler re-exports the same array', () => {
    expect(DEEPER_SOURCE_IDS).toHaveLength(5);
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

    // Direct insert, not `enqueue`: refresh is a worse priority than the pending follower
    // row, so `enqueue` would answer `already_queued` and leave the follower in place.
    await db.prepare('DELETE FROM records_queue WHERE building_id = ?').bind(id).run();
    await db
      .prepare("INSERT INTO records_queue (building_id, reason, priority, requested_at) VALUES (?, 'refresh', 1, ?)")
      .bind(id, 1_001)
      .run();
    expect(await pendingQueueReason(db, id)).toBe('refresh');
    expect(await recordsRequestState(db, id)).toBe('requested');
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
