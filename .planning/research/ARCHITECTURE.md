# Architecture Patterns: QA/Stress Testing Integration

**Domain:** QA and stress testing integration for Astro 5 + Cloudflare D1
**Researched:** 2026-02-27
**Overall confidence:** HIGH (verified against official Playwright, Cloudflare D1, and Wrangler docs)

---

## Existing Architecture Overview

The codebase is an Astro 5 SSR app deployed to Cloudflare Pages with a D1 (SQLite) database.
The test infrastructure that already exists:

| Layer | What Exists | Location |
|-------|------------|----------|
| Unit tests | Vitest, 10 test files covering scoring, validation, auth, rate limiting, disputes, audit | `src/lib/__tests__/*.test.ts` |
| E2E tests | Playwright, 2 spec files for navigation and static pages | `e2e/navigation.spec.ts`, `e2e/pages.spec.ts` |
| Smoke tests | Fetch-based script hitting all public URLs | `scripts/smoke-test.ts` |
| Playwright config | Configured but points at preview deployment URL, no local dev server | `playwright.config.ts` |
| Vitest config | `happy-dom` environment, covers `src/**/*.test.{ts,tsx}` | `vitest.config.ts` |

**Critical gap:** The existing Playwright config points at `b3b57132.ratemyplace-64y.pages.dev` (a Cloudflare preview
deployment). Tests cannot run locally or against seeded test data. There is no `webServer` config, no auth
fixtures, no test data seeding, and no stress testing tooling.

---

## How Local D1 Testing Works

### The Storage Layer

Wrangler v3 stores local D1 data at:

```
.wrangler/state/v3/d1/<database-uuid>/db.sqlite
```

This path is created automatically when you run `wrangler dev` or apply migrations with `--local`. The UUID
matches the `database_id` in `wrangler.jsonc` (`7dd2a722-fdd3-4986-b2f7-6d61d069438e`).

Add `.wrangler/` to `.gitignore` if not already present. Never commit local state.

### Applying Migrations Locally

```bash
npx wrangler d1 migrations apply ratemyplace-db --local
```

This applies all 15 existing migration files in order, creating the full schema locally. Wrangler tracks
applied migrations in a `d1_migrations` table in the local SQLite file.

### Seeding Data Locally

Execute SQL files directly against the local database:

```bash
npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/seed.sql
```

Run inline SQL for quick operations:

```bash
npx wrangler d1 execute ratemyplace-db --local --command="SELECT COUNT(*) FROM buildings"
```

### Resetting the Local Database

Create a `scripts/seed/reset.sql` that drops all tables and the migrations table so you can re-apply from
scratch:

```sql
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS disputes;
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS verification_tokens;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS property_managers;
DROP TABLE IF EXISTS review_votes;
DROP TABLE IF EXISTS building_scores;
DROP TABLE IF EXISTS landlord_scores;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS buildings;
DROP TABLE IF EXISTS landlords;
DROP TABLE IF EXISTS d1_migrations;
```

Run with:

```bash
npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/reset.sql
npx wrangler d1 migrations apply ratemyplace-db --local
npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/seed.sql
```

Add an npm script to `package.json`:

```json
"db:reset": "npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/reset.sql",
"db:migrate:local": "npx wrangler d1 migrations apply ratemyplace-db --local",
"db:seed": "npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/seed.sql",
"db:fresh": "npm run db:reset && npm run db:migrate:local && npm run db:seed"
```

