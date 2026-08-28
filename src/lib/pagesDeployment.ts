import { validateSmokeTarget } from './smoke';

const API_ORIGIN = 'https://api.github.com';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MAX_WAIT_MS = 600_000;
const RETRY_INTERVAL_MS = 10_000;
const TRUSTED_APP_SLUG = 'cloudflare-workers-and-pages';
const TRUSTED_CHECK_NAME = 'Cloudflare Pages';
const URL_IN_SUMMARY = /https:\/\/[^\s<>()[\]{}"']+/gi;

export interface PagesDeploymentOptions {
  repository: string;
  sha: string;
  token: string;
  waitMs: number;
}

export interface PagesDeploymentDependencies {
  fetch: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

interface CheckRun {
  appSlug: string;
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  summary: unknown;
}

interface CheckRunsPage {
  totalCount: number;
  checkRuns: CheckRun[];
  hasMalformedTrustedCheck: boolean;
}

interface MalformedTrustedCheck {
  malformedTrustedCheck: true;
}

const defaultDependencies: PagesDeploymentDependencies = {
  fetch,
  now: Date.now,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;

function parseCheckRun(value: unknown): CheckRun | MalformedTrustedCheck | undefined {
  if (!isRecord(value) || !isRecord(value.app)) return undefined;
  const appSlug = optionalString(value.app.slug);
  const name = optionalString(value.name);
  const headSha = optionalString(value.head_sha);
  const status = optionalString(value.status);
  const conclusion = value.conclusion === null ? null : optionalString(value.conclusion);
  const output = isRecord(value.output) ? value.output : undefined;
  const identifiesTrustedCheck = appSlug === TRUSTED_APP_SLUG && name === TRUSTED_CHECK_NAME;
  if (!appSlug || !name || !headSha || !status || conclusion === undefined) {
    return identifiesTrustedCheck ? { malformedTrustedCheck: true } : undefined;
  }
  return { appSlug, name, headSha, status, conclusion, summary: output?.summary };
}

function parseCheckRunsPage(value: unknown): CheckRunsPage {
  if (!isRecord(value) || !Number.isInteger(value.total_count) || (value.total_count as number) < 0 || !Array.isArray(value.check_runs)) {
    throw new Error('Malformed GitHub check-run response');
  }
  const parsedCheckRuns = value.check_runs.map(parseCheckRun);
  const checkRuns = parsedCheckRuns.filter((run): run is CheckRun => run !== undefined && !('malformedTrustedCheck' in run));
  if ((value.total_count as number) > value.check_runs.length) {
    throw new Error('Incomplete check-run pagination');
  }
  return {
    totalCount: value.total_count as number,
    checkRuns,
    hasMalformedTrustedCheck: parsedCheckRuns.some((run) => run !== undefined && 'malformedTrustedCheck' in run),
  };
}

function validateOptions(options: PagesDeploymentOptions): void {
  if (!REPOSITORY.test(options.repository)) throw new Error('Invalid repository');
  if (!FULL_SHA.test(options.sha)) throw new Error('Invalid commit SHA');
  if (!options.token) throw new Error('Missing GITHUB_TOKEN');
  if (!Number.isInteger(options.waitMs) || options.waitMs < 0 || options.waitMs > MAX_WAIT_MS) {
    throw new Error('Wait must be an integer between 0 and 600000 milliseconds');
  }
}

async function fetchCheckRuns(
  options: PagesDeploymentOptions,
  dependencies: PagesDeploymentDependencies,
  deadline: number,
): Promise<CheckRunsPage> {
  const remaining = deadline - dependencies.now();
  if (remaining <= 0) throw new Error('Trusted Cloudflare Pages check deadline reached');
  const url = new URL(`/repos/${options.repository}/commits/${options.sha}/check-runs?per_page=100`, API_ORIGIN);
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = (async (): Promise<CheckRunsPage> => {
    let response: Response;
    try {
      response = await dependencies.fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${options.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
    } catch {
      throw new Error('GitHub check-run request failed');
    }
    if (!response.ok) throw new Error('GitHub check-run request failed');
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('Malformed GitHub check-run response');
    }
    return parseCheckRunsPage(body);
  })();
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('Trusted Cloudflare Pages check deadline reached'));
    }, remaining);
  });

  try {
    const page = await Promise.race([request, timeout]);
    if (dependencies.now() >= deadline) throw new Error('Trusted Cloudflare Pages check deadline reached');
    return page;
  } catch (error) {
    if (timedOut) throw new Error('Trusted Cloudflare Pages check deadline reached');
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isTrusted(run: CheckRun): boolean {
  return run.appSlug === TRUSTED_APP_SLUG && run.name === TRUSTED_CHECK_NAME;
}

function extractOrigin(summary: unknown): string {
  if (summary === undefined) throw new Error('Missing check summary');
  if (typeof summary !== 'string') throw new Error('Malformed check summary');
  if (!summary.trim()) throw new Error('Malformed check summary');

  const origins = new Set<string>();
  for (const match of summary.matchAll(URL_IN_SUMMARY)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      throw new Error('Malformed check summary');
    }
    if (!url.hostname.endsWith('.pages.dev')) continue;
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('Malformed Pages deployment origin');
    }
    try {
      origins.add(validateSmokeTarget('preview', match[0]).origin);
    } catch {
      throw new Error('Invalid Pages hostname');
    }
  }
  if (origins.size === 0) throw new Error('Missing immutable Pages deployment origin');
  if (origins.size > 1) throw new Error('Multiple immutable deployment origins');
  return [...origins][0];
}

function resolvePage(page: CheckRunsPage, sha: string): { origin?: string; retry: boolean } {
  if (page.hasMalformedTrustedCheck) throw new Error('Malformed trusted Cloudflare Pages check');
  const trusted = page.checkRuns.filter(isTrusted);
  if (trusted.some((run) => run.headSha.toLowerCase() !== sha.toLowerCase())) {
    throw new Error('Trusted Cloudflare Pages check has the wrong head SHA');
  }
  if (trusted.length === 0) return { retry: true };
  if (trusted.length > 1) throw new Error('Multiple trusted Cloudflare Pages checks found');

  const [check] = trusted;
  if (check.status === 'queued' || check.status === 'in_progress') return { retry: true };
  if (check.status !== 'completed') throw new Error('Trusted Cloudflare Pages check has an invalid status');
  if (check.conclusion !== 'success') throw new Error('Trusted Cloudflare Pages check did not succeed');
  return { origin: extractOrigin(check.summary), retry: false };
}

export async function resolvePagesDeploymentOrigin(
  options: PagesDeploymentOptions,
  injected?: PagesDeploymentDependencies,
): Promise<string> {
  validateOptions(options);
  const dependencies = injected ?? defaultDependencies;
  const deadline = dependencies.now() + options.waitMs;

  while (true) {
    const resolved = resolvePage(await fetchCheckRuns(options, dependencies, deadline), options.sha);
    if (resolved.origin) return resolved.origin;
    const remaining = deadline - dependencies.now();
    if (!resolved.retry || remaining <= 0) throw new Error('Trusted Cloudflare Pages check deadline reached');
    await dependencies.sleep(Math.min(RETRY_INTERVAL_MS, remaining));
    if (dependencies.now() >= deadline) throw new Error('Trusted Cloudflare Pages check deadline reached');
  }
}
