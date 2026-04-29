/**
 * Simple rate limiting using D1 database
 * Tracks request counts per IP per endpoint within a time window
 */

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
 * @param identifier - Unique identifier (typically IP address)
 * @param endpoint - The endpoint being rate limited (e.g., 'signin', 'signup')
 * @param maxAttempts - Maximum number of attempts allowed in the window
 * @param windowSeconds - Time window in seconds
 */
export async function checkRateLimit(
  db: any,
  identifier: string,
  endpoint: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;
  const key = `${endpoint}:${identifier}`;

  try {
    // Clean up old entries and count recent attempts in one go
    await db.prepare(
      'DELETE FROM rate_limits WHERE expires_at < ?'
    ).bind(now).run();

    const result = await db.prepare(
      'SELECT COUNT(*) as attempt_count, MIN(created_at) as first_attempt FROM rate_limits WHERE rate_key = ? AND created_at > ?'
    ).bind(key, windowStart).first<{ attempt_count: number; first_attempt: number | null }>();

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
    // This prevents bypassing rate limits via DB attacks
    console.error('Rate limit check error:', error);
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
  // Cloudflare provides the client IP in CF-Connecting-IP header
  const cfIP = context.request.headers.get('cf-connecting-ip');
  if (cfIP) return cfIP;

  // Fallback to X-Forwarded-For
  const xff = context.request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();

  // Fallback to X-Real-IP
  const xri = context.request.headers.get('x-real-ip');
  if (xri) return xri;

  return 'unknown';
}
