import { createHash, createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_KEY_PREFIX, checkRateLimit, rateLimitKey, rateLimitSecret } from '../rateLimit';
import { createRecordsTestDb } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// The rate_limits table never holds a raw identifier. A client IP, a user id or a building id
// is stored only as a keyed digest, `${endpoint}:${hex}`, so the table cannot be read back
// into "who asked for what". These tests pin the digest against an independent node:crypto
// computation, prove the raw value never reaches a bound parameter, and prove the limits
// still trip on a real SQLite table.

const IP = '203.0.113.77';
const SECRET = 'test-rate-limit-secret';

function expectedKey(identifier: string, endpoint: string, secret?: string): string {
  const message = `${RATE_LIMIT_KEY_PREFIX}${endpoint}:${identifier}`;
  const digest = secret
    ? createHmac('sha256', secret).update(message).digest('hex')
    : createHash('sha256').update(message).digest('hex');
  return `${endpoint}:${digest.slice(0, 32)}`;
}

/** A D1 double that answers every statement and records every value bound to it. */
function recordingDb(attemptCount = 0) {
  const bound: unknown[][] = [];
  const db = {
    prepare(_sql: string) {
      return {
        bind(...values: unknown[]) {
          bound.push(values);
          return {
            run: async () => ({}),
            first: async () => ({ attempt_count: attemptCount, first_attempt: Math.floor(Date.now() / 1000) - 60 }),
          };
        },
      };
    },
  };
  return { db, bound };
}

describe('rateLimitKey', () => {
  it('is the endpoint plus 32 hex characters of an unkeyed SHA-256 when there is no secret', async () => {
    const key = await rateLimitKey(IP, 'signin', undefined);
    expect(key).toMatch(/^signin:[0-9a-f]{32}$/);
    expect(key).toBe(expectedKey(IP, 'signin'));
  });

  it('is an HMAC-SHA256 of the same message when a secret is set', async () => {
    const key = await rateLimitKey(IP, 'signin', SECRET);
    expect(key).toMatch(/^signin:[0-9a-f]{32}$/);
    expect(key).toBe(expectedKey(IP, 'signin', SECRET));
  });

  it('is deterministic on both paths, so the same caller keeps hitting the same limit', async () => {
    expect(await rateLimitKey(IP, 'signin', undefined)).toBe(await rateLimitKey(IP, 'signin', undefined));
    expect(await rateLimitKey(IP, 'signin', SECRET)).toBe(await rateLimitKey(IP, 'signin', SECRET));
  });

  it('separates endpoints, identifiers and secrets', async () => {
    const base = await rateLimitKey(IP, 'signin', SECRET);
    expect(await rateLimitKey(IP, 'signup', SECRET)).not.toBe(base);
    expect(await rateLimitKey('203.0.113.78', 'signin', SECRET)).not.toBe(base);
    expect(await rateLimitKey(IP, 'signin', 'another-secret')).not.toBe(base);
    expect(await rateLimitKey(IP, 'signin', undefined)).not.toBe(base);
  });

  it.each([IP, '2001:db8::1', 'user-abc123', 'building:bldg-42', 'unknown'])(
    'never contains the identifier %s',
    async (identifier) => {
      for (const secret of [undefined, SECRET]) {
        const key = await rateLimitKey(identifier, 'records_pull', secret);
        expect(key).not.toContain(identifier);
      }
    },
  );
});

describe('rateLimitSecret', () => {
  it('prefers RATE_LIMIT_KEY', () => {
    expect(rateLimitSecret({ RATE_LIMIT_KEY: 'own', TURNSTILE_SECRET_KEY: 'turnstile' })).toBe('own');
  });

  it('falls back to TURNSTILE_SECRET_KEY', () => {
    expect(rateLimitSecret({ TURNSTILE_SECRET_KEY: 'turnstile' })).toBe('turnstile');
    expect(rateLimitSecret({ RATE_LIMIT_KEY: '', TURNSTILE_SECRET_KEY: 'turnstile' })).toBe('turnstile');
    expect(rateLimitSecret({ RATE_LIMIT_KEY: '   ', TURNSTILE_SECRET_KEY: 'turnstile' })).toBe('turnstile');
  });

  it('is undefined when neither is set, so the key falls back to an unkeyed digest', () => {
    expect(rateLimitSecret({})).toBeUndefined();
    expect(rateLimitSecret({ TURNSTILE_SECRET_KEY: '' })).toBeUndefined();
    expect(rateLimitSecret(undefined)).toBeUndefined();
  });
});

describe('checkRateLimit never binds the raw identifier', () => {
  it.each([
    ['a client IP', IP],
    ['a user id', 'user-abc123'],
    ['a building id', 'building:bldg-42'],
  ])('%s, unkeyed and keyed', async (_label, identifier) => {
    for (const secret of [undefined, SECRET]) {
      const { db, bound } = recordingDb();
      const result = await checkRateLimit(db, identifier, 'signin', 5, 900, secret);
      expect(result.allowed).toBe(true);

      const values = bound.flat();
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(String(value)).not.toContain(identifier);
      }
      expect(values).toContain(expectedKey(identifier, 'signin', secret));
    }
  });

  it('still refuses at the limit with the hashed key', async () => {
    const { db, bound } = recordingDb(5);
    const result = await checkRateLimit(db, IP, 'signin', 5, 900, SECRET);
    expect(result.allowed).toBe(false);
    for (const value of bound.flat()) expect(String(value)).not.toContain(IP);
  });
});

