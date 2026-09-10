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

  it('recordsRequestState is ineligible for a non-Boston, no-parcel, or unknown building', async () => {
    const db = createRecordsTestDb();
    const noParcel = await insertBuilding(db, { id: 'b1', parcel_id: null });
    const newHaven = await insertBuilding(db, { id: 'b2', city: 'New Haven', state: 'CT', parcel_id: '123456789' });
    expect(await recordsRequestState(db, noParcel)).toBe('ineligible');
    expect(await recordsRequestState(db, newHaven)).toBe('ineligible');
    expect(await recordsRequestState(db, 'nope')).toBe('ineligible');
  });
});
