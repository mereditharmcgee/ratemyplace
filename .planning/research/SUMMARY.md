# Research Summary: v1.3.0 "Battle Tested" QA Milestone

**Project:** RateMyPlace Boston
**Synthesized:** 2026-02-27
**Research files:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

---

## Executive Summary

RateMyPlace Boston enters v1.3.0 with a solid foundation: 130 passing Vitest unit tests covering scoring, validation, auth, rate limiting, and disputes, plus 2 Playwright spec files covering unauthenticated page navigation. The critical gap is that every meaningful user flow — review submission, admin moderation, dispute filing, auth signup/verification, password reset — has zero E2E coverage. All existing Playwright tests run against a live Cloudflare Pages preview URL, meaning any new test that writes data will corrupt production data. This must be fixed before writing a single new spec.

The recommended approach is strictly additive and minimalist: two new npm packages (`@faker-js/faker` for seed data generation, `autocannon` for stress testing), a local test environment built on `wrangler pages dev` with Playwright's `webServer` config, SQL-based seed data applied via `wrangler d1 execute --local`, and Playwright `storageState` for authenticated session reuse. The architecture follows well-documented official patterns from Cloudflare and Playwright with HIGH confidence. The 7-phase build order (DB foundation → seed data → Playwright local config → auth/review E2E → admin E2E → security E2E → stress testing) respects hard dependencies: data must exist before flows can run, auth must work before protected pages can be tested.

The dominant risk is not technical complexity — it is scope creep and infrastructure over-engineering. For a pre-launch app with one developer, 20 focused Playwright tests against seeded local data will find more real bugs than an elaborate test framework. The pitfalls that will actually bite are: tests accidentally writing to production D1, dirty local D1 state between runs, Google OAuth being impossible to automate, React island hydration timing, and rate limit table pollution blocking auth flow tests. All of these have documented mitigations.

---

## Key Findings

### From STACK.md — Technology Additions

**Packages to add (only 2):**

| Package | Version | Purpose |
|---------|---------|---------|
| `@faker-js/faker` | `^10.3.0` | Realistic seed data generation |
| `autocannon` | latest | HTTP stress testing (Node.js native, no binary install) |

**No new packages needed for:**
- Auth state in E2E — Playwright `storageState` is built in
- Local dev server — `wrangler pages dev` already available via npx
- Network mocking — Playwright `page.route()` is built in
- Database seeding execution — `wrangler d1 execute --local --file` is the official pattern

**Critical version note:** `wrangler pages dev` (not `astro preview`) is required for local E2E — `astro preview` does NOT wire up D1 bindings. ARCHITECTURE.md recommends `astro dev` while STACK.md recommends `wrangler pages dev ./dist`. The safe default is `npx astro dev` which uses the Cloudflare adapter in dev mode; validate which command provides D1 binding before committing to either.

**What NOT to add:** Cypress, Miniflare directly, `@cloudflare/vitest-pool-workers` (for this milestone), Drizzle ORM, k6, Locust, MSW, visual regression tools.

---

### From FEATURES.md — Coverage Priorities

**Table stakes (milestone is incomplete without these):**

1. Seed script: ~20-30 buildings, 10-15 landlords, 50-100 reviews, 5-10 disputes, 3 test users
2. Authenticated E2E: full review submission (27-field form, the core product flow)
3. Authenticated E2E: auth flows (signup, email verification, signin, signout, password reset)
4. Authenticated E2E: admin moderation (approve/reject reviews, resolve disputes)
5. Authenticated E2E: landlord dispute filing
6. Edge case: long inputs, special characters, Unicode, form boundary values
7. Security: auth bypass attempts, SQL injection probes, XSS probe, rate limiting enforcement
8. UI stress: building profile with 20+ reviews, empty states, responsive layout at scale

**Differentiators (valuable but not blocking):**
- Concurrent duplicate review submission prevention
- Admin audit log accuracy verification
- Score aggregation correctness against known seeded data
- Token expiry lifecycle testing
- Dispute uniqueness constraint error surface

**Explicitly deferred (do not build):**
- Visual regression / screenshot diffs
- Chaos engineering / fault injection
- DAST scanning (OWASP ZAP, Burp Suite)
- Load testing with Artillery/k6 against production
- CI/CD pipeline setup
- Mutation testing

