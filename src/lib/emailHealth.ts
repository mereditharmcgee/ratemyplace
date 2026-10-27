// Email delivery health: which emails exist, which channel each belongs to, and the durable
// trace a failed send leaves in `app_settings` for the /admin dashboard.
//
// Privacy: nothing here ever stores or logs a recipient address or Resend's error message
// (which can echo the address). A failure is kept as kind, channel, reason, a sanitized code,
// the HTTP status, an 8-hex recipient hash and the request host — nothing else.
//
// Worker-safe: no `node:` imports and no runtime `astro` import, because the records Worker
// tracks its alerts through here too. Imports from `./email` are type-only, so a route test
// that partially mocks `../email` never breaks this module.
import type { EmailFailureReason, EmailResult, OwnerNoticeKind } from './email';
import { humanize } from './format';
import { logError } from './logger';
import { recipientHash } from './runtime';
import {
  SITE_SETTING_KEYS,
  incrementSiteCounterStatement,
  readSiteSettings,
  writeSiteSettingStatement,
} from './siteSettings';
import type { SiteSettingKey, SiteSettingsDb } from './siteSettings';

export const EMAIL_KINDS = [
  'verification',
  'password_reset',
  'dispute_confirmation',
  'dispute_resolution',
  'contact_confirmation',
  'contact_notification',
  'review_rejected',
  'record_correction_outcome',
  'records_breaker',
  'records_resumed',
  'owner_review_submitted',
  'owner_review_edited',
  'owner_bug_report',
  'owner_record_correction',
  'owner_dispute',
  'owner_verification_upload',
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

/** The email kind of each owner notice. */
export type OwnerEmailKind = `owner_${OwnerNoticeKind}`;
// Compile-time check: every owner notice kind has an email kind. Adding a notice kind in
// email.ts without adding `owner_<kind>` above fails `npm run check` here.
type AssertOwnerKindsAreEmailKinds<T extends EmailKind> = T;
export type OwnerEmailKindChecked = AssertOwnerKindsAreEmailKinds<OwnerEmailKind>;

/** Who an email is for. Each channel keeps its own last-failure record, so one cannot hide another. */
export type EmailChannel = 'owner' | 'records' | 'public';

export const EMAIL_CHANNELS: readonly EmailChannel[] = ['owner', 'records', 'public'];

export const EMAIL_CHANNEL_LABELS: Record<EmailChannel, string> = {
  owner: 'Notices to you',
  records: 'Records-fill alerts',
  public: 'Emails to site users, landlords and filers',
};

export function emailChannelOf(kind: EmailKind): EmailChannel {
  if (kind.startsWith('owner_') || kind === 'contact_notification') return 'owner';
  if (kind.startsWith('records_')) return 'records';
  return 'public';
}

const CHANNEL_FAILURE_KEY: Record<EmailChannel, SiteSettingKey> = {
  owner: SITE_SETTING_KEYS.emailLastFailureOwner,
  records: SITE_SETTING_KEYS.emailLastFailureRecords,
  public: SITE_SETTING_KEYS.emailLastFailurePublic,
};

/** `unknown`: a failure result that carried no reason. `capped`: an owner notice held back by the cap. */
export type EmailProblemReason = EmailFailureReason | 'unknown' | 'capped';

export interface EmailFailureRecord {
  /** Unix seconds. */
  at: number;
  kind: EmailKind;
  reason: EmailProblemReason;
  code: string | null;
  httpStatus: number | null;
  recipientHash: string;
  /** The request host, `'records-scheduler'` for the Worker, or null when unknown. */
  source: string | null;
}

export interface EmailSendMeta {
  kind: EmailKind;
  /** Used only to compute the recipient hash; never stored or logged. */
  to: string;
  source: string | null;
}

export interface EmailHealth {
  /** True when app_settings could not be read at all. */
  unavailable: boolean;
  lastFailure: Record<EmailChannel, EmailFailureRecord | null>;
  failureCount: number;
  cappedCount: number;
  ownerNoticeLastSent: { at: number; kind: string } | null;
}

const KIND_LABELS: Record<EmailKind, string> = {
  verification: 'Email verification',
  password_reset: 'Password reset',
  dispute_confirmation: 'Dispute receipt to the landlord',
  dispute_resolution: 'Dispute outcome to the landlord',
  contact_confirmation: 'Contact form receipt to the sender',
  contact_notification: 'Contact form message to you',
  review_rejected: 'Review-not-published notice to the reviewer',
  record_correction_outcome: 'Correction outcome to the filer',
  records_breaker: 'Records fill paused alert',
  records_resumed: 'Records fill resumed alert',
  owner_review_submitted: 'Notice to you about a new review',
  owner_review_edited: 'Notice to you about an edited review',
  owner_bug_report: 'Notice to you about a bug report',
  owner_record_correction: 'Notice to you about a record correction',
  owner_dispute: 'Notice to you about a landlord dispute',
  owner_verification_upload: 'Notice to you about a tenancy document',
};

const REASON_LABELS: Record<EmailProblemReason, string> = {
  not_configured: 'not sent, RESEND_API_KEY is not set',
  provider_error: 'Resend refused it',
  exception: 'the send failed before Resend answered',
  unknown: 'the send failed, reason not recorded',
  capped: 'held back by the notice cap',
};

function isKey<T extends string>(map: Record<T, string>, value: string): value is T {
  return Object.prototype.hasOwnProperty.call(map, value);
}

/** Takes a plain string: a stored kind may come from a newer deploy. Unknown kinds are humanized. */
export function emailKindLabel(kind: string): string {
  return isKey(KIND_LABELS, kind) ? KIND_LABELS[kind] : humanize(kind);
}

export function emailReasonLabel(reason: string): string {
  return isKey(REASON_LABELS, reason) ? REASON_LABELS[reason] : humanize(reason);
}

/** Resend error names and JS error class names only; anything else is dropped rather than stored. */
function sanitizeCode(code: string | undefined): string | null {
  return typeof code === 'string' && /^[A-Za-z_]{1,64}$/.test(code) ? code : null;
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Await a send and, if it failed, leave a trace. Never rejects: a rejecting `sending` becomes
 * an `exception` result. Returns the send's own result unchanged.
 */
export async function trackEmail(
  db: SiteSettingsDb,
  meta: EmailSendMeta,
  sending: Promise<EmailResult>,
  now: () => number = nowSeconds,
): Promise<EmailResult> {
  let result: EmailResult;
  try {
    result = await sending;
  } catch (err) {
    result = { success: false, error: 'Failed to send email', reason: 'exception', code: errorName(err) };
  }
  if (result.success) return result;

  await recordEmailProblem(db, {
    at: now(),
    kind: meta.kind,
    reason: result.reason ?? 'unknown',
    code: sanitizeCode(result.code),
    httpStatus: typeof result.httpStatus === 'number' ? result.httpStatus : null,
    recipientHash: recipientHash(meta.to),
    source: meta.source,
  });
  return result;
}

/**
 * Log a problem, then store it as its channel's last failure and bump a counter. Never rejects.
 *
 * The two writes are sequential `.run()` calls, not a `db.batch`: this runs in the background
 * after a route has answered, and a batch would open a transaction that could collide with
 * the request's own. They are not atomic; for a best-effort trace that is acceptable, and the
 * record is written first.
 */
export async function recordEmailProblem(db: SiteSettingsDb, record: EmailFailureRecord): Promise<void> {
  const channel = emailChannelOf(record.kind);
  if (record.reason === 'capped') {
    logError('owner_notice_capped', { kind: record.kind, recipient_hash: record.recipientHash, source: record.source });
  } else {
    logError('email_send_failed', {
      kind: record.kind,
      channel,
      reason: record.reason,
      code: record.code,
      http_status: record.httpStatus,
      recipient_hash: record.recipientHash,
      source: record.source,
    });
  }

  try {
    await writeSiteSettingStatement(db, CHANNEL_FAILURE_KEY[channel], JSON.stringify(record), record.at).run();
    const counter = record.reason === 'capped' ? SITE_SETTING_KEYS.ownerNoticeCappedCount : SITE_SETTING_KEYS.emailFailureCount;
    await incrementSiteCounterStatement(db, counter, record.at).run();
  } catch (err) {
    logError('email_failure_record_failed', { kind: record.kind, error: errorMessage(err) });
  }
}

/** Remember the last owner notice Resend accepted. Best-effort; never rejects. */
export async function recordOwnerNoticeSent(db: SiteSettingsDb, kind: EmailKind, at: number): Promise<void> {
  try {
    await writeSiteSettingStatement(db, SITE_SETTING_KEYS.ownerNoticeLastSent, JSON.stringify({ at, kind }), at).run();
  } catch (err) {
    logError('owner_notice_sent_record_failed', { kind, error: errorMessage(err) });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string | null | undefined): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

const STORED_NAME = /^[a-z_]{1,64}$/;

/**
 * A stored failure record, or null for anything malformed. A kind or reason written by a
 * newer deploy still parses (the labels fall back to `humanize`), so a preview's failure is
 * shown rather than silently dropped.
 */
export function parseEmailFailure(value: string | null | undefined): EmailFailureRecord | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  const { at, kind, reason, code, httpStatus, recipientHash: hash, source } = parsed;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (typeof kind !== 'string' || !STORED_NAME.test(kind)) return null;
  if (typeof reason !== 'string' || !STORED_NAME.test(reason)) return null;
  if (code !== null && typeof code !== 'string') return null;
  if (httpStatus !== null && typeof httpStatus !== 'number') return null;
  if (typeof hash !== 'string') return null;
  if (source !== null && typeof source !== 'string') return null;
  return {
    at,
    kind: kind as EmailKind,
    reason: reason as EmailProblemReason,
    code,
    httpStatus,
    recipientHash: hash,
    source,
  };
}

function parseLastSent(value: string | undefined): { at: number; kind: string } | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;
  const { at, kind } = parsed;
  if (typeof at !== 'number' || !Number.isFinite(at) || typeof kind !== 'string') return null;
  return { at, kind };
}

function parseCount(value: string | undefined): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const UNAVAILABLE: EmailHealth = {
  unavailable: true,
  lastFailure: { owner: null, records: null, public: null },
  failureCount: 0,
  cappedCount: 0,
  ownerNoticeLastSent: null,
};

/** Everything the dashboard's "Email delivery" card shows, in one read. Never rejects. */
export async function readEmailHealth(db: SiteSettingsDb): Promise<EmailHealth> {
  try {
    const values = await readSiteSettings(db, Object.values(SITE_SETTING_KEYS));
    return {
      unavailable: false,
      lastFailure: {
        owner: parseEmailFailure(values.get(SITE_SETTING_KEYS.emailLastFailureOwner)),
        records: parseEmailFailure(values.get(SITE_SETTING_KEYS.emailLastFailureRecords)),
        public: parseEmailFailure(values.get(SITE_SETTING_KEYS.emailLastFailurePublic)),
      },
      failureCount: parseCount(values.get(SITE_SETTING_KEYS.emailFailureCount)),
      cappedCount: parseCount(values.get(SITE_SETTING_KEYS.ownerNoticeCappedCount)),
      ownerNoticeLastSent: parseLastSent(values.get(SITE_SETTING_KEYS.ownerNoticeLastSent)),
    };
  } catch (err) {
    logError('email_health_read_failed', { error: errorMessage(err) });
    return { ...UNAVAILABLE, lastFailure: { ...UNAVAILABLE.lastFailure } };
  }
}

/** "<kind label>: <reason label>[ (code[, HTTP status])]" */
export function describeEmailFailure(record: EmailFailureRecord): string {
  const detail: string[] = [];
  if (record.code) detail.push(record.code);
  if (typeof record.httpStatus === 'number') detail.push(`HTTP ${record.httpStatus}`);
  const suffix = detail.length > 0 ? ` (${detail.join(', ')})` : '';
  return `${emailKindLabel(record.kind)}: ${emailReasonLabel(record.reason)}${suffix}`;
}

/**
 * 'from <host>' when the failure came from another host — a preview deploy writes to the
 * production database — so it is not mistaken for a production failure. Null otherwise.
 */
export function emailSourceNote(record: EmailFailureRecord, currentHost: string): string | null {
  if (!record.source || record.source === 'records-scheduler' || record.source === currentHost) return null;
  return `from ${record.source}`;
}

export function emailFailureIsRecent(record: EmailFailureRecord, now: number, days = 7): boolean {
  return now - record.at <= days * 86400;
}
