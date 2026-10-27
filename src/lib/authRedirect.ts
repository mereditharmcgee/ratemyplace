// Sign-in return paths: the one validator for `?redirect=` on /auth/signin and /auth/signup,
// and for the `oauth_return_to` cookie the Google flow carries across the round trip.
//
// LEAF MODULE: no runtime imports. The sign-in and sign-up page scripts import this file, so
// anything it imported would ship to every visitor (`clientLeafModules.test.ts` enforces it).
import type { AstroCookies } from 'astro'; // type-only: erased at build time

export const OAUTH_RETURN_COOKIE = 'oauth_return_to';
/** Sent only to /api/auth/google and its callback, never to the rest of the site. */
export const OAUTH_RETURN_COOKIE_PATH = '/api/auth/google';
const OAUTH_RETURN_MAX_AGE = 600; // the same ten minutes as `oauth_state`

const SENTINEL = 'https://return.invalid';
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\s\\]/;
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;
const LOOP_TARGET = /^\/(?:auth|api)(?:\/|$)/i;
const hasSafeShape = (p: string): boolean => p[0] === '/' && p[1] !== '/' && p[1] !== '\\';

/**
 * A same-origin relative path that is safe to hand to a redirect, or `fallback`.
 *
 * Accepts only a path that starts with exactly one slash and has no dot segments, no `//`
 * or backslash (raw or decoded), no whitespace or control characters and no `%5c`. The
 * result must parse back to itself on the same origin, and never points at `/auth*` or
 * `/api*` (checked on the decoded path, so `/%61uth/signin` is caught too).
 *
 * `fallback` is always a code constant, never request input.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (UNSAFE_CHARS.test(raw) || !hasSafeShape(raw) || /%5c/i.test(raw)) return fallback;
  const rawPath = raw.split(/[?#]/, 1)[0];
  // Dot segments are never legitimate in a return path, and WHATWG dot-segment removal is
  // what turns '/.//evil.example' into the protocol-relative '//evil.example'.
  if (DOT_SEGMENT.test(rawPath)) return fallback;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return fallback;
  }
  if (
    !hasSafeShape(decodedPath) ||
    UNSAFE_CHARS.test(decodedPath) ||
    decodedPath.includes('//') ||
    DOT_SEGMENT.test(decodedPath)
  ) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(raw, SENTINEL);
  } catch {
    return fallback;
  }
  if (url.origin !== SENTINEL) return fallback;
  const out = url.pathname + url.search + url.hash;
  // Fixed point: the value we hand to a redirect must parse back to itself, same origin, and
  // still start with exactly one slash. Belt and braces over the checks above.
  if (!hasSafeShape(out)) return fallback;
  const again = new URL(out, SENTINEL);
  if (again.origin !== SENTINEL || again.pathname + again.search + again.hash !== out) return fallback;
  if (LOOP_TARGET.test(decodedPath)) return fallback; // decoded, so '/%61uth/signin' is caught
  return out;
}

/** `''` for the home page, so bare links stay bare; otherwise `?redirect=<encoded path>`. */
export function redirectQuery(path: string): string {
  return path === '/' ? '' : '?redirect=' + encodeURIComponent(path);
}

/** A sign-in error redirect that keeps the return path when there is one. */
export function signinErrorPath(code: string, returnTo: string): string {
  const base = '/auth/signin?error=' + encodeURIComponent(code);
  return returnTo === '/' ? base : base + '&redirect=' + encodeURIComponent(returnTo);
}

type CookieJar = Pick<AstroCookies, 'get' | 'set' | 'delete'>;

/**
 * Store the validated return path for the Google round trip. A missing, unsafe or home-page
 * path deletes the cookie instead, so a stale one from an abandoned attempt cannot steer
 * this sign-in somewhere else.
 */
export function rememberOAuthReturn(cookies: CookieJar, raw: string | null, secure: boolean): void {
  const path = safeRedirectPath(raw);
  if (path === '/') {
    cookies.delete(OAUTH_RETURN_COOKIE, { path: OAUTH_RETURN_COOKIE_PATH });
    return;
  }
  cookies.set(OAUTH_RETURN_COOKIE, path, {
    path: OAUTH_RETURN_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: OAUTH_RETURN_MAX_AGE,
  });
}

/** Read the return path once, delete it, and re-validate it. Defaults to '/'. */
export function takeOAuthReturn(cookies: CookieJar): string {
  const raw = cookies.get(OAUTH_RETURN_COOKIE)?.value ?? null;
  cookies.delete(OAUTH_RETURN_COOKIE, { path: OAUTH_RETURN_COOKIE_PATH });
  return safeRedirectPath(raw);
}
