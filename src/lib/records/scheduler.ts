// What the companion Cron Worker actually runs: `drain` on the minute tick, `plan` once a
// day. Everything here is a pure function over injected dependencies — clock, pull, fixture,
// alert, log — so the whole scheduler is unit-tested against the node:sqlite D1 double and
// the Worker stays a five-line `scheduled()` handler over `liveDeps`.
import { sourcesForCity } from './jurisdictions';
import { errorMessage } from './errors';
import { pullBuildingRecords, type PullOptions } from './pull';
import {
  claimBatch,
  completeRow,
  errorRateBySource,
  failRow,
  getFillPaused,
  planRefresh,
  purgeFinished,
  setFillPaused,
  topUpFill,
  type ClaimedRow,
} from './queue';
import { SETTING_KEYS, writeSetting } from './settings';
import type { FixtureResult } from './fixture';
import type { BuildingRowForIdentity } from './identity';
import type { PullSummary, RecordsDb } from './types';

/**
 * Per one-minute tick. A seeded building's pull is about 27 requests to data.boston.gov —
 * 17 of them 311 (sixteen yearly files plus the new-system resource), one per assessor year,
 * one each for the other four sources, and no parcel-resolution query, because a seeded row
 * already carries its parcel. Three people-facing rows plus one city-wide row is therefore
 * about 110 requests a minute — polite against a public CKAN endpoint, well under the Workers
 * limit of 1,000 subrequests per invocation, and slow enough that the fill takes months on
 * purpose. Each pull also writes 11 `record_pulls` rows, one per source.
 */
export const PRIORITY_PER_RUN = 3;
export const FILL_PER_RUN = 1;
/**
 * Wall-clock ceiling on one drain, checked before every claim.
 *
 * The cron fires every minute whether or not the previous tick has finished, and Cloudflare
 * does not queue or skip a tick because one is still running. Without a budget a slow
 * upstream does not throttle the system, it compounds it: a tick that takes three minutes is
 * overlapped by two more, each claiming its own rows and opening its own connections to
 * data.boston.gov, and the pile-up grows for as long as the city is slow. Stopping short of
 * the next tick keeps at most one drain in flight, so a slow upstream costs throughput
 * instead of multiplying load.
 *
 * 45 s, not 60: the check happens before a claim, so the pull it lets through still has to
 * finish, and a pull's own worst case is bounded by the per-source timeout, not by this.
 */
export const DRAIN_BUDGET_MS = 45_000;
/** The breaker trips when a source fails more than this share of its attempts in the window. */
export const ERROR_RATE_THRESHOLD = 0.5;
/** Below this many attempts a rate means nothing: three failures out of three is a quiet hour, not an outage. */
export const MIN_ATTEMPTS = 20;
export const ERROR_WINDOW_SECONDS = 86_400;

/**
 * Every Boston source except the assessor years: a building "has records" when one of these
 * has a pull row. The assessor is excluded because the seed already wrote an FY2026 pull row
 * for all 38,208 seeded buildings, so counting it would mark the whole city as done.
 */
export const DEEPER_SOURCE_IDS: string[] = sourcesForCity('Boston')
  .filter((source) => !source.kinds.includes('assessment'))
  .map((source) => source.id);

export interface SchedulerDeps {
  db: RecordsDb;
  /** Unix seconds. Read fresh per claim, not once per run — a drain takes real time. */
  now: () => number;
  /**
   * Milliseconds, for the drain's own budget only — never for a stored timestamp. Separate
   * from `now` because a second-resolution clock cannot measure a 45 s budget without
   * rounding a whole tick away, and because a test that advances one must be free to leave
   * the other alone. Defaults to `Date.now`.
   */
  clockMs?: () => number;
  pull: (db: RecordsDb, building: BuildingRowForIdentity, options: PullOptions) => Promise<PullSummary>;
  fixture: () => Promise<FixtureResult>;
  alert: (subject: string, body: string) => Promise<void>;
  log: (event: string, context: Record<string, unknown>) => void;
}

export interface DrainResult {
  pulled: number;
  failed: number;
  fillPaused: boolean;
  /** True when the run stopped claiming early because DRAIN_BUDGET_MS was spent. */
  budgetHit: boolean;
}

export interface PlanResult {
  refreshEnqueued: number;
  fillEnqueued: number;
  purged: number;
  /** `FixtureResult.failures`: failed checks plus sources that threw. */
  fixtureFailures: number;
  paused: boolean;
  alerted: boolean;
}

/** The default dependency bag for the Worker; tests build their own. */
export function liveDeps(db: RecordsDb, extra: Pick<SchedulerDeps, 'fixture' | 'alert' | 'log'>): SchedulerDeps {
  return { db, now: () => Math.floor(Date.now() / 1000), pull: pullBuildingRecords, ...extra };
}

