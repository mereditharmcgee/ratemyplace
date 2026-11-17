import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend };
    constructor(_apiKey: string) {}
  },
}));

import { PATCH } from '../../pages/api/admin/reviews/[id]';
import { wantsReviewStatusEmail } from '../notifications';
import { flushBackground } from './helpers/flush';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// "Email me when my review status changes" (profile settings) is `users.notification_opt_in`:
// 1 by default, 0 when the author turned it off. The moderation route reads it before the one
// email it sends a review's author, the rejection notice. The in-app notification is not an
// email and is always written.

const TENANT_EMAIL = 'tenant-optin@example.test';

describe('wantsReviewStatusEmail', () => {
  it('is false only for an explicit opt-out', () => {
    expect(wantsReviewStatusEmail(0)).toBe(false);
    expect(wantsReviewStatusEmail(1)).toBe(true);
    expect(wantsReviewStatusEmail(null)).toBe(true);
    expect(wantsReviewStatusEmail(undefined)).toBe(true);
  });
});

describe.skipIf(!sqliteAvailable)('PATCH /api/admin/reviews/[id] honours the email setting', () => {
  let db: TestD1Database;
  let buildingId: string;

  beforeEach(async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    db = createRecordsTestDb();
    await db.prepare("INSERT INTO users (id, email, is_admin) VALUES ('admin-1', 'admin@example.test', 1)").run();
    await db.prepare("INSERT INTO users (id, email) VALUES ('tenant-1', ?)").bind(TENANT_EMAIL).run();
    buildingId = await insertBuilding(db, { id: 'bldg-optin', address: '1 Test Street', slug: '1-test-street-boston', parcel_id: null });
    await db
      .prepare("INSERT INTO reviews (id, user_id, building_id, status) VALUES ('rev-1', 'tenant-1', ?, 'pending')")
      .bind(buildingId)
      .run();
  });

  function context(status: 'approved' | 'rejected'): APIContext {
    return {
      request: new Request('https://ratemyplace.org/api/admin/reviews/rev-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, moderation_notes: 'Please add more detail.' }),
      }),
      url: new URL('https://ratemyplace.org/api/admin/reviews/rev-1'),
      params: { id: 'rev-1' },
      locals: {
        user: { id: 'admin-1', isAdmin: true },
        runtime: { env: { DB: db, RESEND_API_KEY: 'k', SITE_URL: 'https://ratemyplace.org' } },
      },
    } as unknown as APIContext;
  }

  async function optOut(): Promise<void> {
    await db.prepare("UPDATE users SET notification_opt_in = 0 WHERE id = 'tenant-1'").run();
  }

  async function notificationEvents(): Promise<string[]> {
    const { results } = await db
      .prepare("SELECT event_type FROM notifications WHERE user_id = 'tenant-1' ORDER BY id")
      .all<{ event_type: string }>();
    return results.map((row) => row.event_type);
  }

  async function emailSettings(): Promise<number> {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'email_%'").first<{ n: number }>();
    return row?.n ?? 0;
  }

  it('emails a rejection to an author who has not opted out', async () => {
    const res = await PATCH(context('rejected'));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledOnce());
    expect(mockSend.mock.calls[0][0].to).toBe(TENANT_EMAIL);
    expect(await notificationEvents()).toEqual(['review_rejected']);
  });

  it('skips the rejection email for an author who opted out, and keeps the in-app notice', async () => {
    await optOut();

    const res = await PATCH(context('rejected'));
    await flushBackground();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    const review = await db.prepare("SELECT status FROM reviews WHERE id = 'rev-1'").first<{ status: string }>();
    expect(review?.status).toBe('rejected');
    expect(mockSend).not.toHaveBeenCalled();
    // A skipped email is not a failed one: nothing lands on /admin's email card.
    expect(await emailSettings()).toBe(0);
    expect(await notificationEvents()).toEqual(['review_rejected']);
  });

  it('sends no email on approval either way, and still notifies in-app', async () => {
    await optOut();
    const res = await PATCH(context('approved'));
    await flushBackground();
    expect(res.status).toBe(200);
    expect(mockSend).not.toHaveBeenCalled();
    expect(await notificationEvents()).toEqual(['review_approved']);
  });
});
