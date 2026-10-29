import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi } from 'vitest';
import BaseLayout from '../../components/layout/BaseLayout.astro';
import { entityBreadcrumbs, serializeJsonLd, structuredData } from '../jsonLd';
import { canonicalPath } from '../seo';
import { STATIC_SITEMAP_PATHS, renderSitemapIndex, renderUrlSet } from '../sitemap';
import {
  indexPolicyProblem,
  parseSmokeArgs,
  runSmoke,
  validateSmokeTarget,
  type SmokeDependencies,
  type SmokeOptions,
  type SmokeProbeResult,
} from '../smoke';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';
const HTML = '<!doctype html><html><head></head><body>OK</body></html>';
const PROD = 'https://ratemyplace.org';
const PREVIEW_ORIGIN = 'https://1a2b3c4d.ratemyplace-64y.pages.dev';
const BUILDING_PATH = '/building/1-test-street-boston';
const LANDLORD_PATH = '/landlord/acme-realty';
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'",
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const PERMISSIVE_ROBOTS = [
  'User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /api', 'Disallow: /auth', 'Disallow: /profile',
  'Disallow: /review', 'Disallow: /dispute', 'Disallow: /email-verified', 'Disallow: /bug-report', '',
  `Sitemap: ${PROD}/sitemap.xml`, '',
].join('\n');
const DISALLOW_ALL_ROBOTS = 'User-agent: *\nDisallow: /\n';
const NOINDEX_PATHS = ['/auth/signin', '/auth/signup'];

function response(body: BodyInit, init: ResponseInit): Response {
  return new Response(body, init);
}

function requestUrl(input: URL | RequestInfo): URL {
  return new URL(input instanceof URL ? input.href : typeof input === 'string' ? input : input.url);
}

/** A PNG header (signature plus IHDR) of the given size; nothing reads past byte 24. */
function png(width: number, height: number, size = 33): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

interface HeadParts {
  canonical?: string | null;
  ogUrl?: string | null;
  ogImage?: string | null;
  twitterCard?: string | null;
  robots?: string | null;
  jsonLd?: string[];
}

/** A head shaped like BaseLayout's output. Every part can be overridden or dropped (null). */
function indexableHead(canonical: string, breadcrumb = false, parts: HeadParts = {}): string {
  const origin = new URL(canonical).origin;
  const jsonLd = parts.jsonLd ?? [
    serializeJsonLd(structuredData({ siteOrigin: origin, url: canonical, name: 'Page', description: 'd', breadcrumbs: breadcrumb ? entityBreadcrumbs('Page') : undefined })),
  ];
  const tag = (value: string | null | undefined, make: (v: string) => string): string => (value ? make(value) : '');
  return [
    '<head><meta charset="UTF-8"><title>Page | RateMyPlace</title><meta name="description" content="a > b &amp; c">',
    tag(parts.robots, (v) => `<meta name="robots" content="${v}">`),
    tag(parts.canonical === undefined ? canonical : parts.canonical, (v) => `<link rel="canonical" href="${v}">`),
    tag(parts.ogUrl === undefined ? canonical : parts.ogUrl, (v) => `<meta property="og:url" content="${v}">`),
    tag(parts.ogImage === undefined ? `${origin}/brand/social/og-default.png` : parts.ogImage, (v) => `<meta property="og:image" content="${v}">`),
    tag(parts.twitterCard === undefined ? 'summary_large_image' : parts.twitterCard, (v) => `<meta name="twitter:card" content="${v}">`),
    ...jsonLd.map((block) => `<script type="application/ld+json">${block}</script>`),
    '</head>',
  ].join('');
}

function noindexHead(parts: HeadParts = {}): string {
  return [
    '<head><title>Sign in | RateMyPlace</title>',
    parts.robots === null ? '' : `<meta name="robots" content="${parts.robots ?? 'noindex, follow'}">`,
    parts.canonical ? `<link rel="canonical" href="${parts.canonical}">` : '',
    ...(parts.jsonLd ?? []).map((block) => `<script type="application/ld+json">${block}</script>`),
    '</head>',
  ].join('');
}

