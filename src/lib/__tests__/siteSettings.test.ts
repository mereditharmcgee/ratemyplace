import { describe, it, expect, beforeEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb } from './helpers/recordsDb';
import { SETTING_KEYS } from '../records/settings';
import type { RecordsDb } from '../records/types';
import {
  SITE_SETTING_KEYS,
  readSiteSettings,
  writeSiteSettingStatement,
  incrementSiteCounterStatement,
} from '../siteSettings';

describe('SITE_SETTING_KEYS', () => {
  it('never shares a key with the records pipeline', () => {
    const recordKeys = new Set<string>(Object.values(SETTING_KEYS));
    for (const key of Object.values(SITE_SETTING_KEYS)) {
      expect(recordKeys.has(key)).toBe(false);
      expect(key.startsWith('records_')).toBe(false);
    }
  });
});

describe.skipIf(!sqliteAvailable)('site settings in app_settings', () => {
  let db: TestD1Database;

  beforeEach(() => {
    db = createRecordsTestDb();
  });

  async function updatedAt(key: string): Promise<number | null> {
    const row = await db.prepare('SELECT updated_at FROM app_settings WHERE key = ?').bind(key).first<{ updated_at: number }>();
    return row?.updated_at ?? null;
  }

  it('returns an empty map for absent keys', async () => {
    const values = await readSiteSettings(db, [SITE_SETTING_KEYS.emailFailureCount, SITE_SETTING_KEYS.emailLastFailureOwner]);
    expect(values.size).toBe(0);
  });

  it('returns only the keys it was asked for', async () => {
    await writeSiteSettingStatement(db, SITE_SETTING_KEYS.emailFailureCount, '4', 100).run();
    await writeSiteSettingStatement(db, SITE_SETTING_KEYS.ownerNoticeCappedCount, '2', 100).run();
    const values = await readSiteSettings(db, [SITE_SETTING_KEYS.emailFailureCount]);
    expect([...values.entries()]).toEqual([[SITE_SETTING_KEYS.emailFailureCount, '4']]);
  });

  it('returns an empty map when asked for no keys, without querying', async () => {
    const values = await readSiteSettings(db, []);
    expect(values.size).toBe(0);
  });

  it('round-trips a write, and a second write overwrites the value and updated_at', async () => {
    await writeSiteSettingStatement(db, SITE_SETTING_KEYS.ownerNoticeLastSent, '{"at":1}', 100).run();
    expect((await readSiteSettings(db, [SITE_SETTING_KEYS.ownerNoticeLastSent])).get(SITE_SETTING_KEYS.ownerNoticeLastSent)).toBe('{"at":1}');
    expect(await updatedAt(SITE_SETTING_KEYS.ownerNoticeLastSent)).toBe(100);

    await writeSiteSettingStatement(db, SITE_SETTING_KEYS.ownerNoticeLastSent, '{"at":2}', 250).run();
    expect((await readSiteSettings(db, [SITE_SETTING_KEYS.ownerNoticeLastSent])).get(SITE_SETTING_KEYS.ownerNoticeLastSent)).toBe('{"at":2}');
    expect(await updatedAt(SITE_SETTING_KEYS.ownerNoticeLastSent)).toBe(250);
  });

  it('increments an absent counter to 1, then counts up', async () => {
    const key = SITE_SETTING_KEYS.emailFailureCount;
    await incrementSiteCounterStatement(db, key, 10).run();
    expect((await readSiteSettings(db, [key])).get(key)).toBe('1');
    await incrementSiteCounterStatement(db, key, 11).run();
    await incrementSiteCounterStatement(db, key, 12).run();
    expect((await readSiteSettings(db, [key])).get(key)).toBe('3');
    expect(await updatedAt(key)).toBe(12);
  });

  it('counts three increments inside one batch', async () => {
    const key = SITE_SETTING_KEYS.ownerNoticeCappedCount;
    const records: RecordsDb = db;
    await records.batch([
      incrementSiteCounterStatement(db, key, 10),
      incrementSiteCounterStatement(db, key, 10),
      incrementSiteCounterStatement(db, key, 10),
    ]);
    expect((await readSiteSettings(db, [key])).get(key)).toBe('3');
  });

  it('treats a non-numeric stored value as 0 when incrementing', async () => {
    const key = SITE_SETTING_KEYS.emailFailureCount;
    await writeSiteSettingStatement(db, key, 'x', 10).run();
    await incrementSiteCounterStatement(db, key, 11).run();
    expect((await readSiteSettings(db, [key])).get(key)).toBe('1');
  });
});