**Source:** [Cloudflare D1 Local Development](https://developers.cloudflare.com/d1/best-practices/local-development/),
[D1 SQLite Schema, Migrations and Seeds](https://www.thisdot.co/blog/d1-sqlite-schema-migrations-and-seeds)
(MEDIUM confidence — pattern verified across multiple Cloudflare sources)

---

## Running Playwright Against Astro Dev Server

### The Problem with Current Config

The existing `playwright.config.ts` hardcodes a preview URL:

```typescript
baseURL: process.env.BASE_URL || 'https://b3b57132.ratemyplace-64y.pages.dev',
```

This means E2E tests always run against a live remote deployment. There is no local server startup, no
ability to run against seeded data, and tests are dependent on remote availability.

### The Fix: webServer + wrangler dev

Astro with the Cloudflare adapter uses `wrangler pages dev` (or `astro dev` in local mode) for local
development. Playwright's `webServer` option can start the dev server before tests:

```typescript
// playwright.config.ts (revised)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Required for shared local D1 state
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4321',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npx astro dev',
    url: 'http://localhost:4321',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      dependencies: ['setup'],
    },
  ],
  outputDir: 'test-results/',
  reporter: process.env.CI ? [['github'], ['html']] : [['list']],
});
```

**Key decisions:**
- `workers: 1` prevents parallel tests from conflicting on the shared local D1 state
- `BASE_URL` env var allows remote runs against preview/production URLs (existing smoke test behavior)
- `process.env.CI ? 2 : 0` retries — none locally (faster feedback), 2 in CI (handles flakiness)
- `webServer: undefined` when `BASE_URL` is set lets existing remote E2E workflow continue unchanged

**Source:** [Playwright webServer docs](https://playwright.dev/docs/test-webserver),
[Astro Testing Guide](https://docs.astro.build/en/guides/testing/) (HIGH confidence — official docs)

---

## Authentication Fixtures for E2E Tests

The existing E2E tests only cover unauthenticated flows. Testing review submission, admin moderation,
and disputes requires authenticated sessions.

### Recommended Pattern: Project Dependencies + storageState

Use Playwright's recommended project dependencies approach (preferred over global setup — it produces
traces and appears in HTML reports):

```
e2e/
  global.setup.ts         # Creates test users, seeds auth state
  global.teardown.ts      # Cleans up test users
  fixtures.ts             # Exports typed fixtures with auth contexts
  navigation.spec.ts      # Existing, uses default (unauthenticated) context
  pages.spec.ts           # Existing, uses default (unauthenticated) context
  auth/
    signup.spec.ts        # NEW: Tests signup, email verification flow
    signin.spec.ts        # NEW: Tests signin, signout, wrong password
  review/
    submit.spec.ts        # NEW: Uses authedUser fixture
    edge-cases.spec.ts    # NEW: Long inputs, special chars, boundary values
  admin/
    moderation.spec.ts    # NEW: Uses adminUser fixture
    disputes.spec.ts      # NEW: Uses adminUser fixture
  security/
    auth-bypass.spec.ts   # NEW: Uses default context (unauthenticated)
    rate-limit.spec.ts    # NEW: API endpoint hammering
  stress/
    ui-scale.spec.ts      # NEW: Many items, scroll, pagination
playwright/.auth/
  user.json               # Stored session for regular user (gitignored)
  admin.json              # Stored session for admin user (gitignored)
```

### global.setup.ts Pattern

```typescript
// e2e/global.setup.ts
import { test as setup } from '@playwright/test';
import path from 'path';

const USER_AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');
const ADMIN_AUTH_FILE = path.join(__dirname, '../playwright/.auth/admin.json');

setup('authenticate as regular user', async ({ page }) => {
  // Use pre-seeded test user (created by db:seed)
  await page.goto('/auth/signin');
  await page.fill('input[name="email"]', 'testuser@ratemyplace.test');
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('/profile');
  await page.context().storageState({ path: USER_AUTH_FILE });
});

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/auth/signin');
  await page.fill('input[name="email"]', 'admin@ratemyplace.test');
  await page.fill('input[name="password"]', 'AdminPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('/admin');
  await page.context().storageState({ path: ADMIN_AUTH_FILE });
});
```

### fixtures.ts Pattern

```typescript
// e2e/fixtures.ts
import { test as base } from '@playwright/test';
import path from 'path';

export const test = base.extend({
  authedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: path.join(__dirname, '../playwright/.auth/user.json'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: path.join(__dirname, '../playwright/.auth/admin.json'),
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from '@playwright/test';
```

Usage in a spec:

```typescript
import { test, expect } from '../fixtures';

test('submit a review', async ({ authedPage }) => {
  await authedPage.goto('/review/new');
  // ...
});
```

**Source:** [Playwright Authentication](https://playwright.dev/docs/auth),
[Playwright Global Setup/Teardown](https://playwright.dev/docs/test-global-setup-teardown) (HIGH confidence — official docs)

---

## Test Data Seeding Architecture

### Where Seed Files Live

```
scripts/
  seed/
    reset.sql             # DROP all tables + d1_migrations
    seed.sql              # Main seed — calls includes below
    data/
      landlords.sql       # 10 realistic Boston landlords
      buildings.sql       # 30 buildings across Boston neighborhoods
      users.sql           # Test users (regular + admin + verified)
      reviews.sql         # 100+ reviews with full 27-field scores
      disputes.sql        # 5-10 disputes in various states
      building_scores.sql # Pre-computed aggregate scores
      landlord_scores.sql # Pre-computed aggregate scores
```

### Seed Data Design Constraints

D1 uses Cloudflare's SQLite, which means IDs must be text strings (Lucia generates them via
`generateIdFromEntropySize`). The seed SQL must use hardcoded text IDs so foreign keys resolve
correctly:

```sql
-- landlords.sql
INSERT INTO landlords (id, name, slug, description, website, phone, email, created_at, updated_at)
VALUES
  ('lnd_0001', 'Harbor Point Properties', 'harbor-point-properties',
   'Large property management company operating across South Boston and Dorchester',
   'https://harborpoint.example.com', '617-555-0101', 'contact@harborpoint.example.com',
   unixepoch(), unixepoch()),
  ('lnd_0002', 'Cambridge Street Realty', 'cambridge-street-realty',
   'Mid-size landlord managing buildings in Allston and Brighton',
   NULL, '617-555-0202', NULL,
   unixepoch(), unixepoch());
  -- ... 8 more
```

```sql
-- users.sql
-- Passwords are bcrypt hashes of known test passwords
-- Regular user: testuser@ratemyplace.test / TestPassword123!
-- Admin: admin@ratemyplace.test / AdminPassword123!
INSERT INTO users (id, email, email_verified, hashed_password, is_admin, created_at, updated_at)
VALUES
  ('usr_test_regular', 'testuser@ratemyplace.test', 1, '<bcrypt_hash>', 0, unixepoch(), unixepoch()),
  ('usr_test_admin', 'admin@ratemyplace.test', 1, '<bcrypt_hash>', 1, unixepoch(), unixepoch()),
  ('usr_test_unverified', 'unverified@ratemyplace.test', 0, '<bcrypt_hash>', 0, unixepoch(), unixepoch());
```

**Important:** Pre-compute bcrypt hashes offline and hardcode them. The seed script runs via `wrangler d1
execute` which cannot run Node.js async logic — it only executes SQL. Use a one-time helper script
(`scripts/seed/gen-hashes.ts`) to generate hashes, then paste results into `users.sql`.

```typescript
// scripts/seed/gen-hashes.ts — run once to generate, then hardcode output
import { hash } from '../src/lib/password';

const passwords = {
  testuser: 'TestPassword123!',
  admin: 'AdminPassword123!',
  unverified: 'TestPassword123!',
};

for (const [name, pw] of Object.entries(passwords)) {
  const h = await hash(pw);
  console.log(`-- ${name}: ${h}`);
}
```

### Review Data for Volume Testing

Reviews require the full 27-field structure. Create at least 5 reviews per building for meaningful
aggregate scores, and vary the scores to test the weighted scoring display:

```sql
-- reviews.sql (excerpt showing 27-field structure)
INSERT INTO reviews (
  id, user_id, building_id,
  -- Tenancy
  move_in_year, move_in_season, move_out_year, move_out_season, is_current_tenant,
  unit_type, rent_amount,
  -- Unit scores (10 fields)
  unit_structural, unit_plumbing, unit_electrical, unit_climate, unit_ventilation,
  unit_pests, unit_mold, unit_appliances, unit_layout, unit_accuracy,
  -- Building scores (9 fields)
  building_common_areas, building_security, building_exterior, building_noise_neighbors,
  building_noise_external, building_mail, building_laundry, building_parking, building_trash,
  -- Landlord scores (8 fields)
  landlord_maintenance, landlord_communication, landlord_professionalism, landlord_lease_clarity,
  landlord_privacy, landlord_deposit, landlord_rent_practices, landlord_non_retaliation,
  -- Flags
  had_pests, had_heat_issues, had_water_issues, had_security_deposit_issues, had_eviction_threat,
  would_recommend_new, comments,
  -- Moderation
  status, created_at, updated_at
) VALUES (
  'rev_0001', 'usr_test_regular', 'bld_0001',
  2023, 'fall', NULL, NULL, 1,
  '2br', 2800,
  4, 3, 5, 2, 4,
  1, 2, 4, 4, 3,
  3, 4, 4, 3, 4, 5, 2, 1, 4,
  2, 3, 4, 4, 5, 3, 3, 4,
  1, 1, 0, 0, 0,
  'yes', 'Good location but pest issues and poor climate control',
  'approved', unixepoch() - 86400 * 30, unixepoch() - 86400 * 30
);
```

### Building Scores Must Be Pre-Computed

The `building_scores` and `landlord_scores` tables are denormalized aggregates. After inserting reviews,
compute and insert these rows. Do this in SQL using AVG() queries referencing your seeded review IDs,
or create a `scripts/seed/compute-scores.ts` helper that runs after seeding.

**Source:** [D1 SQLite Schema, Migrations and Seeds](https://www.thisdot.co/blog/d1-sqlite-schema-migrations-and-seeds),
Cloudflare D1 local development docs (MEDIUM confidence — pattern adapted from D1 community examples)

---

## Stress Testing Architecture

### Tool: autocannon (not k6)

Use autocannon over k6 for this project because:

- autocannon is a Node.js npm package — no separate binary install required
- The project already uses Node.js tooling (tsx, vitest)
- k6 uses a different JS runtime (goja/Go) which can complicate CI setup
- autocannon results are comparable to wrk for Node.js targets

```bash
npm install -D autocannon
```

### Stress Test Script Structure

```
scripts/
  stress/
    config.ts             # Base URL, endpoints list, default options
    rate-limits.ts        # Hammer auth endpoints to verify 429 responses
    review-submit.ts      # Concurrent review API hits
    search-load.ts        # Search page with many concurrent users
    building-page.ts      # Building page with 50+ reviews
    run-all.ts            # Orchestrate all stress tests, report results
```

```typescript
// scripts/stress/config.ts
export const BASE_URL = process.env.STRESS_TARGET || 'http://localhost:4321';
export const DURATION_SECONDS = 10;
export const CONNECTIONS = 20;

export const endpoints = {
  home: '/',
  search: '/search',
  buildingPage: '/building/harbor-point-southie-1', // seeded building slug
  adminReviews: '/admin/reviews',
};
```

```typescript
// scripts/stress/rate-limits.ts
import autocannon from 'autocannon';
import { BASE_URL } from './config';

const instance = autocannon({
  url: `${BASE_URL}/api/auth/signin`,
  connections: 50,
  duration: 10,
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'flood@test.com', password: 'wrong' }),
}, (err, result) => {
  // Expect: ~95%+ of responses are 429 after threshold
  const non429 = result.responses - (result['4xx'] ?? 0);
  console.log(`Rate limit stress: ${result['4xx']} 4xx / ${result.requests.total} total`);
});

autocannon.track(instance, { renderProgressBar: true });
```

Add npm script:

```json
"stress": "npx tsx scripts/stress/run-all.ts",
"stress:rate-limits": "npx tsx scripts/stress/rate-limits.ts"
```

**Source:** [AutoCannon GitHub](https://github.com/mcollina/autocannon),
[AutoCannon npm](https://www.npmjs.com/package/autocannon) (HIGH confidence — stable, widely used tool)

---

## Component Boundaries

### New Components (create from scratch)

| Component | Location | Purpose |
|-----------|----------|---------|
| `global.setup.ts` | `e2e/global.setup.ts` | Auth session setup using project dependencies pattern |
| `global.teardown.ts` | `e2e/global.teardown.ts` | Clean up test users created during setup |
| `fixtures.ts` | `e2e/fixtures.ts` | Typed auth fixtures (authedPage, adminPage) |
| `reset.sql` | `scripts/seed/reset.sql` | Full database wipe including d1_migrations table |
| `seed.sql` | `scripts/seed/seed.sql` | Orchestrates seeding, calls data/*.sql |
| `gen-hashes.ts` | `scripts/seed/gen-hashes.ts` | One-time bcrypt hash generator, run manually |
| `landlords.sql` | `scripts/seed/data/landlords.sql` | 10 realistic Boston landlords |
| `buildings.sql` | `scripts/seed/data/buildings.sql` | 30 buildings across neighborhoods |
| `users.sql` | `scripts/seed/data/users.sql` | Test users (regular, admin, unverified) |
| `reviews.sql` | `scripts/seed/data/reviews.sql` | 100+ reviews with full 27-field scores |
| `disputes.sql` | `scripts/seed/data/disputes.sql` | Disputes in pending/resolved states |
| `building_scores.sql` | `scripts/seed/data/building_scores.sql` | Pre-computed aggregate scores |
| `landlord_scores.sql` | `scripts/seed/data/landlord_scores.sql` | Pre-computed aggregate scores |
| `stress/config.ts` | `scripts/stress/config.ts` | Stress test target config |
| `stress/run-all.ts` | `scripts/stress/run-all.ts` | Stress test orchestrator |
| `stress/*.ts` | `scripts/stress/*.ts` | Individual stress test scripts |
| `e2e/auth/*.spec.ts` | New spec files | Auth flow E2E tests |
| `e2e/review/*.spec.ts` | New spec files | Review submission E2E tests |
| `e2e/admin/*.spec.ts` | New spec files | Admin moderation E2E tests |
| `e2e/security/*.spec.ts` | New spec files | Security and auth bypass tests |
| `playwright/.auth/` | New directory | Stored auth states (gitignored) |

### Modified Components (changes to existing files)

| Component | Location | What Changes |
|-----------|----------|-------------|
| `playwright.config.ts` | Root | Add `webServer`, add project dependencies, change `workers: 1`, keep `BASE_URL` env var override |
| `package.json` | Root | Add `db:reset`, `db:migrate:local`, `db:seed`, `db:fresh`, `stress`, `e2e:local` scripts |
| `.gitignore` | Root | Add `playwright/.auth/` to prevent committing session files |

### Unchanged Components

All existing E2E specs (`navigation.spec.ts`, `pages.spec.ts`) continue to work unchanged — they
use the default unauthenticated `page` fixture and make no auth assumptions.

All existing unit tests (`src/lib/__tests__/*.test.ts`) are unaffected. Vitest config is unchanged.

The smoke test script (`scripts/smoke-test.ts`) is unchanged — it targets the remote URL independently.

---

## Data Flow for Test Seeding

```
Developer runs: npm run db:fresh
      |
      v
scripts/seed/reset.sql
  DROP TABLE ... (all tables + d1_migrations)
      |
      v
wrangler d1 migrations apply --local
  Applies 0001_initial.sql through 0015_password_reset_tokens.sql
  Creates full schema in .wrangler/state/v3/d1/<uuid>/db.sqlite
      |
      v
scripts/seed/seed.sql
  \include scripts/seed/data/landlords.sql   (10 rows)
  \include scripts/seed/data/buildings.sql   (30 rows)
  \include scripts/seed/data/users.sql       (3 test users)
  \include scripts/seed/data/reviews.sql     (100+ rows)
  \include scripts/seed/data/disputes.sql    (10 rows)
  \include scripts/seed/data/building_scores.sql  (30 rows)
  \include scripts/seed/data/landlord_scores.sql  (10 rows)
      |
      v
Local D1 database now has realistic test data

npm run e2e:local
      |
      v
playwright.config.ts webServer starts: npx astro dev
  Astro dev server at http://localhost:4321
  Cloudflare adapter provides D1 binding from .wrangler/state/...
      |
      v
global.setup.ts runs (project: 'setup')
  Signs in as testuser@ratemyplace.test → saves playwright/.auth/user.json
  Signs in as admin@ratemyplace.test → saves playwright/.auth/admin.json
      |
      v
Test projects run (project: 'chromium', depends on 'setup')
  navigation.spec.ts  — unauthenticated, reads existing nav elements
  pages.spec.ts       — unauthenticated, reads seeded building/search data
  auth/*.spec.ts      — tests sign in/out flows
  review/*.spec.ts    — uses authedPage fixture, submits reviews
  admin/*.spec.ts     — uses adminPage fixture, moderates content
  security/*.spec.ts  — tests auth bypass, injection, rate limits
  stress/ui-scale.spec.ts — large list rendering
```

---

## Environment Separation

| Environment | How to Run | Data Source | Auth |
|-------------|-----------|-------------|------|
| Local (seeded) | `npm run e2e:local` | Local D1 (seeded via `db:fresh`) | storageState from global.setup |
| Remote preview | `BASE_URL=https://... npm run e2e` | Live Cloudflare D1 preview DB | storageState from global.setup (if preview has test users) |
| Production smoke | `npm run smoke` | Production data | None (public pages only) |
| Stress test (local) | `npm run stress` | Local D1 (seeded) | Cookie header from manual login |

The `BASE_URL` env var is the toggle. When set, `webServer` is skipped and Playwright hits the
remote URL directly. When unset, Playwright starts the local dev server.

---

## Build Order for QA Infrastructure

This order respects dependencies: you need data before you can test flows, you need auth before
you can test protected pages, you need seeded data at scale before you can stress test.

### Phase 1: Database Foundation
1. Write `scripts/seed/reset.sql`
2. Verify `wrangler d1 migrations apply ratemyplace-db --local` runs cleanly
3. Manually verify schema with `wrangler d1 execute ratemyplace-db --local --command="SELECT name FROM sqlite_master WHERE type='table'"`
4. Add `db:reset`, `db:migrate:local`, `db:seed`, `db:fresh` npm scripts

**Gate:** `npm run db:fresh` runs without errors

### Phase 2: Seed Data Scripts
1. Write `landlords.sql` (10 landlords with realistic Boston names/neighborhoods)
2. Write `buildings.sql` (30 buildings referencing landlord IDs from step 1)
3. Run `gen-hashes.ts` once to generate bcrypt hashes, paste into `users.sql`
4. Write `users.sql` (regular, admin, unverified test users)
5. Write `reviews.sql` (100+ reviews with full 27-field scores, distributed across buildings)
6. Write `disputes.sql` (10 disputes — some pending, some resolved)
7. Write `building_scores.sql` and `landlord_scores.sql` using pre-computed AVG values
8. Write `seed.sql` that executes all the above in dependency order

**Gate:** `npm run db:fresh` inserts all data without FK constraint errors. Manual query confirms
`SELECT COUNT(*) FROM reviews` returns 100+.

### Phase 3: Playwright Local Config
1. Update `playwright.config.ts` with `webServer`, project dependencies, `workers: 1`
2. Create `e2e/global.setup.ts` using test users from Phase 2
3. Create `e2e/fixtures.ts` with `authedPage` and `adminPage`
4. Create `playwright/.auth/` directory, add to `.gitignore`
5. Run `npm run e2e:local` — confirm existing navigation and pages specs still pass

**Gate:** Existing E2E tests pass locally. `global.setup.ts` successfully authenticates and
creates `.auth/user.json` and `.auth/admin.json`.

### Phase 4: Auth and Review E2E Tests
1. Write `e2e/auth/signin.spec.ts` — sign in, sign out, wrong password, unverified email
2. Write `e2e/auth/signup.spec.ts` — signup flow, email verification redirect
3. Write `e2e/review/submit.spec.ts` — full 27-field review submission using `authedPage`
4. Write `e2e/review/edge-cases.spec.ts` — long inputs, special chars, boundary scores

**Gate:** All auth and review E2E tests pass locally against seeded data.

### Phase 5: Admin E2E Tests
1. Write `e2e/admin/moderation.spec.ts` — approve, reject, flag reviews using `adminPage`
2. Write `e2e/admin/disputes.spec.ts` — view, resolve disputes using `adminPage`
3. Verify admin audit logs are written after each action

**Gate:** Admin flows work end-to-end. Audit log entries verified in DB after admin actions.

### Phase 6: Security E2E Tests
1. Write `e2e/security/auth-bypass.spec.ts` — direct URL access to protected pages while
   unauthenticated, confirm redirects to `/auth/signin`
2. Write `e2e/security/rate-limit.spec.ts` — rapid API calls to auth endpoints, confirm 429
3. Write `e2e/security/admin-access.spec.ts` — non-admin user accessing admin endpoints,
   confirm 403

**Gate:** All security tests pass. Rate limit returns 429 after threshold.

### Phase 7: Stress Testing
1. Install `autocannon` as dev dependency
2. Write `scripts/stress/config.ts`
3. Write `scripts/stress/rate-limits.ts` — verify rate limiting holds under load
4. Write `scripts/stress/search-load.ts` — search page with concurrent users
5. Write `scripts/stress/building-page.ts` — building page with many reviews
6. Write `scripts/stress/run-all.ts` — orchestrate and report
7. Add `stress` npm script

**Gate:** Stress tests run without crashing the dev server. Rate limit endpoint consistently
returns 429 under load. No 500 errors from any endpoint under stress.

---

## Pitfalls to Avoid in This Architecture

### Parallel Test Workers + Shared D1
Do not run Playwright with multiple workers against a local D1 database. Multiple browser contexts
writing to the same SQLite file concurrently will produce race conditions and SQLITE_BUSY errors.
Set `workers: 1` in `playwright.config.ts` for local runs. For CI speed, run the Playwright
workers against the remote preview URL where D1 handles concurrency properly.

### Session Token Format
Lucia v3 uses specific session ID formats. The `global.setup.ts` must sign in through the actual
UI (form submission) rather than directly inserting a session row into the database. The session
cookie name and format are managed by Lucia internally and should not be hand-constructed.

### Review Scores Aggregate Mismatch
The `building_scores` and `landlord_scores` tables are NOT computed on the fly — they are
denormalized caches updated by API logic after review submission/approval. If you seed `reviews`
without seeding the corresponding `building_scores` rows, building profile pages will show no
aggregate data even though reviews exist. Always seed `building_scores.sql` after `reviews.sql`
with matching computed values.

### Email Verification in Test Users
Test users in `users.sql` must have `email_verified = 1`. If `email_verified = 0`, the sign-in
flow will redirect to the verification page instead of the profile, breaking `global.setup.ts`.
The admin user must also have `is_admin = 1`.

### D1 Does Not Support SQL INCLUDE
SQLite (and D1) do not support a `.include` or `.read` directive from the wrangler execute
command. `seed.sql` cannot call other files. Instead, concatenate all data SQL files into a
single file at seed time, or run wrangler execute once per data file in the npm script:

```json
"db:seed": "npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/data/landlords.sql && npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/data/buildings.sql && ..."
```

**Confidence:** HIGH — this is a known SQLite limitation. Confirmed no `.include` support in D1
wrangler execute via community sources.

### Stress Testing Against Production
Never point stress test scripts at `ratemyplace.boston`. Cloudflare has abuse detection that will
temporarily block the IP. Stress tests belong only against local or a dedicated staging environment.

---

## Sources

- [Cloudflare D1 Local Development](https://developers.cloudflare.com/d1/best-practices/local-development/) — HIGH confidence
- [Cloudflare D1 Wrangler Commands](https://developers.cloudflare.com/d1/wrangler-commands/) — HIGH confidence
- [D1 SQLite Schema, Migrations and Seeds (This Dot Labs)](https://www.thisdot.co/blog/d1-sqlite-schema-migrations-and-seeds) — MEDIUM confidence
- [Playwright webServer docs](https://playwright.dev/docs/test-webserver) — HIGH confidence
- [Playwright Authentication](https://playwright.dev/docs/auth) — HIGH confidence
- [Playwright Global Setup and Teardown](https://playwright.dev/docs/test-global-setup-teardown) — HIGH confidence
- [Astro Testing Guide](https://docs.astro.build/en/guides/testing/) — HIGH confidence
- [autocannon GitHub](https://github.com/mcollina/autocannon) — HIGH confidence
- [AppSignal — Performance and Stress Testing in Node.js](https://blog.appsignal.com/2025/06/04/performance-and-stress-testing-in-nodejs.html) — MEDIUM confidence
