// The `app_settings` keys the records pipeline owns, plus the one-line reader and writer
// that go with them.
//
// A LEAF module on purpose: it imports `./types` and nothing else. The keys are read by the
// admin routes and the panel as well as by the scheduler, and importing the scheduler for a
// string constant would drag the whole pull stack — every Boston source adapter — into a
// request path that only wants to look one row up in `app_settings`.
import type { RecordsDb } from './types';

export const SETTING_KEYS = {
  /** '1' or '0'. The city-wide fill switch: set by the breaker, cleared only by a human. */
  fillPaused: 'records_fill_paused',
  /** Unix seconds of the last breaker alert, so a paused fill does not alert again. */
  breakerLastAlert: 'records_breaker_last_alert',
  /** JSON: what the daily Lanark fixture saw. Rendered by the admin queue panel. */
  fixtureLast: 'records_fixture_last',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export async function readSetting(db: RecordsDb, key: SettingKey): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/** `app_settings.updated_at` defaults on insert but does not self-update (0031), so it is set explicitly. */
export async function writeSetting(db: RecordsDb, key: SettingKey, value: string, now: number): Promise<void> {
  await db
    .prepare(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(key, value, now)
    .run();
}