**Seed data distribution requirements:** At least one building with 20+ reviews, at least one with 0 reviews, scores spanning 1-5, mixed `is_current_tenant`, at least one review near 5000-char limit, `move_in_year` spanning 2019-2025 for recency weighting.

---

### From ARCHITECTURE.md — Structure and Patterns

**Directory layout for new test infrastructure:**

```
e2e/
  global.setup.ts        # Auth session setup (project dependencies pattern)
  global.teardown.ts     # Cleanup
  fixtures.ts            # authedPage and adminPage typed fixtures
  auth/                  # signin, signup specs
  review/                # submit, edge-cases specs
  admin/                 # moderation, disputes specs
  security/              # auth-bypass, rate-limit, admin-access specs
  stress/                # ui-scale spec

scripts/seed/
  reset.sql              # DROP all tables including d1_migrations
  seed.sql               # Orchestrates data files (run via separate wrangler calls)
  gen-hashes.ts          # One-time bcrypt hash generator
  data/
    landlords.sql        # 10 landlords with hardcoded text IDs
    buildings.sql        # 30 buildings
    users.sql            # Regular, admin, unverified test users
    reviews.sql          # 100+ reviews with full 27-field scores
    disputes.sql         # 5-10 disputes
    building_scores.sql  # Pre-computed aggregates (required — not auto-computed)
    landlord_scores.sql  # Pre-computed aggregates

scripts/stress/
  config.ts, rate-limits.ts, search-load.ts, building-page.ts, run-all.ts

playwright/.auth/        # user.json, admin.json (gitignored)
```

**Key architectural constraints:**
- `workers: 1` in `playwright.config.ts` — shared local D1 cannot handle parallel writers
- D1 does NOT support SQL INCLUDE — run `wrangler d1 execute` once per data file in the npm script chain
- `building_scores` and `landlord_scores` are denormalized caches — must be seeded separately after reviews, not auto-computed
- Test users must have `email_verified = 1` or `global.setup.ts` login will fail
- Admin user must have `is_admin = 1`
- Bcrypt hashes must be pre-generated offline (`gen-hashes.ts`) and hardcoded in `users.sql`
- Session setup must go through the UI sign-in form — do not hand-construct Lucia session tokens

**npm scripts to add:**
```json
{
  "db:reset": "npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/reset.sql",
  "db:migrate:local": "npx wrangler d1 migrations apply ratemyplace-db --local",
  "db:seed": "npx wrangler d1 execute ratemyplace-db --local --file=./scripts/seed/data/landlords.sql && ...",
  "db:fresh": "npm run db:reset && npm run db:migrate:local && npm run db:seed",
  "e2e:local": "BASE_URL=http://localhost:4321 npx playwright test",
  "stress": "npx tsx scripts/stress/run-all.ts"
}
```

---

### From PITFALLS.md — Top Risks and Mitigations

**Critical pitfalls (will definitely cause failures or data corruption):**

| Pitfall | Risk | Prevention |
|---------|------|------------|
| Playwright currently points at live production URL | Any new data-writing test corrupts production D1 | Fix `playwright.config.ts` webServer + baseURL FIRST, before any other work |
| Seeding with `--remote` flag | Fake data appears publicly on ratemyplace.boston | Never use `--remote` in seed scripts; use `--local` exclusively; add script guard |
| Dirty local D1 state between runs | Tests pass first run, fail second run (stale data, duplicate key errors) | Build `db:fresh` reset script; run it in Playwright global setup |
| Google OAuth cannot be automated | Hours lost, flaky CI, account bans | Use email/password test accounts only; mark OAuth tests as `test.skip` |
| D1 migrations not run in Vitest | `no such table` errors in any integration test | Use `@cloudflare/vitest-pool-workers` with `applyD1Migrations()` for DB tests |

**Moderate pitfalls (significant time waste):**

| Pitfall | Risk | Prevention |
|---------|------|------------|
| Rate limit table blocks auth tests | Auth flow tests fail after 3rd+ run with 503 | Clear `rate_limits` in global setup; isolate rate limit tests |
| React island hydration timing | Playwright clicks buttons before event handlers attach | Use `waitFor` with hydration checks; `waitForLoadState('networkidle')` |
| Foreign key insertion order | Seed fails with FK constraint on first run | Follow order: landlords → buildings → users → reviews → scores → disputes |
| D1 no cross-request transactions | Concurrent duplicate submissions may 500 instead of 409 | Document as known behavior; test and note the actual error surface |
| Over-engineering test infrastructure | Milestone ends with zero bug findings | Write tests before fixtures; stop if helper code exceeds test code after 2 days |

