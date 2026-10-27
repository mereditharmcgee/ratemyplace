import { describe, expect, it } from 'vitest';
import type { AstroCookies } from 'astro';
import {
  OAUTH_RETURN_COOKIE,
  OAUTH_RETURN_COOKIE_PATH,
  redirectQuery,
  rememberOAuthReturn,
  safeRedirectPath,
  signinErrorPath,
  takeOAuthReturn,
} from '../authRedirect';

// The one validator for every sign-in return path. Anything it lets through is handed to a
// redirect, so the property that matters is: whatever it returns is a same-origin path that
// starts with exactly one slash, and parses back to itself.

const BS = String.fromCharCode(92); // a literal backslash, spelled out so no escape hides it

const ACCEPTED: Array<[string, string]> = [
  ['/review/new', '/review/new'],
  ['/review/new?placeId=ChIJNx18GtF744kR6W7CM_iVm58', '/review/new?placeId=ChIJNx18GtF744kR6W7CM_iVm58'],
  ['/review/new?building=seed-1202188000', '/review/new?building=seed-1202188000'],
  ['/review/edit/abc123', '/review/edit/abc123'],
  ['/profile', '/profile'],
  ['/search?q=86%20Crawford', '/search?q=86%20Crawford'],
  ['/building/86-88-crawford-street-boston#reviews', '/building/86-88-crawford-street-boston#reviews'],
  // A dot inside a segment is not a dot segment.
  ['/building/st.-james-ave-boston', '/building/st.-james-ave-boston'],
  ['/x/..y', '/x/..y'],
  // Dots and slashes in the query are not path segments.
  ['/search?q=a/../b', '/search?q=a/../b'],
  ['/search?q=//x', '/search?q=//x'],
  ['/', '/'],
  // Double-encoded slashes decode once to '%2F%2F', which is a same-origin 404, not a host.
  ['/%252F%252Fevil.example', '/%252F%252Fevil.example'],
];

const REJECTED: Array<string | null | undefined> = [
  // Empty or wrong type
  null,
  undefined,
  '',
  'review/new',
  // Protocol-relative and backslash
  '//evil.example',
  '///evil.example',
  `/${BS}evil.example`,
  `${BS}${BS}evil.example`,
  `/${BS}/evil.example`,
  // Schemes
  'https://evil.example',
  'http:evil.example',
  'javascript:alert(1)',
  'data:text/html,x',
  // Encoded slash or backslash
  '/%2F%2Fevil.example',
  '/%2fevil.example',
  '/%5Cevil.example',
  '/%5cevil.example',
  '%2F%2Fevil.example',
  '/x/%2F%2Fevil.example',
  // Whitespace and control characters
  '/\t/evil.example',
  '/\n/evil.example',
  '/%09/evil.example',
  '/ /evil.example',
  '/%20/evil.example',
  '/ /evil.example',
  '/ x',
  // Malformed encoding
  '/%E0%A4%A',
  // Dot segments: WHATWG dot-segment removal turns these into '//evil.example'
  '/.//evil.example',
  '/..//evil.example',
  '/a/..//evil.example',
  '/x/../..//evil.example',
  '/%2e//evil.example',
  '/%2e%2e//evil.example',
  '/%2e/%2e//evil.example',
  // More dot-segment forms
  '/%2E%2E//evil.example',
  '/.%2F/evil.example',
  '/review%2F..%2F..%2Fx',
  '/a/../review/new',
  '/./review/new',
  '/review/.',
  '/review/..',
  // Loop targets, checked on the decoded path
  '/auth/signin',
  '/auth/signin?redirect=%2Fprofile',
  '/auth',
  '/api/auth/google',
  '/API/x',
  '/%61uth/signin',
  '/%61pi/auth/signout',
  '/%41PI/x',
  '/auth%2Fsignin',
  // Too long
  '/' + 'a'.repeat(600),
];

const SITE = 'https://ratemyplace.org';

function expectSafe(out: string): void {
  expect(new URL(out, SITE).origin).toBe(SITE);
  expect(out[0]).toBe('/');
  expect(out[1]).not.toBe('/');
  expect(out[1]).not.toBe(BS);
  expect(safeRedirectPath(out)).toBe(out);
}

