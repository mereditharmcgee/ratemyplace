import type { APIContext } from 'astro';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockSend };
    constructor(_apiKey: string) {}
  },
}));

import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { OWNER_NOTICE_KINDS, OWNER_NOTIFY_EMAIL } from '../email';
import type { OwnerNoticeKind } from '../email';
import { parseEmailFailure } from '../emailHealth';
import type { SiteSettingsDb } from '../siteSettings';
import {
  OWNER_NOTICE_ADMIN_PATH,
  OWNER_NOTICE_PER_KIND_DAILY,
  OWNER_NOTICE_PER_KIND_HOURLY,
  OWNER_NOTICE_SITE_DAILY,
  notifyOwner,
  queueOwnerNotice,
} from '../ownerNotify';

const AT = 1784338200;
const SUBJECT_SUFFIX = ' (Jul 17, 2026, 9:30 PM ET)';

let errorSpy: MockInstance;

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: 'msg_notice' }, error: null });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function loggedEvents(): string[] {
  return errorSpy.mock.calls.flatMap((call) => {
    try {
      return [(JSON.parse(String(call[0])) as { event: string }).event];
    } catch {
      return [];
    }
  });
}

function deps(db: SiteSettingsDb, overrides: Partial<Parameters<typeof notifyOwner>[0]> = {}): Parameters<typeof notifyOwner>[0] {
  return { db, apiKey: 'k', siteUrl: 'https://ratemyplace.org/', source: 'ratemyplace.org', now: () => AT, ...overrides };
}

describe('caps', () => {
  it('are 6 per hour and 15 per day per kind, and 40 per day site-wide', () => {
    expect(OWNER_NOTICE_PER_KIND_HOURLY).toBe(6);
    expect(OWNER_NOTICE_PER_KIND_DAILY).toBe(15);
    expect(OWNER_NOTICE_SITE_DAILY).toBe(40);
  });
});

