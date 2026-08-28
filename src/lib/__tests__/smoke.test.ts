import { describe, expect, it, vi } from 'vitest';
import {
  parseSmokeArgs,
  runSmoke,
  validateSmokeTarget,
  type SmokeDependencies,
  type SmokeOptions,
  type SmokeProbeResult,
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

function deferredBodyResponse(method: 'json' | 'text', headers: HeadersInit): {
  response: Response;
  resolve: (body: unknown) => void;
} {
  let resolve: (body: unknown) => void = () => undefined;
  const body = new Promise<unknown>((bodyResolve) => { resolve = bodyResolve; });
  const response = {
    status: 200,
    headers: new Headers(headers),
    json: () => method === 'json' ? body : Promise.resolve(undefined),
    text: () => method === 'text' ? body.then(String) : Promise.resolve(''),
  } as unknown as Response;
  return { response, resolve };
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
    expect(() => validateSmokeTarget('production', 'https://ratemyplace.org/.')).toThrow();
    expect(() => validateSmokeTarget('production', 'https://ratemyplace.org:443')).toThrow();
    expect(() => validateSmokeTarget('production', 'https://ratemyplace.org:')).toThrow();
  });

  it('rejects noncanonical raw target forms before URL normalization', () => {
    for (const target of [
      'https:ratemyplace.org',
      'https://ratemyplace.org?',
      'https://ratemyplace.org#',
      'https://ratemyplace.org/.',
    ]) expect(() => validateSmokeTarget('production', target)).toThrow();
  });

  it.each([
    ['production credential delimiter', 'production', 'https://@ratemyplace.org'],
    ['preview credential delimiter', 'preview', 'https://@1a2b3c4d.ratemyplace-64y.pages.dev'],
    ['local credential delimiter', 'local', 'http://@localhost:8788'],
    ['production backslash', 'production', 'https://ratemyplace.org\\'],
    ['preview backslash', 'preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev\\'],
    ['local backslash', 'local', 'http://localhost:8788\\'],
  ] as const)('rejects a raw %s before URL normalization', (_label, environment, target) => {
    expect(() => validateSmokeTarget(environment, target)).toThrow();
  });

  it.each([
    ['space', 'production', 'https://ratemyplace.org '],
    ['tab', 'preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev\t'],
    ['carriage return', 'local', 'http://127.0.0.1:8788\r'],
    ['newline', 'local', 'http://[::1]:8788\n'],
    ['delete control', 'production', 'https://ratemyplace.org\u007f'],
  ] as const)('rejects a raw ASCII %s before URL normalization', (_label, environment, target) => {
    expect(() => validateSmokeTarget(environment, target)).toThrow();
  });

  it('restricts preview to this Pages project', () => {
    expect(validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev').hostname)
      .toBe('1a2b3c4d.ratemyplace-64y.pages.dev');
    expect(() => validateSmokeTarget('preview', 'https://ratemyplace-64y.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://codex-phase-22a.ratemyplace-64y.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://attacker.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev:8443')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev:443')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev:')).toThrow();
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
    expect(() => validateSmokeTarget('local', 'http://127.0.0.1:')).toThrow();
  });

  it('accepts local localhost and IPv6 loopback origins', () => {
    expect(validateSmokeTarget('local', 'https://localhost:8788').hostname).toBe('localhost');
    expect(validateSmokeTarget('local', 'http://[::1]:8788').hostname).toBe('[::1]');
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

  it.each([
    ['--environment', ['--environment']],
    ['--base-url', ['--environment', 'local', '--base-url']],
    ['--expected-release', ['--environment', 'local', '--expected-release']],
    ['--wait-for-release-ms', ['--environment', 'local', '--wait-for-release-ms']],
    ['--request-timeout-ms', ['--environment', 'local', '--request-timeout-ms']],
  ])('rejects a missing value for %s', (flag, args) => {
    expect(() => parseSmokeArgs(args)).toThrow(`Missing value for ${flag}`);
  });

  it('rejects invalid release values', () => {
    expect(() => parseSmokeArgs(['--environment', 'preview', '--base-url', 'https://1a2b3c4d.ratemyplace-64y.pages.dev', '--expected-release', 'a'.repeat(39)]))
      .toThrow('--expected-release must be a 40-character hexadecimal SHA');
    expect(() => parseSmokeArgs(['--environment', 'production', '--base-url', 'https://ratemyplace.org', '--expected-release', 'z'.repeat(40)]))
      .toThrow('--expected-release must be a 40-character hexadecimal SHA');
  });

  it('bounds wait and request timeout configuration', () => {
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788', '--wait-for-release-ms', '600001']))
      .toThrow();
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788', '--request-timeout-ms', '30001']))
      .toThrow();
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788', '--wait-for-release-ms', '-1']))
      .toThrow();
    expect(() => parseSmokeArgs(['--environment', 'local', '--base-url', 'http://localhost:8788', '--request-timeout-ms', '999']))
      .toThrow();
  });
});

