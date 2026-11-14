import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// Changing an account's email deletes its outstanding verification links in the same batch
// as the update. Before this, a link sent to the previous address stayed live and verified
// the account under the new, unproven address.

vi.mock('../password', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../password')>()),
  verifyPassword: vi.fn(async () => true),
}));

import { verifyPassword } from '../password';
import { createVerificationToken } from '../tokens';
import { PATCH as emailPATCH } from '../../pages/api/user/email';
import { GET as verifyGET } from '../../pages/api/auth/verify-email';

const suite = sqliteAvailable ? describe : describe.skip;

const USER = { id: 'u1', email: 'tenant@example.com', emailVerified: false, isAdmin: false };

function locals(db: TestD1Database, user: typeof USER | null) {
  return { user, runtime: { env: { DB: db } } };
}

function changeEmail(db: TestD1Database, newEmail: string, currentPassword = 'pw'): Promise<Response> {
  return emailPATCH({
    request: new Request('https://ratemyplace.org/api/user/email', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newEmail }),
    }),
    locals: locals(db, USER),
  } as unknown as APIContext);
}

function verify(db: TestD1Database, token: string): Promise<Response> {
  const url = new URL(`https://ratemyplace.org/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  return verifyGET({
    url,
    request: new Request(url),
    locals: locals(db, null),
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  } as unknown as APIContext);
}

async function seed(db: TestD1Database): Promise<void> {
  await db
    .prepare("INSERT INTO users (id, email, email_verified, hashed_password) VALUES ('u1', 'tenant@example.com', 0, 'h'), ('u2', 'other@example.com', 0, 'h'), ('u3', 'taken@example.com', 1, 'h')")
    .run();
}

async function tokensOf(db: TestD1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM verification_tokens WHERE user_id = ?').bind(userId).first<{ n: number }>();
  return row?.n ?? -1;
}

async function verifiedFlag(db: TestD1Database, userId: string): Promise<number | undefined> {
  const row = await db.prepare('SELECT email_verified FROM users WHERE id = ?').bind(userId).first<{ email_verified: number }>();
  return row?.email_verified;
}

beforeEach(() => {
  vi.mocked(verifyPassword).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

suite('an email change revokes outstanding verification links', () => {
  it("deletes the account's tokens and leaves another account's alone", async () => {
    const db = schemaDb();
    await seed(db);
    await createVerificationToken(db as never, 'u1');
    await createVerificationToken(db as never, 'u2');

    const res = await changeEmail(db, 'moved@example.com');
    expect(res.status).toBe(200);
    expect(await tokensOf(db, 'u1')).toBe(0);
    expect(await tokensOf(db, 'u2')).toBe(1);
  });

  it("a link sent to the previous address no longer verifies the account", async () => {
    const db = schemaDb();
    await seed(db);
    const oldLink = await createVerificationToken(db as never, 'u1');

    expect((await changeEmail(db, 'moved@example.com')).status).toBe(200);
    const res = await verify(db, oldLink);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/signin?error=invalid_link');
    expect(await verifiedFlag(db, 'u1')).toBe(0);
  });

  it('a wrong password leaves the tokens in place', async () => {
    const db = schemaDb();
    await seed(db);
    await createVerificationToken(db as never, 'u1');
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    const res = await changeEmail(db, 'moved@example.com', 'wrong');
    expect(res.status).toBe(400);
    expect(await tokensOf(db, 'u1')).toBe(1);
  });

  it('an address already in use leaves the tokens in place', async () => {
    const db = schemaDb();
    await seed(db);
    await createVerificationToken(db as never, 'u1');

    const res = await changeEmail(db, 'taken@example.com');
    expect(res.status).toBe(409);
    expect(await tokensOf(db, 'u1')).toBe(1);
    const row = await db.prepare("SELECT email FROM users WHERE id = 'u1'").first<{ email: string }>();
    expect(row?.email).toBe('tenant@example.com');
  });
});
