# Domain Pitfalls

**Domain:** QA / stress testing for Astro 5 + Cloudflare Pages + D1 (SQLite) + Lucia Auth
**Researched:** 2026-02-27
**Scope:** Adding testing infrastructure to an existing production app (v1.3.0 "Battle Tested")

---

## Critical Pitfalls

Mistakes that cause test failures that don't represent real bugs, accidental production data
corruption, or large blocks of wasted time.

---

### Pitfall 1: Playwright Is Pointed at Production Right Now

**What goes wrong:** The current `playwright.config.ts` sets `baseURL` to
`https://b3b57132.ratemyplace-64y.pages.dev` — a live Cloudflare Pages preview URL. Any
test that writes data (sign-up flows, review submissions, dispute forms) will write to the
real D1 production database. There is no local server configured.

**Why it happens:** The existing tests are smoke-tests against a deployed environment.
Expanding them to cover auth flows, form submissions, and admin actions without first
switching to a local dev server will corrupt real data.

**Consequences:**
- Fake users, fake reviews, and fake disputes accumulate in production D1
- Rate limit tables fill up with test IPs
- Audit log fills with test admin actions
- Cannot run tests in isolation (shared mutable state)
- Tests that seed 200 buildings hit the production database directly

**Prevention:**
Configure `playwright.config.ts` to start `wrangler pages dev` locally and point
`baseURL` at `http://localhost:8788`. Use an environment variable to switch between
local and preview:

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npx wrangler pages dev --local',
    url: 'http://localhost:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8788',
  },
});
```

**Detection:** If tests run in under 500ms or you see no local server starting, they are
hitting the remote URL.

**Phase:** Seed data seeding and E2E setup phase. Fix before writing any test that touches
the database.

---

### Pitfall 2: D1 Migrations Do Not Run Automatically in Vitest

**What goes wrong:** Tests throw `D1_ERROR: no such table: users` even though the schema
is fully defined in 15 migration files. The `vitest.config.ts` currently uses
`environment: 'happy-dom'` — it is a plain Node.js test environment with no D1 binding
at all, and the Workers Vitest pool (which would provide a real D1 binding) is not
configured.

**Why it happens:** Cloudflare's `@cloudflare/vitest-pool-workers` runs tests inside the
actual Workers runtime, but even then, D1 databases start empty. Migrations must be
explicitly applied in test setup using `applyD1Migrations()`. There is no automatic
migration execution.

**Consequences:**
- Every DB-touching unit or integration test fails immediately
- False confidence: tests in `happy-dom` mode can call functions that use `getDB()` and
  won't throw until the function tries to bind (which never happens, so they may silently
  pass without actually exercising the database path)

**Prevention:**
For unit tests that do not touch the DB (scoring logic, validation), `happy-dom` is fine.
For anything touching D1, switch to the Workers pool:

```typescript
// vitest.config.ts (for DB integration tests)
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          d1Databases: ['DB'],
        },
      },
    },
  },
});
```

Then apply migrations before each test suite:

```typescript
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, await readMigrations('./migrations'));
});
```

Keep two vitest configs: one for unit tests (happy-dom, fast) and one for integration
tests (workers pool, slower). Do not merge them.

**Detection:** Tests pass but nothing is actually inserted/queried, or immediate
`no such table` errors appear.

**Phase:** Any phase writing integration or unit tests for API routes or lib functions
that touch D1.

---

### Pitfall 3: `nodejs_compat` Auto-Injection Creates False Positive Tests

**What goes wrong:** The Workers Vitest pool automatically injects the `nodejs_compat`
flag even if `wrangler.jsonc` does not have it. Tests that depend on Node.js APIs (like
`crypto`, `buffer`) pass in vitest but could fail in production if the flag is ever
removed or the compatibility date changes.

**Why it happens:** This is a documented behavior of `@cloudflare/vitest-pool-workers`.
The project's `wrangler.jsonc` already has `nodejs_compat` set, so for this project the
risk is low — but the inverse is also true: as of compatibility date `2025-09-21`,
`nodejs_compat` combined with newer compatibility dates breaks vitest (tracked in
cloudflare/workers-sdk issue #11028).

**Consequences:**
- Tests pass locally but Workers reject the code in production because a Node API is used
  without the flag being present in the actual runtime
- Upgrading `compatibility_date` in `wrangler.jsonc` breaks the test runner unexpectedly

**Prevention:**
- Do not change `compatibility_date` in `wrangler.jsonc` without checking
  cloudflare/workers-sdk for vitest-pool-workers compatibility first
- Pin `wrangler` and `@cloudflare/vitest-pool-workers` versions in `package.json`; do not
  auto-update these during the QA milestone
- The project already uses Web Crypto API (not Node crypto), which is always available in
  Workers — this is the correct pattern; do not introduce `node:crypto` imports

**Detection:** vitest fails with cryptic errors after a `wrangler` or compatibility date
update.

**Phase:** Any integration test setup phase. Pin versions before writing tests.

---

### Pitfall 4: Google OAuth Cannot Be Automated in E2E Tests

**What goes wrong:** Attempting to drive the real Google OAuth flow in Playwright is
unreliable. Google detects headless browsers and either blocks them, shows CAPTCHAs, or
flags the test account for suspicious activity. There is no reliable way to automate the
Google sign-in popup in a headless browser.

**Why it happens:** The app uses Google OAuth via Lucia. The OAuth redirect goes to
Google's servers. Google's bot detection is aggressive against headless Chromium.

**Consequences:**
- Hours spent trying to make Playwright click through Google's sign-in UI
- Test accounts get banned or CAPTCHAs appear mid-CI run
- Flaky tests that pass locally but fail in GitHub Actions

**Prevention:**
Do not try to automate Google OAuth. Instead, use the programmatic session injection
approach:

1. Create test users via the standard email/password sign-up flow (which is testable)
2. For tests that need a logged-in user, call the sign-in API endpoint directly and
   extract the session cookie, then inject it into the Playwright browser context:

```typescript
// e2e/fixtures/auth.ts
import { test as base, request } from '@playwright/test';