/**
 * One cron tick: people-facing rows first, then one fill row unless the fill is paused.
 *
 * Rows are claimed ONE AT A TIME, with the clock re-read immediately before each claim and
 * the pull run immediately after it, so the lease genuinely covers the request that is in
 * flight. Claiming the whole tick's worth up front would date every lease from the start of
 * the run, and the last row's lease would already be minutes old before its pull began.
 *
 * A failure is recorded where it happens. The lease ALONE is the backoff: `failRow`
 * deliberately leaves `locked_at` set, so the row it just failed is unclaimable for the rest
 * of this tick and for LOCK_TTL_SECONDS after it, and nothing has to be held back to the end
 * of the run to keep it out of the next claim. If the run dies before the write lands, the
 * lease still expires on its own and the row is retried then.
 *
 * Both claim loops also stop when DRAIN_BUDGET_MS of wall clock is gone, so a slow city does
 * not leave three ticks' worth of drains running at once. See the constant.
 */
export async function drain(deps: SchedulerDeps): Promise<DrainResult> {
  const clockMs = deps.clockMs ?? Date.now;
  const startedAt = clockMs();
  const fillPaused = await getFillPaused(deps.db);
  let pulled = 0;
  let failed = 0;
  let budgetHit = false;

  const claimAndRun = async (bounds: { priorityMin?: number; priorityMax: number }): Promise<boolean> => {
    // Checked before the claim, never after: a claim spends an attempt, so a row taken and
    // then abandoned for the budget would be one try closer to parking for nothing.
    if (clockMs() - startedAt >= DRAIN_BUDGET_MS) {
      budgetHit = true;
      return false;
    }
    const [row] = await claimBatch(deps.db, { now: deps.now(), limit: 1, ...bounds });
    if (!row) return false;
    if (await runRow(deps, row)) pulled += 1;
    else failed += 1;
    return true;
  };

  for (let i = 0; i < PRIORITY_PER_RUN; i += 1) {
    if (!(await claimAndRun({ priorityMax: 1 }))) break;
  }
  if (!fillPaused) {
    for (let i = 0; i < FILL_PER_RUN; i += 1) {
      if (!(await claimAndRun({ priorityMin: 2, priorityMax: 2 }))) break;
    }
  }

  // Logged as well as returned. The Worker's `records_drain` line carries the flag either
  // way, but a run that ran out of clock is the one thing in this result worth searching
  // for by event name when the queue starts falling behind.
  if (budgetHit) deps.log('records_drain_budget_hit', { pulled, failed, budgetMs: DRAIN_BUDGET_MS });

  return { pulled, failed, fillPaused, budgetHit };
}

/**
 * Runs one claimed row. Returns true when the pull succeeded.
 *
 * `completeRow` sits OUTSIDE the try: a pull that worked but could not be marked done is a
 * database problem, not a pull failure, and recording it as one would leave the row looking
 * retryable while its records are already written. It surfaces instead.
 *
 * The `failRow` write gets its own try/catch because it is the one write a failing tick
 * must not fail at: the lease is already the backoff, so a lost `last_error` costs one
 * diagnostic line, while a throw here would abort the drain and strand every row behind
 * this one.
 */
