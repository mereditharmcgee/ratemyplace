/**
 * Notifications helper
 *
 * Creates notification records for tenant-facing events.
 * Best-effort: swallows errors so callers are never broken.
 */

export type NotificationEventType =
  | 'review_approved'
  | 'review_rejected'
  | 'review_disputed'
  | 'dispute_resolved';

export const EVENT_MESSAGES: Record<NotificationEventType, (address: string) => string> = {
  review_approved: (address) =>
    `Your review of ${address} has been approved and is now live.`,
  review_rejected: (address) =>
    `Your review of ${address} was not approved. See your dashboard for details.`,
  review_disputed: (address) =>
    `Your review of ${address} has been disputed by the landlord.`,
  dispute_resolved: (address) =>
    `The dispute on your review of ${address} has been resolved.`,
};

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
    console.error('Failed to create notification:', error);
  }
}
