# Score Model Unification — Design Spec

**Date:** 2026-07-11
**Phase:** 1 of 4 (data-model debt remediation)
**Status:** Approved design, pending spec review

## Problem

Building / landlord / property-manager scores are computed three different ways
for what is nominally the same number:

1. **SQL `AVG(overall_score)`** — a plain, non-recency-weighted mean. Used by
   search, map, saved, admin lists, autocomplete, and the per-building rows on
   landlord/PM detail pages (12 files).
2. **`calculateAggregatedScores` / `calculate*Averages`** — a recency-weighted
   mean. Used by the building/landlord detail-page **headers**.
3. **Precomputed `*_scores` tables** — `building_scores`, `landlord_scores`,
   `property_manager_scores`. Read in 3 detail pages, **written only by the seed
   script, never by application code**. In production they are empty, so the
   detail pages rely on a recompute-on-read fallback — and the one place missing
   that fallback (the PM page) produced a user-visible "No reviews yet" bug.

The three methods agree today only because the dataset is small and every review
is recent (recency weight = 1.0). They will diverge as reviews age. The dead
cache tables are a latent trap wherever a fallback is missing.

## Goals

- **One canonical answer** for a building/landlord/PM aggregate overall score,
  used by every view, that cannot drift.
- **Eliminate the dead cache tables** entirely.
- **Preserve current behavior** — no score should visibly change today (all
  reviews are recent). This is a refactor, not a scoring change.
- Keep aggregation **cheap** (no fetching + looping over review rows in list
  views).

## Non-goals (explicitly deferred)

- Endpoint robustness / partial-body handling (Phase 2).
- Type-safety cleanup (Phase 3).
- Dual-column reconciliation — `move_out_year` vs `move_out_year_new`,
  `had_pests` vs `had_pest_issues`, etc. (Phase 4). This design *touches* the
  `move_out_year` coupling (see Recency basis) but does not resolve it.

## The core invariant

