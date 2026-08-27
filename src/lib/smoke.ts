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
  const rawTarget = RAW_TARGET.exec(value);
  if (!rawTarget) {
    throw new Error('--base-url must be an origin without credentials, path, query, or fragment');
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
  const fetched = await requestWithTimeout(
    probeUrl(options, probe.path),
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
    const destination = new URL(location, options.baseUrl);
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
  return results;
}
