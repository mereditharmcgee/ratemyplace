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
    const result = await db
      .prepare('UPDATE records_queue SET locked_at = ? WHERE id = ? AND done_at IS NULL AND (locked_at IS NULL OR locked_at < ?)')
      .bind(options.now, row.id, staleBefore)
      .run();
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

/** A deeper pull older than this makes an interesting building due for a refresh. */
export const REFRESH_AFTER_SECONDS = 30 * 86_400;
/** How long a finished refresh or fill row is kept. Button rows are kept forever. */
export const FINISHED_RETENTION_SECONDS = 90 * 86_400;
/** Ceiling on pending fill rows, so the queue table stays a working set, not a copy of the city. */
export const FILL_TARGET = 2000;
const FILL_PAUSED_KEY = 'records_fill_paused';

export interface PlannerOptions {
  now: number;
  /** Every Boston source id except the assessor years; a building "has records" when one of these has a pull row. */
  deeperSourceIds: string[];
}

/** Placeholders for a bound `IN (...)` list. The list length is a code fact; the values are bound. */
function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

/**
 * Interesting buildings (an approved review, a saved-building row, or a finished button
 * pull) whose latest deeper pull is older than REFRESH_AFTER_SECONDS and which have no
 * pending row get a refresh row. Returns the number enqueued.
 *
 * A building with NO deeper pull at all is skipped for free: MAX() over no rows is NULL,
 * and `NULL < ?` is NULL, not true, so the row never matches. Those buildings are the
 * fill's job, not the refresh's — do not "fix" this with COALESCE.
 */
export async function planRefresh(db: RecordsDb, options: PlannerOptions): Promise<number> {
  const ids = options.deeperSourceIds;
  const rows = await db
    .prepare(
      'SELECT b.id FROM buildings b ' +
        "WHERE (EXISTS (SELECT 1 FROM reviews r WHERE r.building_id = b.id AND r.status = 'approved') " +
        '   OR EXISTS (SELECT 1 FROM saved_buildings s WHERE s.building_id = b.id) ' +
        "   OR EXISTS (SELECT 1 FROM records_queue q WHERE q.building_id = b.id AND q.reason = 'button' AND q.done_at IS NOT NULL)) " +
        'AND NOT EXISTS (SELECT 1 FROM records_queue p WHERE p.building_id = b.id AND p.done_at IS NULL) ' +
        `AND (SELECT MAX(retrieved_at) FROM record_pulls rp WHERE rp.building_id = b.id AND rp.source_id IN (${placeholders(ids.length)})) < ?`,
    )
    .bind(...ids, options.now - REFRESH_AFTER_SECONDS)
    .all<{ id: string }>();
  for (const row of rows.results) await enqueue(db, { buildingId: row.id, reason: 'refresh', now: options.now });
  return rows.results.length;
}

/**
 * Tops the fill queue up to `target` pending rows from seeded buildings that have never had
 * a deeper pull and have no pending row, ordered so a neighborhood completes together.
 * `neighborhood IS NULL` leads the ORDER BY because SQLite sorts NULLs first by default and
 * an unplaced building should not jump ahead of a named neighborhood.
 */
export async function topUpFill(db: RecordsDb, options: PlannerOptions & { target?: number }): Promise<number> {
  const target = options.target ?? FILL_TARGET;
  const pending = await db
    .prepare("SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'fill' AND done_at IS NULL")
    .first<{ n: number }>();
  const room = target - (pending?.n ?? 0);
  if (room <= 0) return 0;
  const ids = options.deeperSourceIds;
  const rows = await db
    .prepare(
      "SELECT b.id FROM buildings b WHERE b.source = 'seed' " +
        'AND NOT EXISTS (SELECT 1 FROM records_queue q WHERE q.building_id = b.id AND q.done_at IS NULL) ' +
        `AND NOT EXISTS (SELECT 1 FROM record_pulls rp WHERE rp.building_id = b.id AND rp.source_id IN (${placeholders(ids.length)})) ` +
        'ORDER BY b.neighborhood IS NULL, b.neighborhood, b.street_key, b.st_num_lo, b.id LIMIT ?',
    )
    .bind(...ids, room)
    .all<{ id: string }>();
  for (const row of rows.results) await enqueue(db, { buildingId: row.id, reason: 'fill', now: options.now });
  return rows.results.length;
}

