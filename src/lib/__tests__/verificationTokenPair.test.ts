import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createVerificationToken, validateVerificationToken } from '../tokens';
import { GET as verifyGET } from '../../pages/api/auth/verify-email';

// A resend keeps the previous unexpired link working, so pressing resend on the review
// pages right after sign-up does not kill the sign-up email's link. At most two links are
// live per account, and a verification with either one deletes both.

const suite = sqliteAvailable ? describe : describe.skip;

function verify(db: TestD1Database, token: string): Promise<Response> {
  const url = new URL(`https://ratemyplace.org/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  return verifyGET({
    url,
    request: new Request(url),
    locals: { user: null, runtime: { env: { DB: db } } },
    redirect: (path: string, status = 302) => new Response(null, { status, headers: { Location: path } }),
  } as unknown as APIContext);
}

async function seed(db: TestD1Database): Promise<void> {
  await db
    .prepare("INSERT INTO users (id, email, email_verified) VALUES ('u1', 'tenant@example.com', 0), ('u2', 'other@example.com', 0)")
    .run();
}

async function valid(db: TestD1Database, token: string): Promise<boolean> {
  return (await validateVerificationToken(db as never, token)).valid;
}

async function liveTokens(db: TestD1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT token FROM verification_tokens WHERE user_id = ? ORDER BY rowid')
    .bind(userId)
    .all<{ token: string }>();
  return results.map((row) => row.token);
}

async function create(db: TestD1Database, userId: string): Promise<string> {
  return createVerificationToken(db as never, userId);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

suite('verification links: a resend keeps the previous one', () => {
  it('the sign-up link and the resend link both work', async () => {
    const db = schemaDb();
    await seed(db);
    const t1 = await create(db, 'u1');
    const t2 = await create(db, 'u1');
    expect(await valid(db, t1)).toBe(true);
    expect(await valid(db, t2)).toBe(true);
  });

  it('verifying with the older link verifies the account and deletes both', async () => {
    const db = schemaDb();
    await seed(db);
    const t1 = await create(db, 'u1');
    await create(db, 'u1');

    const res = await verify(db, t1);
    expect(res.headers.get('Location')).toBe('/email-verified');
    const row = await db.prepare("SELECT email_verified FROM users WHERE id = 'u1'").first<{ email_verified: number }>();
    expect(row?.email_verified).toBe(1);
    expect(await liveTokens(db, 'u1')).toEqual([]);
  });

  it('at most two links are live: a third send drops the oldest', async () => {
    const db = schemaDb();
    await seed(db);
    const t1 = await create(db, 'u1');
    const t2 = await create(db, 'u1');
    const t3 = await create(db, 'u1');
    expect(await valid(db, t1)).toBe(false);
    expect(await valid(db, t2)).toBe(true);
    expect(await valid(db, t3)).toBe(true);
    expect(await liveTokens(db, 'u1')).toEqual([t2, t3]);
  });

  it('an expired previous link is not kept', async () => {
    const db = schemaDb();
    await seed(db);
    const t1 = await create(db, 'u1');
    await db.prepare('UPDATE verification_tokens SET expires_at = unixepoch() - 60 WHERE token = ?').bind(t1).run();
    const t2 = await create(db, 'u1');
    expect(await liveTokens(db, 'u1')).toEqual([t2]);
  });

  it('two links made in the same second: the later one is the one kept', async () => {
    const db = schemaDb();
    await seed(db);
    const t1 = await create(db, 'u1');
    const t2 = await create(db, 'u1');
    await db.prepare("UPDATE verification_tokens SET created_at = 1700000000 WHERE user_id = 'u1'").run();
    const t3 = await create(db, 'u1');
    expect(await liveTokens(db, 'u1')).toEqual([t2, t3]);
    expect(await valid(db, t1)).toBe(false);
  });

  it("another account's links are untouched by every send and by a verification", async () => {
    const db = schemaDb();
    await seed(db);
    const other1 = await create(db, 'u2');
    const other2 = await create(db, 'u2');
    const mine = await create(db, 'u1');
    await create(db, 'u1');
    await create(db, 'u1');
    expect(await liveTokens(db, 'u2')).toEqual([other1, other2]);

    await verify(db, (await liveTokens(db, 'u1'))[0]);
    expect(await liveTokens(db, 'u2')).toEqual([other1, other2]);
    expect(await valid(db, mine)).toBe(false);
    const row = await db.prepare("SELECT email_verified FROM users WHERE id = 'u2'").first<{ email_verified: number }>();
    expect(row?.email_verified).toBe(0);
  });

  it('an unknown or expired link still lands on the sign-in error, unchanged', async () => {
    const db = schemaDb();
    await seed(db);
    expect((await verify(db, 'nope')).headers.get('Location')).toBe('/auth/signin?error=invalid_link');
    const t1 = await create(db, 'u1');
    await db.prepare('UPDATE verification_tokens SET expires_at = unixepoch() - 60 WHERE token = ?').bind(t1).run();
    expect((await verify(db, t1)).headers.get('Location')).toBe('/auth/signin?error=link_expired');
  });
});
