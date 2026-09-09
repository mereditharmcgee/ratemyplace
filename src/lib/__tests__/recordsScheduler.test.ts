import { describe, expect, it } from 'vitest';
import {
  DEEPER_SOURCE_IDS,
  ERROR_WINDOW_SECONDS,
  FILL_PER_RUN,
  MIN_ATTEMPTS,
  PRIORITY_PER_RUN,
  SCHEDULER_SETTING_KEYS,
  drain,
  liveDeps,
  plan,
  type SchedulerDeps,
} from '../records/scheduler';
import { enqueue, getFillPaused, setFillPaused } from '../records/queue';
import { sourcesForCity } from '../records/jurisdictions';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import type { FixtureResult } from '../records/fixture';
import type { PullSummary, RecordsDb, RecordsPreparedStatement } from '../records/types';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import type { TestD1Database } from './helpers/sqliteD1';

const NOW = 1_800_000_000;

function fixtureResult(overrides: Partial<FixtureResult> = {}): FixtureResult {
  return {
    checks: [],
    checksFailed: 0,
    failures: 0,
    sourceErrors: [],
    rowsBySource: {},
    parcelId: '2102098000',
    condominium: false,
    ...overrides,
  };
}

interface LoggedEvent {
  event: string;
  context: Record<string, unknown>;
}

type TestDeps = SchedulerDeps & { alerts: string[]; pulled: string[]; logs: string[]; logged: LoggedEvent[] };

function deps(db: TestD1Database, overrides: Partial<SchedulerDeps> = {}): TestDeps {
  const alerts: string[] = [];
  const pulled: string[] = [];
  const logs: string[] = [];
  const logged: LoggedEvent[] = [];
  return {
    db,
    now: () => NOW,
    pull: async (_db, building, options): Promise<PullSummary> => {
      pulled.push(`${building.id}:${options.triggerReason}`);
      return { buildingId: building.id, jurisdiction: 'boston', parcelId: null, condominium: false, sources: [] };
    },
    fixture: async () => fixtureResult(),
    alert: async (subject, body) => {
      alerts.push(`${subject}\n${body}`);
    },
    log: (event, context) => {
      logs.push(event);
      logged.push({ event, context });
    },
    alerts,
    pulled,
    logs,
    logged,
    ...overrides,
  };
}

/** Inserts a `record_pulls` row directly: the breaker reads that table, it never writes it. */
async function pullRow(db: TestD1Database, id: string, sourceId: string, status: string, at: number): Promise<void> {
  await db
    .prepare(
      'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, retrieved_at) ' +
        "VALUES (?, 'b1', 'boston', ?, ?, 'q', ?, 0, ?)",
    )
    .bind(id, sourceId, sourceId, status, at)
    .run();
}

