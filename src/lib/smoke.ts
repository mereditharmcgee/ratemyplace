export type SmokeEnvironment = 'local' | 'preview' | 'production';

export interface SmokeConfig {
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

export interface SmokeResult {
  path: string;
  status: number;
  ok: boolean;
  durationMs: number;
  detail?: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;
const PREVIEW_HOST = /^[0-9a-f]{8}\.ratemyplace-64y\.pages\.dev$/;
const HTML_PATHS = ['/', '/about', '/contact', '/guidelines', '/map', '/methodology', '/privacy', '/search', '/terms', '/auth/signin', '/auth/signup'];
const PROTECTED_PATHS = ['/profile', '/review/new', '/admin'];
const API_PROBES = [
  { path: '/api/buildings?q=__rmp_smoke_no_match__', status: 200, key: 'buildings' },
  { path: '/api/reviews/user', status: 401, key: 'error' },
  { path: '/api/admin/reviews?limit=1', status: 401, key: 'error' },
];
const ERROR_SENTINELS = ['Internal Server Error', 'Application error', '500 Error'];
const DEFAULT_DEPENDENCIES: SmokeDependencies = {
  fetch,
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function parseMilliseconds(value: string, flag: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be an integer`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) throw new Error(`${flag} must be between ${minimum} and ${maximum}`);
  return parsed;
}

export function validateSmokeTarget(environment: SmokeEnvironment, value: string): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error('Invalid --base-url');
  }
  const rawTarget = value.slice(value.indexOf('//') + 2);
  const suffixIndex = rawTarget.search(/[/?#]/);
  const authority = suffixIndex === -1 ? rawTarget : rawTarget.slice(0, suffixIndex);
  const rawPath = suffixIndex === -1 || rawTarget[suffixIndex] !== '/'
    ? ''
    : rawTarget.slice(suffixIndex).split(/[?#]/, 1)[0];
  if (target.username || target.password || target.hash || target.search || target.pathname !== '/' || (rawPath !== '' && rawPath !== '/')) {
    throw new Error('--base-url must be an origin without credentials, path, query, or fragment');
  }
  const hasExplicitPort = /:\d+$/.test(authority);
  const isProduction = target.protocol === 'https:' && target.hostname === 'ratemyplace.org' && target.port === '' && !hasExplicitPort;
  const isPreview = target.protocol === 'https:' && target.port === '' && !hasExplicitPort && PREVIEW_HOST.test(target.hostname);
  const isLocal = (target.protocol === 'http:' || target.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if ((environment === 'production' && !isProduction) ||
      (environment === 'preview' && !isPreview) ||
      (environment === 'local' && !isLocal)) throw new Error(`Invalid ${environment} --base-url`);
  return target;
}

export function parseSmokeArgs(args: string[]): SmokeConfig {
  const values = new Map<string, string>();
  const flags = new Set(['--environment', '--base-url', '--expected-release', '--wait-for-release-ms', '--request-timeout-ms']);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!flags.has(flag)) throw new Error(`Unknown argument: ${flag}`);
    if (values.has(flag)) throw new Error(`Duplicate ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
  }
  const environment = values.get('--environment');
  if (!environment) throw new Error('Missing --environment');
  if (environment !== 'local' && environment !== 'preview' && environment !== 'production') throw new Error('--environment must be local, preview, or production');
  const baseUrl = values.get('--base-url');
  if (!baseUrl) throw new Error('Missing --base-url');
  const expectedRelease = values.get('--expected-release');
  if (environment !== 'local' && !expectedRelease) throw new Error('Missing --expected-release');
  if (expectedRelease && !FULL_SHA.test(expectedRelease)) throw new Error('--expected-release must be a 40-character hexadecimal SHA');
  return {
    environment,
    baseUrl: validateSmokeTarget(environment, baseUrl),
    expectedRelease: expectedRelease?.toLowerCase(),
    waitForReleaseMs: values.has('--wait-for-release-ms') ? parseMilliseconds(values.get('--wait-for-release-ms') ?? '', '--wait-for-release-ms', 0, 600_000) : 0,
    requestTimeoutMs: values.has('--request-timeout-ms') ? parseMilliseconds(values.get('--request-timeout-ms') ?? '', '--request-timeout-ms', 1_000, 30_000) : 10_000,
  };
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function result(path: string, start: number, now: () => number, status: number, ok: boolean, detail?: string): SmokeResult {
  return { path, status, ok, durationMs: Math.max(0, now() - start), ...(detail ? { detail } : {}) };
}

async function fetchWithTimeout(url: URL, config: SmokeConfig, dependencies: SmokeDependencies, timeoutMs = config.requestTimeoutMs): Promise<{ response?: Response; error?: 'Request timed out' | 'Request failed' }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { response: await dependencies.fetch(url, { cache: 'no-store', redirect: 'manual', signal: controller.signal }) };
  } catch {
    return { error: controller.signal.aborted ? 'Request timed out' : 'Request failed' };
  } finally {
    clearTimeout(timeout);
  }
}

function probeUrl(config: SmokeConfig, path: string): URL {
  return new URL(path, config.baseUrl);
}

interface HealthCheck { result: SmokeResult; release?: string; }

async function probeHealth(config: SmokeConfig, dependencies: SmokeDependencies, deadline?: number): Promise<HealthCheck> {
  const path = '/api/health';
  const start = dependencies.now();
  const remainingBudget = deadline === undefined ? undefined : deadline - start;
  if (remainingBudget !== undefined && remainingBudget <= 0) {
    return { result: result(path, start, dependencies.now, 0, false, 'Release wait deadline reached') };
  }
  const timeoutMs = remainingBudget === undefined
    ? config.requestTimeoutMs
    : Math.max(1, Math.min(config.requestTimeoutMs, remainingBudget));
  const fetched = await fetchWithTimeout(probeUrl(config, path), config, dependencies, timeoutMs);
  if (!fetched.response) return { result: result(path, start, dependencies.now, 0, false, fetched.error) };
  const { response } = fetched;
  if (response.status !== 200 || isRedirect(response.status) || !isJson(response)) return { result: result(path, start, dependencies.now, response.status, false, 'Expected health JSON response') };
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { result: result(path, start, dependencies.now, response.status, false, 'Malformed health response') };
    const health = body as { status?: unknown; release?: unknown };
    if (health.status !== 'ok' || typeof health.release !== 'string') return { result: result(path, start, dependencies.now, response.status, false, 'Malformed health response') };
    const matches = !config.expectedRelease || health.release === config.expectedRelease;
    return { result: result(path, start, dependencies.now, response.status, matches, matches ? undefined : 'Release mismatch'), release: health.release };
  } catch {
    return { result: result(path, start, dependencies.now, response.status, false, 'Malformed health response') };
  }
}

