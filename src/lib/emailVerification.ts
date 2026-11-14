// The verified-email gate on review writes.
//
// Order in every route it guards: authentication (401), then this check (403), then
// ownership, content type, limiter, Turnstile, validation and the write. It runs before any
// D1 statement, so an unverified account spends no limiter budget, triggers no Turnstile call
// and learns nothing about whether a review id exists.
//
// Lucia re-reads `users.email_verified` on every request (middleware.ts calls
// validateSession), so an account whose email changes is gated from its next request.
//
// Server-only: the routes and the review pages' frontmatter call it.
import { VERIFY_TO_POST_ERROR } from './contributionCopy';

/** `details.reason` of the 403. A reason code, not copy. */
export const EMAIL_VERIFICATION_REQUIRED = 'email_verification_required';

/** Strict: only `emailVerified === true` passes. */
export function hasVerifiedEmail(user: { emailVerified?: unknown } | null | undefined): boolean {
  return user?.emailVerified === true;
}

/**
 * 403 in the reason envelope shared with Phase 26:
 * `{ error, details: { reason: 'email_verification_required' } }`.
 */
export function emailVerificationRequired(): Response {
  return new Response(
    JSON.stringify({ error: VERIFY_TO_POST_ERROR, details: { reason: EMAIL_VERIFICATION_REQUIRED } }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}