async function settingOf(db: TestD1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Wraps the test db so the one statement `failRow` runs throws, standing in for a D1 blip on
 * the failure write itself. Every other statement passes straight through.
 */
function failWriteThrows(db: TestD1Database): RecordsDb {
  return {
    prepare(sql: string): RecordsPreparedStatement {
      const inner = db.prepare(sql);
      const self: RecordsPreparedStatement = {
        bind(...values: unknown[]) {
          inner.bind(...(values as never[]));
          return self;
        },
        first: <T>() => inner.first<T>(),
        all: <T>() => inner.all<T>(),
        async run() {
          if (sql.startsWith('UPDATE records_queue SET last_error')) throw new Error('D1_ERROR: storage unavailable');
          return inner.run();
        },
      };
      return self;
    },
    batch: (statements: RecordsPreparedStatement[]) => db.batch(statements as never),
  };
}

describe('drain', () => {
  it('pulls up to PRIORITY_PER_RUN priority rows and FILL_PER_RUN fill rows, stamping queue:<reason>', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'p2', 'p3', 'p4', 'f1', 'f2']) await insertBuilding(db, { id, slug: id });
    for (const id of ['p1', 'p2', 'p3', 'p4']) await enqueue(db, { buildingId: id, reason: 'button', now: NOW });
    for (const id of ['f1', 'f2']) await enqueue(db, { buildingId: id, reason: 'fill', now: NOW });

    const d = deps(db);
    expect(await drain(d)).toEqual({ pulled: PRIORITY_PER_RUN + FILL_PER_RUN, failed: 0, fillPaused: false });
    expect(d.pulled).toEqual(['p1:queue:button', 'p2:queue:button', 'p3:queue:button', 'f1:queue:fill']);

    const done = await db.prepare('SELECT COUNT(*) AS n FROM records_queue WHERE done_at IS NOT NULL').first<{ n: number }>();
    expect(done?.n).toBe(PRIORITY_PER_RUN + FILL_PER_RUN);
  });

  it('stops early instead of spinning when the queue runs dry mid-run', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'p1', slug: 'p1' });
    await enqueue(db, { buildingId: 'p1', reason: 'button', now: NOW });

    const d = deps(db);
    expect(await drain(d)).toEqual({ pulled: 1, failed: 0, fillPaused: false });
    expect(d.pulled).toEqual(['p1:queue:button']);
  });

  it('skips fill rows while paused but still serves priority rows', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'f1']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'p1', reason: 'refresh', now: NOW });
    await enqueue(db, { buildingId: 'f1', reason: 'fill', now: NOW });
    await setFillPaused(db, true, NOW);

    const d = deps(db);
    expect(await drain(d)).toEqual({ pulled: 1, failed: 0, fillPaused: true });
    expect(d.pulled).toEqual(['p1:queue:refresh']);
  });

  it('records a thrown pull as a failed attempt and keeps draining the rest', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'p2']) await insertBuilding(db, { id, slug: id });
    for (const id of ['p1', 'p2']) await enqueue(db, { buildingId: id, reason: 'button', now: NOW });

    const d = deps(db, {
      pull: async (_db, building) => {
        if (building.id === 'p1') throw new Error('network down');
        return { buildingId: building.id, jurisdiction: 'boston', parcelId: null, condominium: false, sources: [] };
      },
    });
    expect(await drain(d)).toEqual({ pulled: 1, failed: 1, fillPaused: false });

    const row = await db
      .prepare("SELECT attempts, last_error, locked_at, done_at FROM records_queue WHERE building_id = 'p1'")
      .first<{ attempts: number; last_error: string; locked_at: number | null; done_at: number | null }>();
    // The lease survives the failure: it is the retry backoff, so the row is not claimable
    // again until it expires. See failRow.
    expect(row).toEqual({ attempts: 1, last_error: 'network down', locked_at: NOW, done_at: null });
    expect(d.logs).toEqual(['records_queue_pull_failed']);
  });

  it('does not re-claim the row it just failed, so one bad row cannot burn a whole run of attempts', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'p1', slug: 'p1' });
    await enqueue(db, { buildingId: 'p1', reason: 'button', now: NOW });

    const d = deps(db, {
      pull: async () => {
        throw new Error('network down');
      },
    });
    expect(await drain(d)).toEqual({ pulled: 0, failed: 1, fillPaused: false });

    const row = await db.prepare("SELECT attempts FROM records_queue WHERE building_id = 'p1'").first<{ attempts: number }>();
    // One claim spent of MAX_ATTEMPTS, not three: the kept lease is what stops the run from
    // coming straight back round to the same row and parking it inside a single tick.
    expect(row?.attempts).toBe(1);
  });

  it('claims one row at a time, so a row finished mid-run is never pulled', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'p2', 'p3']) await insertBuilding(db, { id, slug: id });
    for (const id of ['p1', 'p2', 'p3']) await enqueue(db, { buildingId: id, reason: 'button', now: NOW });

    const d = deps(db);
    const record = d.pull;
    // Someone else finishes p2 while p1 is in flight. A drain that claimed all three up front
    // would already hold p2 and pull a building whose records had just been written.
    d.pull = async (dbArg, building, options) => {
      if (building.id === 'p1') {
        await db.prepare("UPDATE records_queue SET done_at = ? WHERE building_id = 'p2'").bind(NOW).run();
      }
      return record(dbArg, building, options);
    };

    expect(await drain(d)).toEqual({ pulled: 2, failed: 0, fillPaused: false });
    expect(d.pulled).toEqual(['p1:queue:button', 'p3:queue:button']);
  });

  it('does not let a failing priority row cost the tick its fill row', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'f1']) await insertBuilding(db, { id, slug: id });
    await enqueue(db, { buildingId: 'p1', reason: 'button', now: NOW });
    await enqueue(db, { buildingId: 'f1', reason: 'fill', now: NOW });

    const d = deps(db);
    const record = d.pull;
    d.pull = async (dbArg, building, options) => {
      if (building.id === 'p1') throw new Error('network down');
      return record(dbArg, building, options);
    };

    // The priority loop ends early — p1 holds its lease, so there is nothing left to claim —
    // but the fill loop is a separate budget and still gets its row.
    expect(await drain(d)).toEqual({ pulled: 1, failed: 1, fillPaused: false });
    expect(d.pulled).toEqual(['f1:queue:fill']);
  });

  it('logs and keeps draining when the failure write itself fails', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'p2']) await insertBuilding(db, { id, slug: id });
    for (const id of ['p1', 'p2']) await enqueue(db, { buildingId: id, reason: 'button', now: NOW });

    const d = deps(db);
    const record = d.pull;
    d.pull = async (dbArg, building, options) => {
      if (building.id === 'p1') throw new Error('network down');
      return record(dbArg, building, options);
    };
    d.db = failWriteThrows(db);

    // A lost `last_error` costs a diagnostic line; aborting the drain would strand p2.
    expect(await drain(d)).toEqual({ pulled: 1, failed: 1, fillPaused: false });
    expect(d.pulled).toEqual(['p2:queue:button']);
    expect(d.logs).toEqual(['records_queue_pull_failed', 'records_queue_fail_write_failed']);
  });

  it('re-reads the clock before each claim, so a slow run does not date its later work from the start', async () => {
    const db = createRecordsTestDb();
    for (const id of ['p1', 'p2']) await insertBuilding(db, { id, slug: id });
    for (const id of ['p1', 'p2']) await enqueue(db, { buildingId: id, reason: 'button', now: NOW });

    let clock = NOW;
    const d = deps(db, { now: () => (clock += 60) });
    await drain(d);

    const rows = await db
      .prepare('SELECT building_id, done_at FROM records_queue ORDER BY id')
      .all<{ building_id: string; done_at: number }>();
    expect(rows.results.map((r) => r.building_id)).toEqual(['p1', 'p2']);
    expect(rows.results[1].done_at).toBeGreaterThan(rows.results[0].done_at);
  });
});

