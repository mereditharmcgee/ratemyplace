import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb } from './helpers/recordsDb';
import { recipientHash } from '../runtime';
import type { EmailResult } from '../email';
import {
  EMAIL_KINDS,
  EMAIL_CHANNEL_LABELS,
  emailChannelOf,
  emailKindLabel,
  emailReasonLabel,
  trackEmail,
  recordEmailProblem,
  recordOwnerNoticeSent,
  parseEmailFailure,
  readEmailHealth,
  describeEmailFailure,
  emailSourceNote,
  emailFailureIsRecent,
} from '../emailHealth';
import type { EmailFailureRecord } from '../emailHealth';

const PROVIDER_ERROR: EmailResult = {
  success: false,
  error: 'Too many requests for tenant@example.com',
  reason: 'provider_error',
  code: 'rate_limit_exceeded',
  httpStatus: 429,
};

function logLines(spy: MockInstance): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call) => {
    try {
      return JSON.parse(String(call[0])) as Record<string, unknown>;
    } catch {
      return { raw: call.map(String).join(' ') };
    }
  });
}

function rawLogText(spy: MockInstance): string {
  return spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
}

describe('email kinds and labels', () => {
  it('maps owner_* and contact_notification to owner, records_* to records, the rest to public', () => {
    for (const kind of EMAIL_KINDS) {
      const expected = kind.startsWith('owner_') || kind === 'contact_notification'
        ? 'owner'
        : kind.startsWith('records_')
          ? 'records'
          : 'public';
      expect(emailChannelOf(kind)).toBe(expected);
    }
    expect(emailChannelOf('owner_bug_report')).toBe('owner');
    expect(emailChannelOf('records_breaker')).toBe('records');
    expect(emailChannelOf('password_reset')).toBe('public');
  });

  it('labels every channel', () => {
    expect(EMAIL_CHANNEL_LABELS).toEqual({
      owner: 'Notices to you',
      records: 'Records-fill alerts',
      public: 'Emails to site users, landlords and filers',
    });
  });

  it.each(EMAIL_KINDS)('%s has a readable label (no snake_case, no undefined)', (kind) => {
    const label = emailKindLabel(kind);
    expect(label).not.toContain('_');
    expect(label).not.toContain('undefined');
    expect(label.length).toBeGreaterThan(0);
  });

  it('falls back to humanize for an unknown kind or reason', () => {
    expect(emailKindLabel('owner_future_kind')).toBe('Owner Future Kind');
    expect(emailReasonLabel('weird_reason')).toBe('Weird Reason');
  });

  it('labels every known reason', () => {
    expect(emailReasonLabel('not_configured')).toBe('not sent, RESEND_API_KEY is not set');
    expect(emailReasonLabel('provider_error')).toBe('Resend refused it');
    expect(emailReasonLabel('exception')).toBe('the send failed before Resend answered');
    expect(emailReasonLabel('unknown')).toBe('the send failed, reason not recorded');
    expect(emailReasonLabel('capped')).toBe('held back by the notice cap');
  });
});

describe('describeEmailFailure / emailSourceNote / emailFailureIsRecent', () => {
  const base: EmailFailureRecord = {
    at: 1784338200,
    kind: 'password_reset',
    reason: 'provider_error',
    code: 'rate_limit_exceeded',
    httpStatus: 429,
    recipientHash: 'abcd1234',
    source: 'ratemyplace.org',
  };

  it('describes a provider error with its code and status', () => {
    expect(describeEmailFailure(base)).toBe('Password reset: Resend refused it (rate_limit_exceeded, HTTP 429)');
  });

  it('describes a capped notice with no detail', () => {
    expect(describeEmailFailure({ ...base, kind: 'owner_bug_report', reason: 'capped', code: null, httpStatus: null })).toBe(
      'Notice to you about a bug report: held back by the notice cap',
    );
  });

  it('describes an exception with only a code', () => {
    expect(describeEmailFailure({ ...base, reason: 'exception', code: 'TypeError', httpStatus: null })).toBe(
      'Password reset: the send failed before Resend answered (TypeError)',
    );
  });

  it('describes a failure with no reason recorded', () => {
    expect(describeEmailFailure({ ...base, reason: 'unknown', code: null, httpStatus: null })).toBe(
      'Password reset: the send failed, reason not recorded',
    );
  });

  it('names a source only when it is another host', () => {
    expect(emailSourceNote(base, 'ratemyplace.org')).toBeNull();
    expect(emailSourceNote({ ...base, source: 'records-scheduler' }, 'ratemyplace.org')).toBeNull();
    expect(emailSourceNote({ ...base, source: null }, 'ratemyplace.org')).toBeNull();
    expect(emailSourceNote({ ...base, source: 'abc.ratemyplace-64y.pages.dev' }, 'ratemyplace.org')).toBe(
      'from abc.ratemyplace-64y.pages.dev',
    );
  });

  it('counts a failure as recent for seven days', () => {
    const day = 86400;
    expect(emailFailureIsRecent(base, base.at + 6 * day)).toBe(true);
    expect(emailFailureIsRecent(base, base.at + 8 * day)).toBe(false);
  });
});

