---
phase: 10-foundations-and-legal-hardening
plan: "03"
subsystem: review-form
tags: [bug-fix, move-in-date, form-ux, validation, privacy]
dependency_graph:
  requires: []
  provides: [correct-move-in-season-computation]
  affects: [review-submission, review-edit, validation]
tech_stack:
  added: []
  patterns: [TDD-red-green, helper-function-extraction]
key_files:
  created:
    - src/lib/__tests__/privacy.test.ts
  modified:
    - src/lib/privacy.ts
    - src/components/reviews/form-steps/types.ts
    - src/components/reviews/form-steps/UnitDetailsStep.tsx
    - src/components/reviews/ReviewForm.tsx
    - src/components/reviews/ReviewEditForm.tsx
    - src/pages/api/reviews.ts
    - src/lib/validation.ts
    - src/lib/__tests__/validation.test.ts
decisions:
  - "Keep legacy move_in_season validation path for backward compatibility; add move_in_month as new preferred path"
  - "Validation accepts either move_in_month (new) or move_in_season (legacy) — no breaking change"
  - "December correctly uses user-provided year: month=12, year=2025 stores as Winter 2025 (not Winter 2026)"
  - "Fall back to 'winter' season and current year in API if no month/year provided (old reviews already stored)"
metrics:
  duration_minutes: 2
  completed_date: "2026-03-20"
  tasks_completed: 2
  files_modified: 8
requirements: [FIX-01]
---

# Phase 10 Plan 03: Move-In Date Bug Fix Summary

**One-liner:** User-provided move-in month/year with `getSeasonFromMonth` helper replaces hardcoded `'winter'` and submission-year defaults.

## What Was Built

Fixed a data accuracy bug where the review submission API hardcoded `'winter'` as the season and `new Date().getFullYear()` as the move-in year, producing incorrect move-in dates for all reviews.

### getSeasonFromMonth helper (Task 1 — TDD)

Added `getSeasonFromMonth(month: number): string` to `src/lib/privacy.ts`:
- spring = March-May (3-5)
- summer = June-August (6-8)
- fall = September-November (9-11)
- winter = December-February (12, 1, 2)

13 unit tests covering all 12 months, including the December edge case (December 2025 = Winter 2025, not Winter 2026).

### Form and API changes (Task 2)

1. **UnitDetails interface** — added `moveInMonth: string` and `moveInYear: string`
2. **UnitDetailsStep.tsx** — "When did you move in?" month select + descending year select (2000 to current)
3. **ReviewForm.tsx** — initialized both fields as empty string; appends to FormData on submit
4. **ReviewEditForm.tsx** — initializes from existing review data; month/year selects in Tenancy Details; sends in PATCH body
5. **reviews.ts API** — parses `move_in_month` and `move_in_year` from FormData; calls `getSeasonFromMonth` to compute season; replaces both hardcoded defaults
6. **validation.ts** — dual-path validation: `move_in_month` (1-12 integer, new) OR `move_in_season` (legacy string, backward compat)
7. **validation.test.ts** — 5 new tests for month validation (valid range 1-12, rejects 0, 13, and non-integers)

## Test Results

- 189 tests passing (up from 171 before this plan)
- 13 new privacy tests (all 12 months + December edge case)
- 5 new validation tests (move_in_month range + type checks)
- Build clean

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | cefe7f3 | feat(10-03): add getSeasonFromMonth helper with full test coverage |
| 2 | cb28f34 | feat(10-03): collect actual move-in month/year from users, fix season bug |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED
