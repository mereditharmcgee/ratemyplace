---
phase: 07-auth-and-review-e2e
plan: 02
subsystem: testing
tags: [playwright, e2e, review-form, multi-step-form, authentication]

# Dependency graph
requires:
  - phase: 06-playwright-local-environment
    provides: fixtures.ts with authedPage/adminPage fixtures and ./fixtures import convention
  - phase: 05-seed-data
    provides: building-30 (45-melnea-cass-blvd) with stable ID and slug for deterministic assertions

provides:
  - e2e/review.spec.ts with 6 test cases covering E2E-03 and E2E-04 requirements
  - Happy-path test exercising all 27 rating fields across 7 form steps
  - Step navigation test verifying Back/Continue with data persistence
  - Validation and auth protection tests

affects: [08-admin-and-disputes-e2e, 09-security-e2e, plan-03-e2e-run]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - rateAllItemsInStep helper avoids data-* attributes by using button[type='button'] with exact score text regex
    - Page type derived from fixture parameter type (not imported from @playwright/test) to satisfy ./fixtures-only import rule
    - test.setTimeout(90000) for long happy-path tests with 27 button clicks

key-files:
  created:
    - e2e/review.spec.ts
  modified: []

key-decisions:
  - "Derive Page type via Parameters<Parameters<typeof test>[1]>[0]['authedPage'] to avoid importing @playwright/test directly"
  - "rateAllItemsInStep uses button[type='button'] with exact score regex - React conditionally renders only current step's items so all matched buttons belong to current step"
  - "Happy-path test uses test.setTimeout(90000) - 27 button clicks + navigation + submission exceeds 30s default"
  - "Unit Details step has no Back button (first visible step when building pre-selected); step navigation test goes to unit-rating then Back"
  - "building_id validation test uses authedPage.request.post to call /api/reviews directly with form data"

patterns-established:
  - "Pattern: rateAllItemsInStep(page, score) helper - reusable across future rating-step tests"
  - "Pattern: waitForLoadState('networkidle') after goto for React hydration before form interaction"
  - "Pattern: locator('button[type=\"button\"]', { hasText: 'Continue' }) for step navigation buttons"

requirements-completed: [E2E-03, E2E-04]

# Metrics
duration: 15min
completed: 2026-02-28
---

# Phase 7 Plan 02: Review Form E2E Tests Summary

**Playwright E2E spec covering the 27-field multi-step review form: happy-path full submission, step navigation with data persistence, auth protection, and privacy checkbox validation**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-28T21:04:00Z
- **Completed:** 2026-02-28T21:19:36Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Created e2e/review.spec.ts with 6 Playwright test cases covering E2E-03 and E2E-04
- Happy-path test navigates all 7 form steps (unit-details, unit-rating x10, building-rating x9, landlord-rating x8, additional, confirm) and verifies redirect to /building/45-melnea-cass-blvd after submission
- Step navigation test fills unit number "7A", navigates forward then back, confirms data persists
- Auth protection test confirms unauthenticated users redirect to /auth/signin
- Privacy checkbox test confirms Submit Review button is disabled until checked
- Boundary values test clicks rating buttons at 1 (min) and 5 (max) to confirm UI accepts edge inputs

## Task Commits

Each task was committed atomically:

1. **Task 1: Create e2e/review.spec.ts with review form tests** - `518c7f0` (feat)
2. **Task 2: Verify review spec file has valid test structure** - `518c7f0` (validated in same commit — no files changed)

**Plan metadata:** (pending docs commit)

## Files Created/Modified

- `e2e/review.spec.ts` - 6 Playwright tests covering happy-path review submission, step navigation, auth protection, privacy checkbox, building_id validation, and boundary rating values

## Decisions Made

- Derived `Page` type via `Parameters<Parameters<typeof test>[1]>[0]['authedPage']` instead of importing from `@playwright/test` — satisfies the project convention that all imports in e2e files come from `./fixtures`
- `rateAllItemsInStep` helper locates buttons using `button[type="button"]` filtered by exact score text regex — avoids needing data-* attributes (which don't exist in RatingItem.tsx) and works correctly because React only renders the current step's items in the DOM
- Added `test.setTimeout(90000)` to the happy-path and checkbox tests — 27 button clicks plus form navigation exceeds Playwright's 30-second default timeout
- Used `authedPage.request.post` for the building_id validation test — direct API call cleanly tests server-side validation without navigating the UI

## Deviations from Plan

**1. [Rule 1 - Bug] Fixed @playwright/test import violating project convention**

- **Found during:** Task 1 verification check
- **Issue:** Initial implementation imported `type { Page }` from `@playwright/test`, which the plan's verification script explicitly rejects
- **Fix:** Replaced with inline type derivation `type Page = Parameters<Parameters<typeof test>[1]>[0]['authedPage']` using only the `./fixtures` import
- **Verification:** Automated verification script passed: "OK: review.spec.ts verified"
- **Committed in:** `518c7f0` (corrected before commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - import convention bug caught by verification)
**Impact on plan:** Minor fix, no scope change, verification passed cleanly.

## Issues Encountered

- Playwright test list command confirms all 6 tests are recognized and parseable by Playwright (9 total including global setup and existing spec files)

## Next Phase Readiness

- e2e/review.spec.ts is ready for inclusion in Plan 03 (full E2E run)
- Tests require a running dev server with seeded D1 database (building-30 must exist with slug 45-melnea-cass-blvd)
- Happy-path test submits a real review to building-30; subsequent runs may accumulate reviews for that building (seed data reset handles this)

## Self-Check: PASSED

- FOUND: e2e/review.spec.ts
- FOUND: commit 518c7f0 (feat(07-02): add e2e/review.spec.ts with review form E2E tests)
- FOUND: .planning/phases/07-auth-and-review-e2e/07-02-SUMMARY.md

---
*Phase: 07-auth-and-review-e2e*
*Completed: 2026-02-28*