describe.skipIf(!sqliteAvailable)('checkRateLimit against a real rate_limits table', () => {
  async function storedKeys(db: TestD1Database): Promise<string[]> {
    const { results } = await db.prepare('SELECT rate_key FROM rate_limits ORDER BY id').all<{ rate_key: string }>();
    return results.map((row) => row.rate_key);
  }

  it('trips on the sixth attempt and stores only the digest', async () => {
    const db = createRecordsTestDb();
    for (let i = 0; i < 5; i += 1) {
      expect((await checkRateLimit(db, IP, 'signin', 5, 900, SECRET)).allowed).toBe(true);
    }
    const sixth = await checkRateLimit(db, IP, 'signin', 5, 900, SECRET);
    expect(sixth.allowed).toBe(false);
    expect(sixth.error).toBeUndefined();

    const keys = await storedKeys(db);
    expect(keys).toHaveLength(5);
    expect(new Set(keys)).toEqual(new Set([expectedKey(IP, 'signin', SECRET)]));
    for (const key of keys) expect(key).not.toContain(IP);
  });

  it('trips on the unkeyed path too', async () => {
    const db = createRecordsTestDb();
    for (let i = 0; i < 3; i += 1) {
      expect((await checkRateLimit(db, 'user-abc123', 'building-save', 3, 3600, undefined)).allowed).toBe(true);
    }
    expect((await checkRateLimit(db, 'user-abc123', 'building-save', 3, 3600, undefined)).allowed).toBe(false);
    for (const key of await storedKeys(db)) expect(key).not.toContain('user-abc123');
  });

  it('keeps endpoints and callers apart', async () => {
    const db = createRecordsTestDb();
    expect((await checkRateLimit(db, IP, 'dispute', 1, 3600, SECRET)).allowed).toBe(true);
    expect((await checkRateLimit(db, IP, 'dispute', 1, 3600, SECRET)).allowed).toBe(false);
    // Same caller, other endpoint: its own budget.
    expect((await checkRateLimit(db, IP, 'contact', 1, 3600, SECRET)).allowed).toBe(true);
    // Other caller, same endpoint: its own budget.
    expect((await checkRateLimit(db, '203.0.113.78', 'dispute', 1, 3600, SECRET)).allowed).toBe(true);
  });
});

// Source contract: every caller passes the key material, and nothing logs a raw client IP.
// `adminIp` on audit entries is the one documented place an IP is kept, so it is not matched.

const ROOT = process.cwd();

function walk(dir: string, accept: (path: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...walk(path, accept));
    } else if (accept(path)) {
      found.push(path);
    }
  }
  return found;
}

const sources = new Map(
  [
    ...walk(join(ROOT, 'src', 'pages'), (path) => path.endsWith('.ts') || path.endsWith('.astro')),
    ...walk(join(ROOT, 'src', 'lib'), (path) => path.endsWith('.ts')),
  ].map((path) => [relative(ROOT, path).split(sep).join('/'), readFileSync(path, 'utf8')]),
);

describe('rate limit callers', () => {
  it('every checkRateLimit call passes the rate limit secret', () => {
    const calls: Array<{ file: string; call: string }> = [];
    for (const [file, source] of sources) {
      if (file === 'src/lib/rateLimit.ts') continue;
      for (const match of source.matchAll(/checkRateLimit\(/g)) {
        // The call text up to its matching close paren.
        let depth = 0;
        let end = match.index + 'checkRateLimit'.length;
        for (; end < source.length; end += 1) {
          if (source[end] === '(') depth += 1;
          if (source[end] === ')') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        calls.push({ file, call: source.slice(match.index, end + 1) });
      }
    }
    expect(calls.length).toBeGreaterThan(20);
    const missing = calls.filter(({ call }) => !/rateLimitSecret\(|rateLimitSecret\b/.test(call));
    expect(missing).toEqual([]);
  });

  it('no route or module logs the raw client IP', () => {
    const offenders: string[] = [];
    for (const [file, source] of sources) {
      if (/\bip:\s*(clientIP|ip|getClientIP)\b/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

// The public privacy page describes what the limiter keeps. It kept the raw IP once, and the
// page said so; it must not go on saying so now that only a one-way code is kept.
describe('the privacy page on the rate limiter', () => {
  const privacy = readFileSync(join(ROOT, 'src', 'pages', 'privacy.astro'), 'utf8');

  it('says the limiter keeps a one-way code, not the IP address', () => {
    expect(privacy).not.toContain('keeps your IP address');
    expect(privacy.match(/keeps only a scrambled form of your IP address, which expires within an hour/g)).toHaveLength(2);
  });

  it('never says no IPs are stored, since the audit log keeps admin IPs', () => {
    expect(privacy).not.toMatch(/no IP(s| address(es)?) (are|is) (stored|kept)/i);
  });
});
