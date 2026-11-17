import type { APIContext } from 'astro';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { DELETE as deleteReview } from '../../pages/api/admin/reviews/[id]';
import { DELETE as deleteBuilding } from '../../pages/api/admin/buildings/[id]';
import { createAdminTestDb } from './helpers/adminDb';
import { insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// A proof-of-address file is deleted from R2 when an admin decides on it. A review deleted
// before that decision, or with its building, used to leave the file in R2 with nothing
// pointing at it. Both deletes now remove the files first, finish even when R2 refuses, log
// a failure without a key, filename or user id, and put the counts on the audit entry.

const suite = sqliteAvailable ? describe : describe.skip;

// Keys follow the upload route's shape: users/{userId}/verifications/{reviewId}/{timestamp}.{ext}
const KEY_PENDING = 'users/tenant-1/verifications/rev-1/1700000001.pdf';
const KEY_DECIDED = 'users/tenant-2/verifications/rev-2/1700000002.jpg';
const KEY_OTHER = 'users/tenant-3/verifications/rev-3/1700000003.png';
const FILENAME = 'my-lease-sentinel.pdf';

/** The table as migration 0007 creates it, read from the file so it cannot drift. */
function verificationImagesDdl(): string {
  const sql = readFileSync(join(process.cwd(), 'migrations', '0007_verification_and_admin.sql'), 'utf8');
  const ddl = sql.match(/CREATE TABLE IF NOT EXISTS verification_images \([\s\S]*?\n\);/);
  if (!ddl) throw new Error('could not find verification_images in 0007');
  return ddl[0];
}

interface FakeBucket {
  deleted: string[];
  /** Whether the review row still existed when each delete ran. */
  reviewPresent: boolean[];
  failing: Set<string>;
  delete(key: string): Promise<void>;
}

function fakeBucket(db: TestD1Database, failing: string[] = []): FakeBucket {
  const bucket: FakeBucket = {
    deleted: [],
    reviewPresent: [],
    failing: new Set(failing),
    async delete(key: string) {
      const reviewId = key.split('/')[3];
      bucket.reviewPresent.push((await db.prepare('SELECT 1 AS present FROM reviews WHERE id = ?').bind(reviewId).first()) !== null);
      if (bucket.failing.has(key)) throw new Error(`R2 refused ${key}`);
      bucket.deleted.push(key);
    },
  };
  return bucket;
}

function context(db: TestD1Database, url: string, id: string, bucket: FakeBucket | undefined): APIContext {
  return {
    request: new Request(url, { method: 'DELETE' }),
    url: new URL(url),
    params: { id },
    locals: {
      user: { id: 'admin-1', isAdmin: true },
      runtime: { env: { DB: db, ...(bucket ? { VERIFICATION_BUCKET: bucket } : {}) } },
    },
  } as unknown as APIContext;
}

suite('admin deletes remove proof-of-address files', () => {
  let db: TestD1Database;
  let errorSpy: MockInstance;

  beforeEach(async () => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    db = createAdminTestDb();
    db.exec(verificationImagesDdl());
    for (const id of ['admin-1', 'tenant-1', 'tenant-2', 'tenant-3']) {
      await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, `${id}@example.test`).run();
    }
    await insertBuilding(db, { id: 'bldg-a', address: '1 Test Street', slug: '1-test-street-boston' });
    await insertBuilding(db, { id: 'bldg-b', address: '3 Test Street', slug: '3-test-street-boston' });
    const review = (id: string, userId: string, buildingId: string, status: string) =>
      db.prepare('INSERT INTO reviews (id, user_id, building_id, status) VALUES (?, ?, ?, ?)').bind(id, userId, buildingId, status).run();
    await review('rev-1', 'tenant-1', 'bldg-a', 'pending');
    await review('rev-2', 'tenant-2', 'bldg-a', 'approved');
    await review('rev-3', 'tenant-3', 'bldg-b', 'pending');
    const document = (id: string, reviewId: string, userId: string, key: string, filename: string, status: string) =>
      db
        .prepare(
          "INSERT INTO verification_images (id, review_id, user_id, r2_key, filename, content_type, size_bytes, status) VALUES (?, ?, ?, ?, ?, 'application/pdf', 1000, ?)",
        )
        .bind(id, reviewId, userId, key, filename, status)
        .run();
    await document('ver-1', 'rev-1', 'tenant-1', KEY_PENDING, FILENAME, 'pending');
    await document('ver-2', 'rev-2', 'tenant-2', KEY_DECIDED, '', 'approved');
    await document('ver-3', 'rev-3', 'tenant-3', KEY_OTHER, FILENAME, 'pending');
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  async function auditNewValue(actionType: string): Promise<Record<string, unknown>> {
    const row = await db.prepare('SELECT new_value FROM audit_logs WHERE action_type = ?').bind(actionType).first<{ new_value: string | null }>();
    expect(row).not.toBeNull();
    return JSON.parse(row?.new_value ?? 'null') as Record<string, unknown>;
  }

  async function count(sql: string): Promise<number> {
    return (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  }

  function loggedText(): string {
    return errorSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
  }

  function loggedEvents(): Array<Record<string, unknown>> {
    return errorSpy.mock.calls.flatMap((call) => {
      try {
        return [JSON.parse(String(call[0])) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  }

  function expectNothingIdentifyingLogged(): void {
    const text = loggedText();
    for (const secret of [KEY_PENDING, KEY_DECIDED, KEY_OTHER, FILENAME, 'tenant-1', 'tenant-2', 'users/']) {
      expect(text).not.toContain(secret);
    }
  }

  it('deleting a review removes its pending document before the review row goes, and audits the count', async () => {
    const bucket = fakeBucket(db);

    const res = await deleteReview(context(db, 'https://ratemyplace.org/api/admin/reviews/rev-1', 'rev-1', bucket));

    expect(res.status).toBe(200);
    expect(bucket.deleted).toEqual([KEY_PENDING]);
    expect(bucket.reviewPresent).toEqual([true]);
    expect(await count("SELECT COUNT(*) AS n FROM reviews WHERE id = 'rev-1'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM verification_images WHERE review_id = 'rev-1'")).toBe(0);
    expect(await auditNewValue('review_deleted')).toMatchObject({ deleted: true, verificationFiles: { removed: 1, failed: 0 } });
  });

  it('a review with no document makes no R2 call and audits zero files', async () => {
    await db.prepare("INSERT INTO reviews (id, user_id, building_id, status) VALUES ('rev-4', 'tenant-1', 'bldg-b', 'approved')").run();
    const bucket = fakeBucket(db);

    const res = await deleteReview(context(db, 'https://ratemyplace.org/api/admin/reviews/rev-4', 'rev-4', bucket));

    expect(res.status).toBe(200);
    expect(bucket.deleted).toEqual([]);
    expect(bucket.reviewPresent).toEqual([]);
    expect(await auditNewValue('review_deleted')).toMatchObject({ verificationFiles: { removed: 0, failed: 0 } });
  });

  it('still deletes the review when R2 refuses, logs without the key, and audits the failure', async () => {
    const bucket = fakeBucket(db, [KEY_PENDING]);

    const res = await deleteReview(context(db, 'https://ratemyplace.org/api/admin/reviews/rev-1', 'rev-1', bucket));

    expect(res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM reviews WHERE id = 'rev-1'")).toBe(0);
    expect(await auditNewValue('review_deleted')).toMatchObject({ verificationFiles: { removed: 0, failed: 1 } });
    expect(loggedEvents().map((entry) => entry.event)).toContain('verification_files_delete_failed');
    expectNothingIdentifyingLogged();
  });

  it('still deletes the review when the bucket binding is missing, and counts the file as failed', async () => {
    const res = await deleteReview(context(db, 'https://ratemyplace.org/api/admin/reviews/rev-1', 'rev-1', undefined));

    expect(res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM reviews WHERE id = 'rev-1'")).toBe(0);
    expect(await auditNewValue('review_deleted')).toMatchObject({ verificationFiles: { removed: 0, failed: 1 } });
    expect(loggedEvents().map((entry) => entry.event)).toContain('verification_files_delete_failed');
    expectNothingIdentifyingLogged();
  });

  it("deleting a building removes every document of its reviews, and only those, before the building goes", async () => {
    const bucket = fakeBucket(db);

    const res = await deleteBuilding(context(db, 'https://ratemyplace.org/api/admin/buildings/bldg-a', 'bldg-a', bucket));

    expect(res.status).toBe(200);
    expect([...bucket.deleted].sort()).toEqual([KEY_DECIDED, KEY_PENDING].sort());
    expect(bucket.reviewPresent).toEqual([true, true]);
    expect(await count("SELECT COUNT(*) AS n FROM buildings WHERE id = 'bldg-a'")).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM verification_images')).toBe(1);
    expect(await auditNewValue('building_deleted')).toMatchObject({ verificationFiles: { removed: 2, failed: 0 } });
  });

  it('still deletes the building when one file fails, and audits both counts', async () => {
    const bucket = fakeBucket(db, [KEY_DECIDED]);

    const res = await deleteBuilding(context(db, 'https://ratemyplace.org/api/admin/buildings/bldg-a', 'bldg-a', bucket));

    expect(res.status).toBe(200);
    expect(bucket.deleted).toEqual([KEY_PENDING]);
    expect(await count("SELECT COUNT(*) AS n FROM buildings WHERE id = 'bldg-a'")).toBe(0);
    expect(await auditNewValue('building_deleted')).toMatchObject({ verificationFiles: { removed: 1, failed: 1 } });
    expectNothingIdentifyingLogged();
  });
});
