import { describe, it, expect, vi } from 'vitest';
import { getClientIP, checkRateLimit, buildRateLimitHeaders } from '../rateLimit';
import type { RateLimitResult } from '../rateLimit';

// ═══════════════════════════════════════════════════
// getClientIP
// ═══════════════════════════════════════════════════

function mockContext(headers: Record<string, string | null>) {
  return {
    request: {
      headers: {
        get: (name: string) => headers[name] ?? null,
      },
    },
  };
}

describe('getClientIP', () => {
  it('extracts IP from CF-Connecting-IP header', () => {
    const ctx = mockContext({ 'cf-connecting-ip': '1.2.3.4' });
    expect(getClientIP(ctx)).toBe('1.2.3.4');
  });

  it('falls back to X-Forwarded-For header', () => {
    const ctx = mockContext({ 'x-forwarded-for': '5.6.7.8, 9.10.11.12' });
    expect(getClientIP(ctx)).toBe('5.6.7.8');
  });

  it('takes first IP from X-Forwarded-For chain', () => {
    const ctx = mockContext({ 'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2' });
    expect(getClientIP(ctx)).toBe('10.0.0.1');
  });

  it('falls back to X-Real-IP header', () => {
    const ctx = mockContext({ 'x-real-ip': '192.168.1.1' });
    expect(getClientIP(ctx)).toBe('192.168.1.1');
  });

  it('returns "unknown" when no headers present', () => {
    const ctx = mockContext({});
    expect(getClientIP(ctx)).toBe('unknown');
  });

  it('prefers CF-Connecting-IP over X-Forwarded-For', () => {
    const ctx = mockContext({
      'cf-connecting-ip': '1.1.1.1',
      'x-forwarded-for': '2.2.2.2',
    });
    expect(getClientIP(ctx)).toBe('1.1.1.1');
  });

  it('prefers X-Forwarded-For over X-Real-IP', () => {
    const ctx = mockContext({
      'x-forwarded-for': '3.3.3.3',
      'x-real-ip': '4.4.4.4',
    });
    expect(getClientIP(ctx)).toBe('3.3.3.3');
  });
});

// ═══════════════════════════════════════════════════
// checkRateLimit (with mocked D1)
// ═══════════════════════════════════════════════════

function mockDB(attemptCount: number = 0, shouldError: boolean = false) {
  const runFn = vi.fn().mockResolvedValue({});
  const firstFn = vi.fn().mockResolvedValue({
    attempt_count: attemptCount,
    first_attempt: Math.floor(Date.now() / 1000) - 60,
  });

  if (shouldError) {
    return {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockRejectedValue(new Error('DB error')),
          first: vi.fn().mockRejectedValue(new Error('DB error')),
        }),
      }),
    };
  }

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: runFn,
        first: firstFn,
      }),
    }),
  };
}

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const db = mockDB(2); // 2 attempts, limit is 5
    const result = await checkRateLimit(db, '1.2.3.4', 'signin', 5, 900);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // 5 - 2 - 1 = 2
    expect(result.retryAfterSeconds).toBe(0);
  });

  it('blocks requests at the limit', async () => {
    const db = mockDB(5); // 5 attempts, limit is 5
    const result = await checkRateLimit(db, '1.2.3.4', 'signin', 5, 900);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('blocks requests over the limit', async () => {
    const db = mockDB(10); // 10 attempts, limit is 5
    const result = await checkRateLimit(db, '1.2.3.4', 'signin', 5, 900);
    expect(result.allowed).toBe(false);
  });

  it('gracefully handles database errors by failing closed', async () => {
    const db = mockDB(0, true);
    const result = await checkRateLimit(db, '1.2.3.4', 'signin', 5, 900);
    // Should BLOCK the request when DB fails (fail-closed)
    expect(result.allowed).toBe(false);
    expect(result.error).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBe(60);
  });

  it('returns correct remaining count', async () => {
    const db = mockDB(0); // 0 attempts, limit is 3
    const result = await checkRateLimit(db, '1.2.3.4', 'signup', 3, 3600);
    expect(result.remaining).toBe(2); // 3 - 0 - 1 = 2
  });
});

// ═══════════════════════════════════════════════════
// buildRateLimitHeaders
// ═══════════════════════════════════════════════════

describe('buildRateLimitHeaders', () => {
  const allowed: RateLimitResult = { allowed: true, remaining: 4, retryAfterSeconds: 0 };
  const blocked: RateLimitResult = { allowed: false, remaining: 0, retryAfterSeconds: 1800 };
  const failed: RateLimitResult = { allowed: false, remaining: 0, retryAfterSeconds: 60, error: true };

  it('returns X-RateLimit-Limit and X-RateLimit-Remaining but no Retry-After when allowed', () => {
    const headers = buildRateLimitHeaders(allowed, 5);
    expect(headers['X-RateLimit-Limit']).toBe('5');
    expect(headers['X-RateLimit-Remaining']).toBe('4');
    expect('Retry-After' in headers).toBe(false);
  });

  it('returns all three headers including Retry-After when blocked (429-shape)', () => {
    const headers = buildRateLimitHeaders(blocked, 3);
    expect(headers['X-RateLimit-Limit']).toBe('3');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['Retry-After']).toBe('1800');
  });

  it('returns all three headers when error===true (fail-closed 503-shape)', () => {
    const headers = buildRateLimitHeaders(failed, 3);
    expect(headers['X-RateLimit-Limit']).toBe('3');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['Retry-After']).toBe('60');
  });

  it('all header values are strings (safe to spread into Record<string, string>)', () => {
    const headers = buildRateLimitHeaders(allowed, 5);
    for (const val of Object.values(headers)) {
      expect(typeof val).toBe('string');
    }
    const headersBlocked = buildRateLimitHeaders(blocked, 3);
    for (const val of Object.values(headersBlocked)) {
      expect(typeof val).toBe('string');
    }
  });

  it('reflects the limit argument verbatim as a string (60→"60", 120→"120")', () => {
    const h60 = buildRateLimitHeaders(allowed, 60);
    expect(h60['X-RateLimit-Limit']).toBe('60');
    const h120 = buildRateLimitHeaders(allowed, 120);
    expect(h120['X-RateLimit-Limit']).toBe('120');
  });
});