**D1-specific gotchas (differ from standard SQLite):**
- Foreign keys are ON by default (unlike SQLite default)
- No cross-request transactions
- Test database starts empty — migrations must be explicitly applied
- Data persists between `wrangler dev` runs — always reset before test run
- `isolatedStorage: true` isolates per test file, not per test block

---

## Implications for Roadmap

### Recommended Phase Structure

**Phase 1: Database Foundation** (prerequisite for everything)
- Rationale: Nothing else can run without local D1 working correctly
- Deliverable: `npm run db:fresh` executes without errors; schema verified locally
- Key work: `reset.sql`, `db:migrate:local` npm script, schema verification
- Pitfalls: Dirty state (Pitfall 6), production contamination (Pitfall 5)
- Research flag: None — official Cloudflare docs cover this completely

**Phase 2: Seed Data**
- Rationale: All E2E tests, stress tests, and UI scale tests depend on realistic data existing
- Deliverable: 30 buildings, 10 landlords, 100+ reviews, 3 test users, 10 disputes in local D1
- Key work: All `scripts/seed/data/*.sql` files, `gen-hashes.ts`, pre-computed score rows
- Pitfalls: FK insertion order (Pitfall 7), missing score aggregates (Pitfall 11), hardcoded IDs required
- Research flag: None — pattern is clear; main work is writing the actual SQL rows

**Phase 3: Playwright Local Environment**
- Rationale: Must redirect tests away from production URL before writing any data-touching spec
- Deliverable: Existing navigation/pages specs pass locally; `global.setup.ts` creates `.auth/*.json`
- Key work: `playwright.config.ts` `webServer` config, `global.setup.ts`, `fixtures.ts`, `.gitignore` update
- Pitfalls: Production URL contamination (Pitfall 1 — fix this first), `workers: 1` required, local dev server command choice
- Research flag: Validate which local server command (`astro dev` vs `wrangler pages dev`) correctly exposes D1 binding in dev mode

**Phase 4: Auth and Review E2E**
- Rationale: Review submission is the core product value; auth is the gate to all protected flows
- Deliverable: signin, signup, review submission, and form edge case specs passing
- Key work: `e2e/auth/*.spec.ts`, `e2e/review/submit.spec.ts`, `e2e/review/edge-cases.spec.ts`
- Pitfalls: Rate limit table pollution (Pitfall 9), React island hydration (Pitfall 10), Google OAuth blocker (Pitfall 4), Resend email bypass required (Pitfall 13)
- Research flag: None — patterns are clear

**Phase 5: Admin E2E**
- Rationale: Admin dashboard has 9 sub-pages and zero E2E coverage; moderation is critical pre-launch
- Deliverable: Approve/reject reviews, resolve disputes, audit log entries verified
- Key work: `e2e/admin/moderation.spec.ts`, `e2e/admin/disputes.spec.ts`
- Pitfalls: Admin `storageState` setup must succeed in Phase 3 first
- Research flag: None

**Phase 6: Security E2E**
- Rationale: Auth bypass and admin access control are the highest-severity untested paths
- Deliverable: 401 on unauthenticated API calls, 403 on non-admin to admin endpoints, 429 on rate limit threshold
- Key work: `e2e/security/auth-bypass.spec.ts`, `e2e/security/rate-limit.spec.ts`, `e2e/security/admin-access.spec.ts`
- Pitfalls: Keep rate limit tests isolated — do not mix with auth flow tests
- Research flag: None

**Phase 7: Stress Testing**
- Rationale: Validates rate limiting holds under load and UI renders correctly at volume
- Deliverable: `npm run stress` runs without crashing; rate limit endpoint returns 429 consistently under load
- Key work: `scripts/stress/*.ts`, `autocannon` install
- Pitfalls: Never point at production (Cloudflare abuse detection); run only against local or dedicated preview
- Research flag: None — autocannon is straightforward for this use case

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Stack | HIGH | All core recommendations backed by official Cloudflare, Playwright, and Astro docs; only Artillery (STACK.md) vs autocannon (ARCHITECTURE.md) conflict exists |
| Features | HIGH | Grounded in direct codebase inspection of existing test infrastructure; coverage gaps are directly observable |
| Architecture | HIGH | Official Playwright auth docs, Cloudflare D1 docs; file structure and patterns are concrete and actionable |
| Pitfalls | HIGH | Most pitfalls are based on official docs (D1 FK behavior, vitest isolation, storageState) plus confirmed GitHub issues |

