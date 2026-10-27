import type { APIContext } from 'astro';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { flushBackground } from './helpers/flush';

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) =>
    token === 'good' ? { success: true } : { success: false, error: 'Bot verification failed. Please try again.' },
  ),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

vi.mock('../email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../email')>()),
  sendDisputeConfirmationEmail: vi.fn(async () => ({ success: true })),
}));

import { queueOwnerNotice } from '../ownerNotify';
import { sendDisputeConfirmationEmail } from '../email';
import { DISPUTE_REASONS } from '../disputes';
import { parseEmailFailure } from '../emailHealth';
import { recipientHash } from '../runtime';
import { POST } from '../../pages/api/disputes';

const queued = vi.mocked(queueOwnerNotice);
const confirmation = vi.mocked(sendDisputeConfirmationEmail);

async function disputesDb(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(readFileSync(join(process.cwd(), 'migrations', '0012_disputes.sql'), 'utf8'));
  await db.prepare("INSERT INTO users (id, email) VALUES ('tenant-1', 'tenant@example.com')").run();
  await insertBuilding(db);
  await db
    .prepare("INSERT INTO reviews (id, user_id, building_id, status) VALUES ('rev-1', 'tenant-1', 'bldg-lanark', 'approved')")
    .run();
  return db;
}

const body = {
  reviewUrl: 'https://ratemyplace.org/building/bldg-lanark#review-rev-1',
  landlordName: 'Acme LLC',
  landlordEmail: 'landlord@example.com',
  landlordPhone: '617-555-0100',
  disputeReasons: [DISPUTE_REASONS[0]],
  disputeExplanation: 'Not a tenant.',
  turnstileToken: 'good',
};

function context(db: TestD1Database, payload: unknown, env: Record<string, unknown> = { RESEND_API_KEY: 'k' }): APIContext {
  // Built at the real origin: the route derives siteUrl from request.url, and
  // extractReviewIdFromUrl rejects a reviewUrl from any other origin.
  const request = new Request('https://ratemyplace.org/api/disputes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.30' },
    body: JSON.stringify(payload),
  });
  return {
    request,
    locals: { user: null, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret', ...env } } },
  } as unknown as APIContext;
}

async function publicFailure(db: TestD1Database) {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'email_last_failure_public'").first<{ value: string }>();
  return parseEmailFailure(row?.value);
}

describe.skipIf(!sqliteAvailable)('POST /api/disputes owner notice and tracked receipt', () => {
  beforeEach(() => {
    queued.mockClear();
    confirmation.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('queues exactly a dispute notice for the building, with no landlord fields', async () => {
    const db = await disputesDb();
    const response = await POST(context(db, body));

    expect(response.status).toBe(201);
    expect(queued).toHaveBeenCalledOnce();
    expect(queued.mock.calls[0][1]).toEqual({ kind: 'dispute', buildingId: 'bldg-lanark' });
    expect(confirmation).toHaveBeenCalledOnce();
    await flushBackground();
  });

  it('does not queue for a review that does not exist', async () => {
    const db = await disputesDb();
    const response = await POST(context(db, { ...body, reviewUrl: 'https://ratemyplace.org/building/bldg-lanark#review-nope' }));
    expect(response.status).toBe(404);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue a second time for a duplicate dispute', async () => {
    const db = await disputesDb();
    expect((await POST(context(db, body))).status).toBe(201);
    await flushBackground();
    const duplicate = await POST(context(db, body));
    expect(duplicate.status).toBe(409);
    expect(queued).toHaveBeenCalledOnce();
    await flushBackground();
  });

  it('records a refused landlord receipt on the public channel', async () => {
    confirmation.mockResolvedValueOnce({ success: false, error: 'x', reason: 'provider_error', code: 'validation_error', httpStatus: 422 });
    const db = await disputesDb();

    expect((await POST(context(db, body))).status).toBe(201);

    await vi.waitFor(async () => {
      expect(await publicFailure(db)).toMatchObject({
        kind: 'dispute_confirmation',
        reason: 'provider_error',
        recipientHash: recipientHash('landlord@example.com'),
        source: 'ratemyplace.org',
      });
    });
  });

  it('records not_configured instead of silently skipping when RESEND_API_KEY is unset', async () => {
    const actual = await vi.importActual<typeof import('../email')>('../email');
    confirmation.mockImplementationOnce(actual.sendDisputeConfirmationEmail);
    const db = await disputesDb();

    expect((await POST(context(db, body, {}))).status).toBe(201);

    expect(confirmation).toHaveBeenCalledOnce();
    await vi.waitFor(async () => {
      expect(await publicFailure(db)).toMatchObject({ kind: 'dispute_confirmation', reason: 'not_configured' });
    });
  });
});
