import type { APIContext } from 'astro';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { flushBackground } from './helpers/flush';

// Every route send goes through the real trackSend/trackEmail here, against sqlite, so each
// case proves the exact channel, kind and recipient hash a failure of that email records.

vi.mock('../turnstile', () => ({ verifyTurnstile: vi.fn(async () => ({ success: true })) }));

vi.mock('../tokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tokens')>()),
  createVerificationToken: vi.fn(async () => 'tok'),
  createPasswordResetToken: vi.fn(async () => 'tok'),
}));

vi.mock('../auth', () => ({
  initializeLucia: vi.fn(() => ({
    createSession: async () => ({ id: 's' }),
    createSessionCookie: () => ({ name: 'n', value: 'v', attributes: {} }),
  })),
}));

vi.mock('../password', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../password')>()),
  hashPassword: vi.fn(async () => 'h'),
}));

vi.mock('../email', async (importOriginal) => {
  const FAIL = () =>
    vi.fn(async () => ({ success: false, error: 'x', reason: 'provider_error', code: 'validation_error', httpStatus: 422 }));
  return {
    ...(await importOriginal<typeof import('../email')>()),
    sendVerificationEmail: FAIL(),
    sendPasswordResetEmail: FAIL(),
    sendContactConfirmationEmail: FAIL(),
    sendContactNotificationEmail: FAIL(),
    sendDisputeResolutionEmail: FAIL(),
  };
});

import { OWNER_NOTIFY_EMAIL, sendPasswordResetEmail } from '../email';
import { parseEmailFailure } from '../emailHealth';
import { recipientHash } from '../runtime';
import { POST as contactPOST } from '../../pages/api/contact';
import { POST as signupPOST } from '../../pages/api/auth/signup';
import { POST as resendPOST } from '../../pages/api/auth/resend-verification';
import { POST as forgotPOST } from '../../pages/api/auth/forgot-password';
import { PATCH as disputePATCH } from '../../pages/api/disputes/[id]';

function testDb(): TestD1Database {
  const db = createRecordsTestDb();
  db.exec(`
    ALTER TABLE users ADD COLUMN hashed_password TEXT;
    ALTER TABLE users ADD COLUMN google_id TEXT;
    ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
  `);
  for (const file of ['0020_contact_messages.sql', '0012_disputes.sql']) {
    db.exec(readFileSync(join(process.cwd(), 'migrations', file), 'utf8'));
  }
  return db;
}

interface ContextOptions {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
  user?: Record<string, unknown> | null;
  params?: Record<string, string>;
}

