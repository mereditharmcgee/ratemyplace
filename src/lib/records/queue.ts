import type { RecordsDb } from './types';
import type { BuildingRowForIdentity } from './identity';

export type QueueReason = 'button' | 'follower' | 'refresh' | 'fill';

/** Lower runs first. Button and follower are a person waiting; refresh keeps interest fresh; fill is the city-wide pass. */
export const PRIORITY: Record<QueueReason, number> = { button: 0, follower: 0, refresh: 1, fill: 2 };
/** A lock older than this is a Worker run that died mid-pull; the row is claimable again. */
export const LOCK_TTL_SECONDS = 600;
/** After this many thrown pulls the row is parked for a human. Per-source errors do not count. */
export const MAX_ATTEMPTS = 3;
const MAX_ERROR_LENGTH = 500;

export interface EnqueueInput {
  buildingId: string;
  reason: QueueReason;
  now: number;
}

export interface ClaimOptions {
  now: number;
  /** Highest priority number to claim (inclusive). 1 = button, follower, refresh; 2 = everything. */
  priorityMax: number;
  /** Lowest priority number to claim (inclusive). Defaults to 0. */
  priorityMin?: number;
  limit: number;
}

export interface ClaimedRow {
  id: number;
  buildingId: string;
  reason: QueueReason;
  attempts: number;
  building: BuildingRowForIdentity;
}

interface PendingRow {
  id: number;
  reason: QueueReason;
  priority: number;
}

interface CandidateRow {
  id: number;
  building_id: string;
  reason: QueueReason;
  attempts: number;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  parcel_id: string | null;
  sam_id: string | null;
}

/**
 * D1 returns `{ meta: { changes } }` from run(); RecordsDb types it as `unknown` because
 * most callers ignore it. A conditional UPDATE has to read the count, so narrow it here
 * rather than widening the shared interface. A missing count reads as zero: fail closed,
 * the same way the correction-resolve endpoint treats it.
 */
interface RunResultWithChanges {
  meta?: { changes?: number };
}

/**
 * One pending row per building (0031's partial unique index). A request at a better
 * priority than the pending row replaces it in one batch; anything else is a no-op.
 */
export async function enqueue(db: RecordsDb, input: EnqueueInput): Promise<{ status: 'queued' | 'already_queued' }> {
  const priority = PRIORITY[input.reason];
  const pending = await db
    .prepare('SELECT id, reason, priority FROM records_queue WHERE building_id = ? AND done_at IS NULL')
    .bind(input.buildingId)
    .first<PendingRow>();
  const insert = db
    .prepare('INSERT INTO records_queue (building_id, reason, priority, requested_at) VALUES (?, ?, ?, ?)')
    .bind(input.buildingId, input.reason, priority, input.now);
  if (!pending) {
    await insert.run();
    return { status: 'queued' };
  }
  if (priority >= pending.priority) return { status: 'already_queued' };
  // Delete and insert in ONE batch: the partial unique index on building_id would reject
  // the insert if the two ran as separate statements and the delete were rolled back.
  await db.batch([db.prepare('DELETE FROM records_queue WHERE id = ? AND done_at IS NULL').bind(pending.id), insert]);
  return { status: 'queued' };
}

/**
 * Claims up to `limit` pending rows in (priority, requested_at) order by setting locked_at
 * with a conditional UPDATE per row, so two overlapping Worker runs cannot both take one.
 * Rows locked within LOCK_TTL_SECONDS and rows at MAX_ATTEMPTS are skipped.
 */
export async function claimBatch(db: RecordsDb, options: ClaimOptions): Promise<ClaimedRow[]> {
  const staleBefore = options.now - LOCK_TTL_SECONDS;
  // Over-fetch: a concurrent run may win some of these conditional updates, so the
  // candidate list has to be longer than the number of rows we intend to claim.
  const candidates = await db
    .prepare(
      'SELECT q.id, q.building_id, q.reason, q.attempts, b.address, b.city, b.state, b.zip_code, b.parcel_id, b.sam_id ' +
        'FROM records_queue q JOIN buildings b ON b.id = q.building_id ' +
        'WHERE q.done_at IS NULL AND q.priority BETWEEN ? AND ? AND q.attempts < ? AND (q.locked_at IS NULL OR q.locked_at < ?) ' +
        'ORDER BY q.priority, q.requested_at, q.id LIMIT ?',
    )
    .bind(options.priorityMin ?? 0, options.priorityMax, MAX_ATTEMPTS, staleBefore, options.limit * 2)
    .all<CandidateRow>();
  const claimed: ClaimedRow[] = [];
  for (const row of candidates.results) {
    if (claimed.length >= options.limit) break;
    const result = (await db
      .prepare('UPDATE records_queue SET locked_at = ? WHERE id = ? AND done_at IS NULL AND (locked_at IS NULL OR locked_at < ?)')
      .bind(options.now, row.id, staleBefore)
      .run()) as RunResultWithChanges;
    if (!Number(result.meta?.changes ?? 0)) continue;
    claimed.push({
      id: row.id,
      buildingId: row.building_id,
      reason: row.reason,
      attempts: row.attempts,
      building: {
        id: row.building_id,
        address: row.address,
        city: row.city,
        state: row.state,
        zip_code: row.zip_code,
        parcel_id: row.parcel_id,
        sam_id: row.sam_id,
      },
    });
  }
  return claimed;
}

export async function completeRow(db: RecordsDb, id: number, now: number): Promise<void> {
  await db.prepare('UPDATE records_queue SET done_at = ?, locked_at = NULL WHERE id = ?').bind(now, id).run();
}

export async function failRow(db: RecordsDb, id: number, error: string): Promise<void> {
  const message = error.length > MAX_ERROR_LENGTH ? `${error.slice(0, MAX_ERROR_LENGTH - 1)}…` : error;
  await db
    .prepare('UPDATE records_queue SET attempts = attempts + 1, last_error = ?, locked_at = NULL WHERE id = ?')
    .bind(message, id)
    .run();
}
