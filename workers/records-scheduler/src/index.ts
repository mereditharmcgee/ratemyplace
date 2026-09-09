// The whole Worker: two cron triggers, one dependency bag, no logic. Everything the
// scheduler actually does lives in `src/lib/records/scheduler.ts`, where it is unit-tested
// against the node:sqlite D1 double. This file only wires bindings to those dependencies.
import type { D1Database, ScheduledEvent } from '@cloudflare/workers-types';
import { sendRecordsBreakerEmail } from '../../../src/lib/email';
import { errorMessage } from '../../../src/lib/records/errors';
import { runLanarkFixture } from '../../../src/lib/records/fixture';
import { drain, liveDeps, plan, type SchedulerDeps } from '../../../src/lib/records/scheduler';
import type { FetchLike, RecordsDb } from '../../../src/lib/records/types';

interface Env {
  DB: D1Database;
  RESEND_API_KEY: string;
  /** A secret, not a var, so the address is not in git. Unset is handled, not assumed away. */
  RECORDS_ALERT_EMAIL: string | undefined;
  SITE_URL: string;
}

const PLAN_CRON = '0 6 * * *';
const DRAIN_CRON = '* * * * *';

/**
 * This budget covers exactly one request: the fixture's direct SAM fetch, filtered to a
 * single parcel. `fetchAllRows` would otherwise hand that request the 120 s bulk-page
 * budget sized for the 32,000-row seed pull; `runLanarkFixture` already narrows it to
 * `FETCH_TIMEOUT_MS` (10 s), and 15 s is that with a little more room, which a cron can
 * afford where a user-facing request cannot. Every other request the fixture makes goes
 * out through `ckanSql`'s own 10 s timeout and is unaffected by this number.
 */
const FIXTURE_TIMEOUT_MS = 15_000;

function log(event: string, context: Record<string, unknown>, level: 'info' | 'error' = 'info'): void {
  const line = JSON.stringify({ level, timestamp: new Date().toISOString(), event, ...context });
  // Workers Logs keeps the stream either way, but only console.error shows as an error in
  // the dashboard, which is what makes a failure findable without reading every line.
  if (level === 'error') console.error(line);
  else console.log(line);
}

function depsFor(env: Env): SchedulerDeps {
  const fetchImpl: FetchLike = (input, init) => fetch(input, init);
  // `RecordsDb` is the structural slice of D1 this codebase actually uses; the interface
  // exists so the node:sqlite test double can stand in for the real binding.
  const db: RecordsDb = env.DB;
  return liveDeps(db, {
    fixture: () => runLanarkFixture(fetchImpl, { timeoutMs: FIXTURE_TIMEOUT_MS }),
    alert: async (subject, body) => {
      const to = env.RECORDS_ALERT_EMAIL;
      if (!to) {
        // No address is a deployment mistake, not a reason to fail the breaker: the pause
        // has already been written to D1 and holds. Say so loudly and carry on.
        log('records_breaker_email_skipped', { subject, reason: 'RECORDS_ALERT_EMAIL is not set' }, 'error');
        return;
      }
      // The alert is plain text, so the admin panel has to arrive as an absolute URL —
      // there is no document for a relative one to be relative to.
      const withLink = `${body}\n\n${env.SITE_URL}/admin/records`;
      const result = await sendRecordsBreakerEmail(env.RESEND_API_KEY, to, subject, withLink);
      if (!result.success) log('records_breaker_email_failed', { error: result.error }, 'error');
    },
    log,
  });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    let isPlan: boolean;
    switch (event.cron) {
      case PLAN_CRON:
        isPlan = true;
        break;
      case DRAIN_CRON:
        isPlan = false;
        break;
      default:
        // An unrecognised pattern means `wrangler.jsonc` and this file disagree about the
        // schedule. Guessing would run the wrong half of the system every minute.
        log('records_scheduler_unknown_cron', { cron: event.cron }, 'error');
        throw new Error(`Unknown cron trigger: ${event.cron}`);
    }

    const deps = depsFor(env);
    const started = Date.now();
    try {
      const result = isPlan ? await plan(deps) : await drain(deps);
      log(isPlan ? 'records_plan' : 'records_drain', { ...result, ms: Date.now() - started });
    } catch (err) {
      // Log it, then rethrow. Nobody is watching this run: a red line in the dashboard's
      // Cron Events pane is the only alarm an unattended cron gets, and swallowing the
      // error here would make a queue that has stopped moving look perfectly healthy.
      log('records_scheduler_error', { cron: event.cron, error: errorMessage(err) }, 'error');
      throw err;
    }
  },
};
