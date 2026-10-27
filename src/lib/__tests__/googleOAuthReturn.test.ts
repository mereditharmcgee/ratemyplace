import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { GET as startGoogle } from '../../pages/api/auth/google';
import { GET as googleCallback } from '../../pages/api/auth/google/callback';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';

// The Google round trip carries the sign-in return path in its own cookie,
// `oauth_return_to`, scoped to /api/auth/google so only the callback ever sees it. The
// `oauth_state` cookie and its CSRF comparison are untouched; the path never travels as a
// callback query parameter, and `redirect_uri` stays exactly /api/auth/google/callback.

interface SetCall { name: string; value: string; options: Record<string, unknown> }
interface DeleteCall { name: string; options: Record<string, unknown> }

function fakeJar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const sets: SetCall[] = [];
  const deletes: DeleteCall[] = [];
  return {
    sets,
    deletes,
    jar: {
      get: (name: string) => (values.has(name) ? { value: values.get(name) as string } : undefined),
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        values.set(name, value);
        sets.push({ name, value, options });
      },
      delete: (name: string, options: Record<string, unknown> = {}) => {
        values.delete(name);
        deletes.push({ name, options });
      },
    },
  };
}

function context(url: string, jar: unknown, env: Record<string, unknown>): APIContext {
  return {
    url: new URL(url),
    cookies: jar,
    locals: { runtime: { env } },
    redirect: (to: string, status = 302) => new Response(null, { status, headers: { Location: to } }),
  } as unknown as APIContext;
}

const RETURN = '/review/new?placeId=abc';
const RETURN_ENC = '%2Freview%2Fnew%3FplaceId%3Dabc';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GET /api/auth/google remembers where to return', () => {
  it('sets oauth_return_to beside an unchanged oauth_state and an unchanged redirect_uri', async () => {
    const { jar, sets } = fakeJar();
    const res = await startGoogle(context(`https://ratemyplace.org/api/auth/google?redirect=${RETURN_ENC}`, jar, { GOOGLE_CLIENT_ID: 'cid' }));

    const ret = sets.find((s) => s.name === 'oauth_return_to');
    expect(ret).toEqual({
      name: 'oauth_return_to',
      value: RETURN,
      options: { path: '/api/auth/google', httpOnly: true, sameSite: 'lax', secure: import.meta.env.PROD, maxAge: 600 },
    });
    const state = sets.find((s) => s.name === 'oauth_state');
    expect(state?.options.path).toBe('/');

    const location = new URL(res.headers.get('Location') ?? '');
    expect(location.host).toBe('accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe('https://ratemyplace.org/api/auth/google/callback');
    expect(location.searchParams.get('state')).toBe(state?.value);
  });

  it.each([['%2F%2Fevil.example'], ['%2F.%2F%2Fevil.example']])('an unsafe redirect %s sets nothing and clears any stale cookie', async (encoded) => {
    const { jar, sets, deletes } = fakeJar({ oauth_return_to: '/stale' });
    await startGoogle(context(`https://ratemyplace.org/api/auth/google?redirect=${encoded}`, jar, { GOOGLE_CLIENT_ID: 'cid' }));
    expect(sets.some((s) => s.name === 'oauth_return_to')).toBe(false);
    expect(deletes).toContainEqual({ name: 'oauth_return_to', options: { path: '/api/auth/google' } });
  });

  it('keeps the return path on the not-configured error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { jar } = fakeJar();
    const res = await startGoogle(context(`https://ratemyplace.org/api/auth/google?redirect=${RETURN_ENC}`, jar, {}));
    expect(res.headers.get('Location')).toBe(`/auth/signin?error=oauth_not_configured&redirect=${RETURN_ENC}`);
  });
});

describe('GET /api/auth/google/callback returns there', () => {
  it('keeps the return path on a denied consent and deletes the cookie', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { jar, deletes } = fakeJar({ oauth_return_to: RETURN });
    const res = await googleCallback(context('https://ratemyplace.org/api/auth/google/callback?error=access_denied', jar, {}));
    expect(res.headers.get('Location')).toBe(`/auth/signin?error=oauth_denied&redirect=${RETURN_ENC}`);
    expect(deletes).toContainEqual({ name: 'oauth_return_to', options: { path: '/api/auth/google' } });
  });

  it('keeps the return path on a state mismatch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { jar } = fakeJar({ oauth_return_to: RETURN, oauth_state: 'expected' });
    const res = await googleCallback(context('https://ratemyplace.org/api/auth/google/callback?code=c&state=other', jar, {}));
    expect(res.headers.get('Location')).toBe(`/auth/signin?error=invalid_state&redirect=${RETURN_ENC}`);
  });

  it.each([['//evil.example'], ['/.//evil.example']])('drops a hostile cookie %j', async (value) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { jar } = fakeJar({ oauth_return_to: value });
    const res = await googleCallback(context('https://ratemyplace.org/api/auth/google/callback?error=access_denied', jar, {}));
    expect(res.headers.get('Location')).toBe('/auth/signin?error=oauth_denied');
  });

  const suite = sqliteAvailable ? it : it.skip;
  suite('on success, lands on the remembered path', async () => {
    const db = new TestD1Database(createMemoryDatabase());
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, email_verified INTEGER DEFAULT 0,
        google_id TEXT, name TEXT, avatar_url TEXT, hashed_password TEXT, is_admin INTEGER DEFAULT 0
      );
      CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', id_token: 'it', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ sub: 'g-1', email: 'g@example.com', email_verified: true }), { status: 200 });
    }));
    const { jar } = fakeJar({ oauth_return_to: RETURN, oauth_state: 's1' });
    const res = await googleCallback(context(
      'https://ratemyplace.org/api/auth/google/callback?code=c&state=s1',
      jar,
      { DB: db, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret' },
    ));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(RETURN);
  });
});