async function runRow(deps: SchedulerDeps, row: ClaimedRow): Promise<boolean> {
  try {
    await deps.pull(deps.db, row.building, { triggeredBy: null, triggerReason: `queue:${row.reason}` });
  } catch (err) {
    const message = errorMessage(err);
    deps.log('records_queue_pull_failed', {
      queueId: row.id,
      buildingId: row.buildingId,
      reason: row.reason,
      attempts: row.attempts,
      error: message,
    });
    try {
      await failRow(deps.db, row.id, message);
    } catch (writeErr) {
      deps.log('records_queue_fail_write_failed', {
        queueId: row.id,
        buildingId: row.buildingId,
        error: errorMessage(writeErr),
      });
    }
    return false;
  }
  await completeRow(deps.db, row.id, deps.now());
  return true;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The one line that says how the fixture went: the breaker trip reason, and the report's first line. */
function fixtureHeadline(fixture: FixtureResult): string {
  return `Lanark fixture: ${plural(fixture.checksFailed, 'check')} failed, ${plural(fixture.sourceErrors.length, 'source')} threw`;
}

/**
 * What the fixture saw, for a human reading the alert at 3am: the headline numbers, then
 * every failed check with its detail and every source that threw, then the per-source row
 * counts. The row counts are the fastest way to tell "the city is down" from "our query
 * broke" — a source that returns zero rows where it returned four hundred yesterday is a
 * different problem from one that threw.
 */
function fixtureReport(fixture: FixtureResult): string {
  const lines = [`${fixtureHeadline(fixture)}.`];
  for (const check of fixture.checks) if (!check.ok) lines.push(`  - ${check.label}: ${check.detail}`);
  for (const failure of fixture.sourceErrors) lines.push(`  - ${failure.label} threw: ${failure.message}`);
  const labels = Object.keys(fixture.rowsBySource).sort();
  if (labels.length > 0) {
    lines.push('Rows by source:');
    for (const label of labels) lines.push(`  ${label}: ${fixture.rowsBySource[label]}`);
  }
  return lines.join('\n');
}

/**
 * The daily tick. Order matters: purge, then refresh, then fill top-up, then the fixture and
 * the error rates, so a breaker trip is judged on the day's pulls and stops the fill before
 * the next drain. The breaker only ever pauses — a human unpauses from the admin panel, so a
 * source that flaps cannot pause and resume the fill behind everyone's back.
 */
export async function plan(deps: SchedulerDeps): Promise<PlanResult> {
  const now = deps.now();
  const purged = await purgeFinished(deps.db, { now });
  const refreshEnqueued = await planRefresh(deps.db, { now, deeperSourceIds: DEEPER_SOURCE_IDS });
  const fillEnqueued = await topUpFill(deps.db, { now, deeperSourceIds: DEEPER_SOURCE_IDS });
  // Rows that actually landed, not rows planned: a reader who pressed the button between a
  // planner's SELECT and its insert owns that row, and this line is the only lasting record
  // of how the day's fill went.
  deps.log('records_plan_enqueued', { purged, refreshEnqueued, fillEnqueued });

  const fixture = await deps.fixture();
  await writeSetting(
    deps.db,
    SETTING_KEYS.fixtureLast,
    JSON.stringify({
      at: now,
      failures: fixture.failures,
      checksFailed: fixture.checksFailed,
      checksTotal: fixture.checks.length,
      failed: fixture.checks.filter((check) => !check.ok).map((check) => check.label),
      sourceErrors: fixture.sourceErrors,
      rowsBySource: fixture.rowsBySource,
    }),
    now,
  );

  const rates = await errorRateBySource(deps.db, { now, windowSeconds: ERROR_WINDOW_SECONDS });
  // Every source counts here, the six assessor years included, even though the fill's notion of
  // "covered" excludes them. That is deliberate: parcel resolution runs through the assessor, so
  // an assessor outage fails every other source for the same building, and a breaker blind to it
  // would watch five sources fail without ever naming the one thing that broke them.
  const tripped = rates.filter((rate) => rate.attempts >= MIN_ATTEMPTS && rate.rate > ERROR_RATE_THRESHOLD);

  // The rate trips are listed in the email; the fixture headline is not, because
  // `fixtureReport` prints it two lines further down and once is enough.
  const rateReasons = tripped.map(
    (rate) => `Source ${rate.sourceId}: ${rate.errors} of ${rate.attempts} pulls failed in the last 24 hours`,
  );
  const reasons = fixture.failures > 0 ? [fixtureHeadline(fixture), ...rateReasons] : rateReasons;

  const wasPaused = await getFillPaused(deps.db);
  let alerted = false;
  if (reasons.length > 0 && !wasPaused) {
    await setFillPaused(deps.db, true, now);
    // Logged before the alert goes out: the pause is what happened, and a mail provider having
    // a bad minute must not be the reason nothing recorded it.
    deps.log('records_fill_paused', { reasons });
    const body = ['The city-wide records fill was paused automatically.', ''];
    if (rateReasons.length > 0) body.push(...rateReasons, '');
    body.push(
      fixtureReport(fixture),
      '',
      'Button and refresh pulls keep running. Clear the pause from /admin/records once the cause is understood.',
    );
    await deps.alert('RateMyPlace records fill paused', body.join('\n'));
    await writeSetting(deps.db, SETTING_KEYS.breakerLastAlert, String(now), now);
    alerted = true;
  }

  return {
    refreshEnqueued,
    fillEnqueued,
    purged,
    fixtureFailures: fixture.failures,
    paused: reasons.length > 0 || wasPaused,
    alerted,
  };
}

/**
 * The `app_settings` keys this module writes, under the names its own callers use. The keys
 * themselves live in `settings.ts`, a leaf module anything can import; this is an alias, not
 * a second copy.
 */
export const SCHEDULER_SETTING_KEYS = {
  lastAlert: SETTING_KEYS.breakerLastAlert,
  lastFixture: SETTING_KEYS.fixtureLast,
} as const;