describe('plan', () => {
  it('runs refresh planning, fill top-up, purge, the fixture, and reports numbers', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 's1' });
    await db
      .prepare(
        "UPDATE buildings SET source = 'seed', neighborhood = 'Allston', street_key = 'A ST', st_num_lo = 1, st_num_hi = 1 WHERE id = 's1'",
      )
      .run();

    const d = deps(db);
    expect(await plan(d)).toMatchObject({
      refreshEnqueued: 0,
      fillEnqueued: 1,
      purged: 0,
      fixtureFailures: 0,
      paused: false,
      alerted: false,
    });
    expect(d.alerts).toEqual([]);
    // The daily numbers are the only record of what the plan did; nothing else logs them.
    expect(d.logged).toContainEqual({
      event: 'records_plan_enqueued',
      context: { purged: 0, refreshEnqueued: 0, fillEnqueued: 1 },
    });
  });

  it('stores the fixture result under the scheduler setting key on a healthy run', async () => {
    const db = createRecordsTestDb();
    const d = deps(db, {
      fixture: async () => fixtureResult({ rowsBySource: { 'Approved Building Permits': 0, RentSmart: 4 } }),
    });
    await plan(d);

    const stored = await settingOf(db, SCHEDULER_SETTING_KEYS.lastFixture);
    expect(JSON.parse(stored!)).toEqual({
      at: NOW,
      failures: 0,
      checksFailed: 0,
      failed: [],
      sourceErrors: [],
      rowsBySource: { 'Approved Building Permits': 0, RentSmart: 4 },
    });
    expect(await settingOf(db, SCHEDULER_SETTING_KEYS.lastAlert)).toBeNull();
  });

  it('pauses the fill and alerts once when the fixture fails, and does not alert again while paused', async () => {
    const db = createRecordsTestDb();
    const d = deps(db, {
      fixture: async () =>
        fixtureResult({
          checks: [{ label: 'parcel resolves to 2102098000', ok: false, detail: 'got null' }],
          checksFailed: 1,
          failures: 2,
          sourceErrors: [{ label: 'RentSmart', message: 'HTTP 503' }],
          rowsBySource: { 'Approved Building Permits': 0 },
        }),
    });

    expect(await plan(d)).toMatchObject({ paused: true, alerted: true, fixtureFailures: 2 });
    expect(await getFillPaused(db)).toBe(true);
    expect(d.alerts).toHaveLength(1);
    expect(d.alerts[0]).toContain('1 check failed, 1 source threw');
    // The headline is the fixture report's first line and nothing repeats it above.
    expect(d.alerts[0].split('1 check failed, 1 source threw')).toHaveLength(2);
    expect(d.alerts[0]).toContain('parcel resolves to 2102098000: got null');
    expect(d.alerts[0]).toContain('RentSmart threw: HTTP 503');
    expect(d.alerts[0]).toContain('Approved Building Permits: 0');
    expect(await settingOf(db, SCHEDULER_SETTING_KEYS.lastAlert)).toBe(String(NOW));
    expect(d.logs).toContain('records_fill_paused');

    expect(await plan(d)).toMatchObject({ paused: true, alerted: false });
    expect(d.alerts).toHaveLength(1);
  });

  it('pauses when any source error rate exceeds the threshold with enough attempts, not below it', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    for (let i = 0; i < MIN_ATTEMPTS - 1; i += 1) await pullRow(db, `p${i}`, 'permits', 'error', NOW - i);
    expect(await plan(deps(db))).toMatchObject({ paused: false, alerted: false });

    for (let i = MIN_ATTEMPTS - 1; i < MIN_ATTEMPTS + 5; i += 1) await pullRow(db, `p${i}`, 'permits', 'error', NOW - i);
    const d = deps(db);
    expect(await plan(d)).toMatchObject({ paused: true, alerted: true });
    expect(d.alerts[0]).toContain('permits');
  });

  it('leaves a source alone when half its attempts failed but no more than half', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    for (let i = 0; i < 30; i += 1) await pullRow(db, `p${i}`, 'permits', i % 2 === 0 ? 'error' : 'ok', NOW - i);
    expect(await plan(deps(db))).toMatchObject({ paused: false, alerted: false });
  });

  it('ignores failures older than the error window', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    for (let i = 0; i < 30; i += 1) await pullRow(db, `p${i}`, 'permits', 'error', NOW - ERROR_WINDOW_SECONDS - i - 1);
    expect(await plan(deps(db))).toMatchObject({ paused: false, alerted: false });
  });

  it('does not unpause by itself once the fixture is healthy again', async () => {
    const db = createRecordsTestDb();
    await setFillPaused(db, true, NOW);
    expect(await plan(deps(db))).toMatchObject({ paused: true, alerted: false });
    expect(await getFillPaused(db)).toBe(true);
    // The fixture ran and its result is stored even though the pause predates it: the panel
    // needs today's fixture to tell "still broken" from "fixed, waiting for a human".
    expect(JSON.parse((await settingOf(db, SCHEDULER_SETTING_KEYS.lastFixture))!)).toMatchObject({ at: NOW, failures: 0 });
  });

  it('records the pause before sending the alert, so a failing mailer cannot lose it', async () => {
    const db = createRecordsTestDb();
    const d = deps(db, {
      fixture: async () =>
        fixtureResult({
          checks: [{ label: 'parcel resolves to 2102098000', ok: false, detail: 'got null' }],
          checksFailed: 1,
          failures: 1,
        }),
      alert: async () => {
        throw new Error('mailer down');
      },
    });

    await expect(plan(d)).rejects.toThrow('mailer down');
    expect(await getFillPaused(db)).toBe(true);
    expect(d.logs).toContain('records_fill_paused');
  });
});

