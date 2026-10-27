import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend };
    constructor(_apiKey: string) {}
  },
}));

import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb } from './helpers/recordsDb';
import { OWNER_NOTIFY_EMAIL } from '../email';
import { parseEmailFailure } from '../emailHealth';
import { RECORDS_PAUSED_SUBJECT, RECORDS_RESUMED_SUBJECT } from '../records/scheduler';
import { schedulerAlert } from '../records/schedulerAlert';
import type { SchedulerAlertConfig } from '../records/schedulerAlert';

describe.skipIf(!sqliteAvailable)('schedulerAlert', () => {
  let db: TestD1Database;
  let log: ReturnType<typeof vi.fn<SchedulerAlertConfig['log']>>;

  beforeEach(() => {
    db = createRecordsTestDb();
    log = vi.fn<SchedulerAlertConfig['log']>();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg_alert' }, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function alert(overrides: Partial<SchedulerAlertConfig> = {}) {
    return schedulerAlert({
      db,
      apiKey: 'k',
      alertEmail: 'ops@example.org',
      siteUrl: 'https://ratemyplace.org',
      log,
      ...overrides,
    });
  }

  async function recordsFailure() {
    const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'email_last_failure_records'").first<{ value: string }>();
    return parseEmailFailure(row?.value);
  }

  it('sends the paused alert to the configured address with the admin link appended', async () => {
    await alert()(RECORDS_PAUSED_SUBJECT, 'Fixture failed');

    expect(mockSend).toHaveBeenCalledOnce();
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe('ops@example.org');
    expect(args.from).toBe('RateMyPlace Boston <noreply@ratemyplace.org>');
    expect(args.subject).toBe(RECORDS_PAUSED_SUBJECT);
    expect(args.text).toBe('Fixture failed\n\nhttps://ratemyplace.org/admin/records');
    expect(log).not.toHaveBeenCalled();
  });

  it('sends the resumed alert, and records a failure of it as records_resumed', async () => {
    await alert()(RECORDS_RESUMED_SUBJECT, 'Back');
    expect(mockSend.mock.calls[0][0].subject).toBe(RECORDS_RESUMED_SUBJECT);

    mockSend.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'bad' } });
    await alert()(RECORDS_RESUMED_SUBJECT, 'Back');
    expect((await recordsFailure())?.kind).toBe('records_resumed');
  });

  it.each([undefined, '', '   '])('falls back to the owner inbox when RECORDS_ALERT_EMAIL is %j, and says so', async (alertEmail) => {
    await alert({ alertEmail })(RECORDS_PAUSED_SUBJECT, 'Fixture failed');

    expect(mockSend.mock.calls[0][0].to).toBe(OWNER_NOTIFY_EMAIL);
    expect(log).toHaveBeenCalledWith('records_alert_recipient_default', { subject: RECORDS_PAUSED_SUBJECT }, 'error');
  });

  it('records a refused paused alert on the records channel and logs it without the address', async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', statusCode: 422, message: 'Invalid `to` field: ops@example.org' },
    });

    await expect(alert()(RECORDS_PAUSED_SUBJECT, 'Fixture failed')).resolves.toBeUndefined();

    expect(await recordsFailure()).toMatchObject({
      kind: 'records_breaker',
      reason: 'provider_error',
      source: 'records-scheduler',
    });
    const failed = log.mock.calls.find(([event]) => event === 'records_breaker_email_failed');
    expect(failed).toBeDefined();
    const [, ctx, level] = failed ?? [];
    expect(level).toBe('error');
    expect(ctx).not.toHaveProperty('error');
    expect(JSON.stringify(ctx)).not.toContain('@');
    expect(ctx).toMatchObject({ subject: RECORDS_PAUSED_SUBJECT, reason: 'provider_error', code: 'validation_error', http_status: 422 });
  });

  it('records not_configured without calling Resend when the key is missing', async () => {
    await alert({ apiKey: '' })(RECORDS_PAUSED_SUBJECT, 'Fixture failed');

    expect(mockSend).not.toHaveBeenCalled();
    expect((await recordsFailure())?.reason).toBe('not_configured');
  });

  it('never throws, even when the database is gone', async () => {
    db.exec('DROP TABLE app_settings');
    mockSend.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(alert()(RECORDS_PAUSED_SUBJECT, 'Fixture failed')).resolves.toBeUndefined();
  });
});
