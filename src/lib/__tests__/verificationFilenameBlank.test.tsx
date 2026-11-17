import type { APIContext } from 'astro';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import VerificationQueue from '../../components/admin/VerificationQueue';
import type { PendingVerification } from '../../pages/api/admin/pending-verifications';
import { GET, POST } from '../../pages/api/admin/verification/[id]';
import { createAdminTestDb } from './helpers/adminDb';
import { insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// The filename on a proof-of-address upload is the tenant's own ("Lease - 12 Main St Apt 3.pdf"
// is typical), so it is kept only while an admin needs it. A decision blanks it, approve or
// reject; the column is NOT NULL, so blank means ''. Admin views that show a filename cope
// with an empty one.

const suite = sqliteAvailable ? describe : describe.skip;
const FILENAME = 'lease-sentinel-unit-4b.pdf';

function verificationImagesDdl(): string {
  const sql = readFileSync(join(process.cwd(), 'migrations', '0007_verification_and_admin.sql'), 'utf8');
  const ddl = sql.match(/CREATE TABLE IF NOT EXISTS verification_images \([\s\S]*?\n\);/);
  if (!ddl) throw new Error('could not find verification_images in 0007');
  return ddl[0];
}

suite('a verification decision blanks the filename', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createAdminTestDb();
    // The approve path stamps these 0007 review columns; the admin test db leaves them out.
    db.exec('ALTER TABLE reviews ADD COLUMN verified_at INTEGER; ALTER TABLE reviews ADD COLUMN verified_by TEXT;');
    db.exec(verificationImagesDdl());
    for (const id of ['admin-1', 'tenant-1']) {
      await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, `${id}@example.test`).run();
    }
    await insertBuilding(db, { id: 'bldg-a', address: '1 Test Street', slug: '1-test-street-boston' });
    await db.prepare("INSERT INTO reviews (id, user_id, building_id, status) VALUES ('rev-1', 'tenant-1', 'bldg-a', 'approved')").run();
    await db
      .prepare(
        "INSERT INTO verification_images (id, review_id, user_id, r2_key, filename, content_type, size_bytes) VALUES ('ver-1', 'rev-1', 'tenant-1', 'users/tenant-1/verifications/rev-1/1.pdf', ?, 'application/pdf', 2048)",
      )
      .bind(FILENAME)
      .run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function decide(action: 'approve' | 'reject'): Promise<Response> {
    return POST({
      params: { id: 'ver-1' },
      request: new Request('https://ratemyplace.org/api/admin/verification/ver-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejection_reason: action === 'reject' ? 'Address does not match.' : undefined }),
      }),
      locals: {
        user: { id: 'admin-1', isAdmin: true },
        runtime: { env: { DB: db, VERIFICATION_BUCKET: { delete: async () => {} } } },
      },
    } as unknown as APIContext);
  }

  async function row(): Promise<Record<string, unknown> | null> {
    return db
      .prepare('SELECT status, filename, content_type, size_bytes, reviewed_by, rejection_reason FROM verification_images WHERE id = ?')
      .bind('ver-1')
      .first<Record<string, unknown>>();
  }

  it('on approval', async () => {
    const res = await decide('approve');
    expect(res.status).toBe(200);
    expect(await row()).toEqual({
      status: 'approved',
      filename: '',
      content_type: 'application/pdf',
      size_bytes: 2048,
      reviewed_by: 'admin-1',
      rejection_reason: null,
    });
  });

  it('on rejection', async () => {
    const res = await decide('reject');
    expect(res.status).toBe(200);
    expect(await row()).toEqual({
      status: 'rejected',
      filename: '',
      content_type: 'application/pdf',
      size_bytes: 2048,
      reviewed_by: 'admin-1',
      rejection_reason: 'Address does not match.',
    });
  });

  it('a blank filename still downloads under a generic name', async () => {
    await db.prepare("UPDATE verification_images SET filename = '' WHERE id = 'ver-1'").run();
    const res = await GET({
      params: { id: 'ver-1' },
      request: new Request('https://ratemyplace.org/api/admin/verification/ver-1'),
      locals: {
        user: { id: 'admin-1', isAdmin: true },
        runtime: { env: { DB: db, VERIFICATION_BUCKET: { get: async () => ({ body: 'bytes' }) } } },
      },
    } as unknown as APIContext);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="verification"');
  });
});

describe('the admin queue with a blank filename', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ROW: PendingVerification = {
    id: 'ver-example-1',
    review_id: 'review-example-1',
    user_id: 'user-example-1',
    r2_key: 'example/key',
    filename: '',
    content_type: 'application/pdf',
    size_bytes: 2048,
    uploaded_at: 1767225600,
    building_address: '12 Example Rd',
    building_city: 'Boston',
    user_email: 'tenant@example.com',
  };

  it.each(['', '   '])('shows "Unnamed file" for %j, with the size', async (filename) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verifications: [{ ...ROW, filename }] }) }));
    render(<VerificationQueue />);
    await screen.findByText('12 Example Rd');
    expect(screen.getByText('Unnamed file (2.0 KB)')).toBeTruthy();
  });

  it('shows the filename when there is one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verifications: [{ ...ROW, filename: 'example-lease.pdf' }] }) }));
    render(<VerificationQueue />);
    await screen.findByText('12 Example Rd');
    expect(screen.getByText('example-lease.pdf (2.0 KB)')).toBeTruthy();
  });
});
