import { DEFAULT_OG_IMAGE, NOINDEX_ROBOTS, canonicalPath } from './seo';
import { STATIC_SITEMAP_PATHS } from './sitemap';

export type SmokeEnvironment = 'local' | 'preview' | 'production';

export interface SmokeOptions {
  environment: SmokeEnvironment;
  baseUrl: URL;
  expectedRelease?: string;
  waitForReleaseMs: number;
  requestTimeoutMs: number;
}

export interface SmokeDependencies {
  fetch: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

export interface SmokeProbeResult {
  name: string;
  path: string;
  status: number;
  ok: boolean;
  detail: string;
  durationMs: number;
}

interface HtmlProbe {
  name: string;
  path: string;
}

interface ApiProbe {
  name: string;
  path: string;
  status: number;
  key: string;
}

interface RequestSuccess<T> {
  response: Response;
  body: T;
}

interface RequestFailure {
  response?: Response;
  error: 'Request timed out' | 'Request failed';
}

interface HealthCheck {
  result: SmokeProbeResult;
  release?: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;
const PREVIEW_HOST = /^[0-9a-f]{8}\.ratemyplace-64y\.pages\.dev$/;
const RAW_TARGET = /^(https?):\/\/([^/?#]+)(\/?)$/i;
const FORBIDDEN_RAW_TARGET_SYNTAX = /[@\\\u0000-\u0020\u007f]/;
const HTML_PROBES: HtmlProbe[] = [
  { name: 'home', path: '/' },
  { name: 'about', path: '/about' },
  { name: 'contact', path: '/contact' },
  { name: 'guidelines', path: '/guidelines' },
  { name: 'map', path: '/map' },
  { name: 'methodology', path: '/methodology' },
  { name: 'privacy', path: '/privacy' },
  { name: 'search', path: '/search' },
  { name: 'terms', path: '/terms' },
  { name: 'signin', path: '/auth/signin' },
  { name: 'signup', path: '/auth/signup' },
];
const PROTECTED_PROBES: HtmlProbe[] = [
  { name: 'profile-auth', path: '/profile' },
  { name: 'new-review-auth', path: '/review/new' },
  { name: 'admin-auth', path: '/admin' },
];
const API_PROBES: ApiProbe[] = [
  { name: 'buildings-search', path: '/api/buildings?q=__rmp_smoke_no_match__', status: 200, key: 'buildings' },
  { name: 'user-reviews-auth', path: '/api/reviews/user', status: 401, key: 'error' },
  { name: 'admin-reviews-auth', path: '/api/admin/reviews?limit=1', status: 401, key: 'error' },
];
const ERROR_SENTINELS = ['Internal Server Error', 'Application error', '500 Error'];

// SEO-07 discoverability probes. They run after every probe above, as rows of their own, so
// none of the earlier checks changes. Expectations depend on the environment: a preview
// deployment serves production's canonical URLs and sitemap locs (SITE_URL is the production
// origin there) but a disallow-all robots.txt, because it is not the canonical host.
type IndexPolicy = 'indexable' | 'noindex';

interface IndexProbe {
  name: string;
  path: string;
  index: IndexPolicy;
}

/** Where canonicals, og:image, the robots Sitemap line and sitemap locs point in production and preview. */
const CANONICAL_ORIGIN = 'https://ratemyplace.org';
const SEARCH_VARIANT_PATH = '/search?q=__rmp_smoke_no_match__';
const INDEX_PROBES: IndexProbe[] = [
  ...STATIC_SITEMAP_PATHS.map((path): IndexProbe => ({ name: `index-${path === '/' ? 'home' : path.slice(1)}`, path, index: 'indexable' })),
  { name: 'noindex-signin', path: '/auth/signin', index: 'noindex' },
  { name: 'noindex-signup', path: '/auth/signup', index: 'noindex' },
  { name: 'noindex-search-query', path: SEARCH_VARIANT_PATH, index: 'noindex' },
];
const OG_IMAGE_MAX_BYTES = 300_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DISALLOW_ALL_ROBOTS = 'User-agent: *\nDisallow: /\n';
const ROBOTS_DISALLOWED_PREFIXES = ['/admin', '/api', '/auth', '/profile', '/review'];
const SITEMAP_PRIVATE_PREFIXES = [
  '/admin', '/api', '/auth', '/profile', '/review', '/dispute', '/email-verified', '/bug-report', '/owner-of-record', '/property-manager',
];
const ENTITY_SLUG = '[a-z0-9-]+';
const JSON_LD_RATING_KEYS = ['aggregateRating', 'review', 'reviews', 'reviewRating', 'ratingValue', 'ratingCount', 'reviewCount', 'bestRating', 'worstRating'];
const SITEMAP_DEGRADED = 'Sitemap degraded: static only';
const DEFAULT_DEPENDENCIES: SmokeDependencies = {
  fetch,
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function parseMilliseconds(value: string, flag: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(flag + ' must be an integer');
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(flag + ' must be between ' + minimum + ' and ' + maximum);
  }
  return parsed;
}

export function validateSmokeTarget(environment: SmokeEnvironment, value: string): URL {
  if (FORBIDDEN_RAW_TARGET_SYNTAX.test(value)) {
    throw new Error('--base-url must be an origin without credentials, path, query, or fragment');
  }
  const rawTarget = RAW_TARGET.exec(value);
  if (!rawTarget) {
    throw new Error('--base-url must be an origin without credentials, path, query, or fragment');
  }
  if (rawTarget[2].endsWith(':')) {
    throw new Error('--base-url must not contain an empty port');
  }

  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error('Invalid --base-url');
  }

  const authority = rawTarget[2];
  if (target.username || target.password || target.hash || target.search || target.pathname !== '/') {
    throw new Error('--base-url must be an origin without credentials, path, query, or fragment');
  }
  const hasExplicitPort = /:\d+$/.test(authority);
  const isProduction = target.protocol === 'https:' && target.hostname === 'ratemyplace.org' && target.port === '' && !hasExplicitPort;
  const isPreview = target.protocol === 'https:' && target.port === '' && !hasExplicitPort && PREVIEW_HOST.test(target.hostname);
  const isLocal = (target.protocol === 'http:' || target.protocol === 'https:') &&
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if ((environment === 'production' && !isProduction) ||
      (environment === 'preview' && !isPreview) ||
      (environment === 'local' && !isLocal)) {
    throw new Error('Invalid ' + environment + ' --base-url');
  }
  return target;
}

export function parseSmokeArgs(args: string[]): SmokeOptions {
  const values = new Map<string, string>();
  const flags = new Set([
    '--environment',
    '--base-url',
    '--expected-release',
    '--wait-for-release-ms',
    '--request-timeout-ms',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!flags.has(flag)) throw new Error('Unknown argument: ' + flag);
    if (values.has(flag)) throw new Error('Duplicate ' + flag);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
    values.set(flag, value);
  }

  const environment = values.get('--environment');
  if (!environment) throw new Error('Missing --environment');
  if (environment !== 'local' && environment !== 'preview' && environment !== 'production') {
    throw new Error('--environment must be local, preview, or production');
  }
  const baseUrl = values.get('--base-url');
  if (!baseUrl) throw new Error('Missing --base-url');
  const expectedRelease = values.get('--expected-release');
  if (environment !== 'local' && !expectedRelease) throw new Error('Missing --expected-release');
  if (expectedRelease && !FULL_SHA.test(expectedRelease)) {
    throw new Error('--expected-release must be a 40-character hexadecimal SHA');
  }

  return {
    environment,
    baseUrl: validateSmokeTarget(environment, baseUrl),
    expectedRelease: expectedRelease?.toLowerCase(),
    waitForReleaseMs: values.has('--wait-for-release-ms')
      ? parseMilliseconds(values.get('--wait-for-release-ms') ?? '', '--wait-for-release-ms', 0, 600_000)
      : 0,
    requestTimeoutMs: values.has('--request-timeout-ms')
      ? parseMilliseconds(values.get('--request-timeout-ms') ?? '', '--request-timeout-ms', 1_000, 30_000)
      : 10_000,
  };
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function result(
  name: string,
  path: string,
  start: number,
  now: () => number,
  status: number,
  ok: boolean,
  detail = '',
): SmokeProbeResult {
  return { name, path, status, ok, detail, durationMs: Math.max(0, now() - start) };
}

function responseStatus(failure: RequestFailure): number {
  return failure.response?.status ?? 0;
}

function isFailure<T>(outcome: RequestSuccess<T> | RequestFailure): outcome is RequestFailure {
  return 'error' in outcome;
}

async function requestWithTimeout<T>(
  url: URL,
  dependencies: SmokeDependencies,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<RequestSuccess<T> | RequestFailure> {
  const controller = new AbortController();
  let receivedResponse: Response | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const operation = (async (): Promise<RequestSuccess<T>> => {
    receivedResponse = await dependencies.fetch(url, {
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new Error('Request aborted');
    const body = await consume(receivedResponse);
    if (controller.signal.aborted) throw new Error('Request aborted');
    return { response: receivedResponse, body };
  })();
  const guardedOperation = operation.then(
    (success) => ({ kind: 'success' as const, success }),
    () => ({ kind: 'failed' as const }),
  );
  const timeout = new Promise<{ kind: 'timed-out'; failure: RequestFailure }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: 'timed-out', failure: { response: receivedResponse, error: 'Request timed out' } });
    }, timeoutMs);
  });

