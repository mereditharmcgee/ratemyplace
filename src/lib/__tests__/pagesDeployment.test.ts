import { describe, expect, it, vi } from 'vitest';
import { resolvePagesDeploymentOrigin, type PagesDeploymentDependencies } from '../pagesDeployment';

const SHA = '3c0350327bef3ed8bf6afa34a3723294cf49b59d';
const ORIGIN = 'https://a1b2c3d4.ratemyplace-64y.pages.dev';

interface CheckRunFixture {
  app?: { slug?: unknown };
  name?: unknown;
  head_sha?: unknown;
  status?: unknown;
  conclusion?: unknown;
  output?: { summary?: unknown };
}

const apiResponse = (checkRuns: CheckRunFixture[], totalCount = checkRuns.length) => new Response(JSON.stringify({
  total_count: totalCount,
  check_runs: checkRuns,
}), { status: 200, headers: { 'content-type': 'application/json' } });

const trustedCheck = (overrides: CheckRunFixture = {}): CheckRunFixture => ({
  app: { slug: 'cloudflare-workers-and-pages' },
  name: 'Cloudflare Pages',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'success',
  output: { summary: `Deployment URL: ${ORIGIN}` },
  ...overrides,
});

const dependencies = (responses: Array<Response | Error>, start = 0): PagesDeploymentDependencies => {
  let now = start;
  return {
    fetch: vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    }),
    now: () => now,
    sleep: vi.fn(async (milliseconds: number) => { now += milliseconds; }),
  };
};

const resolve = (deps: PagesDeploymentDependencies, waitMs = 600_000) => resolvePagesDeploymentOrigin({
  repository: 'example/ratemyplace',
  sha: SHA,
  token: 'test-token',
  waitMs,
}, deps);

describe('resolvePagesDeploymentOrigin', () => {
  it('returns the single trusted immutable deployment origin for the requested SHA', async () => {
    await expect(resolve(dependencies([apiResponse([trustedCheck()])]))).resolves.toBe(ORIGIN);
  });

  it('selects the immutable URL from a trusted Pages summary that also advertises its branch alias', async () => {
    const summary = [
      'Preview URL: https://0d4541c6.ratemyplace-64y.pages.dev',
      'Branch Preview URL: https://codex-phase-22a-smoke-delive.ratemyplace-64y.pages.dev',
    ].join('\n');

    await expect(resolve(dependencies([apiResponse([trustedCheck({ output: { summary } })])]))).resolves.toBe(
      'https://0d4541c6.ratemyplace-64y.pages.dev',
    );
  });

  it('rejects a malformed branch alias even when the same summary has a valid immutable URL', async () => {
    const summary = `${ORIGIN} https://branch-.ratemyplace-64y.pages.dev`;

    await expect(resolve(dependencies([apiResponse([trustedCheck({ output: { summary } })])]))).rejects.toThrow(
      /invalid Pages hostname/i,
    );
  });

  it.each([
    ['missing trusted check', [apiResponse([]), apiResponse([trustedCheck()])]],
    ['queued trusted check', [apiResponse([trustedCheck({ status: 'queued', conclusion: null })]), apiResponse([trustedCheck()])]],
    ['in-progress trusted check', [apiResponse([trustedCheck({ status: 'in_progress', conclusion: null })]), apiResponse([trustedCheck()])]],
  ])('retries %s inside the wait budget', async (_name, responses) => {
    await expect(resolve(dependencies(responses), 20_000)).resolves.toBe(ORIGIN);
  });

  it('ignores untrusted checks while waiting for the Cloudflare Pages check', async () => {
    const untrusted = trustedCheck({ app: { slug: 'someone-else' } });
    await expect(resolve(dependencies([apiResponse([untrusted]), apiResponse([trustedCheck()])]), 20_000)).resolves.toBe(ORIGIN);
  });

  it.each([
    ['incomplete pagination', apiResponse([trustedCheck()], 2), /incomplete check-run pagination/i],
    ['wrong trusted head SHA', apiResponse([trustedCheck({ head_sha: 'a'.repeat(40) })]), /head SHA/i],
    ['unsuccessful completion', apiResponse([trustedCheck({ conclusion: 'failure' })]), /did not succeed/i],
    ['ambiguous trusted matches', apiResponse([trustedCheck(), trustedCheck()]), /multiple trusted/i],
    ['missing summary', apiResponse([trustedCheck({ output: {} })]), /missing check summary/i],
    ['malformed summary', apiResponse([trustedCheck({ output: { summary: 7 } })]), /malformed check summary/i],
    ['invalid project hostname', apiResponse([trustedCheck({ output: { summary: 'https://a1b2c3d4.wrong-project.pages.dev' } })]), /invalid Pages hostname/i],
    ['explicit default Pages port', apiResponse([trustedCheck({ output: { summary: 'https://a1b2c3d4.ratemyplace-64y.pages.dev:443' } })]), /invalid Pages hostname/i],
    ['wrong-project branch alias', apiResponse([trustedCheck({ output: { summary: 'https://codex-phase-22a-smoke-delive.wrong-project.pages.dev' } })]), /invalid Pages hostname/i],
    ['branch alias with explicit default port', apiResponse([trustedCheck({ output: { summary: 'https://codex-phase-22a-smoke-delive.ratemyplace-64y.pages.dev:443' } })]), /invalid Pages hostname/i],
    ['multiple deployment origins', apiResponse([trustedCheck({ output: { summary: `${ORIGIN} https://b2c3d4e5.ratemyplace-64y.pages.dev` } })]), /multiple immutable deployment origins/i],
  ])('fails closed for %s', async (_name, response, expected) => {
    await expect(resolve(dependencies([response]))).rejects.toThrow(expected);
  });

  it('fails safely when the GitHub API request fails', async () => {
    await expect(resolve(dependencies([new Error('network unavailable')]))).rejects.toThrow(/GitHub check-run request failed/i);
  });

  it('rejects a trusted response delivered after the resolver deadline', async () => {
    let now = 0;
    const delayedResponse: PagesDeploymentDependencies = {
      fetch: vi.fn(async () => {
        now = 11;
        return apiResponse([trustedCheck()]);
      }),
      now: () => now,
      sleep: vi.fn(async () => undefined),
    };

    await expect(resolve(delayedResponse, 10)).rejects.toThrow(/deadline/i);
  });

  it('aborts an unresolved GitHub request when the resolver deadline expires', async () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      let outcome: unknown;
      const unresolvedRequest: PagesDeploymentDependencies = {
        fetch: vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            now = 10;
            reject(new Error('request aborted'));
          });
        })),
        now: () => now,
        sleep: vi.fn(async () => undefined),
      };
      void resolve(unresolvedRequest, 10).then(
        () => { outcome = 'resolved'; },
        (error: unknown) => { outcome = error; },
      );

      await vi.advanceTimersByTimeAsync(10);

      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toMatch(/deadline/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['missing trusted head SHA', trustedCheck({ head_sha: undefined })],
    ['missing trusted status', trustedCheck({ status: undefined })],
  ])('fails immediately for %s', async (_name, malformedTrustedCheck) => {
    await expect(resolve(dependencies([apiResponse([malformedTrustedCheck])]), 10_000))
      .rejects.toThrow(/malformed trusted Cloudflare Pages check/i);
  });

  it('fails after the bounded deadline while a trusted check remains pending', async () => {
    const pending = apiResponse([trustedCheck({ status: 'queued', conclusion: null })]);
    await expect(resolve(dependencies([pending]), 10_000)).rejects.toThrow(/deadline/i);
  });
});
