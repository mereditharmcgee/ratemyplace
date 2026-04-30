---
phase: 20-critical-flow-e2e-coverage
plan: 02
subsystem: testing
tags: [playwright, e2e, score-consistency, d1, sqlite, cross-view]

# Dependency graph
requires:
  - phase: 20-01
    provides: e2e/critical-flows.spec.ts with TEST-01, building-e2e-01 seeded, cleanupPhase20Reviews by building_id
  - phase: 19-d1-index-migration
    provides: stable D1 schema with indexed reviews table

provides:
  - TEST-02 cross-view score consistency E2E: submit → approve → assert overall_score matches across /api/search/results, /building/[slug], and /profile
  - TEST_BUILDING_SLUG constant in critical-flows.spec.ts

affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Controlled recency window: single current-year review collapses all three score code paths to same value"
    - "Search query uses building address (not slug) — search endpoint matches on address/neighborhood/landlord_name, not slug column"
    - "waitForResponse approve pattern (not UI badge) reused from TEST-01 — badge disappears from pending-filtered view"

key-files:
  created: []
  modified:
    - e2e/critical-flows.spec.ts

key-decisions:
  - "Search by TEST_BUILDING_ADDRESS (not TEST_BUILDING_SLUG) — search endpoint WHERE clause only covers address/neighborhood/landlord name columns, not slug"
  - "Exact equality (.toBe) assertion for cross-view scores — single current-year review makes SQL ROUND(AVG(x),1) = JS Math.round(x*10)/10 = stored value; toBeCloseTo is the fallback if float edge case surfaces"
  - "Approve pattern: waitForResponse on PATCH (not UI badge check) — reuses the fix from TEST-01 where badge disappears from pending-filtered view after approval"

patterns-established:
  - "Cross-view score test: 1 review + controlled recency window + exact equality assertion"
  - "Search field used: avg_overall in /api/search/results response (SQL ROUND AVG)"
  - "Profile score selector: .bg-white.border.border-gray-200.rounded-[6px] scoped by address, then .font-medium.text-teal-700"

requirements-completed:
  - TEST-02

# Metrics
duration: 30min
completed: 2026-04-29
---

# Phase 20 Plan 02: Cross-View Score Consistency E2E (TEST-02) Summary

**Playwright E2E test asserting exact equality of overall_score across SQL aggregate (/api/search/results), live-calculated building detail page, and per-review profile page using a controlled single-current-year-review recency window**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-04-29T03:00:00Z
- **Completed:** 2026-04-29T03:30:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `TEST_BUILDING_SLUG = 'test-cross-view-consistency'` constant alongside existing `TEST_BUILDING_ID` and `TEST_BUILDING_ADDRESS`
- Implemented TEST-02 cross-view consistency test inside the existing `Phase 20: Critical Flows` describe block (after TEST-01)
- Test submits one review with all 27 score fields = 4, approves via admin UI (PATCH waitForResponse pattern), then reads score from three distinct sources and asserts exact equality
- Confirmed: cleanupPhase20Reviews (by building_id subquery) correctly handles TEST-02's non-reserved-ID reviews — no additional cleanup changes needed

## Task Commits

1. **Task 1: Add TEST-02 cross-view consistency test** - `e6f7273` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `e2e/critical-flows.spec.ts` - Added TEST_BUILDING_SLUG constant and full TEST-02 test body (123 lines added)

## Score Values Observed

With all 27 score fields = 4 (equal weights cancel, result is 4.0):
- Search: `avg_overall = 4.0`
- Detail: `4.0` (from `.text-4xl.font-bold.text-teal-600`)
- Profile: `4.0` (from `.font-medium.text-teal-700` scoped to review card)

All three identical — test asserts `searchScore === detailScore && detailScore === profileScore`. Exact equality held without any `toBeCloseTo` needed.

## Decisions Made

1. **Search by address, not slug:** The plan specified searching for `TEST_BUILDING_SLUG` but the `/api/search/results` endpoint only searches `address`, `neighborhood`, and `landlord.name` columns — the slug column is not part of the WHERE clause. Changed to search by `TEST_BUILDING_ADDRESS` ("999 E2E Test Way") to get a hit. Defensive slug-match `results.find(r => r.slug === TEST_BUILDING_SLUG)` still applied to isolate the specific building's row.