/** mulberry32: a tiny seeded PRNG, so the fuzz is the same 20,000 strings on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('safeRedirectPath', () => {
  it.each(ACCEPTED)('accepts %j as %j', (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each(REJECTED.map((value) => [value]))('rejects %j', (input) => {
    expect(safeRedirectPath(input)).toBe('/');
  });

  it('returns the code-constant fallback it is given', () => {
    expect(safeRedirectPath('//evil.example', '/profile')).toBe('/profile');
  });

  it('every output, accepted or rejected, is a same-origin single-slash fixed point', () => {
    const inputs = [...ACCEPTED.map(([input]) => input), ...REJECTED, '/%2561uth/signin'];
    for (const input of inputs) expectSafe(safeRedirectPath(input));
  });

  it('holds the same property over 20,000 seeded hostile strings', () => {
    const tokens = ['/', BS, '.', '..', '%2e', '%2E', '%2e%2e', '%2f', '%2F', '%5c', 'a', 'evil.example', '%25', ':', '?', '#', '@', '\t', ' ', 'http', '%00'];
    const random = mulberry32(20261026);
    for (let i = 0; i < 20_000; i += 1) {
      let candidate = random() < 0.9 ? '/' : '';
      const count = 1 + Math.floor(random() * 8);
      for (let j = 0; j < count; j += 1) candidate += tokens[Math.floor(random() * tokens.length)];
      const out = safeRedirectPath(candidate);
      try {
        expectSafe(out);
      } catch (error) {
        throw new Error(`fuzz input ${JSON.stringify(candidate)} gave ${JSON.stringify(out)}: ${String(error)}`);
      }
    }
  });
});

describe('redirectQuery and signinErrorPath', () => {
  it('adds nothing for the home page and encodes everything else', () => {
    expect(redirectQuery('/')).toBe('');
    expect(redirectQuery('/review/new?placeId=abc')).toBe('?redirect=%2Freview%2Fnew%3FplaceId%3Dabc');
  });

  it('keeps the return path on a sign-in error redirect', () => {
    expect(signinErrorPath('oauth_denied', '/')).toBe('/auth/signin?error=oauth_denied');
    expect(signinErrorPath('oauth_denied', '/review/new')).toBe('/auth/signin?error=oauth_denied&redirect=%2Freview%2Fnew');
  });
});

interface SetCall { name: string; value: string; options: Record<string, unknown> }
interface DeleteCall { name: string; options: Record<string, unknown> }

/** A Map-backed cookie jar that records every set and delete with its options. */
function fakeJar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const sets: SetCall[] = [];
  const deletes: DeleteCall[] = [];
  const jar = {
    get: (name: string) => (values.has(name) ? { value: values.get(name) as string } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      values.set(name, value);
      sets.push({ name, value, options });
    },
    delete: (name: string, options: Record<string, unknown> = {}) => {
      values.delete(name);
      deletes.push({ name, options });
    },
  };
  return { jar: jar as unknown as Pick<AstroCookies, 'get' | 'set' | 'delete'>, values, sets, deletes };
}

describe('OAuth return cookie', () => {
  it('names the cookie and scopes it to the Google routes', () => {
    expect(OAUTH_RETURN_COOKIE).toBe('oauth_return_to');
    expect(OAUTH_RETURN_COOKIE_PATH).toBe('/api/auth/google');
  });

  it('remembers a safe path with exactly the agreed attributes', () => {
    const { jar, sets, deletes } = fakeJar();
    rememberOAuthReturn(jar, '/review/new?placeId=abc', true);
    expect(deletes).toEqual([]);
    expect(sets).toEqual([
      {
        name: 'oauth_return_to',
        value: '/review/new?placeId=abc',
        options: { path: '/api/auth/google', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 600 },
      },
    ]);
  });

  it.each([['/.//evil.example'], ['//evil.example'], ['/'], [null]])(
    'deletes instead of setting for %j',
    (raw) => {
      const { jar, sets, deletes } = fakeJar({ oauth_return_to: '/stale' });
      rememberOAuthReturn(jar, raw, true);
      expect(sets).toEqual([]);
      expect(deletes).toEqual([{ name: 'oauth_return_to', options: { path: '/api/auth/google' } }]);
    },
  );

  it('takes the path back and deletes it on the same path', () => {
    const { jar, deletes, values } = fakeJar({ oauth_return_to: '/review/new?placeId=abc' });
    expect(takeOAuthReturn(jar)).toBe('/review/new?placeId=abc');
    expect(deletes).toEqual([{ name: 'oauth_return_to', options: { path: '/api/auth/google' } }]);
    expect(values.has('oauth_return_to')).toBe(false);
  });

  it.each([['//evil.example'], ['/.//evil.example']])('re-validates a hostile cookie %j to /', (value) => {
    const { jar } = fakeJar({ oauth_return_to: value });
    expect(takeOAuthReturn(jar)).toBe('/');
  });

  it('answers / for an empty jar', () => {
    const { jar } = fakeJar();
    expect(takeOAuthReturn(jar)).toBe('/');
  });
});
