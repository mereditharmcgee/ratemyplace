import { describe, expect, it, vi } from 'vitest';
import {
  parseSmokeArgs,
  runSmoke,
  validateSmokeTarget,
  type SmokeDependencies,
} from '../smoke';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';
const HTML = '<!doctype html><html><head></head><body>OK</body></html>';

function response(body: string, init: ResponseInit): Response {
  return new Response(body, init);
}

function requestUrl(input: URL | RequestInfo): URL {
  return new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
}

function successResponses(release = RELEASE): SmokeDependencies['fetch'] {
  return vi.fn(async (input: URL | RequestInfo) => {
    const path = requestUrl(input).pathname;
    if (path === '/api/health') {
      return response(JSON.stringify({ status: 'ok', release }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/profile' || path === '/review/new' || path === '/admin') {
      return response('', { status: 302, headers: { location: '/auth/signin?next=%2Fprofile' } });
    }
    if (path === '/api/buildings') {
      return response(JSON.stringify({ buildings: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path.startsWith('/api/')) {
      return response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return response(HTML, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'",
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
    });
  }) as unknown as SmokeDependencies['fetch'];
}

function dependencies(fetch: SmokeDependencies['fetch'], now = () => 0): SmokeDependencies {
  return { fetch, now, sleep: vi.fn(async () => undefined) };
}

describe('smoke target authority', () => {
  it('has no implicit target', () => {
    expect(() => parseSmokeArgs([])).toThrow('Missing --environment');
  });

  it('accepts only the canonical production origin', () => {
    expect(validateSmokeTarget('production', 'https://ratemyplace.org').origin)
      .toBe('https://ratemyplace.org');
    expect(() => validateSmokeTarget('production', 'https://example.com')).toThrow();
    expect(() => validateSmokeTarget('production', 'https://ratemyplace.org/search')).toThrow();
    expect(() => validateSmokeTarget('production', 'https://ratemyplace.org:443')).toThrow();
  });

  it('restricts preview to this Pages project', () => {
    expect(validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev').hostname)
      .toBe('1a2b3c4d.ratemyplace-64y.pages.dev');
    expect(() => validateSmokeTarget('preview', 'https://ratemyplace-64y.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://codex-phase-22a.ratemyplace-64y.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://attacker.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev:8443')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev:443')).toThrow();
  });

  it('requires a full SHA outside local mode', () => {
    expect(() => parseSmokeArgs([
      '--environment', 'production',
      '--base-url', 'https://ratemyplace.org',
    ])).toThrow('Missing --expected-release');
  });

  it('allows an explicit local development port', () => {
    expect(validateSmokeTarget('local', 'http://127.0.0.1:8788').origin)
      .toBe('http://127.0.0.1:8788');
  });

  it('rejects duplicate, unknown, and unsafe CLI arguments', () => {
    expect(() => parseSmokeArgs(['--environment', 'local', '--environment', 'local', '--base-url', 'http://localhost:8788']))
      .toThrow('Duplicate --environment');
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788', '--wrong']))
      .toThrow('Unknown argument');
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://user:pass@localhost:8788']))
      .toThrow();
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788/?q=x']))
      .toThrow();
  });

  it('bounds wait and request timeout configuration', () => {
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788', '--wait-for-release-ms', '600001']))
      .toThrow();
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788', '--request-timeout-ms', '30001']))
      .toThrow();
  });
});

describe('smoke probes', () => {
  const config = parseSmokeArgs([
    '--environment', 'local', '--base-url', 'http://127.0.0.1:8788', '--expected-release', RELEASE,
  ]);

  it('allows only same-origin sign-in redirects for protected paths', async () => {
    const fetch = successResponses();
    const results = await runSmoke(config, dependencies(fetch));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ cache: 'no-store', redirect: 'manual' }));
  });

  it('fails protected redirects to the home page or another origin', async () => {
    for (const location of ['/', 'https://attacker.example/auth/signin']) {
      const fetch = successResponses();
      const standard = successResponses();
      vi.mocked(fetch).mockImplementation(async (input: URL | RequestInfo) => {
        if (requestUrl(input).pathname === '/profile') return response('', { status: 302, headers: { location } });
        return standard(input);
      });
      const results = await runSmoke(config, dependencies(fetch));
      expect(results.find((result) => result.path === '/profile')?.ok).toBe(false);
    }
  });

  it('fails redirects from ordinary, API, and health probes', async () => {
    for (const path of ['/', '/api/buildings', '/api/health']) {
      const fetch = successResponses();
      const standard = successResponses();
      vi.mocked(fetch).mockImplementation((input: URL | RequestInfo) => {
        const requestedPath = requestUrl(input).pathname;
        if (requestedPath === path) return Promise.resolve(response('', { status: 302, headers: { location: '/auth/signin' } }));
        return standard(input);
      });
      const results = await runSmoke(config, dependencies(fetch));
      const failedProbe = path === '/'
        ? results.find((result) => result.path === '/')
        : results.find((result) => result.path.startsWith(path));
      expect(failedProbe?.ok).toBe(false);
    }
  });

  it('fails a release mismatch after the configured wait budget', async () => {
    let clock = 0;
    const fetch = successResponses('f'.repeat(40));
    const deps = dependencies(fetch, () => clock);
    deps.sleep = vi.fn(async (milliseconds: number) => { clock += milliseconds; });
    const results = await runSmoke({ ...config, waitForReleaseMs: 20_000 }, deps);
    const release = results.find((result) => result.path === '/api/health');
    expect(release).toMatchObject({ ok: false, detail: expect.stringContaining(RELEASE) });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['500 response', '/api/health', () => response('', { status: 500 })],
    ['missing home security header', '/', () => response(HTML, { status: 200, headers: { 'content-type': 'text/html' } })],
    ['non-JSON API response', '/api/buildings', () => response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['HTML error sentinel', '/', () => response(`<html>Internal Server Error</html>`, {
      status: 200,
      headers: {
        'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
        'content-security-policy': 'x', 'referrer-policy': 'x',
      },
    })],
  ])('fails a %s', async (_label, path, badResponse) => {
    const fetch = successResponses();
    const standard = successResponses();
    vi.mocked(fetch).mockImplementation((input: URL | RequestInfo) => {
      if (requestUrl(input).pathname === path) return Promise.resolve(badResponse());
      return standard(input);
    });
    const results = await runSmoke(config, dependencies(fetch));
    const failedProbe = path === '/'
      ? results.find((item) => item.path === '/')
      : results.find((item) => item.path.startsWith(path));
    expect(failedProbe?.ok).toBe(false);
  });

  it('aborts a hanging request at the configured timeout', async () => {
    const fetch = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    })) as unknown as SmokeDependencies['fetch'];
    vi.useFakeTimers();
    const running = runSmoke({ ...config, requestTimeoutMs: 1_000 }, dependencies(fetch));
    await vi.advanceTimersByTimeAsync(1_000);
    const results = await running;
    vi.useRealTimers();
    expect(results[0]).toMatchObject({ path: '/api/health', ok: false });
  });
});
