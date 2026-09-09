// The whole Worker: two cron triggers, one dependency bag, no logic. Everything the
// scheduler actually does lives in `src/lib/records/scheduler.ts`, where it is unit-tested
// against the node:sqlite D1 double. This file only wires bindings to those dependencies.
import type { D1Database, ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';
import { sendRecordsBreakerEmail } from '../../../src/lib/email';
import { runLanarkFixture } from '../../../src/lib/records/fixture';
import { drain, liveDeps, plan, type SchedulerDeps } from '../../../src/lib/records/scheduler';
import type { FetchLike, RecordsDb } from '../../../src/lib/records/types';

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
  RECORDS_ALERT_EMAIL: string;
  SITE_URL: string;
}

const PLAN_CRON = '0 6 * * *';

/**
 * The fixture is one SAM lookup plus one run of every Boston source for a single parcel —
 * nothing like the multi-page bulk pulls `FETCH_TIMEOUT_MS` is sized for. A tight budget
 * keeps the daily plan well inside the Worker's own limits when a source hangs.
 */
const FIXTURE_TIMEOUT_MS = 15_000;

function log(event: string, context: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', timestamp: new Date().toISOString(), event, ...context }));
}

function depsFor(env: Env): SchedulerDeps {
  const fetchImpl: FetchLike = (input, init) => fetch(input, init);
  // D1Database satisfies RecordsDb structurally (prepare/batch); the cast keeps the Worker
  // types and the site's types from having to agree on the D1 package version.
  const db = env.DB as unknown as RecordsDb;
  return liveDeps(db, {
    fixture: () => runLanarkFixture(fetchImpl, { timeoutMs: FIXTURE_TIMEOUT_MS }),
    alert: async (subject, body) => {
      const result = await sendRecordsBreakerEmail(env.RESEND_API_KEY, env.RECORDS_ALERT_EMAIL, subject, body);
      if (!result.success) log('records_breaker_email_failed', { error: result.error });
    },
    log,
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = depsFor(env);
    const started = Date.now();
    const work =
      event.cron === PLAN_CRON
        ? plan(deps).then((r) => log('records_plan', { ...r, ms: Date.now() - started }))
        : drain(deps).then((r) => log('records_drain', { ...r, ms: Date.now() - started }));
    ctx.waitUntil(
      work.catch((err) =>
        log('records_scheduler_error', { cron: event.cron, error: err instanceof Error ? err.message : String(err) })
      )
    );
    await work;
  },
};
