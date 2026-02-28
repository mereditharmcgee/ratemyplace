---
phase: 06-playwright-local-environment
plan: 01
subsystem: testing
tags: [playwright, e2e, wrangler, d1, auth, fixtures, session]

# Dependency graph
requires:
  - phase: 05-seed-data
    provides: Test users (user@test.ratemyplace.local and admin@test.ratemyplace.local) with hardcoded PBKDF2 password hashes for deterministic E2E sign-in
provides:
  - Playwright config pointing at local wrangler dev server (http://localhost:8788) with setup project dependency chain
  - Global auth setup that creates user.json and admin.json via UI sign-in
  - Custom test fixtures exporting authedPage and adminPage for downstream E2E specs
  - Updated e2e npm scripts with full db:setup + build + playwright pipeline
  - .gitignore exclusion for auth session files
affects:
  - 07-auth-and-review-e2e
  - 08-admin-and-disputes-e2e
  - 09-security-e2e
  - 10-stress-testing-and-ui-at-scale

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Playwright setup project dependency chain: setup project runs global.setup.ts before chromium tests"
    - "Session file pattern: global.setup.ts creates playwright/.auth/user.json and admin.json; fixtures.ts consumes them via storageState"
    - "workers: 1 required for shared local D1 (prevents parallel write conflicts)"
    - "reuseExistingServer: true allows running against pre-started wrangler dev server"

key-files:
  created:
    - e2e/global.setup.ts
    - e2e/fixtures.ts
  modified:
    - playwright.config.ts
    - package.json
    - .gitignore

key-decisions:
  - "baseURL set to http://localhost:8788 (overridable via BASE_URL env var) — no production URLs in test config"
  - "retries: 0 for fail-fast local testing (was 1 in old config)"
  - "workers: 1 required — shared local D1 cannot handle parallel writers"
  - "webServer command: npx wrangler pages dev ./dist --port 8788 with reuseExistingServer: true"
  - "waitForURL('/') used in global.setup.ts because sign-in JS does window.location.href = '/' for both user and admin"
  - "Auth files stored in playwright/.auth/ (gitignored) — not committed to source control"

patterns-established:
  - "Fixture pattern: downstream specs import { test, expect } from './fixtures' to get authedPage/adminPage"
  - "Pipeline pattern: e2e scripts run db:setup (fresh+seed) then build then playwright test"
  - "Session isolation: each fixture creates a fresh browser context with stored auth state and closes it after use"

requirements-completed:
  - INFRA-04
  - INFRA-05

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 6 Plan 01: Playwright Local Environment Summary

**Playwright configured for local wrangler dev server with setup project, dual-role auth session fixtures (authedPage/adminPage), and full db:setup + build + test pipeline**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T19:39:19Z
- **Completed:** 2026-02-28T19:44:12Z
- **Tasks:** 4
- **Files modified:** 5

## Accomplishments

- playwright.config.ts rewritten: local dev server (localhost:8788), workers:1, setup project dependency chain, no production URLs
- e2e/global.setup.ts created: signs in as regular user and admin via UI form, saves session files to playwright/.auth/
- e2e/fixtures.ts created: exports authedPage and adminPage custom fixtures plus re-exported expect
- package.json e2e scripts updated to chain db:setup + build + playwright test pipeline
- .gitignore updated to exclude playwright/.auth/ auth session files

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite playwright.config.ts for local dev server** - `4af84a1` (feat)
2. **Task 2: Create e2e/global.setup.ts with user and admin sign-in** - `9ddbf0f` (feat)
3. **Task 3: Create e2e/fixtures.ts with authedPage and adminPage fixtures** - `399552e` (feat)
4. **Task 4: Update package.json e2e scripts and .gitignore** - `94972bd` (feat)

## Files Created/Modified

- `playwright.config.ts` - Playwright config with local wrangler dev server, workers:1, setup project dependency chain
- `e2e/global.setup.ts` - Auth setup: creates playwright/.auth/ dir, signs in as user and admin, saves session JSON
- `e2e/fixtures.ts` - Custom fixtures: authedPage (user session) and adminPage (admin session) + re-exported expect
- `package.json` - e2e and e2e:headed scripts now chain db:setup + build + playwright test
- `.gitignore` - Added playwright/.auth/ exclusion

## Decisions Made

- `retries: 0` for fail-fast local testing (previous config had 1 retry, which hides intermittent issues during development)
- `reuseExistingServer: true` on webServer block allows running against a pre-started wrangler dev server, speeding up iteration
- `waitForURL('/')` is the correct wait strategy because the sign-in JS handler does `window.location.href = '/'` on success for both roles
- Auth credentials (user@test.ratemyplace.local / admin@test.ratemyplace.local) are hardcoded in global.setup.ts — these are local-only seed users, not secrets

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Verification scripts using inline `node -e "..."` failed due to Windows shell escaping of backslash and exclamation characters. Fixed by writing verification logic to temporary .cjs files and running them as scripts (cleanup: deleted temp files after use). No impact on deliverables.

## User Setup Required

None - no external service configuration required. All files are local configuration.

## Next Phase Readiness

- Playwright infrastructure complete; Phase 7 (Auth and Review E2E) can now write specs importing from `./fixtures`
- Plan 02 (integration verification) will run a smoke check of the actual wrangler + Playwright pipeline before Phase 7 begins
- Note: `npm run e2e` will fail until `e2e/*.spec.ts` files are updated to use the new local baseURL — existing specs may reference the old production preview URL

---
*Phase: 06-playwright-local-environment*
*Completed: 2026-02-28*
