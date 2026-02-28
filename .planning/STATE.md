---
gsd_state_version: 1.0
milestone: v1.3.0
milestone_name: Battle Tested
status: in_progress
last_updated: "2026-02-28T19:44:12Z"
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 12
  completed_plans: 6
---

# Project State

**Project:** RateMyPlace Boston
**Milestone:** v1.3.0 "Battle Tested"
**Updated:** 2026-02-28

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-27)

**Core value:** Tenants can submit honest, anonymous reviews and see aggregated scores
**Current focus:** v1.3.0 — Phase 6 Plan 01 complete (Playwright local environment infrastructure)

## Current Position

Phase: 6 — Playwright Local Environment (in progress — 1/2 plans done)
Plan: 01 complete — playwright.config.ts, global.setup.ts, fixtures.ts, e2e scripts, .gitignore
Status: Plan 01 done — Playwright infrastructure configured for local wrangler dev server; Plan 02 (integration verification) next
Last activity: 2026-02-28 — Completed 06-01-PLAN.md (playwright.config.ts, global.setup.ts, fixtures.ts, package.json, .gitignore)

## v1.3.0 Phase Map

| Phase | Name | Status |
|-------|------|--------|
| 4 | Database Foundation | Complete |
| 5 | Seed Data | Complete (2/2 plans done) |
| 6 | Playwright Local Environment | In progress (1/2 plans done) |
| 7 | Auth and Review E2E | Not started |
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

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 04-database-foundation | 01 | 35min | 2 | 2 |
| 04-database-foundation | 02 | 5min | 2 | 2 |
| 04-database-foundation | 03 | 18min | 3 | 2 |
| 05-seed-data | 01 | 5min | 2 | 2 |
| 05-seed-data | 02 | 39min | 3 | 1 |
| 06-playwright-local-environment | 01 | 5min | 4 | 5 |

## Blockers

None currently.

---
*State updated: 2026-02-28 — Completed 06-01 (playwright.config.ts, global.setup.ts, fixtures.ts, e2e scripts, .gitignore)*
