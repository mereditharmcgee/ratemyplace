/**
 * Notifications helper
 *
 * Creates notification records for tenant-facing events.
 * Best-effort: swallows errors so callers are never broken.
 */

import { logError } from './logger';

/**
 * Every value here must also be in the `notifications.event_type` CHECK (latest rebuild:
 * migration 0037). A value the CHECK lacks fails the insert, which createNotification
 * swallows and logs as `notification_write_failed`.
 */
export type NotificationEventType =
  | 'review_approved'
  | 'review_rejected'
  | 'review_disputed'
  | 'dispute_resolved'
  | 'verification_approved'
  | 'verification_rejected';

export const EVENT_MESSAGES: Record<NotificationEventType, (address: string) => string> = {
  review_approved: (address) =>
    `Your review of ${address} has been approved and is now live.`,
  review_rejected: (address) =>
    `Your review of ${address} was not approved. See your dashboard for details.`,
  review_disputed: (address) =>
    `Your review of ${address} has been disputed by the landlord.`,
  dispute_resolved: (address) =>
    `The dispute on your review of ${address} has been resolved.`,
  // Proof-of-address decisions. The rejection reason is not repeated here: My Reviews shows
  // it beside the review, with the way to send a different document. A document can be
  // approved while its review is still pending or after it was rejected, when readers see no
  // review at all, so the approval says the review "has" the badge, not that it "shows" one.
  verification_approved: (address) =>
    `We verified your tenancy at ${address}. Your review now has a Verified badge.`,
  verification_rejected: (address) =>
    `We could not verify your tenancy at ${address} with the document you sent. See My Reviews for what to do next.`,
};

/**
 * Whether a review's author gets email about its status: the profile setting "Email me when
 * my review status changes", stored as `users.notification_opt_in`. Only an explicit 0 opts
 * out; 1 is the column default and NULL reads as opted in. In-app notifications are written
 * either way.
 */
export function wantsReviewStatusEmail(optIn: number | null | undefined): boolean {
  return optIn !== 0;
}

export interface CreateNotificationParams {
  userId: string;
  eventType: NotificationEventType;
  reviewId: string;
  buildingAddress: string;
}

/**
 * Insert a notification row for a user.
 * Best-effort: logs error but never throws.
 */
export async function createNotification(
  db: any,
  params: CreateNotificationParams
): Promise<void> {
  try {
    const message = EVENT_MESSAGES[params.eventType](params.buildingAddress);

    await db
      .prepare(
        `INSERT INTO notifications (user_id, event_type, review_id, message)
         VALUES (?, ?, ?, ?)`
      )
      .bind(params.userId, params.eventType, params.reviewId, message)
      .run();
  } catch (error) {
    // Structured, with the event type, so a CHECK that lacks a new event (a migration not yet
    // applied) is greppable. Never the address or the message: they name the building.
    logError('notification_write_failed', {
      eventType: params.eventType,
      reviewId: params.reviewId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