function context(db: TestD1Database, path: string, options: ContextOptions = {}): APIContext {
  const url = new URL(`https://ratemyplace.org${path}`);
  const request = new Request(url, {
    method: options.method ?? 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.40', ...(options.headers ?? {}) },
    body: options.body,
  });
  return {
    request,
    url,
    params: options.params ?? {},
    cookies: { set: vi.fn() },
    locals: { user: options.user ?? null, runtime: { env: { DB: db, SITE_URL: 'https://ratemyplace.org' } } },
  } as unknown as APIContext;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function setting(db: TestD1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function waitForFailure(db: TestD1Database, key: string, expected: Record<string, unknown>): Promise<void> {
  await vi.waitFor(async () => {
    expect(parseEmailFailure(await setting(db, key))).toMatchObject(expected);
  });
}

describe.skipIf(!sqliteAvailable)('route email sends record their failures', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(sendPasswordResetEmail).mockClear();
  });

  it('contact: the receipt fails on the public channel and the notification on the owner channel', async () => {
    const db = testDb();
    const response = await contactPOST(
      context(db, '/api/contact', {
        body: form({
          name: 'Pat Doe',
          email: 'sender@example.com',
          category: 'general',
          message: 'Hello, this is a test message.',
          'cf-turnstile-response': 'good',
        }),
      }),
    );

    expect(response.status).toBe(200);
    await waitForFailure(db, 'email_last_failure_public', {
      kind: 'contact_confirmation',
      recipientHash: recipientHash('sender@example.com'),
      source: 'ratemyplace.org',
    });
    await waitForFailure(db, 'email_last_failure_owner', {
      kind: 'contact_notification',
      recipientHash: recipientHash(OWNER_NOTIFY_EMAIL),
    });
    await vi.waitFor(async () => expect(await setting(db, 'email_failure_count')).toBe('2'));

    const { results } = await db.prepare('SELECT value FROM app_settings').all<{ value: string }>();
    for (const row of results) expect(row.value).not.toContain('@');
  });

  it('signup: a failed verification email is recorded against the lowercased address', async () => {
    const db = testDb();
    const response = await signupPOST(
      context(db, '/api/auth/signup', {
        body: form({
          email: 'New@Example.com',
          password: 'longpassword1',
          confirmPassword: 'longpassword1',
          'cf-turnstile-response': 'good',
        }),
      }),
    );

    expect(response.status).toBe(200);
    await waitForFailure(db, 'email_last_failure_public', {
      kind: 'verification',
      recipientHash: recipientHash('new@example.com'),
    });
  });

  it('resend-verification: a failed verification email is recorded', async () => {
    const db = testDb();
    const response = await resendPOST(
      context(db, '/api/auth/resend-verification', { user: { id: 'u1', email: 'Tenant@Example.com', emailVerified: false } }),
    );

    expect(response.status).toBe(200);
    await waitForFailure(db, 'email_last_failure_public', {
      kind: 'verification',
      recipientHash: recipientHash('tenant@example.com'),
    });
  });

  it('forgot-password: a failed reset email is recorded', async () => {
    const db = testDb();
    await db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u2', 'reset@example.com', 'h')").run();

    const response = await forgotPOST(
      context(db, '/api/auth/forgot-password', { body: form({ email: 'reset@example.com', 'cf-turnstile-response': 'good' }) }),
    );

    expect(response.status).toBe(200);
    await waitForFailure(db, 'email_last_failure_public', {
      kind: 'password_reset',
      recipientHash: recipientHash('reset@example.com'),
    });
  });

  it('forgot-password: a Google-only account gets no reset email, so nothing is sent or recorded', async () => {
    // Why the production check cannot use password reset on the owner: both admin accounts
    // are Google-only, and this branch answers success without sending.
    const db = testDb();
    await db.prepare("INSERT INTO users (id, email, hashed_password, google_id) VALUES ('u3', 'google@example.com', NULL, 'g1')").run();

    const response = await forgotPOST(
      context(db, '/api/auth/forgot-password', { body: form({ email: 'google@example.com', 'cf-turnstile-response': 'good' }) }),
    );

    expect(response.status).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    await flushBackground();
    const { results } = await db.prepare("SELECT key FROM app_settings WHERE key LIKE 'email_last_failure_%'").all();
    expect(results).toEqual([]);
  });

  it('disputes/[id]: a failed resolution email to the landlord is recorded', async () => {
    const db = testDb();
    await db.prepare("INSERT INTO users (id, email, is_admin) VALUES ('admin-1', 'admin@example.com', 1)").run();
    await db.prepare("INSERT INTO users (id, email) VALUES ('tenant-1', 'tenant@example.com')").run();
    await insertBuilding(db);
    await db
      .prepare("INSERT INTO reviews (id, user_id, building_id, status) VALUES ('rev-1', 'tenant-1', 'bldg-lanark', 'approved')")
      .run();
    await db
      .prepare(
        'INSERT INTO disputes (id, review_id, landlord_name, landlord_email, landlord_phone, dispute_reasons) ' +
          "VALUES ('d1', 'rev-1', 'Acme LLC', 'landlord@example.com', '617-555-0100', '[\"Other\"]')",
      )
      .run();

    const response = await disputePATCH(
      context(db, '/api/disputes/d1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionOutcome: 'dismiss', resolutionNotes: 'Stands.' }),
        user: { id: 'admin-1', isAdmin: true },
        params: { id: 'd1' },
      }),
    );

    expect(response.status).toBe(200);
    await waitForFailure(db, 'email_last_failure_public', {
      kind: 'dispute_resolution',
      recipientHash: recipientHash('landlord@example.com'),
    });
  });
});
