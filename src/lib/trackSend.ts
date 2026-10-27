// The one call shape for an email sent from a request:
//
//   trackSend(context, 'password_reset', user.email, sendPasswordResetEmail(apiKey, ...));
//
// It runs the send in the background via `fireAndForget` (so the response is not held up)
// and records a failure on /admin through `trackEmail`. Request path only; the records Worker
// calls `trackEmail` directly.
import type { APIContext } from 'astro';
import { getDB } from './db';
import type { EmailResult } from './email';
import { trackEmail } from './emailHealth';
import type { EmailKind } from './emailHealth';
import { logError } from './logger';
import { fireAndForget } from './runtime';

/**
 * The host that served the request, stored with a failure so a preview deploy's failure —
 * preview writes to the production database — is labelled as one. Reads `request.url`, not
 * `context.url`, because several route-test contexts carry only a request.
 */
export function requestSource(context: APIContext): string | null {
  try {
    return new URL(context.request.url).host;
  } catch {
    return null;
  }
}

/**
 * Never throws: it runs after a route's own write has committed, and a tracking problem must
 * not turn a saved submission into a 500. If the tracker cannot be set up, the send is still
 * consumed so its promise can never become an unhandled rejection.
 */
export function trackSend(context: APIContext, kind: EmailKind, to: string, sending: Promise<EmailResult>): void {
  try {
    fireAndForget(context, trackEmail(getDB(context), { kind, to, source: requestSource(context) }, sending));
  } catch (err) {
    sending.catch(() => {});
    logError('email_track_failed', { kind, error: err instanceof Error ? err.message : String(err) });
  }
}