describe('smoke probes', () => {
  const config: SmokeOptions = parseSmokeArgs([
    '--environment', 'local', '--base-url', 'http://127.0.0.1:8788', '--expected-release', RELEASE,
  ]);

  it('allows only same-origin sign-in redirects for protected paths', async () => {
    const fetch = successResponses();
    const results = await runSmoke(config, dependencies(fetch));
    const first: SmokeProbeResult = results[0];
    expect(results.every((result) => result.ok)).toBe(true);
    expect(Object.keys(config).sort()).toEqual(['baseUrl', 'environment', 'expectedRelease', 'requestTimeoutMs', 'waitForReleaseMs']);
    expect(first).toEqual(expect.objectContaining({
      name: 'health', path: '/api/health', status: 200, ok: true, detail: '', durationMs: expect.any(Number),
    }));
    expect(results.map((result) => result.name)).toEqual([
      'health', 'home', 'about', 'contact', 'guidelines', 'map', 'methodology', 'privacy', 'search', 'terms', 'signin', 'signup',
      'profile-auth', 'new-review-auth', 'admin-auth', 'buildings-search', 'user-reviews-auth', 'admin-reviews-auth',
    ]);
    expect(results.every((result) => Object.keys(result).sort().join(',') === 'detail,durationMs,name,ok,path,status')).toBe(true);
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

  it('resolves protected redirect locations against the requested URL', async () => {
    for (const { location, ok } of [
      { location: '/auth/signin?next=%2Freview%2Fnew', ok: true },
      { location: '../../auth/signin?next=%2Freview%2Fnew', ok: true },
      { location: 'auth/signin', ok: false },
    ]) {
      const fetch = successResponses();
      const standard = successResponses();
      vi.mocked(fetch).mockImplementation(async (input: URL | RequestInfo) => {
        if (requestUrl(input).pathname === '/review/new') {
          return response('', { status: 302, headers: { location } });
        }
        return standard(input);
      });
      const results = await runSmoke(config, dependencies(fetch));
      expect(results.find((result) => result.path === '/review/new')?.ok).toBe(ok);
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
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caps a hanging health request at the positive release-wait deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetch = vi.fn((_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')));
    })) as unknown as SmokeDependencies['fetch'];
    const running = runSmoke(
      { ...config, waitForReleaseMs: 5_000, requestTimeoutMs: 30_000 },
      dependencies(fetch, Date.now),
    );
    let settled = false;
    void running.then(() => { settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(true);
    } finally {
      if (!settled) await vi.advanceTimersByTimeAsync(25_000);
      await expect(running).resolves.toMatchObject([{ path: '/api/health', ok: false }]);
      vi.useRealTimers();
    }
  });

  it('caps a hanging health JSON body at the positive release-wait deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const deferred = deferredBodyResponse('json', { 'content-type': 'application/json' });
    let aborted = false;
    const fetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
      return deferred.response;
    }) as unknown as SmokeDependencies['fetch'];
    const running = runSmoke(
      { ...config, waitForReleaseMs: 5_000, requestTimeoutMs: 30_000 },
      dependencies(fetch, Date.now),
    );
    let settled = false;
    void running.then(() => { settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(true);
      expect(aborted).toBe(true);
    } finally {
      deferred.resolve({ status: 'ok', release: RELEASE });
      await expect(running).resolves.toMatchObject([{
        name: 'health',
        status: 200,
        ok: false,
        detail: expect.stringContaining('Request timed out'),
      }]);
      vi.useRealTimers();
    }
  });

  it('caps a hanging HTML body at the ordinary request timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const deferred = deferredBodyResponse('text', {
      'content-type': 'text/html',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'",
      'referrer-policy': 'strict-origin-when-cross-origin',
    });
    const standard = successResponses();
    let aborted = false;
    const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
      if (requestUrl(input).pathname === '/') return Promise.resolve(deferred.response);
      return standard(input);
    }) as unknown as SmokeDependencies['fetch'];
    const running = runSmoke({ ...config, requestTimeoutMs: 1_000 }, dependencies(fetch, Date.now));
    let settled = false;
    void running.then(() => { settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(1_000);
      expect(settled).toBe(true);
      expect(aborted).toBe(true);
    } finally {
      deferred.resolve(HTML);
      await expect(running).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'home', path: '/', status: 200, ok: false, detail: 'Request timed out' }),
      ]));
      vi.useRealTimers();
    }
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