**Tool conflict to resolve:** STACK.md recommends `artillery` for load testing; ARCHITECTURE.md recommends `autocannon`. Both are valid. `autocannon` is simpler (no YAML config, pure Node.js API, lighter weight) and better suited to this project's scale. Recommend `autocannon` and skip Artillery unless YAML scenario scripts become necessary.

**One MEDIUM confidence area:** The exact local dev server command for Playwright `webServer`. STACK.md says `wrangler pages dev ./dist` (requires build step, serves compiled output), ARCHITECTURE.md says `npx astro dev` (no build step, faster startup, dev server mode). This must be validated before Phase 3 — run both and confirm which one correctly serves D1 data from `.wrangler/state/`.

---

## Gaps to Address

1. **Local dev server command validation** — Must test whether `astro dev` or `wrangler pages dev` correctly provides D1 binding in the Cloudflare Astro adapter's local mode before writing the `webServer` config.

2. **`db:seed` npm script exact form** — D1 does not support SQL INCLUDE directives. The seed npm script must chain multiple `wrangler d1 execute` calls (one per data file). The exact chained command needs to be written out in full before implementation begins.

3. **Email verification bypass strategy** — For auth flow E2E, the seed must insert pre-verified users (`email_verified = 1`). For testing the verification flow itself, tokens must be read directly from local D1. Confirm the Resend API key is absent from `.dev.vars` before running auth tests.

4. **bcrypt hash generation** — `gen-hashes.ts` must be run once manually before `users.sql` can be written. This is a one-time step that requires access to the app's password hashing function and cannot be skipped.

---

## Aggregated Sources

| Source | Confidence | Used By |
|--------|------------|---------|
| [Cloudflare D1 Wrangler Commands](https://developers.cloudflare.com/d1/wrangler-commands/) | HIGH | STACK, ARCHITECTURE |
| [Cloudflare D1 Local Development](https://developers.cloudflare.com/d1/best-practices/local-development/) | HIGH | STACK, ARCHITECTURE, PITFALLS |
| [Cloudflare D1 Foreign Keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) | HIGH | PITFALLS |
| [Playwright Authentication Docs](https://playwright.dev/docs/auth) | HIGH | STACK, FEATURES, ARCHITECTURE, PITFALLS |
| [Playwright webServer Docs](https://playwright.dev/docs/test-webserver) | HIGH | ARCHITECTURE |
| [Playwright Global Setup/Teardown](https://playwright.dev/docs/test-global-setup-teardown) | HIGH | ARCHITECTURE |
| [Astro Testing Guide](https://docs.astro.build/en/guides/testing/) | HIGH | STACK, ARCHITECTURE |
| [Astro Cloudflare Integration Docs](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) | HIGH | STACK |
| [Cloudflare Workers Vitest Integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) | HIGH | FEATURES, PITFALLS |
| [Vitest Isolation and Concurrency (Cloudflare)](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/) | HIGH | PITFALLS |
| [Faker.js v10 Docs](https://fakerjs.dev/guide/) | HIGH | STACK |
| [autocannon GitHub](https://github.com/mcollina/autocannon) | HIGH | ARCHITECTURE |
| [OWASP Top 10:2025 A05 Injection](https://owasp.org/Top10/2025/A05_2025-Injection/) | HIGH | FEATURES |
| [D1 SQLite Schema, Migrations and Seeds (This Dot Labs)](https://www.thisdot.co/blog/d1-sqlite-schema-migrations-and-seeds) | MEDIUM | STACK, ARCHITECTURE |
| [Artillery HTTP Engine Docs](https://www.artillery.io/docs/reference/engines/http) | MEDIUM | STACK |
| [workers-sdk Issue #11028: nodejs_compat breaks vitest](https://github.com/cloudflare/workers-sdk/issues/11028) | MEDIUM | PITFALLS |
| [Lucia v3 Session Validation](https://v3.lucia-auth.com/guides/validate-session-cookies/) | HIGH | PITFALLS |
| Direct codebase inspection (`e2e/`, `src/lib/__tests__/`, `scripts/`, `package.json`) | HIGH | FEATURES, ARCHITECTURE |
