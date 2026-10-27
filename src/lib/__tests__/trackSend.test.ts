import type { APIContext } from 'astro';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb } from './helpers/recordsDb';
import { flushBackground } from './helpers/flush';
import { recipientHash } from '../runtime';
import { parseEmailFailure } from '../emailHealth';
import { requestSource, trackSend } from '../trackSend';
import type { EmailResult } from '../email';

const FAILED: EmailResult = { success: false, error: 'x', reason: 'provider_error', code: 'validation_error', httpStatus: 422 };

function contextWith(locals: Record<string, unknown>, url = 'https://ratemyplace.org/api/x'): APIContext {
  return { request: new Request(url, { method: 'POST' }), locals } as unknown as APIContext;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requestSource', () => {
  it('is the request host', () => {
    expect(requestSource(contextWith({}))).toBe('ratemyplace.org');
    expect(requestSource(contextWith({}, 'https://abc.ratemyplace-64y.pages.dev/api/contact'))).toBe('abc.ratemyplace-64y.pages.dev');
  });

  it('is null when the request URL cannot be read', () => {
    expect(requestSource({ request: { url: 'not a url' }, locals: {} } as unknown as APIContext)).toBeNull();
  });
});

describe.skipIf(!sqliteAvailable)('trackSend', () => {
  it('registers one background task that records a failure with the request host as source', async () => {
    const db: TestD1Database = createRecordsTestDb();
    const waitUntil = vi.fn();
    const context = contextWith({ runtime: { env: { DB: db }, ctx: { waitUntil } } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    trackSend(context, 'password_reset', 'tenant@example.com', Promise.resolve(FAILED));

    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0][0];
    const row = await db
      .prepare("SELECT value FROM app_settings WHERE key = 'email_last_failure_public'")
      .first<{ value: string }>();
    const record = parseEmailFailure(row?.value);
    expect(record).toMatchObject({
      kind: 'password_reset',
      reason: 'provider_error',
      recipientHash: recipientHash('tenant@example.com'),
      source: 'ratemyplace.org',
    });
  });

  it('never throws without a runtime, logs, and still consumes a rejecting send', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const context = contextWith({});
      expect(() => trackSend(context, 'verification', 'u@example.com', Promise.reject(new Error('boom')))).not.toThrow();
      await flushBackground();
      expect(unhandled).not.toHaveBeenCalled();
      const events = errorSpy.mock.calls.map((call) => JSON.parse(String(call[0])) as { event: string; kind?: string });
      expect(events).toContainEqual(expect.objectContaining({ event: 'email_track_failed', kind: 'verification' }));
      expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('u@example.com');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