2. **Approve pattern: waitForResponse (not UI badge):** The plan's task code used `expect(reviewRow.locator('span.rounded-full')).toContainText('approved')` for approve confirmation, but 20-01-SUMMARY documented that this fails because the card disappears from the pending-filtered view after approval. Reused the `adminPage.waitForResponse(PATCH_MATCHER)` pattern from TEST-01.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Search query parameter must use building address, not building slug**
- **Found during:** Task 1 (test execution — searchData.results.length was 0)
- **Issue:** Plan specified `/api/search/results?q=test-cross-view-consistency` (the slug), but the search endpoint's WHERE clause only matches on `b.address LIKE ?`, `b.neighborhood LIKE ?`, or `l.name LIKE ?`. The slug is not a searchable column.
- **Fix:** Changed query parameter from `TEST_BUILDING_SLUG` to `TEST_BUILDING_ADDRESS` ("999 E2E Test Way"). Added comment explaining why address is used. Kept defensive slug-filter on the returned results array.
- **Files modified:** e2e/critical-flows.spec.ts
- **Verification:** Search returns 1 result with `slug=test-cross-view-consistency` after the fix
- **Committed in:** e6f7273 (Task 1 commit)

**2. [Rule 1 - Bug] Approve confirmation pattern from plan code uses disappearing UI badge**
- **Found during:** Task 1 (implementation review — 20-01-SUMMARY documented this exact failure mode)
- **Issue:** Plan task code used `await expect(reviewRow.locator('span.rounded-full')).toContainText('approved')` but 20-01-SUMMARY established that the card disappears from the DOM on a pending-filtered view before the badge can be observed.
- **Fix:** Used `waitForResponse` on PATCH matching pattern — same as TEST-01. Consistent with established Phase 20 pattern.
- **Files modified:** e2e/critical-flows.spec.ts
- **Verification:** Test passes consistently across multiple runs (14–15s per run)
- **Committed in:** e6f7273 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes required for test to run and pass. No scope creep. All planned assertions preserved.

## Idempotency Verification

Tested with a leftover review manually inserted:
```sql
INSERT INTO reviews (id, user_id, building_id, ...) VALUES ('review-leftover-test', 'user-04', 'building-e2e-01', 'pending', ...)
```
Both tests passed with the dirty DB — `beforeEach` cleanup correctly wiped the leftover row via `DELETE FROM reviews WHERE building_id = 'building-e2e-01'`.

## Cleanup Contract Note for Future Phases

`cleanupPhase20Reviews()` deletes ALL reviews for `building-e2e-01` by `building_id` subquery (not by reserved IDs). Any future E2E spec that inserts a review against `building-e2e-01` will have it wiped by Phase 20's cleanup. Future specs targeting `building-e2e-01` should either:
1. Use a different test building, OR
2. Accept that Phase 20 cleanup will wipe their reviews in `beforeEach`/`afterEach`

## Controlled Recency Window Confirmation

The single-review + current-year strategy worked exactly as planned:
- `calculateAggregatedScores([review])` with recency weight 1.0 for current year → same value as stored `overall_score`
- SQL `ROUND(AVG(overall_score), 1)` over 1 row = `ROUND(overall_score, 1)` = JS `Math.round(x * 10) / 10`
- No `toBeCloseTo` needed — exact `.toBe()` held

## Playwright Test Results

```
npx playwright test e2e/critical-flows.spec.ts --reporter=line --no-deps

Running 2 tests using 1 worker
  2 passed (41.9s)
```

Individual runs:
- TEST-01: passes in ~17s
- TEST-02: passes in ~15s
- Combined: 2 passed (~42s)

## Next Phase Readiness

- Phase 20 complete: TEST-01 (audit log causal), TEST-02 (cross-view consistency), TEST-03 (clearRateLimits extraction) all done
- review-129+ IDs remain free for future reservations
- `building-e2e-01` permanently seeded — available for any future E2E spec needing a clean test building

## Self-Check: PASSED

- e2e/critical-flows.spec.ts: FOUND
- .planning/phases/20-critical-flow-e2e-coverage/20-02-SUMMARY.md: FOUND
- Commit e6f7273: FOUND

---
*Phase: 20-critical-flow-e2e-coverage*
*Completed: 2026-04-29*
