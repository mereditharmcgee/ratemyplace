// What the profile tells a reviewer about their proof-of-address document, and the one rule
// for which line a review shows; plus what the admin queue says when a document cannot be
// shown. A client leaf: the profile's review list and notification list and the admin queue
// (React islands) import it, so it has no runtime imports (clientLeafModules.test.ts).
//
// Every string here is a proposal the owner may edit. The notification messages themselves
// live in EVENT_MESSAGES (notifications.ts), because they are written when the decision is
// made, and the rejection email lives in email.ts with the other templates.

/** A verification_images.status, or null when the review has never had a document. */
export type VerificationStatus = 'pending' | 'approved' | 'rejected';

export const VERIFICATION_COPY = {
  /** No document yet. The wording the profile had before November 2026. */
  prompt: 'Verify your tenancy to add a trust badge to this review',
  verifyButton: 'Verify',
  /** A document is waiting for an admin. Nothing else is shown, and there is no button: a second upload is refused while one is pending. */
  pending: 'Your document is waiting for review.',
  /** The last document was not accepted. */
  rejected: 'We could not verify your tenancy with the document you sent.',
  /** Shown before the moderator's reason, only when they gave one. Matches the review-not-published email. */
  reasonLabel: 'What we noted:',
  tryAgain: 'You can send a different one. A lease, a utility bill, a rent receipt or mail with your name and this address all work.',
  tryAgainButton: 'Send a different document',
  /** The action on a verification notice in the notification list. */
  notificationAction: 'Go to My Reviews',
} as const;

/**
 * The help text under "Email me when my review status changes" in profile settings. It names
 * every email that setting turns off (wantsReviewStatusEmail in notifications.ts).
 */
export const REVIEW_STATUS_EMAIL_HINT =
  'Today that means an email if a review is not approved, or if we cannot verify your tenancy with a document you sent. Your dashboard shows every update either way.';

/**
 * Admin-facing. An admin opening a document is logged first, and the document is served only
 * when that entry is written (GET /api/admin/verification/[id] fails closed).
 */
export const VERIFICATION_ADMIN_COPY = {
  /** The route's 503 error. A PDF opens in its own tab, which shows this. */
  viewNotLogged: 'This document was not shown because its view could not be logged. Try again in a minute.',
  /** The queue's line in place of an image that did not load. An image cannot read the error, so this covers a missing file too. */
  documentNotShown: 'This document could not be shown. Its view may not have been logged, or the file may be missing.',
  retry: 'Try again',
} as const;

/** Notification events that get the "Go to My Reviews" action. */
export const VERIFICATION_NOTICE_EVENTS: readonly string[] = ['verification_approved', 'verification_rejected'];

export type VerificationPrompt =
  | { kind: 'none' }
  | { kind: 'verify' }
  | { kind: 'pending' }
  | { kind: 'rejected'; reason: string | null };

export interface VerificationState {
  is_verified: boolean;
  /** The status of the review's latest document, or null when it has none. */
  verification_status: VerificationStatus | null;
  /** The latest document's rejection reason; the API sends it only for a rejected one. */
  verification_rejection_reason: string | null;
}

/**
 * Which verification line a review shows on the profile. A verified review shows none. An
 * approved latest document on a review without the badge (the badge was removed by hand)
 * asks again, as a review with no document does.
 */
export function verificationPrompt(review: VerificationState): VerificationPrompt {
  if (review.is_verified) return { kind: 'none' };
  if (review.verification_status === 'pending') return { kind: 'pending' };
  if (review.verification_status === 'rejected') {
    const reason = review.verification_rejection_reason?.trim();
    return { kind: 'rejected', reason: reason ? reason : null };
  }
  return { kind: 'verify' };
}
