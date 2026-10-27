import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';
import { ADMIN_INBOX_ROWS, readAdminInbox } from '../admin/inbox';
import { OWNER_NOTICE_ADMIN_PATH } from '../ownerNotify';

const TABLES = ['reviews', 'bug_reports', 'record_corrections', 'disputes', 'verification_images'] as const;

function inboxDb(rows: Partial<Record<(typeof TABLES)[number], string[]>>, skip: string[] = []): TestD1Database {
  const db = new TestD1Database(createMemoryDatabase());
  for (const table of TABLES) {
    if (skip.includes(table)) continue;
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, status TEXT NOT NULL)`);
    (rows[table] ?? []).forEach((status, i) => {
      db.exec(`INSERT INTO ${table} (id, status) VALUES ('${table}-${i}', '${status}')`);
    });
  }
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.skipIf(!sqliteAvailable)('readAdminInbox', () => {
  it('counts only what is waiting on the owner', async () => {
    const db = inboxDb({
      reviews: ['pending', 'pending', 'approved', 'rejected', 'flagged'],
      bug_reports: ['new', 'in_progress', 'resolved', 'wont_fix'],
      record_corrections: ['pending', 'resolved'],
      disputes: ['pending', 'resolved', 'resolved'],
      verification_images: ['pending', 'pending', 'pending', 'approved', 'rejected'],
    });

    expect(await readAdminInbox(db)).toEqual({
      reviewsPending: 2,
      bugReportsOpen: 2,
      correctionsPending: 1,
      disputesPending: 1,
      verificationsPending: 3,
    });
  });

  it('reads all zeros from empty tables', async () => {
    expect(await readAdminInbox(inboxDb({}))).toEqual({
      reviewsPending: 0,
      bugReportsOpen: 0,
      correctionsPending: 0,
      disputesPending: 0,
      verificationsPending: 0,
    });
  });

  it('returns null and logs once when a table is missing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await readAdminInbox(inboxDb({}, ['disputes']))).toBeNull();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toMatchObject({ event: 'admin_inbox_failed' });
  });
});

describe('ADMIN_INBOX_ROWS', () => {
  it('links each row to the same queue its owner notice links to', () => {
    expect(ADMIN_INBOX_ROWS.map((row) => row.href).sort()).toEqual(
      [...new Set(Object.values(OWNER_NOTICE_ADMIN_PATH))].sort(),
    );
  });

  it('covers every count, with readable labels', () => {
    expect(ADMIN_INBOX_ROWS.map((row) => row.key)).toEqual([
      'reviewsPending',
      'bugReportsOpen',
      'correctionsPending',
      'disputesPending',
      'verificationsPending',
    ]);
    expect(ADMIN_INBOX_ROWS.map((row) => row.label)).toEqual([
      'Reviews to moderate',
      'Open bug reports',
      'Record corrections',
      'Landlord disputes',
      'Tenancy documents to verify',
    ]);
  });
});