function htmlPage(head: string): Response {
  return response(`<!doctype html><html lang="en">${head}<body>OK</body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  });
}

function xml(body: string): Response {
  return response(body, { status: 200, headers: { 'content-type': 'application/xml; charset=utf-8' } });
}

const SITEMAP_INDEX = renderSitemapIndex(PROD, ['static.xml', 'buildings-1.xml']);
const STATIC_SITEMAP = renderUrlSet([
  ...STATIC_SITEMAP_PATHS.map((path) => ({ loc: `${PROD}${path}`, lastmod: null })),
  { loc: `${PROD}${LANDLORD_PATH}`, lastmod: 1_700_000_000 },
]);
const BUILDING_SITEMAP = renderUrlSet([{ loc: `${PROD}${BUILDING_PATH}`, lastmod: 1_700_000_000 }]);

/** What the deployed site serves for the SEO probes' paths. Canonicals and locs name production. */
function seoResponse(url: URL): Response | null {
  const path = url.pathname;
  if (path === '/brand/social/og-default.png') return response(png(1200, 630), { status: 200, headers: { 'content-type': 'image/png' } });
  if (path === '/robots.txt') {
    // The real route: permissive only on the canonical host.
    return response(url.host === 'ratemyplace.org' ? PERMISSIVE_ROBOTS : DISALLOW_ALL_ROBOTS, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  if (path === '/sitemap.xml') return xml(SITEMAP_INDEX);
  if (path === '/sitemaps/static.xml') return xml(STATIC_SITEMAP);
  if (path === '/sitemaps/buildings-1.xml') return xml(BUILDING_SITEMAP);
  if (NOINDEX_PATHS.includes(path) || (path === '/search' && url.search !== '')) return htmlPage(noindexHead());
  if (path === BUILDING_PATH || path === LANDLORD_PATH) return htmlPage(indexableHead(`${PROD}${path}`, true));
  if (STATIC_SITEMAP_PATHS.includes(path)) return htmlPage(indexableHead(`${PROD}${canonicalPath(path)}`));
  return null;
}

function successResponses(release = RELEASE): SmokeDependencies['fetch'] {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = requestUrl(input);
    const path = url.pathname;
    const seo = seoResponse(url);
    if (seo) return seo;
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
      headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
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
      // SEO-07, appended after the original probes.
      'og-image', 'robots',
      'index-home', 'index-about', 'index-contact', 'index-guidelines', 'index-map', 'index-methodology', 'index-privacy', 'index-search', 'index-terms',
      'noindex-signin', 'noindex-signup', 'noindex-search-query',
      'sitemap-index', 'sitemap-static', 'sitemap-buildings', 'sitemap-building-page', 'sitemap-landlord-page',
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
    // Only the home probe's request hangs: the SEO probes fetch / again afterwards, and the
    // point here is that one hanging body costs one timeout, not the whole run.
    let homeServed = false;
    const fetch = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
      if (requestUrl(input).pathname === '/' && !homeServed) {
        homeServed = true;
        return Promise.resolve(deferred.response);
      }
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

describe('SEO probes (SEO-07)', () => {
  const LOCAL_ORIGIN = 'http://127.0.0.1:8788';
  const CONFIGS = {
    local: parseSmokeArgs(['--environment', 'local', '--base-url', LOCAL_ORIGIN, '--expected-release', RELEASE]),
    preview: parseSmokeArgs(['--environment', 'preview', '--base-url', PREVIEW_ORIGIN, '--expected-release', RELEASE]),
    production: parseSmokeArgs(['--environment', 'production', '--base-url', PROD, '--expected-release', RELEASE]),
  };
  type Environment = keyof typeof CONFIGS;
  type Match = (url: URL) => boolean;

  /** The healthy site, with the requests `match` picks answered by `make` instead. */
  function overriding(match: Match, make: (url: URL) => Response): SmokeDependencies['fetch'] {
    const standard = successResponses();
    return vi.fn(async (input: URL | RequestInfo) => {
      const url = requestUrl(input);
      return match(url) ? make(url) : standard(input);
    }) as unknown as SmokeDependencies['fetch'];
  }
  const at = (path: string): Match => (url) => url.pathname === path && url.search === '';
  const atSearchVariant: Match = (url) => url.pathname === '/search' && url.search !== '';
  const text = (body: string): Response => response(body, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const withLoc = (urlset: string, loc: string): string => urlset.replace('</urlset>', `  <url><loc>${loc}</loc></url>\n</urlset>`);
  const staticOnly = renderUrlSet(STATIC_SITEMAP_PATHS.map((path) => ({ loc: `${PROD}${path}`, lastmod: null })));

  function probe(results: SmokeProbeResult[], name: string): SmokeProbeResult {
    const found = results.find((result) => result.name === name);
    if (!found) throw new Error(`no ${name} probe`);
    return found;
  }

  it.each(['local', 'preview', 'production'] as const)('passes every probe on a healthy %s deployment', async (environment) => {
    const results = await runSmoke(CONFIGS[environment], dependencies(successResponses()));
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results).toHaveLength(37);
  });

  it('says why a local robots.txt is disallow-all, without failing it', async () => {
    const results = await runSmoke(CONFIGS.local, dependencies(successResponses()));
    expect(probe(results, 'robots')).toMatchObject({ ok: true, detail: 'Disallow-all: not the canonical host' });
    expect(probe(results, 'index-about')).toMatchObject({ ok: true, detail: '' });
  });

  it('asks the target for every path, the building chunk and sitemap pages included', async () => {
    // The preview's sitemap names production URLs; the probes must still read the preview.
    const fetch = successResponses();
    await runSmoke(CONFIGS.preview, dependencies(fetch));
    const calls = vi.mocked(fetch).mock.calls;
    const urls = calls.map(([input]) => requestUrl(input as URL));
    expect(urls.every((url) => url.origin === PREVIEW_ORIGIN)).toBe(true);
    expect(urls.map((url) => url.pathname)).toEqual(expect.arrayContaining([
      '/brand/social/og-default.png', '/robots.txt', '/sitemap.xml', '/sitemaps/static.xml', '/sitemaps/buildings-1.xml', BUILDING_PATH, LANDLORD_PATH,
    ]));
    for (const [, init] of calls) expect(init).toMatchObject({ cache: 'no-store', redirect: 'manual' });
  });

  it('leaves the original probes alone when only the head is wrong', async () => {
    const fetch = overriding(at('/'), () => htmlPage(indexableHead(`${PROD}/`, false, { canonical: null })));
    const results = await runSmoke(CONFIGS.production, dependencies(fetch));
    expect(probe(results, 'home')).toMatchObject({ ok: true, detail: '' });
    expect(results.filter((result) => !result.ok).map((result) => result.name)).toEqual(['index-home']);
  });

  it('accepts a canonical on the local target itself, and only locally', async () => {
    const make = () => htmlPage(indexableHead(`${LOCAL_ORIGIN}/about`));
    const local = await runSmoke(CONFIGS.local, dependencies(overriding(at('/about'), make)));
    expect(probe(local, 'index-about').ok).toBe(true);
    const production = await runSmoke(CONFIGS.production, dependencies(overriding(at('/about'), make)));
    expect(probe(production, 'index-about')).toMatchObject({ ok: false, detail: `Canonical mismatch: ${LOCAL_ORIGIN}/about` });
  });

  const failures: Array<[string, Environment, Match, (url: URL) => Response, string, string]> = [
    // Index policy: canonical, og:url, og:image, Twitter card, robots meta, structured data.
    ['a missing canonical on /', 'production', at('/'), () => htmlPage(indexableHead(`${PROD}/`, false, { canonical: null })), 'index-home', 'Missing canonical'],
    ['a relative canonical on /', 'production', at('/'), () => htmlPage(indexableHead(`${PROD}/`, false, { canonical: '/' })), 'index-home', 'Canonical mismatch: /'],
    ['a canonical on the preview host', 'preview', at('/about'), () => htmlPage(indexableHead(`${PREVIEW_ORIGIN}/about`)), 'index-about', `Canonical mismatch: ${PREVIEW_ORIGIN}/about`],
    ['a missing og:url', 'production', at('/terms'), () => htmlPage(indexableHead(`${PROD}/terms`, false, { ogUrl: null })), 'index-terms', 'og:url mismatch'],
    ['a relative og:image', 'production', at('/about'), () => htmlPage(indexableHead(`${PROD}/about`, false, { ogImage: '/brand/social/og-default.png' })), 'index-about', 'og:image mismatch: /brand/social/og-default.png'],
    ['an og:image on the wrong origin', 'preview', at('/map'), () => htmlPage(indexableHead(`${PROD}/map`, false, { ogImage: `${PREVIEW_ORIGIN}/brand/social/og-default.png` })), 'index-map', `og:image mismatch: ${PREVIEW_ORIGIN}/brand/social/og-default.png`],
    ['a missing twitter:card', 'production', at('/privacy'), () => htmlPage(indexableHead(`${PROD}/privacy`, false, { twitterCard: null })), 'index-privacy', 'Missing twitter:card summary_large_image'],
    ['a robots meta on an indexable page', 'production', at('/search'), () => htmlPage(indexableHead(`${PROD}/search`, false, { robots: 'noindex, follow' })), 'index-search', 'Unexpected robots meta on an indexable page'],
    ['no JSON-LD on an indexable page', 'production', at('/contact'), () => htmlPage(indexableHead(`${PROD}/contact`, false, { jsonLd: [] })), 'index-contact', 'Expected one JSON-LD block'],
    ['unescaped JSON-LD', 'production', at('/contact'), () => htmlPage(indexableHead(`${PROD}/contact`, false, { jsonLd: [JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', url: `${PROD}/contact`, name: 'A & B' }] })] })), 'index-contact', 'Unescaped JSON-LD'],
    ['invalid JSON-LD', 'production', at('/methodology'), () => htmlPage(indexableHead(`${PROD}/methodology`, false, { jsonLd: ['{"@context":'] })), 'index-methodology', 'Invalid JSON-LD'],
    ['a rating in JSON-LD', 'production', at('/guidelines'), () => htmlPage(indexableHead(`${PROD}/guidelines`, false, { jsonLd: [serializeJsonLd({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage', url: `${PROD}/guidelines`, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.8 } }] })] })), 'index-guidelines', 'Rating in JSON-LD'],
    ['a JSON-LD WebPage at another URL', 'production', at('/guidelines'), () => htmlPage(indexableHead(`${PROD}/guidelines`, false, { jsonLd: [serializeJsonLd(structuredData({ siteOrigin: PROD, url: `${PROD}/about`, name: 'n', description: 'd' }))] })), 'index-guidelines', 'JSON-LD WebPage url mismatch'],
    ['a missing noindex on sign-in', 'production', at('/auth/signin'), () => htmlPage(noindexHead({ robots: null })), 'noindex-signin', 'Missing noindex'],
    ['an indexable search variant', 'preview', atSearchVariant, () => htmlPage(indexableHead(`${PROD}/search`)), 'noindex-search-query', 'Missing noindex'],
    ['a canonical on a search variant', 'production', atSearchVariant, () => htmlPage(noindexHead({ canonical: `${PROD}/search` })), 'noindex-search-query', 'Canonical on a noindex page'],
    ['JSON-LD on a noindex page', 'production', at('/auth/signup'), () => htmlPage(noindexHead({ jsonLd: ['{}'] })), 'noindex-signup', 'Structured data on a noindex page'],
    // robots.txt per environment.
    ['a permissive robots.txt on preview', 'preview', at('/robots.txt'), () => text(PERMISSIVE_ROBOTS), 'robots', 'Preview robots.txt must disallow every crawler'],
    ['a disallow-all robots.txt in production', 'production', at('/robots.txt'), () => text(DISALLOW_ALL_ROBOTS), 'robots', 'Production robots.txt disallows every crawler'],
    ['a production robots.txt with no Sitemap line', 'production', at('/robots.txt'), () => text(PERMISSIVE_ROBOTS.replace(/Sitemap:.*\n/, '')), 'robots', 'Missing Sitemap line'],
    ['a production robots.txt naming another sitemap host', 'production', at('/robots.txt'), () => text(PERMISSIVE_ROBOTS.replace(PROD, PREVIEW_ORIGIN)), 'robots', 'Missing Sitemap line'],
    ['a production robots.txt that stopped disallowing /admin', 'production', at('/robots.txt'), () => text(PERMISSIVE_ROBOTS.replace('Disallow: /admin\n', '')), 'robots', 'Missing Disallow: /admin'],
    ['a robots.txt served as HTML', 'production', at('/robots.txt'), () => htmlPage('<head></head>'), 'robots', 'Expected text/plain 200 response'],
    // Sitemap: healthy versus degraded, and what the files may list.
    ['a degraded sitemap index in production', 'production', at('/sitemap.xml'), () => xml(renderSitemapIndex(PROD, ['static.xml'])), 'sitemap-index', 'Sitemap degraded: static only'],
    ['a degraded sitemap index on preview', 'preview', at('/sitemap.xml'), () => xml(renderSitemapIndex(PROD, ['static.xml'])), 'sitemap-index', 'Sitemap degraded: static only'],
    ['a sitemap index with no static file', 'production', at('/sitemap.xml'), () => xml(renderSitemapIndex(PROD, ['buildings-1.xml'])), 'sitemap-index', 'Missing static.xml'],
    ['a sitemap index naming the preview host', 'production', at('/sitemap.xml'), () => xml(renderSitemapIndex(PREVIEW_ORIGIN, ['static.xml', 'buildings-1.xml'])), 'sitemap-index', `Unexpected sitemap loc: ${PREVIEW_ORIGIN}/sitemaps/static.xml`],
    ['a sitemap index that is not XML', 'production', at('/sitemap.xml'), () => htmlPage('<head></head>'), 'sitemap-index', 'Expected XML 200 response'],
    ['a static sitemap listing /admin', 'production', at('/sitemaps/static.xml'), () => xml(withLoc(STATIC_SITEMAP, `${PROD}/admin`)), 'sitemap-static', 'Private path in sitemap: /admin'],
    ['a static sitemap listing a query URL', 'production', at('/sitemaps/static.xml'), () => xml(withLoc(STATIC_SITEMAP, `${PROD}/search?q=x`)), 'sitemap-static', `Query or fragment in sitemap loc: ${PROD}/search?q=x`],
    ['a static sitemap listing a property manager', 'production', at('/sitemaps/static.xml'), () => xml(withLoc(STATIC_SITEMAP, `${PROD}/property-manager/x`)), 'sitemap-static', 'Private path in sitemap: /property-manager/x'],
    ['a static sitemap listing an unknown page', 'production', at('/sitemaps/static.xml'), () => xml(withLoc(STATIC_SITEMAP, `${PROD}/about/`)), 'sitemap-static', `Unexpected sitemap loc: ${PROD}/about/`],
    ['a static sitemap missing a static page', 'production', at('/sitemaps/static.xml'), () => xml(STATIC_SITEMAP.replace(`  <url><loc>${PROD}/terms</loc></url>\n`, '')), 'sitemap-static', 'Missing static path: /terms'],
    ['a static sitemap with no landlords in production', 'production', at('/sitemaps/static.xml'), () => xml(staticOnly), 'sitemap-static', 'Sitemap degraded: no landlord URLs'],
    ['a static sitemap with no landlords on preview', 'preview', at('/sitemaps/static.xml'), () => xml(staticOnly), 'sitemap-static', 'Sitemap degraded: no landlord URLs'],
    ['an empty building chunk', 'production', at('/sitemaps/buildings-1.xml'), () => xml(renderUrlSet([])), 'sitemap-buildings', 'Empty building chunk'],
    ['a building chunk listing a landlord', 'production', at('/sitemaps/buildings-1.xml'), () => xml(renderUrlSet([{ loc: `${PROD}${LANDLORD_PATH}`, lastmod: null }])), 'sitemap-buildings', `Unexpected sitemap loc: ${PROD}${LANDLORD_PATH}`],
    ['a building chunk that is gone', 'production', at('/sitemaps/buildings-1.xml'), () => response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain' } }), 'sitemap-buildings', 'Expected XML 200 response'],
    ['a listed building whose canonical is not its loc', 'production', at(BUILDING_PATH), () => htmlPage(indexableHead(`${PROD}/building/other`, true)), 'sitemap-building-page', `Canonical mismatch: ${PROD}/building/other`],
    ['a listed landlord with no breadcrumb', 'production', at(LANDLORD_PATH), () => htmlPage(indexableHead(`${PROD}${LANDLORD_PATH}`)), 'sitemap-landlord-page', 'Missing JSON-LD breadcrumb'],
    ['a listed landlord page that is noindex', 'preview', at(LANDLORD_PATH), () => htmlPage(noindexHead()), 'sitemap-landlord-page', 'Missing canonical'],
    // The default social image.
    ['a missing social image', 'production', at('/brand/social/og-default.png'), () => response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }), 'og-image', 'Expected image 200 response'],
    ['a social image of the wrong type', 'preview', at('/brand/social/og-default.png'), () => response(png(1200, 630), { status: 200, headers: { 'content-type': 'image/jpeg' } }), 'og-image', 'Expected image/png, got image/jpeg'],
    ['a social image of the wrong size', 'production', at('/brand/social/og-default.png'), () => response(png(1200, 600), { status: 200, headers: { 'content-type': 'image/png' } }), 'og-image', 'Wrong dimensions: 1200x600'],
    ['a social image of 300 KB', 'production', at('/brand/social/og-default.png'), () => response(png(1200, 630, 300_000), { status: 200, headers: { 'content-type': 'image/png' } }), 'og-image', 'Image too large: 300000 bytes'],
    ['a social image that is not a PNG', 'production', at('/brand/social/og-default.png'), () => response('<html></html>', { status: 200, headers: { 'content-type': 'image/png' } }), 'og-image', 'Not a PNG'],
  ];

  it.each(failures)('fails %s', async (_label, environment, match, make, name, detail) => {
    const results = await runSmoke(CONFIGS[environment], dependencies(overriding(match, make)));
    expect(probe(results, name)).toMatchObject({ ok: false, detail });
  });

  it('fails a degraded sitemap in production and preview but reports it locally', async () => {
    const degraded = () => overriding(at('/sitemap.xml'), () => xml(renderSitemapIndex(PROD, ['static.xml'])));
    for (const environment of ['production', 'preview'] as const) {
      const results = await runSmoke(CONFIGS[environment], dependencies(degraded()));
      expect(probe(results, 'sitemap-index')).toMatchObject({ ok: false, detail: 'Sitemap degraded: static only' });
      expect(probe(results, 'sitemap-buildings')).toMatchObject({ ok: false, detail: 'No building chunk listed' });
      expect(probe(results, 'sitemap-building-page')).toMatchObject({ ok: false, detail: 'No building URL listed' });
    }
    const fetch = degraded();
    const local = await runSmoke(CONFIGS.local, dependencies(fetch));
    expect(probe(local, 'sitemap-index')).toMatchObject({ ok: true, detail: 'Sitemap degraded: static only' });
    expect(probe(local, 'sitemap-buildings')).toMatchObject({ ok: true, detail: 'No building chunk listed' });
    expect(probe(local, 'sitemap-building-page')).toMatchObject({ ok: true, detail: 'No building URL listed' });
    expect(vi.mocked(fetch).mock.calls.map(([input]) => requestUrl(input as URL).pathname)).not.toContain('/sitemaps/buildings-1.xml');
  });

  it('reports a landlord-less static sitemap locally without failing it', async () => {
    const results = await runSmoke(CONFIGS.local, dependencies(overriding(at('/sitemaps/static.xml'), () => xml(staticOnly))));
    expect(probe(results, 'sitemap-static')).toMatchObject({ ok: true, detail: 'Sitemap degraded: no landlord URLs' });
    expect(probe(results, 'sitemap-landlord-page')).toMatchObject({ ok: true, detail: 'No landlord URL listed' });
  });
});

// The head checks read what BaseLayout really renders, so the smoke parser and the layout cannot
// drift apart unnoticed.
describe('indexPolicyProblem against the rendered layout', () => {
  async function renderLayout(url: string, props: Record<string, unknown>): Promise<string> {
    const container = await AstroContainer.create();
    return container.renderToString(BaseLayout, {
      props,
      slots: { default: '<p>x</p>' },
      request: new Request(url),
      partial: false,
      locals: { user: null, session: null, runtime: { env: { SITE_URL: PROD } } } as unknown as App.Locals,
    });
  }

  it('passes the home page and a static page', async () => {
    const home = await renderLayout(`${PROD}/`, { title: 'Know before you sign.', description: 'd' });
    expect(indexPolicyProblem(home, { policy: 'indexable', canonicals: [`${PROD}/`] })).toBeNull();
    const about = await renderLayout(`${PREVIEW_ORIGIN}/about`, { title: 'About', description: 'd' });
    expect(indexPolicyProblem(about, { policy: 'indexable', canonicals: [`${PROD}/about`] })).toBeNull();
  });

  it('passes a detail page with its breadcrumb', async () => {
    const html = await renderLayout(`${PROD}/landlord/x`, { title: 'X', description: 'd', breadcrumbs: entityBreadcrumbs('X') });
    expect(indexPolicyProblem(html, { policy: 'indexable', canonicals: [`${PROD}/landlord/x`], breadcrumb: true })).toBeNull();
  });

  it('passes a noindex page, and fails it as indexable', async () => {
    const html = await renderLayout(`${PROD}/auth/signin`, { title: 'Sign in', noindex: true });
    expect(indexPolicyProblem(html, { policy: 'noindex', canonicals: [] })).toBeNull();
    expect(indexPolicyProblem(html, { policy: 'indexable', canonicals: [`${PROD}/auth/signin`] })).toBe('Missing canonical');
  });

  it('is not fooled by markup inside a hostile title or description', async () => {
    const hostile = `x"> <link rel="canonical" href="https://evil.example/"><meta name="robots" content="noindex"><script type="application/ld+json">{}</script>`;
    const html = await renderLayout(`${PROD}/landlord/x`, { title: hostile, description: hostile, breadcrumbs: entityBreadcrumbs(hostile) });
    expect(indexPolicyProblem(html, { policy: 'indexable', canonicals: [`${PROD}/landlord/x`], breadcrumb: true })).toBeNull();
  });

  // Astro escapes only & and " in attribute values, so a name holding "</head>" reaches the head
  // verbatim inside og:title and the description. The head ends at a real end tag only.
  it('reads past a </head> quoted inside an attribute value', async () => {
    for (const name of ['Acme </head> Co', 'Acme </HEAD > <link rel="canonical" href="https://evil.example/"> Co']) {
      const html = await renderLayout(`${PROD}/landlord/x`, { title: name, description: name, breadcrumbs: entityBreadcrumbs(name) });
      expect(indexPolicyProblem(html, { policy: 'indexable', canonicals: [`${PROD}/landlord/x`], breadcrumb: true })).toBeNull();
    }
  });

  it('fails a page with no head or an unterminated one', () => {
    for (const html of ['<!doctype html><html><body>x</body></html>', '<!doctype html><html><head><link rel="canonical" href="x">']) {
      expect(indexPolicyProblem(html, { policy: 'noindex', canonicals: [] })).toBe('Missing head');
    }
  });
});