  try {
    const outcome = await Promise.race([guardedOperation, timeout]);
    if (outcome.kind === 'success') return outcome.success;
    if (outcome.kind === 'timed-out') return outcome.failure;
    return { response: receivedResponse, error: 'Request failed' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function sleepWithinBudget(dependencies: SmokeDependencies, milliseconds: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guardedSleep = dependencies.sleep(milliseconds).then(
    () => undefined,
    () => undefined,
  );
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, milliseconds);
  });
  try {
    await Promise.race([guardedSleep, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function probeUrl(options: SmokeOptions, path: string): URL {
  return new URL(path, options.baseUrl);
}

function homeHeadersPresent(response: Response): boolean {
  const requiredHeaders: Array<[string, string?]> = [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['content-security-policy'],
    ['referrer-policy'],
  ];
  return !requiredHeaders.some(([name, expected]) => {
    const actual = response.headers.get(name);
    return !actual || (expected !== undefined && actual.toLowerCase() !== expected.toLowerCase());
  });
}

async function probeHealth(
  options: SmokeOptions,
  dependencies: SmokeDependencies,
  deadline?: number,
): Promise<HealthCheck> {
  const name = 'health';
  const path = '/api/health';
  const start = dependencies.now();
  const remainingBudget = deadline === undefined ? undefined : deadline - start;
  if (remainingBudget !== undefined && remainingBudget <= 0) {
    return { result: result(name, path, start, dependencies.now, 0, false, 'Release wait deadline reached') };
  }
  const timeoutMs = remainingBudget === undefined
    ? options.requestTimeoutMs
    : Math.max(1, Math.min(options.requestTimeoutMs, remainingBudget));
  const fetched = await requestWithTimeout(
    probeUrl(options, path),
    dependencies,
    timeoutMs,
    async (response) => {
      if (response.status !== 200 || isRedirect(response.status) || !isJson(response)) return undefined;
      return response.json() as Promise<unknown>;
    },
  );
  if (isFailure(fetched)) {
    return { result: result(name, path, start, dependencies.now, responseStatus(fetched), false, fetched.error) };
  }
  const { response, body } = fetched;
  if (response.status !== 200 || isRedirect(response.status) || !isJson(response)) {
    return { result: result(name, path, start, dependencies.now, response.status, false, 'Expected health JSON response') };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { result: result(name, path, start, dependencies.now, response.status, false, 'Malformed health response') };
  }
  const health = body as { status?: unknown; release?: unknown };
  if (health.status !== 'ok' || typeof health.release !== 'string') {
    return { result: result(name, path, start, dependencies.now, response.status, false, 'Malformed health response') };
  }
  const matches = !options.expectedRelease || health.release === options.expectedRelease;
  return {
    result: result(name, path, start, dependencies.now, response.status, matches, matches ? '' : 'Release mismatch'),
    release: health.release,
  };
}

async function probeHtml(
  probe: HtmlProbe,
  options: SmokeOptions,
  dependencies: SmokeDependencies,
): Promise<SmokeProbeResult> {
  const start = dependencies.now();
  const fetched = await requestWithTimeout(
    probeUrl(options, probe.path),
    dependencies,
    options.requestTimeoutMs,
    async (response) => {
      const isExpectedHtml = response.status === 200 && !isRedirect(response.status) &&
        response.headers.get('content-type')?.toLowerCase().includes('text/html');
      if (!isExpectedHtml || (probe.name === 'home' && !homeHeadersPresent(response))) return '';
      return response.text();
    },
  );
  if (isFailure(fetched)) {
    return result(probe.name, probe.path, start, dependencies.now, responseStatus(fetched), false, fetched.error);
  }
  const { response, body } = fetched;
  const isExpectedHtml = response.status === 200 && !isRedirect(response.status) &&
    response.headers.get('content-type')?.toLowerCase().includes('text/html');
  if (!isExpectedHtml) {
    return result(probe.name, probe.path, start, dependencies.now, response.status, false, 'Expected HTML 200 response');
  }
  if (probe.name === 'home' && !homeHeadersPresent(response)) {
    return result(probe.name, probe.path, start, dependencies.now, response.status, false, 'Missing required security header');
  }
  const isDocument = /<!doctype html/i.test(body) && /<html[\s>]/i.test(body);
  if (!isDocument || ERROR_SENTINELS.some((sentinel) => body.includes(sentinel))) {
    return result(probe.name, probe.path, start, dependencies.now, response.status, false, 'Invalid HTML response');
  }
  return result(probe.name, probe.path, start, dependencies.now, response.status, true);
}

async function probeProtected(
  probe: HtmlProbe,
  options: SmokeOptions,
  dependencies: SmokeDependencies,
): Promise<SmokeProbeResult> {
  const start = dependencies.now();
  const requestedUrl = probeUrl(options, probe.path);
  const fetched = await requestWithTimeout(
    requestedUrl,
    dependencies,
    options.requestTimeoutMs,
    async () => undefined,
  );
  if (isFailure(fetched)) {
    return result(probe.name, probe.path, start, dependencies.now, responseStatus(fetched), false, fetched.error);
  }
  const { response } = fetched;
  const location = response.headers.get('location');
  if (!isRedirect(response.status) || !location) {
    return result(probe.name, probe.path, start, dependencies.now, response.status, false, 'Expected sign-in redirect');
  }
  try {
    const destination = new URL(location, requestedUrl);
    const allowed = destination.origin === options.baseUrl.origin && destination.pathname === '/auth/signin';
    return result(probe.name, probe.path, start, dependencies.now, response.status, allowed, allowed ? '' : 'Invalid sign-in redirect');
  } catch {
    return result(probe.name, probe.path, start, dependencies.now, response.status, false, 'Invalid sign-in redirect');
  }
}

async function probeApi(
  probe: ApiProbe,
  options: SmokeOptions,
  dependencies: SmokeDependencies,
): Promise<SmokeProbeResult> {
  const start = dependencies.now();
  const fetched = await requestWithTimeout(
    probeUrl(options, probe.path),
    dependencies,
    options.requestTimeoutMs,
    async (response) => {
      if (response.status !== probe.status || isRedirect(response.status) || !isJson(response)) return undefined;
      return response.json() as Promise<unknown>;
    },
  );
  if (isFailure(fetched)) {
    return result(probe.name, probe.path, start, dependencies.now, responseStatus(fetched), false, fetched.error);
  }
  const { response, body } = fetched;
  if (response.status !== probe.status || isRedirect(response.status) || !isJson(response)) {
    return result(probe.name, probe.path, start, dependencies.now, response.status, false, 'Expected JSON API response');
  }
  const valid = !!body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, probe.key);
  return result(probe.name, probe.path, start, dependencies.now, response.status, valid, valid ? '' : 'Malformed API response');
}

// ---- SEO-07: social image, robots, index policy, sitemap ------------------------------------

const HTML_TYPES = ['text/html'];
const XML_TYPES = ['application/xml', 'text/xml'];
const TEXT_TYPES = ['text/plain'];
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const TAG_ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
// A tag's attribute text, quoted values included: Astro escapes `"` and `&` inside an
// attribute but not `>`, so a description holding `>` must not end the tag early.
const TAG_BODY = `((?:[^>"']|"[^"]*"|'[^']*')*)`;

function contentType(response: Response): string {
  return (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

function isOkType(response: Response, types: readonly string[]): boolean {
  return response.status === 200 && types.includes(contentType(response));
}

/**
 * Origins a canonical, the robots Sitemap line or a sitemap loc may use. Production and preview:
 * production's only. Local: production's (the SITE_URL fallback) or the local target's own.
 */
function acceptedOrigins(options: SmokeOptions): string[] {
  return options.environment === 'local' && options.baseUrl.origin !== CANONICAL_ORIGIN
    ? [CANONICAL_ORIGIN, options.baseUrl.origin]
    : [CANONICAL_ORIGIN];
}

/** A pass, or a failure carrying `problem`. */
function verdict(
  name: string,
  path: string,
  start: number,
  now: () => number,
  status: number,
  problem: string | null,
  passDetail = '',
): SmokeProbeResult {
  return result(name, path, start, now, status, problem === null, problem ?? passDetail);
}

/**
 * A degraded sitemap (D1 unavailable: static pages only) fails on preview and production,
 * which share the production D1, and is reported but passes locally, where the database may
 * simply be empty.
 */
function degradedVerdict(
  options: SmokeOptions,
  name: string,
  path: string,
  start: number,
  now: () => number,
  status: number,
  detail: string,
): SmokeProbeResult {
  return options.environment === 'local'
    ? verdict(name, path, start, now, status, null, detail)
    : verdict(name, path, start, now, status, detail);
}

async function fetchText(
  path: string,
  types: readonly string[],
  options: SmokeOptions,
  dependencies: SmokeDependencies,
): Promise<RequestSuccess<string | null> | RequestFailure> {
  return requestWithTimeout(probeUrl(options, path), dependencies, options.requestTimeoutMs, async (response) =>
    isOkType(response, types) ? response.text() : null,
  );
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole: string, decimal?: string, hex?: string, named?: string) => {
    if (decimal !== undefined || hex !== undefined) {
      const code = decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[(named ?? '').toLowerCase()] ?? whole;
  });
}

function tagAttributes(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(TAG_ATTRIBUTE)) {
    found[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

interface HeadTags {
  links: Array<Record<string, string>>;
  metas: Array<Record<string, string>>;
  /** The raw text of each JSON-LD block. */
  jsonLd: string[];
}

// One left-to-right pass over the head: a whole script element, or any other start tag with its
// quoted attributes. A tag is consumed whole, so markup quoted inside an attribute value (a
// title or description holding "<link rel=canonical ...>") is never read as a tag of its own.
const HEAD_TOKEN = new RegExp(`<script\\b${TAG_BODY}>([\\s\\S]*?)<\\/script\\s*>|<([a-zA-Z][\\w:-]*)${TAG_BODY}>`, 'gi');

function headTags(html: string): HeadTags | null {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1];
  if (head === undefined) return null;
  const tags: HeadTags = { links: [], metas: [], jsonLd: [] };
  for (const match of head.matchAll(HEAD_TOKEN)) {
    const [, scriptAttributes, scriptBody, tagName, attributes] = match;
    if (scriptAttributes !== undefined) {
      if ((tagAttributes(scriptAttributes).type ?? '').toLowerCase() === 'application/ld+json') tags.jsonLd.push(scriptBody ?? '');
    } else if (tagName.toLowerCase() === 'link') {
      tags.links.push(tagAttributes(attributes ?? ''));
    } else if (tagName.toLowerCase() === 'meta') {
      tags.metas.push(tagAttributes(attributes ?? ''));
    }
  }
  return tags;
}

function metaContents(tags: HeadTags, key: string): string[] {
  return tags.metas
    .filter((meta) => (meta.property ?? meta.name ?? '').toLowerCase() === key)
    .map((meta) => meta.content ?? '');
}

function canonicalHrefs(tags: HeadTags): string[] {
  return tags.links
    .filter((link) => (link.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))
    .map((link) => link.href ?? '');
}

/** Every key at any depth, and every @type value. */
function jsonLdKeysAndTypes(value: unknown, keys: string[] = [], types: unknown[] = []): { keys: string[]; types: unknown[] } {
  if (Array.isArray(value)) {
    for (const item of value) jsonLdKeysAndTypes(item, keys, types);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      if (key === '@type') types.push(child);
      jsonLdKeysAndTypes(child, keys, types);
    }
  }
  return { keys, types };
}

function jsonLdProblem(raw: string, canonical: string, breadcrumb: boolean): string | null {
  // serializeJsonLd escapes all three; a raw one means the block skipped it.
  if (/[<>&]/.test(raw)) return 'Unescaped JSON-LD';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'Invalid JSON-LD';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Invalid JSON-LD';
  const document = parsed as Record<string, unknown>;
  const graph = document['@graph'];
  if (document['@context'] !== 'https://schema.org' || !Array.isArray(graph)) return 'Invalid JSON-LD';
  const { keys, types } = jsonLdKeysAndTypes(document);
  if (keys.some((key) => JSON_LD_RATING_KEYS.includes(key)) || types.some((type) => ['AggregateRating', 'Review', 'Rating'].includes(String(type)))) {
    return 'Rating in JSON-LD';
  }
  const nodes = graph.filter((node): node is Record<string, unknown> => !!node && typeof node === 'object' && !Array.isArray(node));
  if (nodes.find((node) => node['@type'] === 'WebPage')?.url !== canonical) return 'JSON-LD WebPage url mismatch';
  if (breadcrumb) {
    const items = nodes.find((node) => node['@type'] === 'BreadcrumbList')?.itemListElement;
    const last: unknown = Array.isArray(items) ? items[items.length - 1] : undefined;
    if (!last || typeof last !== 'object' || (last as Record<string, unknown>).item !== canonical) return 'Missing JSON-LD breadcrumb';
  }
  return null;
}

export interface IndexExpectation {
  policy: IndexPolicy;
  /** The canonical URLs the page may declare: one per accepted origin, or exactly a sitemap loc. */
  canonicals: readonly string[];
  /** A detail page: its JSON-LD carries a BreadcrumbList ending at the canonical. */
  breadcrumb?: boolean;
}

/**
 * Why a page's head breaks its index policy, or null. Indexable: one canonical, an og:url equal
 * to it, the default og:image on the canonical's origin, a large-image Twitter card, no robots
 * meta, and one parseable JSON-LD block whose WebPage is the canonical, with no rating in it.
 * Noindex: `noindex, follow`, and no canonical, og:url or JSON-LD. Exported for the layout test.
 */
export function indexPolicyProblem(html: string, expectation: IndexExpectation): string | null {
  const tags = headTags(html);
  if (!tags) return 'Missing head';
  const canonicals = canonicalHrefs(tags);
  const ogUrls = metaContents(tags, 'og:url');
  const robots = metaContents(tags, 'robots');

  if (expectation.policy === 'noindex') {
    if (!robots.some((value) => value.trim().toLowerCase() === NOINDEX_ROBOTS)) return 'Missing noindex';
    if (canonicals.length > 0) return 'Canonical on a noindex page';
    if (ogUrls.length > 0) return 'og:url on a noindex page';
    if (tags.jsonLd.length > 0) return 'Structured data on a noindex page';
    return null;
  }

  if (canonicals.length === 0) return 'Missing canonical';
  if (canonicals.length > 1) return 'Multiple canonical links';
  const [canonical] = canonicals;
  if (!expectation.canonicals.includes(canonical)) return `Canonical mismatch: ${canonical}`;
  if (ogUrls.length !== 1 || ogUrls[0] !== canonical) return 'og:url mismatch';
  const image = metaContents(tags, 'og:image');
  const expectedImage = `${new URL(canonical).origin}${DEFAULT_OG_IMAGE.path}`;
  if (image.length !== 1 || image[0] !== expectedImage) return `og:image mismatch: ${image[0] ?? 'missing'}`;
  if (!metaContents(tags, 'twitter:card').includes('summary_large_image')) return 'Missing twitter:card summary_large_image';
  if (robots.length > 0) return 'Unexpected robots meta on an indexable page';
  if (tags.jsonLd.length !== 1) return 'Expected one JSON-LD block';
  return jsonLdProblem(tags.jsonLd[0], canonical, expectation.breadcrumb === true);
}

async function probeIndexPolicy(
  probe: IndexProbe,
  options: SmokeOptions,
  dependencies: SmokeDependencies,
): Promise<SmokeProbeResult> {
  const start = dependencies.now();
  const fetched = await fetchText(probe.path, HTML_TYPES, options, dependencies);
  if (isFailure(fetched)) {
    return result(probe.name, probe.path, start, dependencies.now, responseStatus(fetched), false, fetched.error);
  }
  const { response, body } = fetched;
  if (body === null) return verdict(probe.name, probe.path, start, dependencies.now, response.status, 'Expected HTML 200 response');
  const pathname = canonicalPath(new URL(probe.path, CANONICAL_ORIGIN).pathname);
  const problem = indexPolicyProblem(body, {
    policy: probe.index,
    canonicals: acceptedOrigins(options).map((origin) => `${origin}${pathname}`),
  });
  return verdict(probe.name, probe.path, start, dependencies.now, response.status, problem);
}

function pngProblem(bytes: Uint8Array): string | null {
  if (bytes.length >= OG_IMAGE_MAX_BYTES) return `Image too large: ${bytes.length} bytes`;
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return 'Not a PNG';
  // The first chunk is always IHDR: width then height, big-endian.
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return 'Not a PNG';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width !== DEFAULT_OG_IMAGE.width || height !== DEFAULT_OG_IMAGE.height) return `Wrong dimensions: ${width}x${height}`;
  return null;
}

async function probeOgImage(options: SmokeOptions, dependencies: SmokeDependencies): Promise<SmokeProbeResult> {
  const name = 'og-image';
  const path = DEFAULT_OG_IMAGE.path;
  const start = dependencies.now();
  const fetched = await requestWithTimeout(probeUrl(options, path), dependencies, options.requestTimeoutMs, async (response) =>
    isOkType(response, [DEFAULT_OG_IMAGE.type]) ? new Uint8Array(await response.arrayBuffer()) : null,
  );
  if (isFailure(fetched)) {
    return result(name, path, start, dependencies.now, responseStatus(fetched), false, fetched.error);
  }
  const { response, body } = fetched;
  if (response.status !== 200) return verdict(name, path, start, dependencies.now, response.status, 'Expected image 200 response');
  if (body === null) {
    return verdict(name, path, start, dependencies.now, response.status, `Expected ${DEFAULT_OG_IMAGE.type}, got ${contentType(response) || 'no content type'}`);
  }
  return verdict(name, path, start, dependencies.now, response.status, pngProblem(body));
}

function permissiveRobotsProblem(body: string, origins: readonly string[]): string | null {
  const lines = body.split('\n').map((line) => line.trim());
  if (!lines.includes('User-agent: *')) return 'Missing User-agent: *';
  if (lines.includes('Disallow: /')) return 'robots.txt disallows every crawler';
  if (!lines.includes('Allow: /')) return 'Missing Allow: /';
  const missing = ROBOTS_DISALLOWED_PREFIXES.find((prefix) => !lines.includes(`Disallow: ${prefix}`));
  if (missing !== undefined) return `Missing Disallow: ${missing}`;
  if (!origins.some((origin) => lines.includes(`Sitemap: ${origin}/sitemap.xml`))) return 'Missing Sitemap line';
  return null;
}

/** Production: the permissive file. Preview: disallow-all (not the canonical host). Local: either. */
async function probeRobots(options: SmokeOptions, dependencies: SmokeDependencies): Promise<SmokeProbeResult> {
  const name = 'robots';
  const path = '/robots.txt';
  const start = dependencies.now();
  const fetched = await fetchText(path, TEXT_TYPES, options, dependencies);
  if (isFailure(fetched)) {
    return result(name, path, start, dependencies.now, responseStatus(fetched), false, fetched.error);
  }
  const { response, body } = fetched;
  if (body === null) return verdict(name, path, start, dependencies.now, response.status, 'Expected text/plain 200 response');
  const text = body.replace(/\r\n/g, '\n');
  const disallowAll = text === DISALLOW_ALL_ROBOTS;
  if (options.environment === 'preview') {
    return verdict(name, path, start, dependencies.now, response.status, disallowAll ? null : 'Preview robots.txt must disallow every crawler');
  }
  if (disallowAll) {
    return options.environment === 'local'
      ? verdict(name, path, start, dependencies.now, response.status, null, 'Disallow-all: not the canonical host')
      : verdict(name, path, start, dependencies.now, response.status, 'Production robots.txt disallows every crawler');
  }
  return verdict(name, path, start, dependencies.now, response.status, permissiveRobotsProblem(text, acceptedOrigins(options)));
}

function xmlLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/g), (match) => decodeEntities(match[1]));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether `loc` is one of the accepted origins followed by a path matching `pathPattern`, and nothing else. */
function locMatches(loc: string, origins: readonly string[], pathPattern: string): boolean {
  return origins.some((origin) => new RegExp(`^${escapeRegExp(origin)}${pathPattern}$`).test(loc));
}

interface SitemapIndexOutcome {
  result: SmokeProbeResult;
  /** The first building chunk's path, fetched on the target origin even when its loc names production. */
  chunkPath: string | null;
}

async function probeSitemapIndex(options: SmokeOptions, dependencies: SmokeDependencies): Promise<SitemapIndexOutcome> {
  const name = 'sitemap-index';
  const path = '/sitemap.xml';
  const start = dependencies.now();
  const fetched = await fetchText(path, XML_TYPES, options, dependencies);
  if (isFailure(fetched)) {
    return { result: result(name, path, start, dependencies.now, responseStatus(fetched), false, fetched.error), chunkPath: null };
  }
  const { response, body } = fetched;
  const done = (problem: string | null, chunkPath: string | null = null): SitemapIndexOutcome => ({
    result: verdict(name, path, start, dependencies.now, response.status, problem),
    chunkPath,
  });
  if (body === null) return done('Expected XML 200 response');
  if (!body.includes('<sitemapindex')) return done('Not a sitemap index');
  const origins = acceptedOrigins(options);
  const locs = xmlLocs(body);
  const unexpected = locs.find((loc) => !locMatches(loc, origins, '/sitemaps/(static|buildings-[1-9]\\d*)\\.xml'));
  if (unexpected !== undefined) return done(`Unexpected sitemap loc: ${unexpected}`);
  if (!locs.some((loc) => loc.endsWith('/sitemaps/static.xml'))) return done('Missing static.xml');
  const chunk = locs.find((loc) => /\/sitemaps\/buildings-\d+\.xml$/.test(loc));
  if (chunk === undefined) {
    return { result: degradedVerdict(options, name, path, start, dependencies.now, response.status, SITEMAP_DEGRADED), chunkPath: null };
  }
  return done(null, new URL(chunk).pathname);
}

interface UrlsetOutcome {
  result: SmokeProbeResult;
  /** The first entity loc listed (a landlord in static.xml, a building in a chunk), for the page probe. */
  firstEntity: string | null;
}

async function probeStaticSitemap(options: SmokeOptions, dependencies: SmokeDependencies): Promise<UrlsetOutcome> {
  const name = 'sitemap-static';
  const path = '/sitemaps/static.xml';
  const start = dependencies.now();
  const fetched = await fetchText(path, XML_TYPES, options, dependencies);
  if (isFailure(fetched)) {
    return { result: result(name, path, start, dependencies.now, responseStatus(fetched), false, fetched.error), firstEntity: null };
  }
  const { response, body } = fetched;
  const origins = acceptedOrigins(options);
  const locs = body === null ? [] : xmlLocs(body);
  const firstEntity = locs.find((loc) => locMatches(loc, origins, `/landlord/${ENTITY_SLUG}`)) ?? null;
  const done = (problem: string | null): UrlsetOutcome => ({
    result: verdict(name, path, start, dependencies.now, response.status, problem),
    firstEntity,
  });
  if (body === null) return done('Expected XML 200 response');
  if (!body.includes('<urlset')) return done('Not a urlset');

  for (const loc of locs) {
    let url: URL;
    try {
      url = new URL(loc);
    } catch {
      return done(`Unexpected sitemap loc: ${loc}`);
    }
    if (url.search !== '' || url.hash !== '' || /[?#]/.test(loc)) return done(`Query or fragment in sitemap loc: ${loc}`);
    if (SITEMAP_PRIVATE_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      return done(`Private path in sitemap: ${url.pathname}`);
    }
    const isStatic = STATIC_SITEMAP_PATHS.some((staticPath) => origins.some((origin) => loc === `${origin}${staticPath}`));
    if (!isStatic && !locMatches(loc, origins, `/landlord/${ENTITY_SLUG}`)) return done(`Unexpected sitemap loc: ${loc}`);
  }
  const missing = STATIC_SITEMAP_PATHS.find((staticPath) => !origins.some((origin) => locs.includes(`${origin}${staticPath}`)));
  if (missing !== undefined) return done(`Missing static path: ${missing}`);
  if (firstEntity === null) {
    return { result: degradedVerdict(options, name, path, start, dependencies.now, response.status, 'Sitemap degraded: no landlord URLs'), firstEntity };
  }
  return done(null);
}

async function probeBuildingChunk(
  chunkPath: string | null,
  options: SmokeOptions,
  dependencies: SmokeDependencies,
): Promise<UrlsetOutcome> {
  const name = 'sitemap-buildings';
  const start = dependencies.now();
  if (chunkPath === null) {
    return { result: degradedVerdict(options, name, '/sitemaps/buildings-1.xml', start, dependencies.now, 0, 'No building chunk listed'), firstEntity: null };
  }
  // By path on the target: a preview's index names production's chunk URLs, and the probe is
  // about this deployment's response, not the live site's.
  const fetched = await fetchText(chunkPath, XML_TYPES, options, dependencies);
  if (isFailure(fetched)) {
    return { result: result(name, chunkPath, start, dependencies.now, responseStatus(fetched), false, fetched.error), firstEntity: null };
  }
  const { response, body } = fetched;
  const origins = acceptedOrigins(options);
  const locs = body === null ? [] : xmlLocs(body);
  const done = (problem: string | null, firstEntity: string | null = null): UrlsetOutcome => ({
    result: verdict(name, chunkPath, start, dependencies.now, response.status, problem),
    firstEntity,
  });
  if (body === null) return done('Expected XML 200 response');
  if (!body.includes('<urlset')) return done('Not a urlset');
  if (locs.length === 0) return done('Empty building chunk');
  const unexpected = locs.find((loc) => !locMatches(loc, origins, `/building/${ENTITY_SLUG}`));
  if (unexpected !== undefined) return done(`Unexpected sitemap loc: ${unexpected}`);
  return done(null, locs[0]);
}

/** The first page a sitemap lists, fetched on the target: indexable, and its canonical is exactly the loc. */
async function probeSitemapEntity(
  name: string,
  loc: string | null,
  placeholderPath: string,
  options: SmokeOptions,
  dependencies: SmokeDependencies,
): Promise<SmokeProbeResult> {
  const start = dependencies.now();
  if (loc === null) {
    return degradedVerdict(options, name, placeholderPath, start, dependencies.now, 0, `No ${placeholderPath.slice(1, -1)} URL listed`);
  }
  const path = new URL(loc).pathname;
  const fetched = await fetchText(path, HTML_TYPES, options, dependencies);
  if (isFailure(fetched)) {
    return result(name, path, start, dependencies.now, responseStatus(fetched), false, fetched.error);
  }
  const { response, body } = fetched;
  if (body === null) return verdict(name, path, start, dependencies.now, response.status, 'Expected HTML 200 response');
  return verdict(name, path, start, dependencies.now, response.status, indexPolicyProblem(body, { policy: 'indexable', canonicals: [loc], breadcrumb: true }));
}

export async function runSmoke(
  options: SmokeOptions,
  injected?: SmokeDependencies,
): Promise<SmokeProbeResult[]> {
  const dependencies = injected ?? DEFAULT_DEPENDENCIES;
  const deadline = dependencies.now() + options.waitForReleaseMs;
  const healthDeadline = options.waitForReleaseMs > 0 ? deadline : undefined;
  let health = await probeHealth(options, dependencies, healthDeadline);

  while (!health.result.ok && options.expectedRelease) {
    const remainingBudget = deadline - dependencies.now();
    if (options.waitForReleaseMs === 0 || remainingBudget <= 0) break;
    await sleepWithinBudget(dependencies, Math.min(10_000, remainingBudget));
    if (dependencies.now() >= deadline) break;
    health = await probeHealth(options, dependencies, deadline);
  }

  if (!health.result.ok) {
    if (options.expectedRelease) {
      const releaseDetail = 'expected ' + options.expectedRelease + ', actual ' + (health.release ?? 'unavailable');
      health.result.detail = health.result.detail === 'Release mismatch'
        ? 'Release mismatch: ' + releaseDetail
        : health.result.detail + '; ' + releaseDetail;
    }
    return [health.result];
  }

  const results: SmokeProbeResult[] = [health.result];
  for (const probe of HTML_PROBES) results.push(await probeHtml(probe, options, dependencies));
  for (const probe of PROTECTED_PROBES) results.push(await probeProtected(probe, options, dependencies));
  for (const probe of API_PROBES) results.push(await probeApi(probe, options, dependencies));

  // SEO-07, after every probe above so none of them changes.
  results.push(await probeOgImage(options, dependencies));
  results.push(await probeRobots(options, dependencies));
  for (const probe of INDEX_PROBES) results.push(await probeIndexPolicy(probe, options, dependencies));
  const sitemapIndex = await probeSitemapIndex(options, dependencies);
  const staticSitemap = await probeStaticSitemap(options, dependencies);
  const buildingChunk = await probeBuildingChunk(sitemapIndex.chunkPath, options, dependencies);
  results.push(sitemapIndex.result, staticSitemap.result, buildingChunk.result);
  results.push(await probeSitemapEntity('sitemap-building-page', buildingChunk.firstEntity, '/building/', options, dependencies));
  results.push(await probeSitemapEntity('sitemap-landlord-page', staticSitemap.firstEntity, '/landlord/', options, dependencies));
  return results;
}
