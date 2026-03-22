import { describe, it, expect, vi } from 'vitest';
import { createNotification, EVENT_MESSAGES, type NotificationEventType } from '../notifications';

function mockDB(shouldError: boolean = false) {
  const runFn = shouldError
    ? vi.fn().mockRejectedValue(new Error('DB error'))
    : vi.fn().mockResolvedValue({});

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: runFn,
      }),
    }),
    _runFn: runFn,
  };
}

describe('createNotification', () => {
  it('inserts a row into notifications table', async () => {
    const db = mockDB();

    await createNotification(db, {
      userId: 'user-123',
      eventType: 'review_approved',
      reviewId: 'review-456',
      buildingAddress: '123 Main St',
    });

    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notifications')
    );
    const bindFn = db.prepare.mock.results[0].value.bind;
    expect(bindFn).toHaveBeenCalled();
  });

  it('builds correct message for each event type', async () => {
    const address = '456 Elm Ave';

    const expectedMessages: Record<NotificationEventType, string> = {
      review_approved: `Your review of ${address} has been approved and is now live.`,
      review_rejected: `Your review of ${address} was not approved. See your dashboard for details.`,
      review_disputed: `Your review of ${address} has been disputed by the landlord.`,
      dispute_resolved: `The dispute on your review of ${address} has been resolved.`,
    };

    for (const [eventType, expectedMessage] of Object.entries(expectedMessages)) {
      const db = mockDB();
      await createNotification(db, {
        userId: 'user-123',
        eventType: eventType as NotificationEventType,
        reviewId: 'review-456',
        buildingAddress: address,
      });

      const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
      // message is the 4th bind argument (userId, eventType, reviewId, message)
      expect(bindArgs[3]).toBe(expectedMessage);
    }
  });

  it('swallows errors and does not throw when DB call fails', async () => {
    const db = mockDB(true);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      createNotification(db, {
        userId: 'user-123',
        eventType: 'review_approved',
        reviewId: 'review-456',
        buildingAddress: '789 Oak St',
      })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('EVENT_MESSAGES maps each NotificationEventType to a function returning a string containing the address', () => {
    const address = 'Test Building, 1 Park St';
    const eventTypes: NotificationEventType[] = [
      'review_approved',
      'review_rejected',
      'review_disputed',
      'dispute_resolved',
    ];

    for (const eventType of eventTypes) {
      const message = EVENT_MESSAGES[eventType](address);
      expect(typeof message).toBe('string');
      expect(message).toContain(address);
    }
  });

  it('createNotification builds correct message for review_disputed event', async () => {
    const db = mockDB();
    const address = '42 Landlord Lane, Boston MA';

    await createNotification(db, {
      userId: 'tenant-001',
      eventType: 'review_disputed',
      reviewId: 'review-999',
      buildingAddress: address,
    });

    const bindArgs = db.prepare.mock.results[0].value.bind.mock.calls[0];
    // bind args: userId, eventType, reviewId, message
    expect(bindArgs[0]).toBe('tenant-001');
    expect(bindArgs[1]).toBe('review_disputed');
    expect(bindArgs[2]).toBe('review-999');
    expect(bindArgs[3]).toBe(`Your review of ${address} has been disputed by the landlord.`);
  });
});