async function probeHtml(path: string, config: SmokeConfig, dependencies: SmokeDependencies): Promise<SmokeResult> {
  const start = dependencies.now();
  const fetched = await fetchWithTimeout(probeUrl(config, path), config, dependencies);
  if (!fetched.response) return result(path, start, dependencies.now, 0, false, fetched.error);
  const { response } = fetched;
  if (response.status !== 200 || isRedirect(response.status) || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) return result(path, start, dependencies.now, response.status, false, 'Expected HTML 200 response');
  if (path === '/') {
    const requiredHeaders: Array<[string, string?]> = [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['content-security-policy'], ['referrer-policy']];
    if (requiredHeaders.some(([name, expected]) => {
      const actual = response.headers.get(name);
      return !actual || (expected !== undefined && actual.toLowerCase() !== expected.toLowerCase());
    })) return result(path, start, dependencies.now, response.status, false, 'Missing required security header');
  }
  try {
    const body = await response.text();
    const isDocument = /<!doctype html/i.test(body) && /<html[\s>]/i.test(body);
    if (!isDocument || ERROR_SENTINELS.some((sentinel) => body.includes(sentinel))) return result(path, start, dependencies.now, response.status, false, 'Invalid HTML response');
    return result(path, start, dependencies.now, response.status, true);
  } catch {
    return result(path, start, dependencies.now, response.status, false, 'Unable to read HTML response');
  }
}

async function probeProtected(path: string, config: SmokeConfig, dependencies: SmokeDependencies): Promise<SmokeResult> {
  const start = dependencies.now();
  const fetched = await fetchWithTimeout(probeUrl(config, path), config, dependencies);
  if (!fetched.response) return result(path, start, dependencies.now, 0, false, fetched.error);
  const { response } = fetched;
  const location = response.headers.get('location');
  if (!isRedirect(response.status) || !location) return result(path, start, dependencies.now, response.status, false, 'Expected sign-in redirect');
  try {
    const destination = new URL(location, config.baseUrl);
    const allowed = destination.origin === config.baseUrl.origin && destination.pathname === '/auth/signin';
    return result(path, start, dependencies.now, response.status, allowed, allowed ? undefined : 'Invalid sign-in redirect');
  } catch {
    return result(path, start, dependencies.now, response.status, false, 'Invalid sign-in redirect');
  }
}

async function probeApi(probe: { path: string; status: number; key: string }, config: SmokeConfig, dependencies: SmokeDependencies): Promise<SmokeResult> {
  const start = dependencies.now();
  const fetched = await fetchWithTimeout(probeUrl(config, probe.path), config, dependencies);
  if (!fetched.response) return result(probe.path, start, dependencies.now, 0, false, fetched.error);
  const { response } = fetched;
  if (response.status !== probe.status || isRedirect(response.status) || !isJson(response)) return result(probe.path, start, dependencies.now, response.status, false, 'Expected JSON API response');
  try {
    const body: unknown = await response.json();
    const valid = !!body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, probe.key);
    return result(probe.path, start, dependencies.now, response.status, valid, valid ? undefined : 'Malformed API response');
  } catch {
    return result(probe.path, start, dependencies.now, response.status, false, 'Malformed API response');
  }
}

export async function runSmoke(config: SmokeConfig, injected?: SmokeDependencies): Promise<SmokeResult[]> {
  const dependencies = injected ?? DEFAULT_DEPENDENCIES;
  const deadline = dependencies.now() + config.waitForReleaseMs;
  const healthDeadline = config.waitForReleaseMs > 0 ? deadline : undefined;
  let health = await probeHealth(config, dependencies, healthDeadline);
  while (!health.result.ok && config.expectedRelease) {
    const remainingBudget = deadline - dependencies.now();
    if (config.waitForReleaseMs === 0 || remainingBudget <= 0) break;
    await dependencies.sleep(Math.min(10_000, remainingBudget));
    if (dependencies.now() >= deadline) break;
    health = await probeHealth(config, dependencies, deadline);
  }
  if (!health.result.ok) {
    if (config.expectedRelease) health.result.detail = `Release mismatch: expected ${config.expectedRelease}, actual ${health.release ?? 'unavailable'}`;
    return [health.result];
  }
  const results: SmokeResult[] = [health.result];
  for (const path of HTML_PATHS) results.push(await probeHtml(path, config, dependencies));
  for (const path of PROTECTED_PATHS) results.push(await probeProtected(path, config, dependencies));
  for (const probe of API_PROBES) results.push(await probeApi(probe, config, dependencies));
  return results;
}
