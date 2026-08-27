# Phase 22A Release Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make type-checking and tests mandatory before merge, expose a minimal non-sensitive deployed-release health contract, and replace the unsafe implicit smoke target with a deterministic read-only suite that verifies the exact deployed commit.

**Architecture:** Cloudflare Pages remains the only deployer. A stable GitHub Actions `quality` job verifies every pull request and `main` push. For each qualifying internal `main` completion, a second workflow runs a non-cancellable `sentinel` job that explicitly fails red for unsuccessful quality or explicitly passes when quality succeeds; a separate success-only `smoke` job needs that sentinel and alone owns cancellable `production-smoke` concurrency while it polls a cookie-free public release endpoint until Pages serves the same commit SHA before executing the read-only smoke contract. The Pages build injects a sanitized release constant explicitly through Vite `define`; the smoke runner accepts only an explicit environment, allowlisted origin, and—for non-local targets—40-character release SHA, so it cannot silently hit an obsolete preview or mistake the previous production release for the new one.

**Tech Stack:** Astro 5 SSR, TypeScript strict mode, Cloudflare Pages, GitHub Actions, Node.js 22.16.0, Vitest 4, native `fetch`.

**Spec:** `docs/superpowers/specs/2026-08-26-trust-density-design.md` — Phase 22 CI/deploy path and initial public release/health contract; requirements SAFE-01, SAFE-02, SAFE-03, SAFE-06, and only the minimal public-health slice of SAFE-09.

## Global Constraints

- Work on `codex/phase-22a-release-safety` from the approved planning baseline; do not implement on `main`.
- Do not stage, edit, or delete the pre-existing untracked `src/pages/api/admin/verification/[id] (1).ts`.
- Cloudflare Pages Git integration remains the sole deployer. No workflow may call `wrangler pages deploy`, use a Cloudflare API token, or mutate D1/R2.
- The public health route handler returns only `{ status, release }` and performs no D1 work, rate-limit write, authentication, provider call, or operational-detail query. Cookie-free monitor/smoke requests take the existing middleware's no-session path and therefore make no Lucia/D1 query; callers that deliberately present a session cookie may still trigger the global session lookup, and this plan makes no broader D1-health claim.
- Smoke is read-only. It does not submit Turnstile forms, create data, exercise Google Places/Maps, or follow an admin/auth redirect and call the destination a pass.
- Do not add sitemap, robots, canonical, or social-image checks before Phase 29.
- `quality` is the stable required-check name. Renaming it is a repository-rules change and requires the same explicit review as changing the ruleset.
- Pushing the branch/opening a PR, activating the `main` ruleset, merging, and any rollback are separate action-time approval gates. No task below implies approval for the next external action.
- SAFE-09 remains open after this sub-release: counters, alert outbox, machine-only ops health, webhook delivery, and the maintenance Worker are Phase 22B.

---

## Current Source Map

| File | Current behavior | Phase 22A responsibility |
|---|---|---|
| `package.json` | Has build/test/smoke scripts, but no `check` | Add `check: astro check`; keep existing commands intact |
| `.node-version` | Absent; local Node is 24 while current Pages v3 default is 22.16.0 | Pin one version used by Pages and GitHub Actions |
| `.github/` | Absent | Add least-privilege CI and post-deploy smoke workflows |
| `scripts/smoke-test.ts` | Defaults to an obsolete preview URL, follows redirects, checks mutable copy, has no timeout/API/release/health assertions | Reduce to a CLI adapter over tested library code |
| `astro.config.mjs` | Does not inject a release constant | Read the Pages build variable, sanitize it, and inject one server build constant through Vite `define` |
| `src/lib/release.ts` | Absent | Validate and expose the explicitly injected Pages commit SHA |
| `src/lib/health.ts` | Absent | Build the narrow typed public health payload |
| `src/pages/api/health.ts` | Absent | Return no-store JSON without touching D1 |
| `src/lib/smoke.ts` | Absent | Own argument/target validation, probes, timeouts, release wait, and response assertions |
| `src/env.d.ts` | Types Cloudflare runtime bindings only | Type the single injected build-release constant used by server code |
| `AGENTS.md`, `README.md`, `.planning/codebase/INTEGRATIONS.md` | Document test/build but say no CI and omit `check` | Document the new verified behavior |

## Interfaces Locked by This Plan

