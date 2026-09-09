// The pull queue: one pending row per building, leased to a Worker run by a conditional UPDATE.
//
// `attempts` counts CLAIMS, not caught failures. `claimBatch` increments it as part of the
// same UPDATE that takes the lease, `completeRow` resets it to 0, and `failRow` only records
// why the pull went wrong. That is deliberate: a row whose pull kills the runner outright —
// an OOM, a CPU-limit kill, anything that never reaches a catch — would otherwise be claimed
// forever, and the runner it kills is the one thing that cannot report the failure. Counting
// claims means such a row parks itself after MAX_ATTEMPTS and waits for a human, while a row
// that merely fails cleanly still gets its MAX_ATTEMPTS tries and a `last_error` each time.
import { truncateError } from './errors';
import { SETTING_KEYS, readSetting, writeSetting } from './settings';
import type { QueueReason, RecordsDb } from './types';
import type { BuildingRowForIdentity } from './identity';

export type { QueueReason };

/** Lower runs first. Button and follower are a person waiting; refresh keeps interest fresh; fill is the city-wide pass. */
export const PRIORITY: Record<QueueReason, number> = { button: 0, follower: 0, refresh: 1, fill: 2 };
/**
 * A lock older than this is a Worker run that died mid-pull; the row is claimable again.
 * The drain claims one row at a time immediately before pulling it, and a single pull's
 * worst case is about 20 requests at the 10s per-source timeout — call it 200s. Half an
 * hour is comfortably clear of that, and it is the delay before a genuinely dead run's row
 * is retried, so there is nothing to gain by cutting it fine.
 */
export const LOCK_TTL_SECONDS = 1800;
/** After this many claims the row is parked for a human. See the claim-counting note above. */
export const MAX_ATTEMPTS = 3;

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
  /**
   * How many rows to claim. Claim ONLY what this run will pull immediately: every claimed
   * row counts an attempt whether or not it is pulled, so a caller that claims ten and pulls
   * three has spent an attempt on seven rows for nothing, and three such runs park them for
   * a human. The claim is a lease on work in flight, not a reservation for later. The drain
   * claims one at a time for exactly this reason.
   */
  limit: number;
}

export interface ClaimedRow {
  id: number;
  buildingId: string;
  reason: QueueReason;
  /** Claims including this one, so a row on its last try before parking reads MAX_ATTEMPTS. */
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
 * 0031's partial unique index rejects a second pending row for the building. Two callers
 * pressing the button at once both read "no pending row" and both insert; the loser lands
 * here, and a row someone else just queued is exactly what `already_queued` means.
 *
 * Matched on the message because that is all D1 gives us — it wraps the SQLite text as
 * "D1_ERROR: UNIQUE constraint failed: records_queue.building_id: SQLITE_CONSTRAINT", so
 * the table-and-column substring is the stable part. Any other failure is a real bug and
 * must not be swallowed as "someone else got there first".
 */
function isPendingRowConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed: records_queue.building_id');
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
    try {
      await insert.run();
    } catch (err) {
      if (isPendingRowConflict(err)) return { status: 'already_queued' };
      throw err;
    }
    return { status: 'queued' };
  }
  if (priority >= pending.priority) return { status: 'already_queued' };
  // The replacement is a fresh row, so the parked row's `attempts` and `last_error` go with
  // the old one. That is deliberate, not an oversight: a better priority means a person is
  // waiting, and the history that parked the fill row is not a reason to refuse them. The
  // new row gets its own MAX_ATTEMPTS. If the building is genuinely unpullable it parks
  // again three tries later, with a current `last_error` instead of a stale one.
  //
  // Delete and insert in ONE batch: the partial unique index on building_id would reject
  // the insert if the two ran as separate statements and the delete were rolled back.
  try {
    await db.batch([db.prepare('DELETE FROM records_queue WHERE id = ? AND done_at IS NULL').bind(pending.id), insert]);
  } catch (err) {
    // Someone replaced the pending row we read: our DELETE matched nothing, so the INSERT
    // met their row instead. The whole batch rolled back and theirs stands.
    if (isPendingRowConflict(err)) return { status: 'already_queued' };
    throw err;
  }
  return { status: 'queued' };
}