describe('DEEPER_SOURCE_IDS', () => {
  /** Named rather than filtered, so re-deriving the list cannot re-derive the bug with it. */
  const DEEPER_LABELS = [
    'Approved Building Permits',
    'Building and Property Violations',
    'Public Works Code Enforcement',
    '311 Service Requests',
    'RentSmart',
  ];

  it('is exactly the five non-assessor Boston sources, in source-list order', () => {
    const sources = sourcesForCity('Boston');
    const expected = DEEPER_LABELS.map((label) => {
      const source = sources.find((s) => s.label === label);
      if (!source) throw new Error(`no Boston source labelled ${label}`);
      return source.id;
    });
    expect(DEEPER_SOURCE_IDS).toEqual(expected);
    // The six assessor years are the whole point of the exclusion: the seed wrote an FY2026
    // pull row for every seeded building, so counting them marks the city done on day one.
    expect(sources).toHaveLength(DEEPER_LABELS.length + 6);
    expect(DEEPER_SOURCE_IDS).not.toContain(FY2026_RESOURCE_ID);
  });
});

describe('liveDeps', () => {
  it('reads the wall clock in seconds and keeps the injected fixture, alert, and log', async () => {
    const db = createRecordsTestDb();
    const fixture = async () => fixtureResult();
    const alert = async () => undefined;
    const log = () => undefined;
    const built = liveDeps(db, { fixture, alert, log });

    expect(built.db).toBe(db);
    expect(built.fixture).toBe(fixture);
    expect(built.alert).toBe(alert);
    expect(built.log).toBe(log);
    expect(Number.isInteger(built.now())).toBe(true);
    expect(Math.abs(built.now() - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(1);
  });
});