export const test = base.extend({
  authenticatedPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    // Call the app's sign-in endpoint directly
    const apiContext = await request.newContext({ baseURL: 'http://localhost:8788' });
    const res = await apiContext.post('/api/auth/signin', {
      data: { email: 'test@example.com', password: 'TestPassword123!' }
    });
    const cookies = res.headers()['set-cookie'];
    // Inject session cookie into browser context
    await context.addCookies([parseCookie(cookies)]);
    const page = await context.newPage();
    await use(page);
    await context.close();
  }
});
```

3. Mark OAuth-specific tests as manual/skipped in CI with `test.skip`

**Detection:** Any test that calls `page.goto('/auth/google')` or navigates to
`accounts.google.com` is going to fail.

**Phase:** Auth flow testing phase. Establish this pattern before writing any
authenticated test.

---

### Pitfall 5: Seeding Data Into Production D1 by Accident

**What goes wrong:** Running a seed script with `--remote` flag (or without `--local`)
writes fake data directly into the production D1 database. All 200 fake buildings, fake
users, and fake reviews become visible on ratemyplace.boston immediately.

**Why it happens:** Wrangler v3+ defaults to local-first, but it is easy to add
`--remote` thinking you are targeting a staging environment that does not exist. For a
Cloudflare Pages project, there is no built-in staging D1 — there is only one production
database.

**Consequences:**
- Fake reviews show up publicly before launch
- Score aggregates get corrupted by seeded data
- Cannot easily distinguish real data from seed data without a flag column

**Prevention:**
- Never run seed scripts with `--remote` or against the production database ID
- Add a `is_seed_data INTEGER DEFAULT 0` marker column to the seed SQL (not to the real
  schema — do this only in the local seed SQL as a comment or in a seed-only table)
- Better: wrap all seed scripts in a guard:

```bash
# scripts/seed-local.sh
if [ "$1" != "--i-know-what-im-doing" ]; then
  echo "ERROR: This seeds LOCAL D1 only. Pass --local flag explicitly."
  exit 1