/** Finished refresh and fill rows are bookkeeping; finished button rows are the record that a reader asked. */
export async function purgeFinished(db: RecordsDb, options: { now: number }): Promise<number> {
  const result = await db
    .prepare("DELETE FROM records_queue WHERE done_at IS NOT NULL AND reason IN ('refresh','fill') AND done_at < ?")
    .bind(options.now - FINISHED_RETENTION_SECONDS)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export interface SourceErrorRate {
  sourceId: string;
  attempts: number;
  errors: number;
  rate: number;
}

/** Per-source attempts and errors over a trailing window, the circuit breaker's input. */
export async function errorRateBySource(
  db: RecordsDb,
  options: { now: number; windowSeconds: number },
): Promise<SourceErrorRate[]> {
  const rows = await db
    .prepare(
      "SELECT source_id, COUNT(*) AS attempts, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors " +
        'FROM record_pulls WHERE retrieved_at >= ? GROUP BY source_id ORDER BY source_id',
    )
    .bind(options.now - options.windowSeconds)
    .all<{ source_id: string; attempts: number; errors: number }>();
  return rows.results.map((r) => ({
    sourceId: r.source_id,
    attempts: r.attempts,
    errors: r.errors,
    rate: r.attempts ? r.errors / r.attempts : 0,
  }));
}

export async function getFillPaused(db: RecordsDb): Promise<boolean> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(FILL_PAUSED_KEY).first<{ value: string }>();
  return row?.value === '1';
}

/** `app_settings.updated_at` defaults on insert but does not self-update (0031), so it is set explicitly. */
export async function setFillPaused(db: RecordsDb, paused: boolean, now: number): Promise<void> {
  await db
    .prepare(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(FILL_PAUSED_KEY, paused ? '1' : '0', now)
    .run();
}

export interface QueueStats {
  /** Claimable rows only: a row parked at MAX_ATTEMPTS is counted under `parked`, not here. */
  pendingByReason: Record<QueueReason, number>;
  parked: number;
  oldestPendingAgeSeconds: number | null;
  completedLast24h: number;
  fillPaused: boolean;
}

export async function queueStats(db: RecordsDb, options: { now: number }): Promise<QueueStats> {
  const byReason = await db
    .prepare('SELECT reason, COUNT(*) AS n FROM records_queue WHERE done_at IS NULL AND attempts < ? GROUP BY reason')
    .bind(MAX_ATTEMPTS)
    .all<{ reason: QueueReason; n: number }>();
  const pendingByReason: Record<QueueReason, number> = { button: 0, follower: 0, refresh: 0, fill: 0 };
  for (const r of byReason.results) pendingByReason[r.reason] = r.n;
  const parked = await db
    .prepare('SELECT COUNT(*) AS n FROM records_queue WHERE done_at IS NULL AND attempts >= ?')
    .bind(MAX_ATTEMPTS)
    .first<{ n: number }>();
  const oldest = await db
    .prepare('SELECT MIN(requested_at) AS t FROM records_queue WHERE done_at IS NULL AND attempts < ?')
    .bind(MAX_ATTEMPTS)
    .first<{ t: number | null }>();
  const done = await db
    .prepare('SELECT COUNT(*) AS n FROM records_queue WHERE done_at >= ?')
    .bind(options.now - 86_400)
    .first<{ n: number }>();
  return {
    pendingByReason,
    parked: parked?.n ?? 0,
    oldestPendingAgeSeconds: oldest?.t == null ? null : options.now - oldest.t,
    completedLast24h: done?.n ?? 0,
    fillPaused: await getFillPaused(db),
  };
}
