// The `app_settings` keys the records pipeline owns, plus the one-line reader and writer
// that go with them.
//
// A LEAF module on purpose: it imports `./types` and nothing else. The keys are read by the
// admin routes and the panel as well as by the scheduler, and importing the scheduler for a
// string constant would drag the whole pull stack — every Boston source adapter — into a
// request path that only wants to look one row up in `app_settings`.
import type { RecordsDb, RecordsPreparedStatement } from './types';

export const SETTING_KEYS = {
  /**
   * '1' or '0'. The city-wide fill switch: set by the breaker or a human, cleared by a human —
   * or by the planner, only for a pause whose recorded cause is `fixture`. See below.
   */
  fillPaused: 'records_fill_paused',
  /** Unix seconds of the last breaker alert, so a paused fill does not alert again. */
  breakerLastAlert: 'records_breaker_last_alert',
  /** JSON: what the daily Lanark fixture saw. Rendered by the admin queue panel. */
  fixtureLast: 'records_fixture_last',
  /**
   * A `BreakerPauseCause`, present only while the breaker owns the current pause. Written in
   * the same batch as the pause; deleted by every other write of `fillPaused`, so a hand pause
   * or a hand resume leaves no cause behind. Absent means a human owns the pause (or it
   * predates this key), and the planner never undoes it.
   */
  breakerPauseCause: 'records_breaker_pause_cause',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * Why the breaker paused the fill. `fixture`: the Lanark fixture failed (this wins when the
 * error rate tripped too) — the planner resumes it the first morning the fixture passes and no
 * source is over the error threshold. `errors`: only a source's error rate tripped — that needs
 * a human, because the fill is the main thing feeding the rate, and a paused fill would let it
 * look healthy without anything having been fixed.
 */
export type BreakerPauseCause = 'fixture' | 'errors';

/** Reads the stored cause, treating anything unrecognised as no cause — i.e. a human's pause. */
export async function readBreakerPauseCause(db: RecordsDb): Promise<BreakerPauseCause | null> {
  const value = await readSetting(db, SETTING_KEYS.breakerPauseCause);
  return value === 'fixture' || value === 'errors' ? value : null;
}

export async function readSetting(db: RecordsDb, key: SettingKey): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * The upsert as a statement, for a caller that has to batch it with another write.
 * `app_settings.updated_at` defaults on insert but does not self-update (0031), so it is set
 * explicitly.
 */
export function writeSettingStatement(db: RecordsDb, key: SettingKey, value: string, now: number): RecordsPreparedStatement {
  return db
    .prepare(
      'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(key, value, now);
}

export async function writeSetting(db: RecordsDb, key: SettingKey, value: string, now: number): Promise<void> {
  await writeSettingStatement(db, key, value, now).run();
}

/** Removing the row, not blanking it: an absent key reads as null everywhere, which is the one "unset" there is. */
export function deleteSettingStatement(db: RecordsDb, key: SettingKey): RecordsPreparedStatement {
  return db.prepare('DELETE FROM app_settings WHERE key = ?').bind(key);
}
