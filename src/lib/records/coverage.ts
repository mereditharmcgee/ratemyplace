// What the site knows about a Boston building's records coverage, for the request paths
// that must not pull anything themselves: the reader-facing button, the follower enqueue on
// save, and the panel's page state. Read-only; the queue module owns every write.
import { sourcesForCity } from './jurisdictions';
import type { QueueReason, RecordsDb } from './types';

/**
 * Every Boston source that is not the assessor. "Covered" means at least one pull of one of
 * these: the seed wrote an FY2026 assessor row for all 38,208 seeded buildings, so counting
 * the assessor would mark the whole city as done. The scheduler re-exports this array.
 */
export const DEEPER_SOURCE_IDS: string[] = sourcesForCity('Boston')
  .filter((source) => !source.kinds.includes('assessment'))
  .map((source) => source.id);

const DEEPER_PLACEHOLDERS = DEEPER_SOURCE_IDS.map(() => '?').join(', ');

/** Any deeper pull row at all, whatever its status — the `planRefresh` notion, not the fill's. */
export async function hasDeeperPull(db: RecordsDb, buildingId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM record_pulls WHERE building_id = ? AND source_id IN (${DEEPER_PLACEHOLDERS}) LIMIT 1`,
    )
    .bind(buildingId, ...DEEPER_SOURCE_IDS)
    .first<{ present: number }>();
  return row !== null;
}

/** The reason on the building's one pending queue row, or null when nothing is queued. */
export async function pendingQueueReason(db: RecordsDb, buildingId: string): Promise<QueueReason | null> {
  const row = await db
    .prepare('SELECT reason FROM records_queue WHERE building_id = ? AND done_at IS NULL')
    .bind(buildingId)
    .first<{ reason: QueueReason }>();
  return row?.reason ?? null;
}

/**
 * The page-state table from the design spec, Section 4:
 * - `ineligible`: not a Boston building with a parcel id (or no such building) — nothing to offer.
 * - `pulled`: a deeper pull exists; the ledger is the normal one and the button never returns.
 * - `requested`: a button, follower, or refresh row is pending; say so, offer no button.
 * - `fill_queued`: only the city-wide pass has it; say so, and still offer the button.
 * - `never_pulled`: offer the button.
 */
export type RecordsRequestState = 'ineligible' | 'pulled' | 'requested' | 'fill_queued' | 'never_pulled';

export async function recordsRequestState(db: RecordsDb, buildingId: string): Promise<RecordsRequestState> {
  const building = await db
    .prepare('SELECT city, parcel_id FROM buildings WHERE id = ?')
    .bind(buildingId)
    .first<{ city: string | null; parcel_id: string | null }>();
  if (!building || building.city !== 'Boston' || building.parcel_id === null) return 'ineligible';
  if (await hasDeeperPull(db, buildingId)) return 'pulled';
  const pending = await pendingQueueReason(db, buildingId);
  if (pending === 'fill') return 'fill_queued';
  if (pending !== null) return 'requested';
  return 'never_pulled';
}
