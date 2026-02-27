# Technology Stack: QA & Stress Testing Additions

**Project:** RateMyPlace Boston — v1.3.0 "Battle Tested"
**Researched:** 2026-02-27
**Scope:** NEW additions only — tools needed for E2E, seeding, load testing, edge case validation

---

## Existing Stack (DO NOT RE-RESEARCH)

These are already installed and working. Do not modify or replace them:

| Tool | Version | Status |
|------|---------|--------|
| `@playwright/test` | `^1.58.2` | Installed, 2 spec files, runs against production URL |
| `vitest` | `^4.0.18` | Installed, 130 tests passing, happy-dom environment |
| `tsx` | `^4.21.0` | Installed, used for `scripts/smoke-test.ts` |
| `wrangler` | (via npx) | Used for D1 migrations |

---

## What Needs to Be Added

The current E2E setup has critical gaps:

1. **No authenticated test flows** — Playwright runs against production with no auth state. Admin flows, review submission, disputes are all untested.
2. **No local test environment** — Tests run against the deployed preview URL. No way to test with controlled data or reset state.
3. **No test data** — No seeded buildings, reviews, or landlords to test against at realistic scale.
4. **No load testing** — No performance validation for concurrent users, rate limiting behavior, or response times at scale.

---

## Recommended Stack Additions

### 1. Data Seeding — SQL-file approach (no new packages)

**What:** TypeScript script that generates SQL INSERT statements and pipes them to `wrangler d1 execute --local --file`

