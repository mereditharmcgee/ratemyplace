/**
 * Simple rate limiting using D1 database
 * Tracks request counts per caller per endpoint within a time window.
 *
 * No identifier is ever stored raw. A client IP, a user id or a building id reaches the
 * `rate_limits` table only as `${endpoint}:${digest}`, where the digest is an HMAC-SHA256 of
 * the identifier keyed by `RATE_LIMIT_KEY` (or `TURNSTILE_SECRET_KEY` when that is unset),
 * cut to 32 hex characters. With neither secret (unit tests, local dev) it is an unkeyed
 * SHA-256 of the same message, never the raw value.
 */
import { encodeHexLowerCase } from '@oslojs/encoding';

/**
 * Domain separation for the digest. Changing it re-keys every row, which is harmless: rows
 * expire within a window, so a change only resets the counters once.
 */
export const RATE_LIMIT_KEY_PREFIX = 'rate-limit:v1:';

/** 32 hex characters, 128 bits: no collision worth a thought at this table's size. */
const DIGEST_HEX_LENGTH = 32;

/** The env values the key material comes from. Both are server secrets on Pages. */
export interface RateLimitSecretEnv {
  RATE_LIMIT_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

/**
 * The key material for `checkRateLimit`: `RATE_LIMIT_KEY` when set, else
 * `TURNSTILE_SECRET_KEY`, else undefined (an unkeyed digest). Blank values count as unset.
 */
export function rateLimitSecret(env: RateLimitSecretEnv | undefined): string | undefined {
  const own = env?.RATE_LIMIT_KEY?.trim();
  if (own) return own;
  const turnstile = env?.TURNSTILE_SECRET_KEY?.trim();
  return turnstile || undefined;
}

/**
 * The stored `rate_key`: the endpoint in clear, so the table can still be read by endpoint,
 * then a digest of the endpoint and identifier. The same inputs always give the same key.
 */
export async function rateLimitKey(identifier: string, endpoint: string, secret: string | undefined): Promise<string> {
  const encoder = new TextEncoder();
  const message = encoder.encode(`${RATE_LIMIT_KEY_PREFIX}${endpoint}:${identifier}`);
  let digest: ArrayBuffer;
  if (secret) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    digest = await crypto.subtle.sign('HMAC', key, message);
  } else {
    digest = await crypto.subtle.digest('SHA-256', message);
  }
  return `${endpoint}:${encodeHexLowerCase(new Uint8Array(digest)).slice(0, DIGEST_HEX_LENGTH)}`;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  error?: boolean;
}

/**
 * Check and enforce rate limits for an endpoint
 *
 * @param db - D1 database instance
 * @param identifier - Unique identifier (typically IP address). Never stored or logged raw.
 * @param endpoint - The endpoint being rate limited (e.g., 'signin', 'signup')
 * @param maxAttempts - Maximum number of attempts allowed in the window
 * @param windowSeconds - Time window in seconds
 * @param secret - Key material from `rateLimitSecret(getEnv(context))`. Required, so a new
 *   caller cannot forget it; undefined falls back to an unkeyed digest.
 */
export async function checkRateLimit(
  db: any,
  identifier: string,
  endpoint: string,
  maxAttempts: number,
  windowSeconds: number,
  secret: string | undefined
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  try {
    // Inside the try: a digest failure fails closed like a database failure.
    const key = await rateLimitKey(identifier, endpoint, secret);

    // Clean up old entries and count recent attempts in one go
    await db.prepare(
      'DELETE FROM rate_limits WHERE expires_at < ?'
    ).bind(now).run();

    // db is typed `any`, so `.first<T>()` type args aren't allowed; cast the result instead.
    const result = await db.prepare(
      'SELECT COUNT(*) as attempt_count, MIN(created_at) as first_attempt FROM rate_limits WHERE rate_key = ? AND created_at > ?'
    ).bind(key, windowStart).first() as { attempt_count: number; first_attempt: number | null } | null;

    const attemptCount = result?.attempt_count || 0;

    if (attemptCount >= maxAttempts) {
      // Rate limit exceeded
      const firstAttempt = result?.first_attempt || now;
      const retryAfter = Math.max(1, (firstAttempt + windowSeconds) - now);

      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: retryAfter,
      };
    }

    // Record this attempt
    await db.prepare(
      'INSERT INTO rate_limits (rate_key, created_at, expires_at) VALUES (?, ?, ?)'
    ).bind(key, now, now + windowSeconds).run();

    return {
      allowed: true,
      remaining: maxAttempts - attemptCount - 1,
      retryAfterSeconds: 0,
    };
  } catch (error) {
    // Fail-closed: block requests when rate limit check fails
    // This prevents bypassing rate limits via DB attacks. The log carries the endpoint and
    // the error only, never the identifier.
    console.error('Rate limit check error:', endpoint, error);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
      error: true,
    };
  }
}

/**
 * Build the standard rate-limit response headers.
 *
 * Spread the return value into a Response's headers object. Always emits
 * X-RateLimit-Limit and X-RateLimit-Remaining; emits Retry-After iff the
 * request was blocked (covers both 429-by-rate and 503-fail-closed paths).
 *
 * @param result - the RateLimitResult returned by checkRateLimit
 * @param limit - the maxAttempts argument passed to checkRateLimit (e.g., 3, 5, 60, 120)
 */
export function buildRateLimitHeaders(
  result: RateLimitResult,
  limit: number
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }
  return headers;
}

/**
 * Get the client's IP address from the request context
 */
export function getClientIP(context: any): string {
  // Cloudflare sets CF-Connecting-IP to the true client IP and overwrites any
  // client-supplied value, so it cannot be spoofed. Always prefer it.
  const cfIP = context.request.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;

  // In production we are always behind Cloudflare. A missing CF-Connecting-IP
  // means the request didn't traverse the edge, so we must NOT trust the
  // client-supplied X-Forwarded-For / X-Real-IP (both spoofable — an attacker
  // could rotate them to bypass rate limits). Bucket all such requests into one
  // key so they're throttled together rather than trivially evaded.
  if (import.meta.env.PROD) return 'unknown';

  // Dev / non-Cloudflare fallbacks — only reached locally, where spoofing is moot.
  const xff = context.request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();

  const xri = context.request.headers.get('x-real-ip');
  if (xri) return xri;

  return 'unknown';
}