```typescript
// src/lib/release.ts
export function normalizeReleaseId(value: unknown, fallback: 'development' | 'unknown'): string;
export const RELEASE_ID: string;

// src/lib/health.ts
export interface PublicHealth {
  status: 'ok';
  release: string;
}
export function buildPublicHealth(release?: string): PublicHealth;

// src/lib/smoke.ts
export type SmokeEnvironment = 'local' | 'preview' | 'production';
export interface SmokeOptions {
  environment: SmokeEnvironment;
  baseUrl: URL;
  expectedRelease?: string;
  waitForReleaseMs: number;
  requestTimeoutMs: number;
}
export interface SmokeProbeResult {
  name: string;
  path: string;
  status: number;
  ok: boolean;
  detail: string;
  durationMs: number;
}
export function parseSmokeArgs(args: string[]): SmokeOptions;
export function validateSmokeTarget(environment: SmokeEnvironment, value: string): URL;
export function runSmoke(options: SmokeOptions, dependencies?: SmokeDependencies): Promise<SmokeProbeResult[]>;
```

The release SHA source order at build time is `CF_PAGES_COMMIT_SHA`, then `GITHUB_SHA`. `astro.config.mjs` accepts only exactly 40 hexadecimal characters, normalizes the value to lowercase, and injects `__RMP_BUILD_RELEASE_ID__` with Vite `define`; it does not broaden `envPrefix` or expose environment objects. Local development falls back to `development`; a production-mode build without a valid SHA exposes `unknown`, which deliberately cannot satisfy post-deploy commit matching.

---

## Task 1: Pin the build runtime and add the type-check command

**Files:**

- Create: `.node-version`
- Modify: `package.json`

- [ ] **Step 1: Prove the command is currently absent**

Run:

```powershell
npm run check
```

Expected: FAIL with `Missing script: "check"`.

- [ ] **Step 2: Add the Node pin**

Create `.node-version` with exactly:

```text
22.16.0
```

This matches the current Cloudflare Pages v3 build-image default and is recognized by Pages. Re-verify the supported version immediately before implementation against Cloudflare's official build-image documentation: <https://developers.cloudflare.com/pages/configuration/build-image/>.

- [ ] **Step 3: Add the package script**

In `package.json`, add this script next to `build`:

```json
"check": "astro check"
```

Do not add a dependency: `@astrojs/check` is already installed and locked.

- [ ] **Step 4: Run the new gate**

Run:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; npm run check
```

Expected: PASS with 0 errors. The orientation baseline on 2026-08-27 reported 22 non-failing hints; hint cleanup is not part of this release.

- [ ] **Step 5: Commit the isolated foundation**

```powershell
git add .node-version package.json
git commit -m "chore: add type-check release gate"
```

---

## Task 2: Add a build-time release identifier and public health contract

**Files:**

- Modify: `astro.config.mjs`
- Modify: `src/env.d.ts`
- Create: `src/lib/release.ts`
- Create: `src/lib/health.ts`
- Create: `src/pages/api/health.ts`
- Create: `src/lib/__tests__/release.test.ts`
- Create: `src/lib/__tests__/health.test.ts`

- [ ] **Step 1: Write failing release normalization tests**

Create `src/lib/__tests__/release.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { normalizeReleaseId } from '../release';