**Why this over alternatives:**
- `@faker-js/faker` for generation in TypeScript, but the output is SQL fed to wrangler — no ORM needed
- `drizzle-seed` requires adding Drizzle ORM as a dep, which the project doesn't use
- `@wataru/seed-d1` (JSR package) is niche, low adoption, adds a dependency for trivial functionality
- Raw SQL via `wrangler d1 execute DB --local --file ./scripts/seed.sql` is the official Cloudflare-documented pattern (HIGH confidence: [Cloudflare D1 docs](https://developers.cloudflare.com/d1/wrangler-commands/))

**Packages to add:**

| Package | Version | Purpose | Install as |
|---------|---------|---------|------------|
| `@faker-js/faker` | `^10.3.0` | Realistic fake data generation (names, addresses, text) | `devDependency` |

**Pattern:** `scripts/seed-local.ts` uses faker to generate TypeScript objects, serializes to SQL INSERT statements, writes a temp `.sql` file, then shells out to `wrangler d1 execute ratemyplace-db --local --file ./tmp/seed.sql`. `tsx` (already installed) runs it.

**Confidence:** HIGH — faker v10 is current, TypeScript-native, no new runtime deps needed.

---

### 2. Playwright Auth State — `storageState` pattern (no new packages)

**What:** Playwright's built-in `storageState` API to save and reuse authenticated sessions.

**Why:** Current `playwright.config.ts` has no auth setup. Tests can't reach `/admin`, `/review/new`, `/profile`, or any form that requires a session cookie (Lucia uses httpOnly cookies). `storageState` captures all cookies including httpOnly and replays them, which is exactly what Lucia's session cookie requires.

**No new packages needed** — this is built into `@playwright/test` (already installed).

**Pattern:**
- Add `e2e/auth.setup.ts` — logs in as regular user via form, saves to `playwright/.auth/user.json`
- Add `e2e/admin.setup.ts` — logs in as admin user, saves to `playwright/.auth/admin.json`
- Update `playwright.config.ts` to add setup projects and `storageState` dependency
- Add `playwright/.auth/` to `.gitignore`

**Confidence:** HIGH — official Playwright pattern ([Playwright auth docs](https://playwright.dev/docs/auth)), confirmed compatible with cookie-based auth.

---

### 3. Playwright Local Dev Server — `webServer` + `wrangler pages dev` (no new packages)

**What:** Playwright `webServer` option to spin up a local server before E2E tests run, pointing to `localhost` instead of the production preview URL.

**Why this matters:** Current config uses `baseURL: 'https://b3b57132.ratemyplace-64y.pages.dev'` — a deployed preview URL. Problems:
- Cannot reset data between test runs
- Test data pollutes production preview
- Cannot test with seeded fixture data
- Network-dependent (flaky in CI)

**`wrangler pages dev` vs `astro preview`:**
- `astro preview` does NOT wire up Cloudflare bindings (D1, R2) — confirmed by Cloudflare docs
- `wrangler pages dev ./dist` correctly proxies D1 local database (stored in `.wrangler/state/`) and honors `wrangler.jsonc` bindings
- This is the correct command for accurate local simulation ([Astro Cloudflare integration docs](https://docs.astro.build/en/guides/integrations-guide/cloudflare/))

**Playwright config change:**
```typescript
webServer: {
  command: 'npm run build && npx wrangler pages dev ./dist --port 8788',
  port: 8788,
  timeout: 60_000,
  reuseExistingServer: !process.env.CI,
},
use: {
  baseURL: 'http://localhost:8788',
}
```

**Note:** Build step is required because `wrangler pages dev` serves the compiled `dist/` output, not source files.

**Confidence:** MEDIUM — documented pattern, but build+start adds ~30s to test startup. Alternative: separate `prebuild` step in CI, then `reuseExistingServer: true`.

---

### 4. Load Testing — Artillery (new package, optional)

**What:** Artillery for HTTP load testing against the deployed URL — simulating concurrent users hitting public endpoints and the review submission flow.

**Why Artillery over alternatives:**

| Tool | Verdict | Reason |
|------|---------|--------|
| **Artillery** | RECOMMENDED | YAML config, Node.js native, ships as npm package, supports cookie sessions, 2.0.30 current stable |
| k6 | Avoid for this project | Go binary, not npm-installable, requires separate install, overkill for the test volume here |
| Locust | Avoid | Python, adds a separate runtime |
| JMeter | Avoid | Java, GUI-heavy, bad DX for a small project |

Artillery v2 is npm-installable, supports:
- Cookie-based sessions (needed to test rate limiting after auth)
- YAML scenario scripts (simple, no complex JS required for basic flows)
- HTTP metrics: response times, error rates, RPS
- `--count` and ramp-up phases

**Packages to add:**

| Package | Version | Purpose | Install as |
|---------|---------|---------|------------|
| `artillery` | `^2.0.30` | HTTP load testing for rate limiting validation and concurrent user simulation | `devDependency` |

**What it tests:** Public page response times under load (homepage, search, building profiles), rate limiting behavior (auth endpoints hit >5 req/min), concurrent review submissions.

**Important constraint:** Cloudflare Workers free tier has burst limits. Load tests should target the deployed preview URL (not production), or limit concurrency to avoid triggering Cloudflare's abuse protection (6000 RPM from 600 virtual users is the documented safe upper limit for paid plans; free tier is much lower).

**Confidence:** MEDIUM — Artillery 2.0.30 confirmed current via npm search. Cookie session support confirmed via Artillery HTTP engine docs, though httpOnly cookie handling has known quirks (GitHub issue #354).

---

### 5. Edge Case & Boundary Testing — Playwright `route.fulfill` (no new packages)

**What:** Playwright's built-in network interception API to simulate error states, empty databases, and slow responses without needing special server configuration.

**Why:** The app needs testing for: empty search results, building with no reviews, admin with 0 items in queue, form submissions with 1000-char inputs, special characters (Unicode, SQL injection attempts, XSS payloads). Playwright's `page.route()` handles the network-layer cases; form boundary tests are pure Playwright `page.fill()` operations.

**No new packages needed** — built into `@playwright/test`.

**Pattern:**
```typescript
// Simulate empty building profile
await page.route('**/api/buildings/*', route => route.fulfill({
  status: 200,
  body: JSON.stringify({ building: null, reviews: [] }),
}));
```

**Confidence:** HIGH — core Playwright API, stable across versions.

---

## Installation Summary

```bash
# Add to devDependencies
npm install -D @faker-js/faker artillery
```

That's it. Two packages. Everything else uses existing tools.

---

## What NOT to Add

| Tool | Why Not |
|------|---------|
| Cypress | Already have Playwright installed and working — switching creates migration cost with zero benefit |
| Miniflare (direct) | Wrangler wraps Miniflare internally. Direct Miniflare usage adds complexity without benefit for Pages apps |
| `@cloudflare/vitest-pool-workers` | Designed for Workers unit tests in the workerd runtime. Overkill for this milestone — existing Vitest + happy-dom already covers the 130 unit tests. Adding this would require significant vitest.config.ts restructuring for marginal gain |
| Drizzle ORM | Only needed for seeding if the project already uses Drizzle. It doesn't — raw SQL via wrangler is simpler |
| Supertest / node-fetch for API testing | Playwright's `request` context and `page.route()` cover API testing needs without additional packages |
| `@playwright/test-reporter-html` (separate install) | Already built into `@playwright/test` |
| `chance`, `casual`, or other faker alternatives | `@faker-js/faker` v10 is the dominant library with TypeScript types built-in |
| k6 | Binary install (not npm), requires separate toolchain, overkill for this project's scale |
| `locust` | Python runtime, wrong ecosystem |
| `msw` (Mock Service Worker) | Designed for component-level mocking in React. Playwright's route.fulfill is the correct tool at E2E level |

---

## Integration Points with Existing Setup

### Vitest (existing)

No changes needed. Unit tests (`src/lib/__tests__/`) continue using Vitest + happy-dom. The new testing additions are complementary, not replacing:

```
vitest run          → Unit tests (scoring, validation, auth logic)
playwright test     → E2E flows (user journeys, auth, forms)
artillery run       → Load tests (rate limiting, performance)
tsx scripts/seed-local.ts → Data setup for local E2E
```

### Playwright Config (update existing)

Update `playwright.config.ts` to:
1. Add `webServer` pointing to local `wrangler pages dev`
2. Add `setup` projects for auth state generation
3. Add `storageState` to main chromium project
4. Keep `baseURL` override via `BASE_URL` env var (existing pattern) for running against deployed URLs

### Package.json Scripts (add)

```json
{
  "seed:local": "tsx scripts/seed-local.ts",
  "seed:clear": "npx wrangler d1 execute ratemyplace-db --local --command 'DELETE FROM reviews; DELETE FROM buildings; DELETE FROM landlords;'",
  "e2e:local": "BASE_URL=http://localhost:8788 npx playwright test",
  "load:test": "artillery run scripts/load-test.yml"
}
```

---

## Environment & Configuration Notes

### Local D1 State Location

Wrangler stores local D1 data in `.wrangler/state/v3/d1/` relative to the project root. This directory should be in `.gitignore` (it likely already is). Seeded data persists between runs until explicitly cleared.

### Auth Test Users

Two test accounts must exist in the local seeded database:
- Regular user: `test-user@ratemyplace.test` — for user flow E2E tests
- Admin user: `test-admin@ratemyplace.test` with `is_admin = 1` — for admin dashboard tests

These are seeded by `seed-local.ts` with known passwords stored in `.env.test` (never committed).

### Playwright `.auth/` Directory

Add to `.gitignore`:
```
playwright/.auth/
```

Storage state files contain session cookies — treat as secrets.

---

## Sources

| Claim | Source | Confidence |
|-------|--------|------------|
| `wrangler d1 execute --local --file` pattern | [Cloudflare D1 wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) | HIGH |
| `wrangler pages dev` required for D1 bindings (not `astro preview`) | [Cloudflare D1 local dev docs](https://developers.cloudflare.com/d1/best-practices/local-development/) | HIGH |
| Playwright `storageState` for auth | [Playwright auth docs](https://playwright.dev/docs/auth) | HIGH |
| Astro official Playwright recommendation | [Astro testing docs](https://docs.astro.build/en/guides/testing/) | HIGH |
| `@faker-js/faker` v10.3.0 current | [Faker.js docs](https://fakerjs.dev/guide/) | HIGH |
| Artillery 2.0.30 current | npm search result, published 18 days ago | MEDIUM |
| Artillery cookie session support | [Artillery HTTP engine docs](https://www.artillery.io/docs/reference/engines/http) | MEDIUM |
| Artillery httpOnly cookie quirks | [GitHub issue #354](https://github.com/artilleryio/artillery/issues/354) | MEDIUM |
| `@cloudflare/vitest-pool-workers` compatibility range | [Cloudflare Workers testing docs](https://developers.cloudflare.com/workers/testing/vitest-integration/) | HIGH |
| Playwright `webServer` with Astro | [Astro testing docs](https://docs.astro.build/en/guides/testing/) | HIGH |
| Playwright version 1.58 current | [Playwright release notes](https://playwright.dev/docs/release-notes) | HIGH |