fi
npx wrangler d1 execute ratemyplace-db --local --file=scripts/seed.sql
```

- Keep the production database ID out of any seed script. Use the binding name, not the
  UUID, and always pass `--local`.

**Detection:** Run `wrangler d1 execute ratemyplace-db --local --command "SELECT COUNT(*) FROM reviews"` before and after seeding. If the count on the remote goes up, something is wrong.

**Phase:** Data seeding phase. Establish the safety guardrails before writing any seed SQL.

---

### Pitfall 6: Local D1 Persists Dirty State Between Test Runs

**What goes wrong:** Wrangler v3+ persists local D1 data across runs in
`.wrangler/state/`. If a seed script runs, tests modify data, and the next run starts
without a reset, tests see stale, mutated data. Tests that assume a clean state fail
intermittently.

**Why it happens:** The persistence-by-default behavior was introduced to improve DX for
development. It is the wrong default for testing.

**Consequences:**
- "Works on my machine" failures where a previous test run's data bleeds into the next
- Rate limit rows from a previous test run block new test attempts
- Duplicate key errors when re-seeding without reset
- Unique constraint violation on `users.email` when the same test user email is inserted twice

**Prevention:**
Create a `scripts/reset-local-db.sh` that drops all tables and re-runs migrations before
seeding:

```bash
#!/bin/bash
# Drop all tables and recreate from migrations
npx wrangler d1 execute ratemyplace-db --local --command "
  PRAGMA foreign_keys = OFF;
  DROP TABLE IF EXISTS audit_logs;
  DROP TABLE IF EXISTS disputes;
  DROP TABLE IF EXISTS rate_limits;
  DROP TABLE IF EXISTS email_verification_tokens;
  DROP TABLE IF EXISTS password_reset_tokens;
  DROP TABLE IF EXISTS property_managers;
  DROP TABLE IF EXISTS review_votes;
  DROP TABLE IF EXISTS reviews;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS building_scores;
  DROP TABLE IF EXISTS landlord_scores;
  DROP TABLE IF EXISTS buildings;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS landlords;
  PRAGMA foreign_keys = ON;
