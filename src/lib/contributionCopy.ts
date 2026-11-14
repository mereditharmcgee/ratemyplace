// What the review pages say to a signed-in account whose email is not verified, and the one
// rule for what the step's resend button shows after the server answers.
//
// LEAF MODULE: no runtime imports. The email verification step's page script imports it, so
// anything it imported would ship to every visitor (`clientLeafModules.test.ts` enforces it).
//
// Every string but `residencyNote` is one the site already shows or sends; the comment names
// where. `emailVerification.test.ts` checks each reused string is still in its source.

export const EMAIL_GATE_COPY = {
  /** The profile's unverified status line (ProfileDashboard.tsx). */
  heading: 'Your email address is not verified',
  /** The verification email's first sentence (email.ts). Also the 403 line, below. */
  why: 'Confirm your email so you can post reviews.',
  /** The profile's resend button and its busy label (ProfileDashboard.tsx). */
  resend: 'Send Verification Email',
  sending: 'Sending...',
  /** The resend route's success message (resend-verification.ts); approved by the owner for the step. */
  sent: 'Verification email sent',
  /** The profile's resend failure line (ProfileDashboard.tsx). */
  failed: 'An error occurred',
  /** The owner's words: email verification versus the optional residency document. */
  residencyNote:
    'Confirming your email lets you post reviews. Residency verification is a separate, optional step where you show a lease or similar document, and it adds a Residency verified badge to your review.',
} as const;

/** The 403 body's `error` from all three write routes, for create and edit alike. */
export const VERIFY_TO_POST_ERROR: string = EMAIL_GATE_COPY.why;

/** `details.reason` on the resend route's existing 400 when the account is already verified. */
export const EMAIL_ALREADY_VERIFIED = 'email_already_verified';

export type GateResendOutcome = { kind: 'reload' } | { kind: 'status'; text: string };

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

/**
 * What the step does after POST /api/auth/resend-verification answers:
 * - 2xx: say the email was sent;
 * - 400 whose `details.reason` is EMAIL_ALREADY_VERIFIED (verified in another tab or device):
 *   reload, so the form renders. Keyed on the reason, never the bare status, so a different
 *   400 cannot start a reload loop;
 * - 429 or 503 with a non-empty string `error`: that text (the limiter's own lines);
 * - anything else, an unparseable body included: the failure line.
 * A network failure never reaches here; the script shows `failed` for it.
 */
export function gateResendOutcome(status: number, body: unknown): GateResendOutcome {
  if (status >= 200 && status < 300) return { kind: 'status', text: EMAIL_GATE_COPY.sent };
  if (status === 400 && field(field(body, 'details'), 'reason') === EMAIL_ALREADY_VERIFIED) {
    return { kind: 'reload' };
  }
  const error = field(body, 'error');
  if ((status === 429 || status === 503) && typeof error === 'string' && error !== '') {
    return { kind: 'status', text: error };
  }
  return { kind: 'status', text: EMAIL_GATE_COPY.failed };
}
