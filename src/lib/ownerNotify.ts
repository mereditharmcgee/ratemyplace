// Email the owner when an intake needs their action: a new or edited review, a bug report, a
// record correction, a landlord dispute, a tenancy document.
//
// A route calls `queueOwnerNotice(context, { kind, buildingId })` after its write commits.
// The notice runs in the background, is capped per kind and site-wide so a flood cannot
// drain the Resend quota or bury the inbox, and leaves a trace on /admin if it is capped or
// fails. The dashboard's "Waiting on you" counts are the safety net for a notice that was
// capped, filtered or lost.
import type { APIContext } from 'astro';
import { getDB } from './db';
import { OWNER_NOTIFY_EMAIL, sendOwnerNoticeEmail } from './email';
import type { OwnerNoticeKind } from './email';
import { recordEmailProblem, recordOwnerNoticeSent, trackEmail } from './emailHealth';
import type { OwnerEmailKind } from './emailHealth';
import { logError } from './logger';
import { checkRateLimit } from './rateLimit';
import { fireAndForget, getEnv, recipientHash } from './runtime';
import type { SiteSettingsDb } from './siteSettings';
import { requestSource } from './trackSend';

export const OWNER_NOTICE_PER_KIND_HOURLY = 6;
export const OWNER_NOTICE_PER_KIND_DAILY = 15;
export const OWNER_NOTICE_SITE_DAILY = 40;

/** Where each notice's button lands. Also the dashboard's "Waiting on you" links. */
export const OWNER_NOTICE_ADMIN_PATH: Record<OwnerNoticeKind, string> = {
  review_submitted: '/admin/reviews?status=pending',
  review_edited: '/admin/reviews?status=pending',
  bug_report: '/admin/bug-reports',
  record_correction: '/admin/records',
  dispute: '/admin/disputes',
  verification_upload: '/admin/verify',
};

/** Deliberately only a kind and a building id: a route cannot pass PII into a notice. */
export interface OwnerNotice {
  kind: OwnerNoticeKind;
  buildingId: string | null;
}

export interface OwnerNoticeDeps {
  db: SiteSettingsDb;
  apiKey: string | undefined;
  /** The site origin for the admin link; a trailing slash is trimmed. */
  siteUrl: string;
  /** The request host, recorded with any failure. */
  source: string | null;
  /** Unix seconds; the notice's received time. Injected by tests. */
  now?: () => number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Checked in order; the first denial holds the notice back. Per-kind caps mean a bug-report
 * flood cannot suppress review notices; the site cap protects the Resend quota.
 */
function capsFor(kind: OwnerNoticeKind): Array<{ identifier: string; endpoint: string; max: number; windowSeconds: number }> {
  return [
    { identifier: kind, endpoint: 'owner-notice-hour', max: OWNER_NOTICE_PER_KIND_HOURLY, windowSeconds: 3600 },
    { identifier: kind, endpoint: 'owner-notice-day', max: OWNER_NOTICE_PER_KIND_DAILY, windowSeconds: 86400 },
    { identifier: 'site', endpoint: 'owner-notice-day', max: OWNER_NOTICE_SITE_DAILY, windowSeconds: 86400 },
  ];
}

async function buildingAddress(db: SiteSettingsDb, buildingId: string | null): Promise<string | null> {
  if (!buildingId) return null;
  try {
    const row = await db.prepare('SELECT address FROM buildings WHERE id = ?').bind(buildingId).first<{ address: string | null }>();
    return row?.address ?? null;
  } catch (err) {
    logError('owner_notice_address_lookup_failed', { error: errorMessage(err) });
    return null;
  }
}

/** Never rejects: it runs in the background after a route has answered. */
export async function notifyOwner(deps: OwnerNoticeDeps, notice: OwnerNotice): Promise<void> {
  try {
    const at = (deps.now ?? (() => Math.floor(Date.now() / 1000)))();
    const emailKind: OwnerEmailKind = `owner_${notice.kind}`;

    for (const cap of capsFor(notice.kind)) {
      const result = await checkRateLimit(deps.db, cap.identifier, cap.endpoint, cap.max, cap.windowSeconds);
      if (result.error) {
        // Fail OPEN, unlike request limiting. Every intake but review edit has already run its
        // own fail-closed limiter on this same table and answered 503 before inserting, so in
        // practice only a review edit — or a limiter failure in the moments between the
        // intake's check and this one — reaches here. Losing the notice would hide the intake.
        logError('owner_notice_cap_unavailable', { kind: notice.kind, cap: `${cap.endpoint}:${cap.identifier}` });
        continue;
      }
      if (!result.allowed) {
        await recordEmailProblem(deps.db, {
          at,
          kind: emailKind,
          reason: 'capped',
          code: null,
          httpStatus: null,
          recipientHash: recipientHash(OWNER_NOTIFY_EMAIL),
          source: deps.source,
        });
        return;
      }
    }

    const address = await buildingAddress(deps.db, notice.buildingId);
    const adminUrl = deps.siteUrl.replace(/\/+$/, '') + OWNER_NOTICE_ADMIN_PATH[notice.kind];
    const result = await trackEmail(
      deps.db,
      { kind: emailKind, to: OWNER_NOTIFY_EMAIL, source: deps.source },
      sendOwnerNoticeEmail(deps.apiKey ?? '', OWNER_NOTIFY_EMAIL, {
        kind: notice.kind,
        buildingAddress: address,
        receivedAt: at,
        adminUrl,
      }),
      () => at,
    );
    if (result.success) {
      await recordOwnerNoticeSent(deps.db, emailKind, at);
    }
  } catch (err) {
    logError('owner_notice_failed', { kind: notice.kind, error: errorMessage(err) });
  }
}

/**
 * Queue a notice from a route, after its write has committed. Never throws: a notice problem
 * must not turn a saved submission into an error.
 */
export function queueOwnerNotice(context: APIContext, notice: OwnerNotice): void {
  try {
    const env = getEnv(context);
    fireAndForget(
      context,
      notifyOwner(
        {
          db: getDB(context),
          apiKey: env.RESEND_API_KEY,
          siteUrl: env.SITE_URL || new URL(context.request.url).origin,
          source: requestSource(context),
        },
        notice,
      ),
    );
  } catch (err) {
    logError('owner_notice_queue_failed', { kind: notice.kind, error: errorMessage(err) });
  }
}