describe.skipIf(!sqliteAvailable)('notifyOwner', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createRecordsTestDb();
    await insertBuilding(db);
  });

  async function setting(key: string): Promise<string | null> {
    const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  async function seedRateRows(key: string, count: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < count; i++) {
      await db
        .prepare('INSERT INTO rate_limits (rate_key, created_at, expires_at) VALUES (?, ?, ?)')
        .bind(key, now - 7200, now + 79200)
        .run();
    }
  }

  it.each(OWNER_NOTICE_KINDS)('%s: sends one notice to the owner with the queue link, address and time', async (kind) => {
    await notifyOwner(deps(db), { kind, buildingId: 'bldg-lanark' });

    expect(mockSend).toHaveBeenCalledOnce();
    const args = mockSend.mock.calls[0][0];
    expect(args.to).toBe(OWNER_NOTIFY_EMAIL);
    expect(args.subject.endsWith(SUBJECT_SUFFIX)).toBe(true);
    expect(args.html).toContain(`https://ratemyplace.org${OWNER_NOTICE_ADMIN_PATH[kind]}`);
    expect(args.html).not.toContain('https://ratemyplace.org//admin');
    expect(args.html).toContain('23-27 Lanark Rd');
    expect(args.html).toContain('Jul 17, 2026, 9:30 PM ET');
  });

  it('carries no tenant data: every address in the payload is ours, and nothing names the tenant', async () => {
    await db.prepare("INSERT INTO users (id, email) VALUES ('tenant-1', 'tenant@example.com')").run();
    await db
      .prepare("INSERT INTO reviews (id, user_id, building_id, status) VALUES ('rev-1', 'tenant-1', 'bldg-lanark', 'pending')")
      .run();

    await notifyOwner(deps(db), { kind: 'review_submitted', buildingId: 'bldg-lanark' });

    const payload = JSON.stringify(mockSend.mock.calls[0][0]);
    const addresses = payload.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      expect(address.endsWith('@ratemyplace.org')).toBe(true);
    }
    expect(payload).not.toContain('tenant');
  });

  it('sends with no Building line for a null or unknown building', async () => {
    await notifyOwner(deps(db), { kind: 'bug_report', buildingId: null });
    expect(mockSend.mock.calls[0][0].html).not.toContain('Building:');

    await notifyOwner(deps(db), { kind: 'dispute', buildingId: 'no-such-building' });
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].html).not.toContain('Building:');
  });

  it('remembers the last notice Resend accepted', async () => {
    await notifyOwner(deps(db), { kind: 'bug_report', buildingId: null });
    expect(JSON.parse((await setting('owner_notice_last_sent')) ?? 'null')).toEqual({ at: AT, kind: 'owner_bug_report' });
  });

  it('records a Resend error on the owner channel and resolves', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', statusCode: 422, message: 'Bad to' } });

    await expect(notifyOwner(deps(db), { kind: 'bug_report', buildingId: null })).resolves.toBeUndefined();

    const record = parseEmailFailure(await setting('email_last_failure_owner'));
    expect(record?.kind).toBe('owner_bug_report');
    expect(record?.reason).toBe('provider_error');
    expect(await setting('owner_notice_last_sent')).toBeNull();
  });

  it('holds back the seventh notice of a kind in an hour, without blocking another kind', async () => {
    for (let i = 0; i < 6; i++) {
      await notifyOwner(deps(db), { kind: 'bug_report', buildingId: null });
    }
    expect(mockSend).toHaveBeenCalledTimes(6);

    await notifyOwner(deps(db), { kind: 'bug_report', buildingId: null });
    expect(mockSend).toHaveBeenCalledTimes(6);
    expect(parseEmailFailure(await setting('email_last_failure_owner'))?.reason).toBe('capped');
    expect(await setting('owner_notice_capped_count')).toBe('1');
    expect(await setting('email_failure_count')).toBeNull();
    expect(loggedEvents()).toContain('owner_notice_capped');

    await notifyOwner(deps(db), { kind: 'review_submitted', buildingId: 'bldg-lanark' });
    expect(mockSend).toHaveBeenCalledTimes(7);
  });

  it('holds back a kind past its daily cap even when its hourly cap allows', async () => {
    await seedRateRows('owner-notice-day:bug_report', 15);

    await notifyOwner(deps(db), { kind: 'bug_report', buildingId: null });

    expect(mockSend).not.toHaveBeenCalled();
    expect(parseEmailFailure(await setting('email_last_failure_owner'))).toMatchObject({ kind: 'owner_bug_report', reason: 'capped' });
  });

  it('holds back any kind past the site-wide daily cap', async () => {
    await seedRateRows('owner-notice-day:site', 40);

    await notifyOwner(deps(db), { kind: 'dispute', buildingId: 'bldg-lanark' });

    expect(mockSend).not.toHaveBeenCalled();
    expect(parseEmailFailure(await setting('email_last_failure_owner'))).toMatchObject({ kind: 'owner_dispute', reason: 'capped' });
  });

  it('still sends when the cap cannot be checked, and says so', async () => {
    db.exec('DROP TABLE rate_limits');

    await notifyOwner(deps(db), { kind: 'review_edited', buildingId: 'bldg-lanark' });

    expect(mockSend).toHaveBeenCalledOnce();
    expect(loggedEvents()).toContain('owner_notice_cap_unavailable');
  });

  it('resolves even when every statement throws', async () => {
    const broken: SiteSettingsDb = {
      prepare: () => {
        throw new Error('D1 down');
      },
      batch: async () => {
        throw new Error('D1 down');
      },
    };
    await expect(notifyOwner(deps(broken), { kind: 'bug_report', buildingId: 'bldg-lanark' })).resolves.toBeUndefined();
  });

  describe('queueOwnerNotice', () => {
    function context(env: Record<string, unknown> | null, waitUntil = vi.fn()): { context: APIContext; waitUntil: ReturnType<typeof vi.fn> } {
      const ctx = {
        request: new Request('https://preview.ratemyplace-64y.pages.dev/api/bug-reports', { method: 'POST' }),
        locals: env ? { runtime: { env, ctx: { waitUntil } } } : {},
      } as unknown as APIContext;
      return { context: ctx, waitUntil };
    }

    it('registers exactly one background task that sends the notice', async () => {
      const { context: ctx, waitUntil } = context({ DB: db, RESEND_API_KEY: 'k', SITE_URL: 'https://ratemyplace.org' });

      queueOwnerNotice(ctx, { kind: 'bug_report', buildingId: null });

      expect(waitUntil).toHaveBeenCalledOnce();
      await waitUntil.mock.calls[0][0];
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend.mock.calls[0][0].html).toContain('https://ratemyplace.org/admin/bug-reports');
    });

    it('never throws without a runtime, and logs', () => {
      const { context: ctx } = context(null);
      expect(() => queueOwnerNotice(ctx, { kind: 'dispute' as OwnerNoticeKind, buildingId: null })).not.toThrow();
      expect(loggedEvents()).toContain('owner_notice_queue_failed');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('links to the request origin when SITE_URL is empty', async () => {
      const { context: ctx, waitUntil } = context({ DB: db, RESEND_API_KEY: 'k', SITE_URL: '' });

      queueOwnerNotice(ctx, { kind: 'bug_report', buildingId: null });

      await waitUntil.mock.calls[0][0];
      expect(mockSend.mock.calls[0][0].html).toContain('https://preview.ratemyplace-64y.pages.dev/admin/bug-reports');
    });
  });
});
