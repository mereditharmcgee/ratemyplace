import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend };
    constructor(_apiKey: string) {}
  },
}));

import { POST } from '../../pages/api/admin/verification/[id]';
import { EVENT_MESSAGES } from '../notifications';
import { VERIFICATION_REJECTED_SUBJECT } from '../email';
import { flushBackground } from './helpers/flush';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// A decision on a proof-of-address document tells the review's author how it went: an
// in-app notice either way, and on a rejection an email too, unless the author turned off
// "Email me when my review status changes". Approval sends no email: the Verified badge
// and the in-app notice cover it. Every name and place here is fictional.

const suite = sqliteAvailable ? describe : describe.skip;
const AUTHOR_EMAIL = 'author-sample@example.test';
const ADDRESS = 'Sample Building';
const REASON = 'The name on the <document> does not match.';

async function seed(db: TestD1Database): Promise<void> {
  await db.prepare("INSERT INTO users (id, email, is_admin) VALUES ('admin-1', 'admin@example.test', 1)").run();
  await db.prepare("INSERT INTO users (id, email) VALUES ('author-1', ?)").bind(AUTHOR_EMAIL).run();
  await db
    .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES ('bldg-a', ?, 'sample-building', 'Boston', 'MA')")
    .bind(ADDRESS)
    .run();
  await db
    .prepare(
      "INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, status) VALUES ('rev-1', 'author-1', 'bldg-a', 2022, 'fall', '1br', 'approved')",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO verification_images (id, review_id, user_id, r2_key, filename, content_type, size_bytes) VALUES ('ver-1', 'rev-1', 'author-1', 'users/author-1/verifications/rev-1/1.pdf', 'sample.pdf', 'application/pdf', 2048)",
    )
    .run();
}

function decide(db: TestD1Database, action: 'approve' | 'reject', reason?: string): Promise<Response> {
  return POST({
    params: { id: 'ver-1' },
    request: new Request('https://ratemyplace.org/api/admin/verification/ver-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, rejection_reason: reason }),
    }),
    url: new URL('https://ratemyplace.org/api/admin/verification/ver-1'),
    locals: {
      user: { id: 'admin-1', isAdmin: true },
      runtime: {
        env: { DB: db, VERIFICATION_BUCKET: { delete: async () => {} }, RESEND_API_KEY: 'k', SITE_URL: 'https://ratemyplace.org' },
      },
    },
  } as unknown as APIContext);
}

async function notices(db: TestD1Database) {
  const { results } = await db
    .prepare("SELECT user_id, event_type, review_id, message FROM notifications WHERE user_id = 'author-1' ORDER BY id")
    .all<{ user_id: string; event_type: string; review_id: string; message: string }>();
  return results;
}

async function emailFailureRows(db: TestD1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'email_%'").first<{ n: number }>();
  return row?.n ?? 0;
}

async function optOut(db: TestD1Database): Promise<void> {
  await db.prepare("UPDATE users SET notification_opt_in = 0 WHERE id = 'author-1'").run();
}

suite('a verification decision tells the review author', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    db = schemaDb();
    await seed(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes an in-app notice on approval and sends no email', async () => {
    const res = await decide(db, 'approve');
    await flushBackground();

    expect(res.status).toBe(200);
    expect(await notices(db)).toEqual([
      {
        user_id: 'author-1',
        event_type: 'verification_approved',
        review_id: 'rev-1',
        message: EVENT_MESSAGES.verification_approved(ADDRESS),
      },
    ]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('writes an in-app notice on rejection and emails the reason', async () => {
    const res = await decide(db, 'reject', REASON);

    expect(res.status).toBe(200);
    expect(await notices(db)).toEqual([
      {
        user_id: 'author-1',
        event_type: 'verification_rejected',
        review_id: 'rev-1',
        message: EVENT_MESSAGES.verification_rejected(ADDRESS),
      },
    ]);
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledOnce());
    const payload = mockSend.mock.calls[0][0];
    expect(payload.to).toBe(AUTHOR_EMAIL);
    expect(payload.subject).toBe(VERIFICATION_REJECTED_SUBJECT);
    // The reason is the moderator's text, escaped.
    expect(payload.html).toContain('The name on the &lt;document&gt; does not match.');
    expect(payload.html).toContain('https://ratemyplace.org/profile');
    // The tenant's own filename is never repeated back.
    expect(payload.html).not.toContain('sample.pdf');
  });

  it('leaves the reason block out when the moderator gave none', async () => {
    const res = await decide(db, 'reject', '   ');
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledOnce());
    expect(mockSend.mock.calls[0][0].html).not.toContain('What we noted');
    const row = await db.prepare("SELECT rejection_reason FROM verification_images WHERE id = 'ver-1'").first<{ rejection_reason: string | null }>();
    expect(row?.rejection_reason).toBeNull();
  });

  it('sends an opted-out author no email but still writes the in-app notice', async () => {
    await optOut(db);

    const res = await decide(db, 'reject', REASON);
    await flushBackground();

    expect(res.status).toBe(200);
    expect(mockSend).not.toHaveBeenCalled();
    // A skipped email is not a failed one: nothing lands on /admin's email card.
    expect(await emailFailureRows(db)).toBe(0);
    expect((await notices(db)).map((n) => n.event_type)).toEqual(['verification_rejected']);
  });

  it('records a failed rejection email on /admin under its own kind', async () => {
    mockSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'x', statusCode: 422 } });
    await decide(db, 'reject', REASON);
    await vi.waitFor(async () => expect(await emailFailureRows(db)).toBeGreaterThan(0));
    const stored = await db
      .prepare("SELECT value FROM app_settings WHERE key = 'email_last_failure_public'")
      .first<{ value: string }>();
    expect(JSON.parse(stored?.value ?? '{}')).toMatchObject({ kind: 'verification_rejected', reason: 'provider_error' });
    expect(stored?.value).not.toContain(AUTHOR_EMAIL);
  });
});

suite('before migration 0037 runs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still makes the decision, still emails, and logs the notice it could not write', async () => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const db = schemaDb({ through: '0036_blank_decided_verification_filenames.sql' });
    await seed(db);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await decide(db, 'reject', REASON);

    expect(res.status).toBe(200);
    const row = await db.prepare("SELECT status FROM verification_images WHERE id = 'ver-1'").first<{ status: string }>();
    expect(row?.status).toBe('rejected');
    expect(await notices(db)).toEqual([]);
    await vi.waitFor(() => expect(mockSend).toHaveBeenCalledOnce());

    const events = consoleSpy.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(String(line)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'notification_write_failed', eventType: 'verification_rejected' }),
    );
    // No log line carries the author's address or the reason.
    const logged = consoleSpy.mock.calls.map((call) => call.map(String).join(' ')).join(' ');
    expect(logged).not.toContain(AUTHOR_EMAIL);
    expect(logged).not.toContain('does not match');
  });
});
