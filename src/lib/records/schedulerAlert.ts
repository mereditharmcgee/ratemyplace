// The records Worker's `alert` dependency: email the maintainer that the city-wide fill
// paused itself (or resumed), and leave a trace on /admin if that email fails.
//
// Moved out of `workers/records-scheduler/src/index.ts` so it can be unit-tested; the Worker
// only wires its bindings into it. Runs inside the Worker, so everything it imports must stay
// runtime-agnostic (no `node:`, no runtime `astro`).
import { OWNER_NOTIFY_EMAIL, sendRecordsBreakerEmail, sendRecordsResumedEmail } from '../email';
import type { EmailResult } from '../email';
import { trackEmail } from '../emailHealth';
import { RECORDS_RESUMED_SUBJECT } from './scheduler';
import type { SchedulerDeps } from './scheduler';
import type { RecordsDb } from './types';

export interface SchedulerAlertConfig {
  db: RecordsDb;
  apiKey: string | undefined;
  /** The Worker's RECORDS_ALERT_EMAIL secret. Unset or blank falls back to OWNER_NOTIFY_EMAIL. */
  alertEmail: string | undefined;
  siteUrl: string;
  log: (event: string, context: Record<string, unknown>, level?: 'info' | 'error') => void;
}

/** Every failure is recorded with this source, so /admin never mistakes it for a preview's. */
const SOURCE = 'records-scheduler';

/** Never throws: the pause has already been written to D1 by the time this runs, and holds. */
export function schedulerAlert(config: SchedulerAlertConfig): SchedulerDeps['alert'] {
  return async (subject, body) => {
    try {
      const configured = config.alertEmail?.trim();
      const to = configured || OWNER_NOTIFY_EMAIL;
      if (!configured) {
        // A missing secret is a deployment mistake. It used to drop the alert entirely; now
        // the owner inbox gets it, and the log says the secret is missing.
        config.log('records_alert_recipient_default', { subject }, 'error');
      }

      // The alert is plain text, so the admin panel has to arrive as an absolute URL —
      // there is no document for a relative one to be relative to.
      const withLink = `${body}\n\n${config.siteUrl}/admin/records`;
      const apiKey = config.apiKey ?? '';

      // `alert` stays one (subject, body) dependency; the scheduler's two subjects are
      // constants, so the resume email is told apart by its subject and anything else is the
      // breaker's. Two explicit tracked calls, so each kind is recorded as itself.
      let result: EmailResult;
      if (subject === RECORDS_RESUMED_SUBJECT) {
        result = await trackEmail(config.db, { kind: 'records_resumed', to, source: SOURCE }, sendRecordsResumedEmail(apiKey, to, subject, withLink));
      } else {
        result = await trackEmail(config.db, { kind: 'records_breaker', to, source: SOURCE }, sendRecordsBreakerEmail(apiKey, to, subject, withLink));
      }

      if (!result.success) {
        // No `error` field: Resend's message can echo the recipient address.
        config.log(
          'records_breaker_email_failed',
          { subject, reason: result.reason ?? 'unknown', code: result.code ?? null, http_status: result.httpStatus ?? null },
          'error',
        );
      }
    } catch (err) {
      config.log('records_breaker_email_failed', { subject, reason: 'exception', code: err instanceof Error ? err.name : typeof err }, 'error');
    }
  };
}