describe('normalizeReleaseId', () => {
  const sha = 'A'.repeat(40);

  it('accepts only a full hexadecimal commit SHA and lowercases it', () => {
    expect(normalizeReleaseId(sha, 'unknown')).toBe('a'.repeat(40));
  });

  it.each([undefined, null, '', 'abc123', 'g'.repeat(40), 'a'.repeat(41)])(
    'uses the explicit fallback for %j',
    (value) => {
      expect(normalizeReleaseId(value, 'unknown')).toBe('unknown');
    }
  );

  it('supports both declared safe fallbacks', () => {
    expect(normalizeReleaseId(undefined, 'development')).toBe('development');
    expect(normalizeReleaseId(undefined, 'unknown')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Write failing health payload and route tests**

Create `src/lib/__tests__/health.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildPublicHealth } from '../health';
import { GET, HEAD } from '../../pages/api/health';

describe('public health contract', () => {
  it('contains only generic status and release', () => {
    expect(buildPublicHealth('a'.repeat(40))).toEqual({
      status: 'ok',
      release: 'a'.repeat(40),
    });
  });

  it('returns no-store JSON without internal fields', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(['release', 'status']);
    expect(body.status).toBe('ok');
    expect(typeof body.release).toBe('string');
  });

  it('supports a bodyless HEAD probe with the same cache policy', async () => {
    const response = await HEAD();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});
```

- [ ] **Step 3: Run the tests to prove the modules are missing**

Run:

```powershell
npm test -- release health
```

Expected: FAIL because `release`, `health`, and `/api/health` do not exist.

- [ ] **Step 4: Type the injected build constant**

Add to `src/env.d.ts`, outside the `App` namespace:

```typescript
declare const __RMP_BUILD_RELEASE_ID__: string;
```

- [ ] **Step 5: Inject a sanitized build-time release constant**

In `astro.config.mjs`, before `defineConfig`, add:

```javascript
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const releaseCandidate =
  process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '';
const buildReleaseId = COMMIT_SHA.test(releaseCandidate.trim())
  ? releaseCandidate.trim().toLowerCase()
  : 'unknown';
```

Add this property to the existing `vite` object without changing its plugins or watcher configuration:

```javascript
define: {
  __RMP_BUILD_RELEASE_ID__: JSON.stringify(buildReleaseId),
},
```

Cloudflare supplies `CF_PAGES_COMMIT_SHA` to the Pages **build** environment, while Astro 5 private SSR environment references are not a reliable way to preserve a build-only value in the deployed Worker. Vite `define` performs an explicit build replacement. Do not add `envPrefix`, inject `process.env`, or make the value client-readable. Official references: <https://developers.cloudflare.com/pages/configuration/build-configuration/> and <https://vite.dev/config/shared-options.html#define>.

- [ ] **Step 6: Implement release normalization**

Create `src/lib/release.ts`:

```typescript
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function normalizeReleaseId(
  value: unknown,
  fallback: 'development' | 'unknown'
): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return COMMIT_SHA.test(normalized) ? normalized : fallback;
}

const injectedRelease = typeof __RMP_BUILD_RELEASE_ID__ === 'string'
  ? __RMP_BUILD_RELEASE_ID__
  : undefined;

export const RELEASE_ID = normalizeReleaseId(
  injectedRelease,
  import.meta.env.DEV ? 'development' : 'unknown'
);
```

The `typeof` guard keeps direct Vitest imports safe because `vitest.config.ts` intentionally uses `configFile: false` and therefore does not inherit `astro.config.mjs`; the built Worker still receives the explicit replacement. Do not add the release constant to the general Vitest config, because the built-Worker proof below is the authoritative injection test.

- [ ] **Step 7: Implement the typed payload and thin route**

Create `src/lib/health.ts`:

```typescript
import { RELEASE_ID } from './release';

export interface PublicHealth {
  status: 'ok';
  release: string;
}

export function buildPublicHealth(release: string = RELEASE_ID): PublicHealth {
  return { status: 'ok', release };
}
```

Create `src/pages/api/health.ts`:

```typescript
import { buildPublicHealth } from '../../lib/health';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const;

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify(buildPublicHealth()), {
    status: 200,
    headers,
  });
}

export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 200, headers });
}
```

This public, input-free GET/HEAD endpoint deliberately has no application rate-limit row: making the cookie-free release probe depend on D1 would defeat its purpose and would persist another IP-derived key immediately before Phase 23 replaces that pattern. Task 5 records this one exact route as a narrow exception in `AGENTS.md`; it does not weaken the checklist for any other public endpoint. Cloudflare's ordinary edge protections remain in front of the route, and any future custom edge rate rule remains a separately approved configuration action.

- [ ] **Step 8: Verify targeted behavior and type-checking**

Run:

```powershell
npm test -- release health
$env:ASTRO_TELEMETRY_DISABLED='1'; npm run check
```

Expected: targeted tests PASS; check reports 0 errors.

- [ ] **Step 9: Prove the injected SHA through a built Worker**

In terminal A, build with a known 40-character fixture and start the local Worker:

```powershell
$syntheticRelease = '0123456789abcdef0123456789abcdef01234567'
$previousCloudflareSha = $env:CF_PAGES_COMMIT_SHA
try {
  $env:CF_PAGES_COMMIT_SHA = $syntheticRelease
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic-release build failed' }
} finally {
  if ($null -eq $previousCloudflareSha) {
    Remove-Item Env:CF_PAGES_COMMIT_SHA
  } else {
    $env:CF_PAGES_COMMIT_SHA = $previousCloudflareSha
  }
}
npx wrangler pages dev ./dist --port 8788
```

In terminal B, make a cookie-free request and assert the exact compiled value:

```powershell
$syntheticRelease = '0123456789abcdef0123456789abcdef01234567'
$health = Invoke-RestMethod -Uri http://127.0.0.1:8788/api/health
if ($health.status -ne 'ok' -or $health.release -ne $syntheticRelease) {
  throw 'Built Worker did not expose the injected release SHA'
}
```

Expected: the assertion is silent and successful. Stop terminal A after the probe. This is required evidence; a unit test that imports `release.ts` is not a substitute for proving the built Worker contains the Pages build value.

- [ ] **Step 10: Commit**

```powershell
git add astro.config.mjs src/env.d.ts src/lib/release.ts src/lib/health.ts src/pages/api/health.ts src/lib/__tests__/release.test.ts src/lib/__tests__/health.test.ts
git commit -m "feat: add public release health contract"
```

---

## Task 3: Replace the implicit smoke target with a tested explicit contract

**Files:**

- Create: `src/lib/smoke.ts`
- Create: `src/lib/__tests__/smoke.test.ts`
- Modify: `scripts/smoke-test.ts`

- [ ] **Step 1: Write failing argument and origin tests**

Create `src/lib/__tests__/smoke.test.ts` and cover these exact cases:

```typescript
import { describe, expect, it, vi } from 'vitest';
import {
  parseSmokeArgs,
  runSmoke,
  validateSmokeTarget,
  type SmokeDependencies,
} from '../smoke';

describe('smoke target authority', () => {
  it('has no implicit target', () => {
    expect(() => parseSmokeArgs([])).toThrow('Missing --environment');
  });

  it('accepts only the canonical production origin', () => {
    expect(validateSmokeTarget('production', 'https://ratemyplace.org').origin)
      .toBe('https://ratemyplace.org');
    expect(() => validateSmokeTarget('production', 'https://example.com')).toThrow();
    expect(() => validateSmokeTarget('production', 'https://ratemyplace.org/search')).toThrow();
  });

  it('restricts preview to this Pages project', () => {
    expect(validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev').hostname)
      .toBe('1a2b3c4d.ratemyplace-64y.pages.dev');
    expect(() => validateSmokeTarget('preview', 'https://ratemyplace-64y.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://codex-phase-22a.ratemyplace-64y.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://attacker.pages.dev')).toThrow();
    expect(() => validateSmokeTarget('preview', 'https://1a2b3c4d.ratemyplace-64y.pages.dev:8443')).toThrow();
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
});
```

Also test the injected runner:

- a redirect to `/` or another origin fails protected-route validation;
- a same-origin `/auth/signin?...` redirect passes;
- any redirect from an ordinary public, API, or health probe fails rather than being followed;
- release mismatch fails after the configured wait budget;
- a 500, missing security header, non-JSON API response, or HTML error sentinel yields a failed probe;
- all expected responses produce only successful results;
- the request timeout aborts a hanging fetch;
- `waitForReleaseMs` is bounded to 600,000 and `requestTimeoutMs` to 30,000.

Use a fake `fetch` and fake `sleep`/`now` through `SmokeDependencies`; tests must not access the network or wait in real time.

- [ ] **Step 2: Run the tests to prove the module is missing**

Run:

```powershell
npm test -- smoke
```

Expected: FAIL because `src/lib/smoke.ts` does not exist.

- [ ] **Step 3: Implement strict CLI parsing and target validation**

In `src/lib/smoke.ts`, implement `parseSmokeArgs` for flags only:

```text
--environment local|preview|production     required
--base-url URL                             required
--expected-release SHA                     required for preview/production; 40 hexadecimal characters
--wait-for-release-ms MILLISECONDS          integer 0 through 600000; default 0
--request-timeout-ms MILLISECONDS           integer 1000 through 30000; default 10000
```

Reject duplicates, unknown flags, missing values, credentials, fragments, queries, and non-root paths. Production and preview also reject non-default ports; local targets permit an explicit development port. Target rules are:

```typescript
production: protocol === 'https:' && hostname === 'ratemyplace.org' && port === ''
preview:    protocol === 'https:' && port === '' &&
            hostname matches /^[0-9a-f]{8}\.ratemyplace-64y\.pages\.dev$/
local:      protocol is http/https && hostname is localhost, 127.0.0.1, or [::1]
```

The preview rule accepts the current hash-based atomic Pages deployment form and rejects the bare production `pages.dev` hostname plus mutable branch aliases. Re-verify the hash-label shape against Cloudflare's preview-deployment documentation immediately before implementation; if the platform format has changed, update this reviewed validator and its tests rather than widening it to a suffix rule. Cloudflare distinguishes atomic hash URLs from branch aliases: <https://developers.cloudflare.com/pages/configuration/preview-deployments/>.

Normalize the expected SHA to lowercase only after the full-SHA regex passes. Local mode may accept an optional valid expected SHA so the built-Worker injection test can exercise exact release matching; it does not require one for ordinary local use.

- [ ] **Step 4: Implement the read-only probe table**

The probe contract is fixed for Phase 22A:

```typescript
const htmlPaths = [
  '/', '/about', '/contact', '/guidelines', '/map', '/methodology',
  '/privacy', '/search', '/terms', '/auth/signin', '/auth/signup',
];

const protectedPaths = ['/profile', '/review/new', '/admin'];

const apiProbes = [
  { path: '/api/buildings?q=__rmp_smoke_no_match__', status: 200, key: 'buildings' },
  { path: '/api/reviews/user', status: 401, key: 'error' },
  { path: '/api/admin/reviews?limit=1', status: 401, key: 'error' },
];
```

Assertions:

- Every fetch uses `redirect: 'manual'`. HTML paths return 200 directly, `text/html`, contain document/html structure, and contain none of `Internal Server Error`, `Application error`, or `500 Error`; any 3xx is a failure.
- `/profile`, `/review/new`, and `/admin` use `redirect: 'manual'`, return 3xx, and resolve to the same-origin `/auth/signin` path. A redirect to `/` is a failure.
- API probes return the exact status without redirecting, JSON content type, a JSON object, and the named top-level key.
- `/api/health` returns 200 without redirecting and `{ status: 'ok', release }`; when `expectedRelease` exists it must match exactly.
- The home response includes `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a `Content-Security-Policy`, and `Referrer-Policy`.
- Every request uses a per-request abort timeout and `cache: 'no-store'`.

- [ ] **Step 5: Implement bounded release polling**

Before running the full suite, `runSmoke` requests `/api/health`. If the release is not the expected SHA and `waitForReleaseMs > 0`, retry every 10 seconds until match or deadline. Network/5xx/malformed responses during this period are retryable only until the same deadline. Once the release matches, run every probe. A deadline failure returns a failed `release` result containing expected and actual release IDs but no response body or internal provider detail.

The dependency seam is:

```typescript
export interface SmokeDependencies {
  fetch: typeof fetch;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}
```

Default it to global `fetch`, `Date.now`, and a small `setTimeout` promise; unit tests inject all three.

- [ ] **Step 6: Reduce the script to CLI/output responsibilities**

Rewrite `scripts/smoke-test.ts` so it only:

1. calls `parseSmokeArgs(process.argv.slice(2))`;
2. prints the explicit environment and origin;
3. calls `runSmoke`;
4. prints one line per result with status/duration/detail;
5. sets `process.exitCode = 1` when any probe fails;
6. sets `process.exitCode = 2` for invalid configuration.

Never log response bodies, headers containing credentials, query values other than the fixed smoke sentinel, or a stack trace for ordinary probe failure.

- [ ] **Step 7: Verify the tests and negative CLI behavior**

Run:

```powershell
npm test -- smoke
npm run smoke
npm run smoke -- --environment production --base-url https://example.com --expected-release aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

Expected: tests PASS; both CLI calls fail fast with exit code 2 and make no network request.

- [ ] **Step 8: Verify against a local built Worker**

In terminal A, retain the build-time release fixture from Task 2 so the full local smoke proves exact-SHA matching as well as route behavior:

```powershell
npm run db:setup
$syntheticRelease = '0123456789abcdef0123456789abcdef01234567'
$previousCloudflareSha = $env:CF_PAGES_COMMIT_SHA
try {
  $env:CF_PAGES_COMMIT_SHA = $syntheticRelease
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic-release build failed' }
} finally {
  if ($null -eq $previousCloudflareSha) {
    Remove-Item Env:CF_PAGES_COMMIT_SHA
  } else {
    $env:CF_PAGES_COMMIT_SHA = $previousCloudflareSha
  }
}
npx wrangler pages dev ./dist --port 8788
```

In terminal B:

```powershell
$syntheticRelease = '0123456789abcdef0123456789abcdef01234567'
npm run smoke -- --environment local --base-url http://127.0.0.1:8788 --expected-release $syntheticRelease
```

Expected: every probe passes and `/api/health` matches the synthetic build SHA. A separate ordinary local run without `--expected-release` may accept `unknown` or `development`, but it is not the build-injection proof.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/smoke.ts src/lib/__tests__/smoke.test.ts scripts/smoke-test.ts
git commit -m "test: make smoke targets explicit"
```

---

## Task 4: Add least-privilege CI and post-deploy commit verification

> **Final-review RULING-002 — documentation correction:** The originally planned
> single-job, workflow-level `production-smoke` concurrency model was corrected after
> final review. The verified implementation keeps the sentinel outside cancellable
> concurrency and gives that concurrency only to the successful smoke job. This preserves
> visibility for failed CI completions; it is not a new product feature.

**Files:**

- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/post-deploy-smoke.yml`
- Create: `src/lib/__tests__/workflowContracts.test.ts`

- [ ] **Step 1: Write a failing repository-level workflow contract test**

Create `src/lib/__tests__/workflowContracts.test.ts` using `readFileSync` and `resolve(process.cwd(), ...)`. Assert:

- `.github/workflows/ci.yml` exists, is named `CI`, has a `quality` job named `quality`, triggers on pull request and `main` push, grants only `contents: read`, disables checkout credential persistence, and runs `npm ci`, `npm run check`, `npm test`, and `npm run build`;
- `.github/workflows/post-deploy-smoke.yml` uses `workflow_run` for `CI`. Its
  non-cancellable `sentinel` job runs for every qualifying internal `main` push
  completion, explicitly fails red when quality did not succeed, explicitly passes on
  success, and never checks out, installs dependencies, or smokes. A separate success-only
  `smoke` job needs the sentinel, alone owns cancellable `production-smoke` concurrency,
  and passes `workflow_run.head_sha` as `--expected-release` while targeting exactly
  `https://ratemyplace.org`;
- neither workflow contains `wrangler pages deploy`, `CLOUDFLARE_API_TOKEN`, `pull_request_target`, or `permissions: write-all`.

Run:

```powershell
npm test -- workflowContracts
```

Expected: FAIL because `.github/workflows` is absent.

- [ ] **Step 2: Create the stable CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: quality
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      ASTRO_TELEMETRY_DISABLED: "1"
    steps:
      - name: Check out source
        uses: actions/checkout@v6
        with:
          persist-credentials: false
      - name: Use pinned Node.js
        uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: npm
      - name: Install locked dependencies
        run: npm ci
      - name: Type-check
        run: npm run check
      - name: Unit tests
        run: npm test
      - name: Production build
        run: npm run build
```

GitHub's official Node workflow guidance uses `setup-node` plus `npm ci`, tests, and build: <https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs>. Astro documents `astro check` as intended for CI: <https://docs.astro.build/en/reference/cli-reference/#astro-check>.

- [ ] **Step 3: Create post-deploy polling and smoke**

Create `.github/workflows/post-deploy-smoke.yml`:

```yaml
name: Post-deploy smoke

on:
  workflow_run:
    workflows: [CI]
    types: [completed]

permissions:
  contents: read

jobs:
  sentinel:
    name: production sentinel
    if: >-
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main' &&
      github.event.workflow_run.head_repository.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Refuse an unverified main deployment
        if: github.event.workflow_run.conclusion != 'success'
        run: |
          echo "CI quality did not succeed for this main commit. Pages may still have attempted deployment."
          exit 1
      - name: Confirm verified main CI
        if: github.event.workflow_run.conclusion == 'success'
        run: echo "CI quality succeeded for this main commit."
  smoke:
    name: production smoke
    needs: sentinel
    if: >-
      needs.sentinel.result == 'success' &&
      github.event.workflow_run.conclusion == 'success'
    concurrency:
      group: production-smoke
      cancel-in-progress: true
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Check out deployed commit
        uses: actions/checkout@v6
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          persist-credentials: false
      - name: Use pinned Node.js
        uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: npm
      - name: Install locked dependencies
        run: npm ci
      - name: Wait for deployed SHA and smoke production
        run: >-
          npm run smoke --
          --environment production
          --base-url https://ratemyplace.org
          --expected-release ${{ github.event.workflow_run.head_sha }}
          --wait-for-release-ms 600000
```

The workflow does not deploy. Cloudflare Pages Git integration can attempt a deployment independently for every `main` push, so a failed quality run must produce a red, non-cancellable sentinel rather than a skipped post-deploy result. Only after that sentinel explicitly passes can the separate, cancellable smoke job run; on success, its health-SHA poll proves which commit is being tested. Cloudflare documents that Git integration owns automatic Pages deployments and check runs: <https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/>.

- [ ] **Step 4: Run the workflow contract and full local gates**

Run:

```powershell
npm test -- workflowContracts
$env:ASTRO_TELEMETRY_DISABLED='1'; npm run check
npm test
npm run build
```

Expected: workflow contract PASS; check reports 0 errors; all unit tests PASS; build completes.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/ci.yml .github/workflows/post-deploy-smoke.yml src/lib/__tests__/workflowContracts.test.ts
git commit -m "chore: add CI and post-deploy verification"
```

---

## Task 5: Document the operator contract and update repository guidance

**Files:**

- Create: `docs/runbooks/release-smoke.md`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `.planning/codebase/INTEGRATIONS.md`

- [ ] **Step 1: Create the runbook**

`docs/runbooks/release-smoke.md` must record:

- the purpose and non-sensitive `{ status, release }` health contract;
- the exact cookie-free monitor assumption: the route handler performs no D1 work, while an unrelated caller that supplies a session cookie may trigger normal middleware session validation;
- the narrow `/api/health` GET/HEAD application-rate-limit exception and the fact that any custom edge rule is separately approved;
- exact local, preview, and production smoke commands;
- accepted hostnames, including the current hash-based atomic preview form, and why no default exists;
- the `quality` required-check name;
- the post-deploy sequence: every qualifying internal `main` CI completion runs a
  non-cancellable sentinel; failure makes it red, success explicitly passes it, and the
  separate success-only smoke job then proceeds through Pages deploy → release-SHA match →
  full smoke under its own cancellable `production-smoke` concurrency;
- that smoke is read-only and excludes Turnstile submission/Maps interaction;
- that post-deploy failure stops the release from being called healthy but does not trigger automatic rollback;
- triage order: compare expected/actual SHA, inspect Pages deployment, inspect failed probe, rerun read-only smoke, then request separate approval for any rollback;
- SAFE-09 limitation: GitHub failure notification is best-effort until Phase 22B adds independent counters/outbox/webhook/machine health.

- [ ] **Step 2: Update canonical commands**

In `AGENTS.md`:

- add `npm run check # Astro/TypeScript diagnostics` to Commands;
- change completion guidance to require `npm run check`, `npm test`, and `npm run build`;
- document that `npm run smoke` has no default and requires explicit environment/origin (and SHA outside local).
- document one narrow endpoint-checklist exception: input-free, read-only `GET`/`HEAD /api/health` has no D1-backed application limiter so cookie-free release monitoring stays independent of D1; this exception applies to no other public endpoint and does not authorize a custom edge rule.

In `README.md`, use `npm ci` for locked setup and list `npm run check`, `npm test`, and `npm run build`.

In `.planning/codebase/INTEGRATIONS.md`, replace “No CI” with the exact two-workflow model and stable `quality` check. Do not claim the `main` ruleset is active until Task 7 verifies it externally.

- [ ] **Step 3: Scan for stale smoke/CI claims**

Run:

```powershell
rg -n -S "b3b57132|No GitHub Actions|no CI|npm run smoke" AGENTS.md README.md scripts docs/runbooks .planning/codebase/INTEGRATIONS.md
```

Expected: no obsolete preview default or “no CI” claim; all smoke examples are explicit.

- [ ] **Step 4: Commit**

```powershell
git add AGENTS.md README.md .planning/codebase/INTEGRATIONS.md docs/runbooks/release-smoke.md
git commit -m "docs: document release safety controls"
```

---

## Task 6: Pre-external-action verification

**Files:** none.

- [ ] **Step 1: Verify only intended files are tracked**

Run:

```powershell
git status --short
git diff --check main...HEAD
git diff --stat main...HEAD
```

Expected: the untracked duplicate verification route remains untracked and absent from `git diff`; no whitespace errors.

- [ ] **Step 2: Run all local gates from a clean install-compatible state**

Run:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; npm run check
npm test
npm run build
```

Expected: all three PASS.

- [ ] **Step 3: Run the complete pre-deploy QA subset**

- Repeat the local smoke command from Task 3.
- At 375, 768, and 1280px, verify `/`, `/auth/signin`, `/auth/signup`, `/profile` denial, `/review/new` denial, and `/admin` denial have no leaked `undefined`/`null`/internal fields.
- Directly request `/api/health`, `/api/reviews/user`, and `/api/admin/reviews?limit=1`; verify exact public/401 contracts.
- Confirm no response exposes secrets, table names, counts in health, stack traces, or the private `unit_number` field.

- [ ] **Step 4: Present the diff and request approval before pushing**

Stop and show:

- commit list;
- full file inventory;
- check/test/build/local-smoke results;
- exact branch name and proposed PR title;
- confirmation that no Cloudflare, D1, R2, GitHub ruleset, or production state changed.

Do not push or open a PR without action-time approval.

---

## Task 7: Activate CI and required checks under separate approvals

**Files:**

- Create after verification: `.planning/milestones/v1.6.0-phases/22-release-operations-migration-safety/22A-VERIFICATION.md`
- Modify after all evidence passes: `.planning/milestones/v1.6.0-REQUIREMENTS.md`

- [ ] **Step 1: After push approval, push the feature branch and open the PR**

Proposed PR title:

```text
chore: add Phase 22A release safety gates
```

Wait for the `quality` check and Cloudflare preview check. If `quality` fails, fix on the branch and repeat local verification; do not weaken the check.

- [ ] **Step 2: Smoke the hash-based atomic preview at the exact SHA**

Open the successful Cloudflare Pages check, follow it to deployment details, and copy the hash-based atomic deployment URL—not the bare production hostname or mutable branch alias. Then resolve the PR head SHA from the checked-out branch:

```powershell
$previewOrigin = Read-Host 'Immutable Cloudflare Pages deployment URL'
$prHeadSha = (git rev-parse HEAD).Trim()
npm run smoke -- --environment preview --base-url $previewOrigin --expected-release $prHeadSha
```

Expected: all read-only probes pass. Turnstile/Maps are explicitly not inferred from preview.

- [ ] **Step 3: Display the exact proposed `main` ruleset and request separate approval**

The proposed ruleset is:

- target: branch `main` only;
- enforcement: active;
- require pull request before merge, with **zero** required approving reviews for the single-maintainer repository;
- require status check `quality`, expected source GitHub Actions, strict/up-to-date branch;
- block force pushes and branch deletion;
- no routine bypass actor.

GitHub requires the status check to have run recently before it can be selected. Verify the existing rulesets read-only, show any conflict, then stop for approval. Official behavior: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>.

- [ ] **Step 4: After ruleset approval, activate and prove it**

Activate through GitHub repository settings or a narrowly scoped `gh api` call. Re-read the saved ruleset and attach its exact JSON/screenshot evidence to the verification record. Open a temporary PR whose `quality` job deliberately fails without changing production code, verify merge is blocked, then close the PR without merging. Do not leave a failing commit on the implementation branch.

- [ ] **Step 5: Request merge approval**

Show:

- green `quality` and Pages preview checks;
- preview smoke tied to the exact SHA;
- active ruleset evidence and blocked-merge proof;
- final diff and commits.

Do not merge until explicitly approved.

- [ ] **Step 6: After merge approval, verify production by exact SHA**

The post-deploy workflow should wait for Pages to serve the merged SHA and then run smoke. Independently confirm its GitHub run is green, update the local remote-tracking ref, and run:

```powershell
git fetch origin main
$mainSha = (git rev-parse origin/main).Trim()
npm run smoke -- --environment production --base-url https://ratemyplace.org --expected-release $mainSha
```

If either fails, do not mark the release healthy. Diagnose read-only; rollback remains a separate approval gate.

- [ ] **Step 7: Record evidence and close only completed requirements**

Create `22A-VERIFICATION.md` with commit SHA, Node/npm versions, CI URL/result, ruleset evidence, preview hostname/SHA/result, production Pages deployment/SHA, post-deploy workflow result, independent production-smoke result, and any expected warnings.

Only after all evidence exists, mark SAFE-01, SAFE-02, SAFE-03, and SAFE-06 complete in `.planning/milestones/v1.6.0-REQUIREMENTS.md`. Leave SAFE-09 unchecked and label its public-health slice complete in the evidence record.

Commit the evidence separately:

```powershell
git add .planning/milestones/v1.6.0-REQUIREMENTS.md .planning/milestones/v1.6.0-phases/22-release-operations-migration-safety/22A-VERIFICATION.md
git commit -m "docs: record Phase 22A release safety activation"
```

Because this evidence commit occurs after the first production merge, it requires its own branch/PR/check/merge approval cycle; never push it directly to `main`.

---

## Final Verification Matrix

| Requirement | Automated evidence | External evidence |
|---|---|---|
| SAFE-01 | `npm run check` exists and returns 0 errors; CI runs it | Green `quality` check |
| SAFE-02 | Workflow contract test; CI runs install/check/test/build | Green PR and `main` workflow runs |
| SAFE-03 | Stable `quality` job name | Active ruleset plus blocked failing-PR proof |
| SAFE-06 | Smoke parser/runner tests; local full smoke | Immutable-preview and production smoke tied to exact SHAs |
| SAFE-09 slice | Health payload/route tests; release mismatch test | Production health reports merged SHA |

## Self-Review Checklist

- [ ] Every spec requirement in scope maps to a task and evidence row.
- [ ] SAFE-04/05/07/08/10/11 and the rest of SAFE-09 remain outside this plan.
- [ ] Scan the plan for unresolved drafting markers or symbolic command values; resolve each from named evidence before handoff.
- [ ] Names are consistent: workflow `CI`, required job/check `quality`, endpoint `/api/health`, fields `status` and `release`, flag `--expected-release`.
- [ ] A built Worker, not only a unit import, exposes the synthetic SHA injected through `astro.config.mjs`.
- [ ] Preview validation rejects the production Pages hostname, branch aliases, credentials, and non-default ports; every ordinary probe rejects redirects.
- [ ] Every qualifying internal `main` quality completion runs a non-cancellable sentinel,
  including an explicitly red result on quality failure; only the separate success-only
  smoke job owns cancellable `production-smoke` concurrency.
- [ ] No workflow has write permission, deployment credentials, `pull_request_target`, or a Cloudflare deployment command.
- [ ] No step treats a successful redirect follow, old release, mutable marketing phrase, or preview-only widget failure as production proof.
- [ ] No external action appears before an explicit action-time approval step.