> A review's `overall_score` column is the **single source of truth** for that
> review's overall score. Every aggregate overall is `SUM(overall_score · w) /
> SUM(w)` over that one column, with one shared recency-weight `w`. Nothing is
> cached; nothing is re-derived differently in different places.

`overall_score` is already written on submit (`api/reviews.ts`) and recomputed
on edit (`api/reviews/[id].ts`) via the same `calculateDomainScores`/
`calculateOverallScore` functions, so the column is authoritative and kept in
sync. (Write-path parity is covered by existing tests added in the prior pass.)

Domain sub-scores (unit / building / landlord) and the recommend-rate have **no
stored column** and appear **only on detail pages**, which already fetch all
review rows. They continue to be computed from the raw items in exactly one
place (`calculateAggregatedScores`).

The building detail page additionally computes a **per-unit-type** average (the
"Studio / 1BR / 2BR" drill-down), today as a plain mean with no recency. Phase 1
aligns this to the shared recency weight (it already iterates the fetched rows),
so the within-building breakdown uses the same method as the headline number —
otherwise it would be a fourth, divergent computation.

## Design

### 1. Shared recency-weight definition (SQL ⇄ JS parity)

Recency weighting must be identical whether applied in SQL (list views) or JS
(detail pages). Today it lives only in JS as `getRecencyWeight(reviewYear,
currentYear)` in `src/lib/scoring.ts`:

| age (yrs) | weight |
|-----------|--------|
| ≤ 2       | 1.00   |
| 3         | 0.95   |
| 4         | 0.90   |
| ≥ 5       | 0.85   |

Add a SQL counterpart in a new `src/lib/scoring-sql.ts`:

- `recencyWeightSql(reviewAlias)` → the `CASE` expression computing `w` from the
  review's age.
- `recencyWeightedOverallSql(reviewAlias)` → the full
  `SUM(<alias>.overall_score * w) / SUM(w)` aggregate expression, rounded to 1
  decimal to match JS.
- Both take the **current year** as a bound parameter (never `Date.now()` inline,
  for testability and cache-friendliness). Call sites pass
  `new Date().getUTCFullYear()`.

**Review-year (recency basis).** Defined once and mirrored in both languages:

- JS: `getReviewYear(review) = review.move_out_year ?? utcYear(review.created_at)`
- SQL: `COALESCE(<alias>.move_out_year, CAST(strftime('%Y', <alias>.created_at, 'unixepoch') AS INTEGER))`

Both use **UTC** year (`getUTCFullYear`, `strftime … 'unixepoch'`) so they agree
deterministically near year boundaries. `created_at` is `NOT NULL`, so the basis
is never null.

> **Known coupling (Phase 4):** new reviews store their move-out year in
> `move_out_year_new`, not the legacy `move_out_year` that the scorer reads, so
> today the recency basis for new reviews falls back to `created_at`. This design
> **preserves that behavior** (uses `move_out_year`, same as current JS). Phase 4
> reconciles the move-out columns and should revisit the basis then.

A unit test asserts `recencyWeightSql`'s `CASE` and `getRecencyWeight()` return
identical weights for ages 0–6 — locking the two definitions together so they
can never silently diverge.

### 2. `calculateAggregatedScores` refactor

Currently its `avgOverall` re-derives each review's overall from the 27 items via
`calculateDomainScores(review).overall`. Change it to aggregate the **stored**
`review.overall_score` (with the shared recency weight and `getReviewYear`), so
the detail-page header uses the *exact* same value the SQL fragment produces for
lists. Domain sub-scores (`avgUnit`/`avgBuilding`/`avgLandlord`) and
`pctWouldRecommend` are unchanged (still computed from items). Reviews with a
null `overall_score` are excluded from the overall, as today.

### 3. Rewire SQL `AVG(overall_score)` sites

Replace the plain `ROUND(AVG(r.overall_score), 1)` in these 12 files with
`recencyWeightedOverallSql('r')` (+ the current-year bind):

`api/search/results.ts`, `search.astro`, `api/search/autocomplete.ts`,
`api/buildings/map.ts`, `api/buildings/saved.ts`, `api/admin/buildings/index.ts`,
`api/admin/landlords/index.ts`, `api/admin/landlords/[id].ts`,
`api/admin/managers/index.ts`, `api/admin/managers/[id].ts`,
`landlord/[slug].astro` (per-building rows), `property-manager/[slug].astro`
(per-building rows).

Each change is mechanical: swap one aggregate expression, add one bind.

### 4. Delete the dead cache

- **Migration `0025_drop_score_cache_tables.sql`:** `DROP TABLE building_scores;
  DROP TABLE landlord_scores; DROP TABLE property_manager_scores;` Safe — these
  hold only derived, recomputable data, never authoritative rows.
- **Detail pages** (`building`, `landlord`, `property-manager` `[slug].astro`):
  remove the `SELECT * FROM *_scores` reads and their now-dead fallback branches;
  always compute via `calculateBuildingAverages` / `calculateLandlordAverages`
  over the fetched review rows. This simplifies each page to a single path.
- **`scripts/db-seed.ts`:** remove the `*_scores` INSERTs and the "Compute/Verify
  scores" seed steps.

## Testing

- **SQL⇄JS weight parity:** `recencyWeightSql` `CASE` vs `getRecencyWeight()` for
  ages 0–6 (drives both from a shared table of expected weights).
- **Header == list:** a building with reviews yields the same aggregate overall
  from `calculateAggregatedScores` (detail header) and from the SQL fragment
  (search/list). Extend the existing "aggregate vs simple-mean" tests.
- **Recency divergence still correct:** an aged review decays identically in both
  paths.
- **Regression guard:** existing scoring tests continue to pass unchanged (the
  refactor preserves current numbers for recent data).

## Rollout & risk

- **Risk: medium.** Many read sites, but each edit is mechanical and behind the
  build + unit-test gate. No data migration beyond dropping derived tables.
- **Verification:** all score outputs are server-rendered, so a Cloudflare
  **preview** deployment can fully verify them (unlike the Turnstile/map work,
  which needed production). Flow: branch → preview → smoke-test score parity
  across search / detail / map / admin against real data → merge.
- **Reversibility:** the table `DROP` is the only one-way step. Mitigated by the
  fact that the data is fully recomputable from `reviews`; if ever needed, the
  tables can be recreated and repopulated from a query.

## File summary

| Change | Files |
|--------|-------|
| New shared SQL helpers | `src/lib/scoring-sql.ts` (new) |
| Refactor aggregate overall to use stored column | `src/lib/scoring.ts` |
| Rewire aggregate expression | 12 files (§3) |
| Remove cache reads + fallbacks | 3 detail `[slug].astro` |
| Align per-unit-type averages to recency | `building/[slug].astro` |
| Drop tables | `migrations/0025_drop_score_cache_tables.sql` (new) |
| Stop seeding cache | `scripts/db-seed.ts` |
| Tests | `src/lib/__tests__/scoring.test.ts`, `scoring-sql.test.ts` (new) |
