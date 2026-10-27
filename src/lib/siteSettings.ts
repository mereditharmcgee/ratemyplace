// The site-level `app_settings` keys: email delivery health and owner-notice state.
//
// A LEAF module on purpose, like `records/settings.ts`: it imports only types, so the email
// tracker can write a row from any request path (or the records Worker) without pulling in
// anything else. The records pipeline owns its own keys in `records/settings.ts`; the two
// sets never overlap, and none of these starts with `records_`.
import type { RecordsDb, RecordsPreparedStatement } from './records/types';

export const SITE_SETTING_KEYS = {
  /** JSON `EmailFailureRecord`: the last owner-notice or contact-notification problem. */
  emailLastFailureOwner: 'email_last_failure_owner',
  /** JSON `EmailFailureRecord`: the last records-scheduler alert problem. */
  emailLastFailureRecords: 'email_last_failure_records',
  /** JSON `EmailFailureRecord`: the last problem sending to a member of the public. */
  emailLastFailurePublic: 'email_last_failure_public',
  /** Integer as text: attempted sends that failed. */
  emailFailureCount: 'email_failure_count',
  /** Integer as text: owner notices held back by the notice cap. */
  ownerNoticeCappedCount: 'owner_notice_capped_count',
  /** JSON `{ at: number; kind: string }`: the last owner notice Resend accepted. */
  ownerNoticeLastSent: 'owner_notice_last_sent',
} as const;

export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[keyof typeof SITE_SETTING_KEYS];

/** The real `D1Database` and the `TestD1Database` double both satisfy it. */
export type SiteSettingsDb = RecordsDb;

/** One SELECT for every key asked for; an absent key is simply missing from the map. */
export async function readSiteSettings(
  db: SiteSettingsDb,
  keys: readonly SiteSettingKey[],
): Promise<Map<SiteSettingKey, string>> {
  const values = new Map<SiteSettingKey, string>();
  if (keys.length === 0) return values;
  const placeholders = keys.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT key, value FROM app_settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  for (const row of results) {
    const key = keys.find((candidate) => candidate === row.key);
    if (key) values.set(key, row.value);
  }
  return values;
}

/**
 * The upsert as a statement. `app_settings.updated_at` defaults on insert but does not
 * self-update (0031), so it is set explicitly — the same SQL as `records/settings.ts`.
 */
export function writeSiteSettingStatement(
  db: SiteSettingsDb,
  key: SiteSettingKey,
  value: string,
  now: number,
): RecordsPreparedStatement {
  return db
    .prepare(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(key, value, now);
}

/**
 * An atomic counter bump in one statement. An absent key starts at '1'; a stored value that
 * is not a number counts as 0, so a bad row heals on the next increment instead of sticking.
 */
export function incrementSiteCounterStatement(
  db: SiteSettingsDb,
  key: SiteSettingKey,
  now: number,
): RecordsPreparedStatement {
  return db
    .prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', ?) " +
        'ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(app_settings.value AS INTEGER) + 1 AS TEXT), ' +
        'updated_at = excluded.updated_at',
    )
    .bind(key, now);
}
