---
phase: 11-schema-survey-fields-and-contact-form
plan: "01"
subsystem: reviews
tags: [survey, schema, migration, form, api, review-card]
dependency_graph:
  requires: []
  provides: [accepts_housing_vouchers column, safely_lit_at_night column, survey field UI, review card pills]
  affects: [reviews table, ReviewForm, ReviewEditForm, ReviewCard, AdditionalStep, api/reviews, api/reviews/[id]]
tech_stack:
  added: []
  patterns: [nullable ALTER TABLE columns, tristate radio groups, null-guarded Astro conditionals]
key_files:
  created:
    - migrations/0019_survey_fields.sql
  modified:
    - src/lib/surveyItems.ts
    - src/components/reviews/form-steps/types.ts
    - src/components/reviews/form-steps/AdditionalStep.tsx
    - src/components/reviews/ReviewForm.tsx
    - src/pages/api/reviews.ts
    - src/components/reviews/ReviewEditForm.tsx
    - src/pages/api/reviews/[id].ts
    - src/components/reviews/ReviewCard.astro
decisions:
  - Placed housingVouchers and safelyLit radio groups before wouldRecommend in AdditionalStep for clustered yes/no/unsure grouping
  - Used nullable TEXT columns (no NOT NULL) — D1 rejects NOT NULL on ALTER TABLE with existing rows
  - Empty string from formData coerced to NULL in API handler using || null pattern
  - ReviewCard uses individual value comparisons rather than map over options to produce correct colored pill per value
metrics:
  duration_minutes: 18
  completed_date: "2026-03-21"
  tasks_completed: 2
  files_modified: 8
---

# Phase 11 Plan 01: Survey Fields — Housing Vouchers and Safely Lit Summary

**One-liner:** Added two nullable TEXT survey columns to reviews table with tristate (Yes/No/Unsure) radio UI in create and edit forms, stored via both POST and PATCH, and displayed as color-coded pills on public review cards.

## What Was Built

Two new public health context fields collected from tenants during review submission:

1. **accepts_housing_vouchers** — "To your knowledge, does this property accept Housing Choice Vouchers (Section 8)?" (Yes/No/Unsure)
2. **safely_lit_at_night** — "Was the building and surrounding area safely lit at night?" (Yes/No/Unsure)

Both fields are optional (no validation required) and stored as nullable TEXT in the reviews table. Older reviews show no pills on the review card (null guard).

## Tasks Completed

| Task | Description | Commit | Key Files |
|------|-------------|--------|-----------|
| 1 | Migration and survey field definitions | 70e8d7f | migrations/0019_survey_fields.sql, surveyItems.ts, types.ts |
| 2 | Wire through form, API, and review card | 2bc0a06 | AdditionalStep.tsx, ReviewForm.tsx, api/reviews.ts, ReviewEditForm.tsx, api/reviews/[id].ts, ReviewCard.astro |

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- Migration 0019 applied locally — columns `accepts_housing_vouchers` and `safely_lit_at_night` confirmed present via `PRAGMA table_info(reviews)`
- Build: clean (no errors)
- Tests: 189 passed (all passing, count grew from 171 baseline due to intervening test additions)

## Self-Check: PASSED

- `migrations/0019_survey_fields.sql` — exists
- `src/lib/surveyItems.ts` — housingVouchers and safelyLit entries added
- `src/components/reviews/form-steps/types.ts` — housingVouchers and safelyLit fields added to ReviewData
- Commits 70e8d7f and 2bc0a06 — both exist in git log
