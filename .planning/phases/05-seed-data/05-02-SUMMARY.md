---
phase: 05-seed-data
plan: "02"
subsystem: seed-data
tags: [seed, reviews, disputes, scoring, d1]
dependency_graph:
  requires: [05-01]
  provides: [complete-seed-dataset]
  affects: [06-playwright-local-env, 07-auth-review-e2e, 10-stress-testing]
tech_stack:
  added: []
  patterns: [calculateOverallScore-at-insert-time, chunked-sql-batch-inserts, score-verification-loop]
key_files:
  modified:
    - scripts/db-seed.ts
decisions:
  - "All 128 reviews + 10 disputes + insert/score functions landed in one commit (all edits staged together before first commit)"
  - "overall_score computed via calculateOverallScore(review) inside insertReviews() — not at constant definition time"
  - "building_scores populates only avg_overall, review_count, pct_* — per-field averages left NULL (building page uses live calculation)"
  - "makeReview() helper auto-derives would_recommend_new (avg>=3.5=yes), had_pests (unit_pests<=2), had_heat_issues (unit_climate<=2), had_water_issues (unit_plumbing<=2), had_security_deposit_issues (landlord_deposit<=2)"
  - "Review inserts batched in chunks of 30 to avoid oversized temp SQL files (Windows-compatible)"
metrics:
  duration: "39min"
  completed_date: "2026-02-28"
  tasks_completed: 3
  files_modified: 1
---

# Phase 5 Plan 02: Seed Reviews, Disputes, and Scores — Summary

**One-liner:** 128 deterministic tenant reviews across 29 buildings, 10 disputes, and pre-computed/verified building and landlord aggregate scores using the real scoring.ts weighted formula.

## What Was Built

Extended `scripts/db-seed.ts` (created in Plan 01) with:

1. **REVIEWS constant** — 128 review objects defined via `makeReview()` helper that auto-derives issue flags and recommendation from scores. Distributed across 29 buildings; building-30 has 0 reviews (empty state). building-01 has 25 (STRESS-01). building-03 averages ~4.5 (high end). building-04 averages ~1.8 (low end). Bell-curve distribution: most buildings 2.5–3.5 avg.

2. **DISPUTES constant** — 10 dispute objects: 7 pending, 3 resolved (outcomes: dismiss, partially_valid, uphold). Each references a unique review_id. Resolved disputes have resolution_notes and resolved_by='user-admin-01'.

3. **insertReviews()** — Computes `overall_score` per review via `calculateOverallScore(r)` at insert time. Batches 128 inserts in chunks of 30.

4. **insertDisputes()** — Handles null resolution fields for pending disputes with proper SQL NULL output.

5. **insertBuildingScores()** — Calls `calculateBuildingAverages()` from scoring.ts. Populates avg_overall, review_count, pct_would_recommend, pct_pest_issues, pct_heat_issues, pct_water_issues, pct_deposit_issues. Skips building-30 (0 reviews).

6. **insertLandlordScores()** — Calls `calculateLandlordAverages()` from scoring.ts. building_count is total owned buildings (not just reviewed ones).

7. **verifyScores()** — Re-queries building_scores from D1 and re-computes from in-memory REVIEWS. Allows 0.01 tolerance for float rounding. Prints per-building result, returns false on any mismatch.

8. **Updated main()** — Full pipeline: users → landlords → buildings → reviews → disputes → building scores → landlord scores → verification. Exits with code 1 if verification fails. Prints final counts and test credentials.

## Verification Results

```
npm run db:setup output:
  ✓ Insert users (8)
  ✓ Insert landlords (10)
  ✓ Insert buildings (30)
  ✓ Insert reviews (128)
  ✓ Insert disputes (10)
  ✓ Compute building scores
  ✓ Compute landlord scores
  Verifying scores... ✓ (29 buildings verified)
  ✓ Seed complete — database ready
  Summary: 8 users, 10 landlords, 30 buildings, 128 reviews, 10 disputes
```

## Review Distribution

| Building | Reviews | Avg Profile |
|----------|---------|-------------|
| building-01 | 25 | Mixed ~3.0–3.5 (STRESS-01) |
| building-02 | 12 | Above average ~3.8 |
| building-03 | 10 | Great ~4.5 (high end) |
| building-04 | 8 | Poor ~1.8 (low end) |
| building-05 to 20 | 2–8 each | Moderate 2.5–3.5 |
| building-21 to 29 | 1 each | Varied |
| building-30 | 0 | Empty state |
| **Total** | **128** | |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate `rent_amount` key in review-038**
- **Found during:** Task 1 implementation
- **Issue:** `rent_amount:3200,rent_amount:3200` caused duplicate object key
- **Fix:** Removed duplicate key
- **Files modified:** scripts/db-seed.ts

**2. [Rule 1 - Bug] Invalid field `unit_noise` in review-086**
- **Found during:** Task 1 implementation
- **Issue:** `unit_noise` is not a valid review score field
- **Fix:** Replaced with `building_noise_neighbors` which was the intended score
- **Files modified:** scripts/db-seed.ts

**3. [Rule 1 - Bug] `updatedAt` typo in makeReview helper**
- **Found during:** Task 1 implementation
- **Issue:** `extras.updatedAt` should be `extras.updated_at` (camelCase vs snake_case)
- **Fix:** Corrected to `extras.updated_at`
- **Files modified:** scripts/db-seed.ts

### Commit Structure Note

All three tasks' code was written in a single editing session and staged together before the first commit, resulting in both REVIEWS/DISPUTES constants and the insert/score/verify functions landing in one commit (fe005d9) rather than separate commits per task. The verification for Tasks 2 and 3 (npm run db:setup) passed after this single commit, confirming correctness.

## Commits

| Hash | Description |
|------|-------------|
| fe005d9 | feat(05-02): add REVIEWS and DISPUTES constants, insert functions, score computation, and verification to db-seed.ts |

## Self-Check: PASSED

- scripts/db-seed.ts: FOUND
- commit fe005d9: FOUND
- npm run db:setup exit code 0: VERIFIED
- 29 buildings with scores verified: CONFIRMED
- building-30 has 0 reviews: CONFIRMED
