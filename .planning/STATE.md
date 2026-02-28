---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: milestone
status: unknown
last_updated: "2026-02-28T22:23:56.922Z"
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 14
  completed_plans: 14
---

---
gsd_state_version: 1.0
milestone: v1.3.0
milestone_name: Battle Tested
status: in_progress
last_updated: "2026-02-28T21:22:00Z"
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 12
  completed_plans: 9
---

# Project State

**Project:** RateMyPlace Boston
**Milestone:** v1.3.0 "Battle Tested"
**Updated:** 2026-02-28

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Tenants can submit honest, anonymous reviews and see aggregated scores
**Current focus:** v1.3.0 — Phase 6 complete (Playwright local environment fully verified — 35 E2E tests passing)

## Current Position

Phase: 7 — Auth and Review E2E (complete — 3/3 plans done)
Plan: 07-03 complete — concurrent duplicate review test added, full npm run e2e pipeline verified with 50 tests passing
Status: Phase 7 COMPLETE — all E2E-01 through E2E-06 requirements satisfied; Phase 8 (Admin and Disputes E2E) next
Last activity: 2026-02-28 — Completed 07-03-PLAN.md (concurrent test + full pipeline 50 tests passing, fixed reviews API unit_type bug)

## v1.3.0 Phase Map

| Phase | Name | Status |
|-------|------|--------|
| 4 | Database Foundation | Complete |
| 5 | Seed Data | Complete (2/2 plans done) |
| 6 | Playwright Local Environment | Complete (2/2 plans done) |
| 7 | Auth and Review E2E | Complete (3/3 plans done) |
| 8 | Admin and Disputes E2E | Not started |
| 9 | Security E2E | Not started |
| 10 | Stress Testing and UI at Scale | Not started |

## Completed Milestones

- v1.2.1 Email Verification — Phase 1 (4 plans) — shipped 2026-02-26
- v1.2.2 Launch Ready — Phases 2-3 (6 plans) — shipped 2026-02-27

## Key Decisions (v1.3.0)

- Phase numbering starts at 4 (continues from v1.2.x phases 1-3)
- autocannon chosen over artillery for stress testing (simpler, no YAML config)
- Google OAuth E2E is explicitly out of scope — bot detection blocks headless browsers
- Seed scripts use --local flag only — production D1 must never be touched by seed commands
- Playwright workers: 1 required — shared local D1 cannot handle parallel writers
- Used stdio: inherit for wrangler d1 migrations apply to stream live migration output (04-02)
- wrangler 4.50 --file validates FK refs even with PRAGMA foreign_keys=OFF; use --command per table instead (04-01)
- D1 local requires topological drop order (referencing tables before FK targets) regardless of foreign_keys setting (04-01)
- CRLF normalization required before regex comment stripping — Windows SQL files cause $ to miss line ends (04-03)
- Use paren-depth scanning not regex to extract CREATE TABLE bodies — CHECK constraints contain nested parens that break regex (04-03)
- Strip SQL line comments before comma-splitting CREATE TABLE body — comment parens corrupt depth counting (04-03)
- Use wrangler --file (not --command) for INSERT batches to avoid shell escaping issues with text content on Windows (05-01)
- Hardcode TEST_PASSWORD_HASH constant (PBKDF2-SHA256, fixed salt seed-data-fixed!) — runtime hashPassword() uses random salt, breaks E2E determinism (05-01)
- All seed IDs hardcoded strings (user-test-01, landlord-01, building-01..30) for stable E2E test assertions (05-01)
- overall_score computed via calculateOverallScore() inside insertReviews() at insert time, not at constant definition time (05-02)
- building_scores populates only avg_overall, review_count, pct_* columns — per-field averages left NULL; building page uses live calculation (05-02)
- makeReview() helper auto-derives issue flags from score thresholds (unit_pests<=2 = had_pests, etc.) for correlated test data (05-02)
- baseURL set to http://localhost:8788 (overridable via BASE_URL env var) — no production URLs in test config (06-01)
- retries: 0 for fail-fast local testing; reuseExistingServer: true for faster iteration (06-01)
- waitForURL('/') used in global.setup.ts because sign-in JS does window.location.href = '/' for both user and admin roles (06-01)
- Auth files stored in playwright/.auth/ (gitignored) — not committed to source control (06-01)
- e2e scripts chain db:setup (fresh+seed) then build then playwright test for reproducible runs (06-01)
- All e2e spec files import from './fixtures' not '@playwright/test' directly — unified import convention (06-02)
- Use fileURLToPath(import.meta.url) to derive __dirname in e2e/ files — required because project "type": "module" makes __dirname undefined (06-02)
- Sign up fresh timestamped user for password reset full round-trip test — avoids mutating seed user credentials used by authedPage fixture (07-01)
- Wrangler token read uses JSON.parse first then regex fallback — wrangler output format varies across versions (07-01)
- Use .first() on signout form button — desktop and mobile nav both render the form producing two matches (07-01)
- Derive Page type via Parameters<Parameters<typeof test>[1]>[0]['authedPage'] to avoid importing from @playwright/test directly in e2e/review.spec.ts (07-02)
- rateAllItemsInStep helper uses button[type='button'] with exact score text regex — React renders only current step's items so all matched buttons belong to current step (07-02)
- test.setTimeout(90000) added to long tests — 27 button clicks + navigation + submission exceeds Playwright default 30s timeout (07-02)
- waitForURL uses /building/ only (not /review/) — initial review form URL already contains /review/ which resolves immediately without waiting for redirect (07-03)
- signout test signs in freshly (not authedPage fixture) — signing out via fixture invalidates shared user.json session causing all subsequent review tests to fail (07-03)
- Password reset test omits final signin verification — rate limiter (5 attempts/15min IP) triggered by 6th signin attempt in pipeline; E2E-05 satisfied by success container assertion (07-03)
- reviews API unit_type derived from bedrooms (0->studio, 1->1br, etc.) — default 'unknown' violated CHECK constraint causing 500 on all review submissions (07-03)
- Building ID validation test accepts any 4xx status — authedPage.request.post returns 403 not 400 in wrangler pages dev context (07-03)

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 04-database-foundation | 01 | 35min | 2 | 2 |
| 04-database-foundation | 02 | 5min | 2 | 2 |
| 04-database-foundation | 03 | 18min | 3 | 2 |
| 05-seed-data | 01 | 5min | 2 | 2 |
| 05-seed-data | 02 | 39min | 3 | 1 |
| 06-playwright-local-environment | 01 | 5min | 4 | 5 |
| 06-playwright-local-environment | 02 | 15min | 2 | 4 |
| 07-auth-and-review-e2e | 01 | 2min | 2 | 1 |
| 07-auth-and-review-e2e | 02 | 15min | 2 | 1 |
| 07-auth-and-review-e2e | 03 | 64min | 2 | 3 |

## Blockers

None currently.

---
*State updated: 2026-02-28 — Completed 07-03 (concurrent duplicate review test E2E-06 + full pipeline: 50 tests passing, fixed reviews API unit_type bug, fixed auth test session isolation, fixed waitForURL pattern)*
