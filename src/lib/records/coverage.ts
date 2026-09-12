// What the site knows about a Boston building's records coverage, for the request paths
// that must not pull anything themselves: the reader-facing button, the follower enqueue on
// save, and the panel's page state. Read-only; the queue module owns every write.
import { jurisdictionForCity } from './jurisdiction';
import { sourcesForCity } from './jurisdictions';
import { MAX_ATTEMPTS, requireDeeperSourceIds } from './queue';
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
  requireDeeperSourceIds('hasDeeperPull', DEEPER_SOURCE_IDS);
  const row = await db
    .prepare(
      `SELECT 1 FROM record_pulls WHERE building_id = ? AND source_id IN (${DEEPER_PLACEHOLDERS}) LIMIT 1`,
    )
    .bind(buildingId, ...DEEPER_SOURCE_IDS)
    .first<unknown>();
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

/** Listed in the precedence order `recordsRequestState` applies. */
export type RecordsRequestState = 'ineligible' | 'pulled' | 'fill_queued' | 'parked' | 'requested' | 'never_pulled';

interface RequestStateRow {
  city: string | null;
  parcel_id: string | null;
  has_deeper: number;
  pending_reason: QueueReason | null;
  pending_attempts: number | null;
}

/**
 * The page-state table from the design spec, Section 4:
 * - `ineligible`: no such building, or no jurisdiction that knows how to pull for its city,
 *   or no parcel id — nothing to offer. Eligibility is the pull path's own test
 *   (`jurisdictionForCity`), not a string compare on 'Boston', so 'boston' and 'Boston, MA'
 *   get the button the pull would honor.
 * - `pulled`: a deeper pull exists; the ledger is the normal one and the button never returns.
 * - `fill_queued`: only the city-wide pass has it; say so, and still offer the button. This
 *   is checked ahead of `parked` on purpose: a fill row that used all `MAX_ATTEMPTS` of its
 *   claims is still a row the button can do something about, because `enqueue` replaces it
 *   with a fresh priority-0 row that gets its own attempts. Offering the button there is
 *   the honest answer — the press really does move the building to the front of the queue.
 * - `parked`: the pending `button`, `follower` or `refresh` row has used all `MAX_ATTEMPTS`
 *   of its claims, so the Worker will not take it again without a human. Such a row keeps
 *   `done_at IS NULL` forever, which `requested` would report as "reload in a few minutes"
 *   for as long as it sits there — so say what is true instead. No button is offered:
 *   against a parked `button` or `follower` row a press can only answer `already_queued`,
 *   priority 0 not beating priority 0, and a parked `refresh` row does not reach this
 *   branch in practice, because `planRefresh` only queues buildings that already have a
 *   deeper pull and `pulled` catches those first. The endpoint still treats `parked`
 *   exactly like `requested` — it is a page state, not a refusal, so a press from a stale
 *   page falls through to `enqueue` rather than meeting a 404 or a 409.
 * - `requested`: a button, follower, or refresh row is pending; say so, offer no button.
 * - `never_pulled`: offer the button.
 *
 * One statement on purpose: the public endpoint calls this once per request, and both
 * subqueries are indexed seeks off `building_id`, so composing `hasDeeperPull` and
 * `pendingQueueReason` would buy two extra D1 round trips and nothing else. Those two stay
 * exported for the callers that need one answer without the other.
 */
export async function recordsRequestState(db: RecordsDb, buildingId: string): Promise<RecordsRequestState> {
  requireDeeperSourceIds('recordsRequestState', DEEPER_SOURCE_IDS);
  // Two scalar subqueries over the same pending row rather than one row subquery: SQLite
  // scalar subqueries return a single column, and 0031's partial unique index means both
  // read the one pending row through the same index seek. Still one statement.
  const row = await db
    .prepare(
      'SELECT b.city, b.parcel_id, ' +
        `EXISTS (SELECT 1 FROM record_pulls rp WHERE rp.building_id = b.id AND rp.source_id IN (${DEEPER_PLACEHOLDERS})) AS has_deeper, ` +
        '(SELECT q.reason FROM records_queue q WHERE q.building_id = b.id AND q.done_at IS NULL) AS pending_reason, ' +
        '(SELECT q.attempts FROM records_queue q WHERE q.building_id = b.id AND q.done_at IS NULL) AS pending_attempts ' +
        'FROM buildings b WHERE b.id = ?',
    )
    .bind(...DEEPER_SOURCE_IDS, buildingId)
    .first<RequestStateRow>();
  if (!row || jurisdictionForCity(row.city) === null || row.parcel_id === null) return 'ineligible';
  if (row.has_deeper) return 'pulled';
  // Ahead of `parked`: an exhausted fill row is the one parked row a press can still fix.
  if (row.pending_reason === 'fill') return 'fill_queued';
  // Before `requested` for the reasons in the docblock: a parked row is pending by
  // `done_at`, so `requested` would read it as work still in flight.
  if (row.pending_reason !== null && (row.pending_attempts ?? 0) >= MAX_ATTEMPTS) return 'parked';
  if (row.pending_reason !== null) return 'requested';
  return 'never_pulled';
}