describe('parseEmailFailure', () => {
  it('returns null for malformed or wrongly shaped values', () => {
    expect(parseEmailFailure(null)).toBeNull();
    expect(parseEmailFailure(undefined)).toBeNull();
    expect(parseEmailFailure('{not json')).toBeNull();
    expect(parseEmailFailure('"a string"')).toBeNull();
    expect(parseEmailFailure(JSON.stringify({ at: 'soon', kind: 'x' }))).toBeNull();
  });
});

describe.skipIf(!sqliteAvailable)('email failure trace in app_settings', () => {
  let db: TestD1Database;
  let errorSpy: MockInstance;

  beforeEach(() => {
    db = createRecordsTestDb();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  async function setting(key: string): Promise<string | null> {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  async function siteRows(): Promise<Array<{ key: string; value: string }>> {
    const { results } = await db
      .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'email_%' OR key LIKE 'owner_%'")
      .all<{ key: string; value: string }>();
    return results;
  }

  it('returns a success unchanged and writes and logs nothing', async () => {
    const ok: EmailResult = { success: true, messageId: 'm1' };
    const result = await trackEmail(db, { kind: 'verification', to: 'u@example.com', source: 'ratemyplace.org' }, Promise.resolve(ok));
    expect(result).toBe(ok);
    expect(await siteRows()).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('records a provider error on the public channel without the address or the Resend message', async () => {
    const result = await trackEmail(
      db,
      { kind: 'password_reset', to: 'tenant@example.com', source: 'ratemyplace.org' },
      Promise.resolve(PROVIDER_ERROR),
      () => 1784338200,
    );
    expect(result).toBe(PROVIDER_ERROR);

    const stored = await setting('email_last_failure_public');
    expect(JSON.parse(stored ?? 'null')).toEqual({
      at: 1784338200,
      kind: 'password_reset',
      reason: 'provider_error',
      code: 'rate_limit_exceeded',
      httpStatus: 429,
      recipientHash: recipientHash('tenant@example.com'),
      source: 'ratemyplace.org',
    });
    expect(await setting('email_failure_count')).toBe('1');

    const failed = logLines(errorSpy).filter((line) => line.event === 'email_send_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      channel: 'public',
      kind: 'password_reset',
      reason: 'provider_error',
      code: 'rate_limit_exceeded',
      http_status: 429,
      recipient_hash: recipientHash('tenant@example.com'),
      source: 'ratemyplace.org',
    });

    const everything = `${stored}\n${rawLogText(errorSpy)}`;
    expect(everything).not.toContain('tenant@example.com');
    expect(everything).not.toContain('Too many requests');
  });

  it('keeps each channel separate, so a later owner failure does not hide the public one', async () => {
    await trackEmail(db, { kind: 'password_reset', to: 'tenant@example.com', source: 'ratemyplace.org' }, Promise.resolve(PROVIDER_ERROR), () => 100);
    await trackEmail(db, { kind: 'owner_bug_report', to: 'owner@example.org', source: 'ratemyplace.org' }, Promise.resolve(PROVIDER_ERROR), () => 200);

    expect(parseEmailFailure(await setting('email_last_failure_owner'))?.kind).toBe('owner_bug_report');
    expect(parseEmailFailure(await setting('email_last_failure_public'))?.kind).toBe('password_reset');
    expect(await setting('email_last_failure_records')).toBeNull();
    expect(await setting('email_failure_count')).toBe('2');
  });

  it('records not_configured and exception with the right reason', async () => {
    await trackEmail(
      db,
      { kind: 'verification', to: 'a@example.com', source: null },
      Promise.resolve({ success: false, error: 'Email service not configured', reason: 'not_configured' }),
    );
    expect(parseEmailFailure(await setting('email_last_failure_public'))?.reason).toBe('not_configured');

    await trackEmail(
      db,
      { kind: 'records_breaker', to: 'a@example.com', source: 'records-scheduler' },
      Promise.resolve({ success: false, error: 'Failed to send email', reason: 'exception', code: 'TypeError' }),
    );
    const records = parseEmailFailure(await setting('email_last_failure_records'));
    expect(records?.reason).toBe('exception');
    expect(records?.code).toBe('TypeError');
  });

  it('turns a rejecting send into a recorded exception and never rejects', async () => {
    const result = await trackEmail(
      db,
      { kind: 'contact_confirmation', to: 'a@example.com', source: 'ratemyplace.org' },
      Promise.reject(new TypeError('fetch failed for a@example.com')),
    );
    expect(result).toEqual({ success: false, error: 'Failed to send email', reason: 'exception', code: 'TypeError' });
    const stored = parseEmailFailure(await setting('email_last_failure_public'));
    expect(stored?.reason).toBe('exception');
    expect(stored?.code).toBe('TypeError');
    expect(rawLogText(errorSpy)).not.toContain('a@example.com');
  });

  it("records a failure with no reason as 'unknown'", async () => {
    await trackEmail(db, { kind: 'password_reset', to: 'a@example.com', source: null }, Promise.resolve({ success: false, error: 'x' }));
    const stored = parseEmailFailure(await setting('email_last_failure_public'));
    expect(stored?.reason).toBe('unknown');
    expect(stored && describeEmailFailure(stored)).toBe('Password reset: the send failed, reason not recorded');
  });

  it('records a capped notice on its own counter and its own log event', async () => {
    await recordEmailProblem(db, {
      at: 500,
      kind: 'owner_dispute',
      reason: 'capped',
      code: null,
      httpStatus: null,
      recipientHash: recipientHash('owner@example.org'),
      source: 'ratemyplace.org',
    });
    expect(parseEmailFailure(await setting('email_last_failure_owner'))?.reason).toBe('capped');
    expect(await setting('owner_notice_capped_count')).toBe('1');
    expect(await setting('email_failure_count')).toBeNull();
    const events = logLines(errorSpy).map((line) => line.event);
    expect(events).toContain('owner_notice_capped');
    expect(events).not.toContain('email_send_failed');
  });

  it('still resolves with the result when app_settings cannot be written', async () => {
    db.exec('DROP TABLE app_settings');
    const result = await trackEmail(
      db,
      { kind: 'password_reset', to: 'tenant@example.com', source: 'ratemyplace.org' },
      Promise.resolve(PROVIDER_ERROR),
    );
    expect(result).toBe(PROVIDER_ERROR);
    const events = logLines(errorSpy).map((line) => line.event);
    expect(events).toContain('email_send_failed');
    expect(events).toContain('email_failure_record_failed');
  });

  it('stores an unsafe code as null', async () => {
    await trackEmail(
      db,
      { kind: 'password_reset', to: 'a@example.com', source: null },
      Promise.resolve({ success: false, error: 'x', reason: 'provider_error', code: 'bad code; DROP', httpStatus: 400 }),
    );
    expect(parseEmailFailure(await setting('email_last_failure_public'))?.code).toBeNull();
  });

  describe('readEmailHealth', () => {
    it('reads an empty table as no problems', async () => {
      expect(await readEmailHealth(db)).toEqual({
        unavailable: false,
        lastFailure: { owner: null, records: null, public: null },
        failureCount: 0,
        cappedCount: 0,
        ownerNoticeLastSent: null,
      });
    });

    it('parses every channel, both counters and the last notice back', async () => {
      await trackEmail(db, { kind: 'password_reset', to: 'a@example.com', source: 'ratemyplace.org' }, Promise.resolve(PROVIDER_ERROR), () => 10);
      await trackEmail(db, { kind: 'records_resumed', to: 'b@example.com', source: 'records-scheduler' }, Promise.resolve(PROVIDER_ERROR), () => 20);
      await recordEmailProblem(db, {
        at: 30, kind: 'owner_bug_report', reason: 'capped', code: null, httpStatus: null, recipientHash: 'h', source: 'ratemyplace.org',
      });
      await recordOwnerNoticeSent(db, 'owner_review_submitted', 40);

      const health = await readEmailHealth(db);
      expect(health.unavailable).toBe(false);
      expect(health.lastFailure.public?.kind).toBe('password_reset');
      expect(health.lastFailure.records?.kind).toBe('records_resumed');
      expect(health.lastFailure.owner?.reason).toBe('capped');
      expect(health.failureCount).toBe(2);
      expect(health.cappedCount).toBe(1);
      expect(health.ownerNoticeLastSent).toEqual({ at: 40, kind: 'owner_review_submitted' });
    });

    it('reads malformed JSON as null without throwing', async () => {
      await db
        .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('email_last_failure_owner', '{oops', 1), ('owner_notice_last_sent', '[]', 1), ('email_failure_count', 'x', 1)")
        .run();
      const health = await readEmailHealth(db);
      expect(health.unavailable).toBe(false);
      expect(health.lastFailure.owner).toBeNull();
      expect(health.ownerNoticeLastSent).toBeNull();
      expect(health.failureCount).toBe(0);
    });

    it('reports unavailable when the table is gone', async () => {
      db.exec('DROP TABLE app_settings');
      expect(await readEmailHealth(db)).toEqual({
        unavailable: true,
        lastFailure: { owner: null, records: null, public: null },
        failureCount: 0,
        cappedCount: 0,
        ownerNoticeLastSent: null,
      });
    });
  });
});