"
npx wrangler d1 migrations apply ratemyplace-db --local
npx wrangler d1 execute ratemyplace-db --local --file=scripts/seed.sql
```

Run this before E2E test runs in CI. Add it to the Playwright global setup.

**Detection:** Tests pass on the first run but fail on the second run without any code
changes.

**Phase:** Data seeding setup phase. Required before any E2E test that writes data.

---

## Moderate Pitfalls

Mistakes that cause incorrect behavior or significant wasted time, but do not corrupt data
or produce wrong results silently.

---

### Pitfall 7: D1 Foreign Key Insertion Order During Seeding

**What goes wrong:** Seed SQL inserts data in the wrong order — for example, inserting
`reviews` before the referenced `users` and `buildings` exist. D1 enforces foreign keys
by default (unlike standard SQLite), so this immediately throws
`FOREIGN KEY constraint failed`.

**Why it happens:** D1 sets `PRAGMA foreign_keys = ON` for every transaction by default.
Standard SQLite has it off by default. A seed file that works against a plain SQLite file
(e.g., during development with a different ORM or tool) may fail against D1.

**Prevention:**
Maintain strict insertion order in seed SQL:
1. `landlords`
2. `buildings` (references `landlords`)
3. `users`
4. `sessions` (references `users`)
5. `reviews` (references `users`, `buildings`)
6. `building_scores` (references `buildings`)
7. `landlord_scores` (references `landlords`)
8. `disputes` (references `reviews`)
9. `audit_logs` (references `users`)
10. `rate_limits`

Alternatively, wrap the entire seed in `PRAGMA defer_foreign_keys = ON` at the start of
the transaction. This defers constraint checking to commit time, allowing any insert
order, but still validates all constraints before committing.

**Detection:** `FOREIGN KEY constraint failed` error on first seed run. Check the line
number — it tells you which table is the offender.

**Phase:** Data seeding phase.

---

### Pitfall 8: Vitest `isolatedStorage: false` Causes Test State Leakage

**What goes wrong:** When running integration tests with the Workers Vitest pool, the
default `isolatedStorage: true` mode creates a fresh D1 database per test file. If you
set `isolatedStorage: false` to run tests concurrently, every test file reads and writes
to the same D1 state. A test that creates a user and a test that checks for no users will
interfere.

**Why it happens:** The Workers pool supports four isolation modes. The concurrent mode
(`isolatedStorage: false, singleWorker: false`) shares storage across all concurrent
tests, which seems like it would be faster but creates test ordering dependencies.

**Prevention:**
- Use the default `isolatedStorage: true` for integration tests touching D1
- Accept that integration tests run serially per file; this is correct for a small app
- For unit tests (scoring logic, validation), keep using `happy-dom` which runs
  concurrently with no shared state at all
- Never use global state in test setup without a corresponding teardown

**Detection:** Tests pass in isolation but fail when run together with `npm test`.

**Phase:** Any integration test setup phase.

---

### Pitfall 9: Rate Limit Table Breaks Auth Flow Tests

**What goes wrong:** The app implements fail-closed rate limiting that writes to the
`rate_limits` D1 table on every auth attempt. E2E tests that attempt sign-in multiple
times in the same test run will hit the rate limit and receive 503 responses — not
because the auth logic is broken, but because the test user's IP has been rate-limited
by previous test attempts.

**Why it happens:** `wrangler pages dev` runs on localhost. All test requests come from
127.0.0.1. The rate limiter sees all E2E test traffic as the same IP. After enough
sign-in tests, the limit is exceeded.

**Consequences:**
- Auth flow tests fail with 503 on the third or fourth run
- Flaky tests that depend on how many other tests ran before them
- Hard to distinguish real rate limit bugs from test infrastructure artifacts

**Prevention:**
- Clear the `rate_limits` table in Playwright global setup (part of the DB reset)
- Use unique email addresses per test run (timestamp-based: `test_${Date.now()}@example.com`)
- In integration tests, mock or disable rate limiting for the test environment by checking
  an env variable: `if (env.TEST_MODE === 'true') skip rate limiting`
- Do not test the rate limiting behavior in E2E tests that also test auth flow — keep
  rate limit testing as a dedicated, isolated test suite

**Detection:** Tests that fail with 503 after previously passing, especially after
running the full test suite multiple times.

**Phase:** Auth flow testing phase.

---

### Pitfall 10: `client:load` React Islands Need Time to Hydrate

**What goes wrong:** Playwright navigates to a page and immediately tries to interact
with a React island (e.g., the `ReviewForm`, the Google Maps address autocomplete, or
the admin dashboard dropdowns). The SSR HTML is present, but the React island has not yet
hydrated. Clicks on buttons do nothing; form submissions fail silently.

**Why it happens:** Astro's island architecture renders React components server-side as
static HTML, then hydrates them client-side when the `client:load` directive fires.
Between page load and hydration completion, the DOM is present but event handlers are not
attached.

**Consequences:**
- Tests click a button, nothing happens, and the assertion times out
- Tests that work in headed mode (where the developer can see the page) fail in headless
  mode because timing is tighter

**Prevention:**
Wait for the `astro-island` element to finish hydrating before interacting:

```typescript
// Wait for the island to hydrate (ssr attribute is removed after hydration)
await page.waitForSelector('astro-island[uid]:not([ssr])');
// Or wait for a specific interactive element to be ready
await page.waitForSelector('[data-testid="review-form-submit"]:not([disabled])');
// Or use role-based waitFor
await page.getByRole('button', { name: 'Submit Review' }).waitFor({ state: 'visible' });
```

For form tests, prefer `page.waitForLoadState('networkidle')` after navigation to ensure
all islands have hydrated before interaction.

**Detection:** Tests that click interactive elements and then time out waiting for a
navigation or response.

**Phase:** E2E testing of review submission, address autocomplete, and admin UI.

---

### Pitfall 11: Scoring Aggregate Tests Against Empty Buildings Are Misleading

**What goes wrong:** Tests that assert score display for a building with zero or one
review pass because the "0 reviews" state is handled, but they do not exercise the
weighted scoring calculation, the privacy-preserving fuzzy display thresholds, or the
aggregation logic. The test gives false confidence.

**Why it happens:** It is easier to write tests against empty states than to write tests
that require seeded data in a specific state. Without a robust seed, tests cluster around
zero-data states.

**Consequences:**
- The scoring system bugs (wrong weights, wrong aggregation) go undetected until real
  users appear
- The `building_scores` and `landlord_scores` tables are never exercised by tests

**Prevention:**
- Seed buildings with known score data (pre-calculated expected aggregate scores) and
  write assertions against those specific values
- Test the scoring calculation directly in unit tests with the actual weights from
  `src/lib/scoring.ts` — do not rely on E2E tests to catch scoring bugs
- Include at least one building in the seed with 5+ reviews to exercise the display
  threshold for aggregate scores

**Detection:** Test coverage report shows `src/lib/scoring.ts` at low coverage while
E2E tests show green.

**Phase:** Data seeding phase and unit test phase.

---

### Pitfall 12: Over-Engineering the Test Infrastructure

**What goes wrong:** Spending the milestone building a full test fixture framework,
factory functions for every model, a custom test database reset utility, a mock Resend
email server, parallel test workers, and a CI matrix — before writing a single meaningful
test. The milestone ends with infrastructure but no coverage.

**Why it happens:** Testing infrastructure work feels productive. It is satisfying to
build factories and fixtures. But for a pre-launch app with one developer and a small
schema, this is premature optimization.

**Consequences:**
- The milestone delivers zero bug findings
- The infrastructure becomes a maintenance burden
- Real user-facing bugs (form validation edge cases, score display at low review counts,
  admin action audit trail correctness) go untested

**Prevention:**
For this app's scale, the right testing investment is:

| What | Do | Don't |
|------|----|-------|
| Scoring logic | Vitest unit tests with real weights | Mock the scoring module |
| E2E auth | Programmatic sign-in fixture, reuse across tests | Build a full auth test framework |
| Data seeding | One seed SQL file with ~10 buildings, ~5 landlords, ~30 reviews | Factory functions per model |
| Email testing | Assert the API endpoint was called (check logs) | Run a local SMTP server |
| Stress testing | Seed 200 buildings, check UI render time visually | Load test with k6 against production |
| CI | Run Playwright against local wrangler pages dev | Build a staging environment |

Use the simplest tool that answers the question. A well-written seed SQL file and 20
focused Playwright tests will find more bugs than 200 lines of fixture infrastructure.

**Detection:** If you have written more test helper code than actual test code after 2
days, stop and write tests.

**Phase:** All phases. Apply the principle from day one.

---

## Minor Pitfalls

---

### Pitfall 13: Resend Email Cannot Be Tested in Local D1 Environment

**What goes wrong:** The email verification flow (sign-up triggers verification email)
calls the Resend API. In local development, `wrangler pages dev` does not mock Resend.
Real emails will be sent to real addresses if the `RESEND_API_KEY` secret is present in
the local environment, or the call will fail silently if it is not.

**Prevention:**
- Do not set `RESEND_API_KEY` in the local `.dev.vars` file for testing
- The app already handles graceful email failure (signup succeeds even if email fails)
  — this means E2E tests for sign-up will pass even without email delivery
- For email verification testing specifically, test the token endpoint directly: create a
  user, read the token from the local D1 `email_verification_tokens` table using
  `wrangler d1 execute --local`, and call the verification endpoint with that token
- Do not add a local email mock server (Mailhog, etc.) — it is not worth the complexity
  for this use case

**Phase:** Auth flow E2E testing phase.

---

### Pitfall 14: `unixepoch()` Timestamps Make Date Comparisons Tricky in Tests

**What goes wrong:** Tests that assert "review created today" or "token expires in 24
hours" use JavaScript `Date` comparison against SQLite `unixepoch()` values. Off-by-one
errors in timezone handling, or forgetting to multiply by 1000 (SQLite stores seconds,
JavaScript uses milliseconds), cause test assertions to fail or, worse, pass incorrectly.

**Why it happens:** The project correctly uses `unixepoch()` for timestamps (per
`CLAUDE.md`). But converting these for test assertions is error-prone.

**Prevention:**
- In test assertions, always convert: `new Date(row.created_at * 1000)`
- For "is this recent?" checks, use a range: `expect(row.created_at).toBeGreaterThan(Date.now() / 1000 - 60)`
- Do not assert exact timestamps — assert within a reasonable window (e.g., "within the
  last 5 seconds")

**Phase:** Any integration test writing assertions against timestamp fields.

---

### Pitfall 15: Playwright Tests Against a Cold Cloudflare Pages Preview Are Slow and Flaky

**What goes wrong:** The current `playwright.config.ts` points at a preview URL. Cold
starts on Cloudflare Workers can add 300-800ms to the first request of a test run. Tests
with 30-second timeouts may pass but only by burning most of the timeout budget on cold
start, making them appear flaky in CI.

**Prevention:**
- Switch to local `wrangler pages dev` for all E2E tests (solves this completely)
- If preview URL testing is kept for smoke tests, add a "warm-up" request before the test
  suite starts, or increase the timeout for the first navigation only
- Set `retries: 0` for local tests (retries mask flakiness; cold start is the real cause)

**Phase:** E2E setup phase. Fix the baseURL configuration first.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Data seeding setup | Writing to production D1 by accident (Pitfall 5) | Use `--local` flag, add script guard |
| Data seeding setup | Dirty state between runs (Pitfall 6) | Build reset script first |
| Data seeding setup | Foreign key order violations (Pitfall 7) | Follow insertion order table above |
| E2E test infrastructure | Tests running against live production URL (Pitfall 1) | Switch to `wrangler pages dev` + webServer config |
| E2E auth testing | Trying to automate Google OAuth (Pitfall 4) | Use programmatic session injection |
| E2E auth testing | Rate limits blocking repeated sign-in tests (Pitfall 9) | Clear `rate_limits` table in global setup |
| E2E form testing | React islands not yet hydrated (Pitfall 10) | Use `waitFor` with hydration checks |
| Integration tests | D1 tables not found in test environment (Pitfall 2) | Configure Workers Vitest pool |
| Integration tests | nodejs_compat version mismatch (Pitfall 3) | Pin wrangler version |
| Integration tests | Shared D1 state between test files (Pitfall 8) | Use default `isolatedStorage: true` |
| Unit tests | Empty-state tests give false confidence in scoring (Pitfall 11) | Seed known data, assert exact scores |
| Stress testing | Over-engineering infrastructure (Pitfall 12) | Simple seed SQL + focused tests only |
| Email verification testing | Real emails sent or silently skipped (Pitfall 13) | Bypass Resend, read token from D1 directly |
| Any DB timestamp assertion | Off-by-1000 milliseconds vs seconds (Pitfall 14) | Convert timestamps consistently |
| CI smoke tests | Cold start flakiness on preview URL (Pitfall 15) | Switch to local dev server |

---

## D1-Specific Gotchas Summary

These are the D1 behaviors that differ from standard SQLite and will surprise anyone who
has tested SQLite apps before:

1. **Foreign keys are ON by default.** Standard SQLite has them OFF. Seed order matters
   or you must use `PRAGMA defer_foreign_keys = ON`.

2. **No cross-request transactions.** D1's "single-threaded, processes queries one at a
   time" model means you cannot keep a transaction open across multiple HTTP requests.
   Tests that assume transactional rollback between requests will not work.

3. **The test database is empty.** Even when using `@cloudflare/vitest-pool-workers`,
   the D1 instance starts with no tables. Migrations must be explicitly applied in
   `beforeAll`.

4. **Data persists between `wrangler dev` runs** by default. This is good for development
   but bad for testing. Always reset before a test run.

5. **No `--remote` in Pages dev.** You cannot connect to the production D1 from
   `wrangler pages dev`. The only way to accidentally hit production is via direct
   `wrangler d1 execute --remote` commands. Keep `--remote` out of all scripts.

6. **`isolatedStorage: true`** in the Workers Vitest pool creates a separate D1 per test
   file — not per test. State can still leak between `test()` blocks within the same
   file.

---

## Sources

- [Cloudflare Vitest Integration Docs](https://developers.cloudflare.com/workers/testing/vitest-integration/) — HIGH confidence
- [D1 Local Development Best Practices](https://developers.cloudflare.com/d1/best-practices/local-development/) — HIGH confidence
- [D1 Foreign Keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) — HIGH confidence
- [D1 Platform Limits](https://developers.cloudflare.com/d1/platform/limits/) — HIGH confidence
- [Vitest Isolation and Concurrency](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/) — HIGH confidence
- [Astro Testing Guide](https://docs.astro.build/en/guides/testing/) — HIGH confidence
- [Playwright Authentication](https://playwright.dev/docs/auth) — HIGH confidence
- [Cloudflare Workers SDK Discussion: D1 in Vitest](https://github.com/cloudflare/workers-sdk/discussions/7855) — MEDIUM confidence
- [Vitest workers-sdk Issue #11028: nodejs_compat breaks vitest with newer compat dates](https://github.com/cloudflare/workers-sdk/issues/11028) — MEDIUM confidence
- [Lucia v3 Session Validation](https://v3.lucia-auth.com/guides/validate-session-cookies/) — HIGH confidence
- [Astro React Hydration Issues](https://github.com/withastro/astro/issues/7709) — MEDIUM confidence
- [Playwright Issues Against Shared Database](https://github.com/microsoft/playwright/issues/33699) — MEDIUM confidence
- [Node.js Compatibility in Workers 2025](https://blog.cloudflare.com/nodejs-workers-2025/) — HIGH confidence