/**
 * Claims up to `limit` pending rows in (priority, requested_at) order by setting locked_at
 * and bumping attempts with a conditional UPDATE per row, so two overlapping Worker runs
 * cannot both take one. Rows locked within LOCK_TTL_SECONDS and rows at MAX_ATTEMPTS are
 * skipped.
 */
export async function claimBatch(db: RecordsDb, options: ClaimOptions): Promise<ClaimedRow[]> {
  // A fractional or negative limit is a caller bug that SQLite would answer with a datatype
  // mismatch or a surprise; NaN and Infinity are bugs it would answer with a whole queue.
  if (!Number.isFinite(options.limit)) throw new Error(`claimBatch: limit must be a finite number, got ${options.limit}`);
  const limit = Math.max(0, Math.floor(options.limit));
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
    .bind(options.priorityMin ?? 0, options.priorityMax, MAX_ATTEMPTS, staleBefore, limit * 2)
    .all<CandidateRow>();
  const claimed: ClaimedRow[] = [];
  for (const row of candidates.results) {
    if (claimed.length >= limit) break;
    const result = await db
      .prepare(
        'UPDATE records_queue SET locked_at = ?, attempts = attempts + 1 ' +
          'WHERE id = ? AND done_at IS NULL AND (locked_at IS NULL OR locked_at < ?)',
      )
      .bind(options.now, row.id, staleBefore)
      .run();
    if (!Number(result.meta?.changes ?? 0)) continue;
    claimed.push({
      id: row.id,
      buildingId: row.building_id,
      reason: row.reason,
      // The candidate SELECT ran before the UPDATE, so the stored count is one higher.
      attempts: row.attempts + 1,
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

/** Resets attempts: the claim that finished proved the row is not the one killing runners. */
export async function completeRow(db: RecordsDb, id: number, now: number): Promise<void> {
  await db.prepare('UPDATE records_queue SET done_at = ?, locked_at = NULL, attempts = 0 WHERE id = ?').bind(now, id).run();
}

/**
 * Records why the pull failed and KEEPS the lease. It does NOT touch attempts — the claim
 * already counted — and it does not clear `locked_at`.
 *
 * Holding the lease is the backoff, and it is free: the row is unclaimable until the lease
 * expires on its own LOCK_TTL_SECONDS later, so a building that fails every time spends its
 * MAX_ATTEMPTS over an hour and a half instead of inside one drain, and the rows behind it
 * keep moving in the meantime. Clearing it would make "retry immediately" mean the very next
 * claim, which is the opposite of what a failure asks for. An admin who wants a parked row
 * tried now clears the lease from the retry endpoint; nothing else needs to.
 */
export async function failRow(db: RecordsDb, id: number, error: string): Promise<void> {
  await db.prepare('UPDATE records_queue SET last_error = ? WHERE id = ?').bind(truncateError(error), id).run();
}

/** A deeper pull older than this makes an interesting building due for a refresh. */
export const REFRESH_AFTER_SECONDS = 30 * 86_400;
/** How long a finished refresh or fill row is kept. Button rows are kept forever. */
export const FINISHED_RETENTION_SECONDS = 90 * 86_400;
/** Ceiling on pending fill rows, so the queue table stays a working set, not a copy of the city. */
export const FILL_TARGET = 2000;

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
 * An empty deeper-source list is a caller bug that both planners would answer plausibly and
 * wrongly: `IN ()` is a SQLite syntax error, and even if it parsed, "no deeper sources" reads
 * as every building being both permanently fresh (refresh does nothing) and never pulled
 * (the fill queues the whole city). Neither is a state to discover in production.
 */
function requireDeeperSourceIds(fn: string, ids: string[]): void {
  if (ids.length === 0) throw new Error(`${fn}: deeperSourceIds must not be empty`);
}

/**
 * Interesting buildings (an approved review, a saved-building row, or a finished button
 * pull) whose latest deeper pull is older than REFRESH_AFTER_SECONDS and which have no
 * pending row get a refresh row. Returns the number actually enqueued.
 *
 * The query drives off the interest set, not off `buildings`. The three ways a building
 * becomes interesting are each a small indexed read, and their UNION is at most a few
 * thousand ids; starting from `buildings` instead means asking three EXISTS questions of
 * all 38,208 seeded rows to find them, every day, for a set that changes by a handful.
 * UNION (not UNION ALL) deduplicates, so a building that is reviewed AND saved is one id.
 *
 * A building with NO deeper pull at all is skipped for free: MAX() over no rows is NULL,
 * and `NULL < ?` is NULL, not true, so the row never matches. Those buildings are the
 * fill's job, not the refresh's — do not "fix" this with COALESCE.
 */
export async function planRefresh(db: RecordsDb, options: PlannerOptions): Promise<number> {
  const ids = options.deeperSourceIds;
  requireDeeperSourceIds('planRefresh', ids);
  const rows = await db
    .prepare(
      'WITH interest(id) AS (' +
        "SELECT building_id FROM reviews WHERE status = 'approved' " +
        'UNION SELECT building_id FROM saved_buildings ' +
        "UNION SELECT building_id FROM records_queue WHERE reason = 'button' AND done_at IS NOT NULL" +
        ') SELECT i.id FROM interest i ' +
        'WHERE NOT EXISTS (SELECT 1 FROM records_queue p WHERE p.building_id = i.id AND p.done_at IS NULL) ' +
        `AND (SELECT MAX(retrieved_at) FROM record_pulls rp WHERE rp.building_id = i.id AND rp.source_id IN (${placeholders(ids.length)})) < ?`,
    )
    .bind(...ids, options.now - REFRESH_AFTER_SECONDS)
    .all<{ id: string }>();
  return countEnqueued(db, rows.results, 'refresh', options.now);
}

/**
 * Enqueues each planned building and counts only the rows that landed. A planner's SELECT
 * and its inserts are not one transaction, so a reader pressing the button in between wins
 * and `enqueue` reports `already_queued` — a row someone else queued is not this run's work,
 * and the daily log should not claim it.
 *
 * The refresh planner uses this row-by-row path on purpose. It plans a handful of rows a day
 * and `enqueue`'s priority replacement is the behavior it wants; the fill, which plans up to
 * FILL_TARGET, has its own batched path below.
 */
async function countEnqueued(db: RecordsDb, rows: { id: string }[], reason: QueueReason, now: number): Promise<number> {
  let queued = 0;
  for (const row of rows) {
    const result = await enqueue(db, { buildingId: row.id, reason, now });
    if (result.status === 'queued') queued += 1;
  }
  return queued;
}

/** Inserts per `db.batch` call. D1 takes far more; this is the size that keeps one statement list sane. */
export const FILL_INSERT_BATCH = 100;

/**
 * The fill-only insert. `fill` is the WORST priority there is, so it can never usefully
 * replace a pending row the way `enqueue` can — "there is already a pending row" and
 * "do nothing" are the same answer here. That makes the whole SELECT-then-insert dance in
 * `enqueue` redundant for the fill, and lets the insert be a plain conflict-skip that a
 * batch can carry.
 *
 * The conflict target names 0031's partial unique index, WHERE clause included: without it
 * SQLite has no index to match and rejects the statement. The interpolated priority is a
 * code constant read straight off PRIORITY, so the two cannot drift; nothing else in this
 * SQL is anything but a bound value.
 */
const FILL_INSERT_SQL =
  `INSERT INTO records_queue (building_id, reason, priority, requested_at) VALUES (?, 'fill', ${PRIORITY.fill}, ?) ` +
  'ON CONFLICT(building_id) WHERE done_at IS NULL DO NOTHING';

/**
 * Sums `meta.changes` over a batch result, which is how many inserts actually landed: a row
 * skipped by the conflict clause reports 0. Both D1 and the test double return one result
 * per statement, in order.
 */
function changedRows(results: unknown): number {
  if (!Array.isArray(results)) {
    throw new Error('topUpFill: db.batch did not return per-statement results, so the enqueued count would be a guess');
  }
  let changed = 0;
  for (const result of results) changed += Number((result as { meta?: { changes?: number } } | null)?.meta?.changes ?? 0);
  return changed;
}

/** Inserts the planned fill rows in batches and returns how many landed. */
async function insertFillRows(db: RecordsDb, rows: { id: string }[], now: number): Promise<number> {
  let queued = 0;
  for (let start = 0; start < rows.length; start += FILL_INSERT_BATCH) {
    const chunk = rows.slice(start, start + FILL_INSERT_BATCH);
    queued += changedRows(await db.batch(chunk.map((row) => db.prepare(FILL_INSERT_SQL).bind(row.id, now))));
  }
  return queued;
}

/**
 * Tops the fill queue up to `target` pending rows from seeded buildings that are not yet
 * covered and have no pending row, ordered so a neighborhood completes together. Returns the
 * number actually enqueued, counted off the inserts that landed — see `insertFillRows`.
 *
 * "Covered" means at least one deeper pull that came back `ok` or `empty` — an answer. A
 * building whose every deeper pull errored learned nothing about the city, so it re-enters
 * the fill rather than being written off by a bad afternoon at data.boston.gov. It re-enters
 * BEHIND every building nobody has tried, which is what `has_any_pull` leads the ORDER BY
 * for: first coverage beats a retry, and a source that is down for a week cannot spend the
 * whole fill re-failing the same buildings. `empty` is an answer, not a miss — the city
 * having no permits for a building is exactly what the panel wants to show — so an `empty`
 * pull ends the building's time in the fill.
 *
 * `neighborhood IS NULL` sits next because SQLite sorts NULLs first by default and an
 * unplaced building should not jump ahead of a named neighborhood.
 */
export async function topUpFill(db: RecordsDb, options: PlannerOptions & { target?: number }): Promise<number> {
  const ids = options.deeperSourceIds;
  requireDeeperSourceIds('topUpFill', ids);
  const target = options.target ?? FILL_TARGET;
  const pending = await db
    .prepare("SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'fill' AND done_at IS NULL")
    .first<{ n: number }>();
  const room = target - (pending?.n ?? 0);
  if (room <= 0) return 0;
  const inList = placeholders(ids.length);
  const rows = await db
    .prepare(
      'SELECT b.id, ' +
        `EXISTS (SELECT 1 FROM record_pulls rp WHERE rp.building_id = b.id AND rp.source_id IN (${inList})) AS has_any_pull ` +
        "FROM buildings b WHERE b.source = 'seed' " +
        'AND NOT EXISTS (SELECT 1 FROM records_queue q WHERE q.building_id = b.id AND q.done_at IS NULL) ' +
        'AND NOT EXISTS (SELECT 1 FROM record_pulls rp WHERE rp.building_id = b.id ' +
        `AND rp.source_id IN (${inList}) AND rp.status IN ('ok','empty')) ` +
        'ORDER BY has_any_pull, b.neighborhood IS NULL, b.neighborhood, b.street_key, b.st_num_lo, b.id LIMIT ?',
    )
    .bind(...ids, ...ids, room)
    .all<{ id: string }>();
  return insertFillRows(db, rows.results, options.now);
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
  return (await readSetting(db, SETTING_KEYS.fillPaused)) === '1';
}

export async function setFillPaused(db: RecordsDb, paused: boolean, now: number): Promise<void> {
  await writeSetting(db, SETTING_KEYS.fillPaused, paused ? '1' : '0', now);
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
