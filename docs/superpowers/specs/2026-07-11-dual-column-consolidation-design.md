# Dual-Column Consolidation — Design Spec

**Date:** 2026-07-11
**Phase:** 4 of 4 (data-model debt remediation)
**Status:** Approved design (all-four scope, move-out Option A), pending spec review

## Problem

The `reviews` table accreted duplicate/legacy columns across schema versions.
Four concepts each have two columns where one is canonical and the other is
legacy or dead:

| Concept | Canonical (keep) | Legacy/dead (remove) | State of the legacy column |
|---|---|---|---|
| Pest flag | `had_pest_issues` (0001, INTEGER) | `had_pests` (0004, INTEGER) | **Dead** — never written by app; only read as an OR-fallback |
| Category scores | 27 OHQS cols (`unit_*`/`building_*`/`landlord_*`, 0004) | 12 v1 `score_*` cols (0001) | **Dead** — never written; present only in a read-row type decl |
| Would-recommend | `would_recommend_new` (0004, TEXT `yes`/`no`/`maybe`) | `would_recommend` (0001, INTEGER 0/1, NOT NULL DEFAULT 1) | **Redundant** — legacy still written by the edit path; read as OR-fallback |
| Move-out year | `move_out_year_new` (0004, TEXT — a year or `'current'`) | `move_out_year` (0001, INTEGER) | **Redundant + a live bug** — legacy is what scoring reads for recency, but new reviews never populate it, so recency silently falls back to `created_at` |

The move-out pair is the notable one: it's the Phase-1 recency-basis quirk. New
reviews write `move_out_year_new`; the scorer reads legacy `move_out_year`
(null for new reviews) → recency decays from submission date, not tenancy date.

## Goals

- One canonical column per concept; drop the four legacy/dead columns (`had_pests`,
  the 12 `score_*` columns, `would_recommend`, `move_out_year` — 15 columns total).
- **Fix the recency basis** (move-out Option A): scoring derives the recency year
  from `move_out_year_new` (the real move-out year), falling back to `created_at`
  when it's `'current'`/absent.
- No data loss: dead columns hold nothing; redundant columns are backfilled into
  their canonical counterpart before removal.
- Safe on production: verify-first, idempotent backfill, deploy-then-drop ordering.

## Non-goals

- `move_out_season` (0001) is a single live column with no `_new` counterpart —
  left as-is.
- `overall_score` stays canonical (established in Phase 1).
- No new features; behavior preserved except the intended recency-basis fix.

## Design

### A. Dead-column removals (no backfill, no behavior change)

**Pests — drop `had_pests`:**
- `src/lib/scoring.ts` (`calculateBuildingAverages`, ~line 307): `if (review.had_pest_issues || review.had_pests)` → `if (review.had_pest_issues)`.
- `src/components/reviews/ReviewCard.astro` (~lines 464, 467): drop the `|| review.had_pests === 1` / `review.had_pests` terms.
- Remove `had_pests` from any type/interface.

**v1 scores — drop the 12 `score_*` columns:**
- `score_building_quality, score_maintenance, score_pest_control, score_safety, score_noise, score_landlord_responsiveness, score_landlord_communication, score_landlord_fairness, score_lease_clarity, score_deposit_handling, score_rent_value, score_amenities`.
- Remove the "Legacy score fields (kept for backward compatibility)" block from the
  row type in `src/pages/api/reviews/[id].ts` and from `src/lib/types.ts`.
- Confirm (grep) no `SELECT` names them and nothing writes them.

### B. Would-recommend — canonical `would_recommend_new`

- **Backfill (idempotent):** `UPDATE reviews SET would_recommend_new = CASE would_recommend WHEN 1 THEN 'yes' WHEN 0 THEN 'no' END WHERE would_recommend_new IS NULL;` (only touches old rows that predate `_new`; `would_recommend` is NOT NULL so it always has a value to map).
- **Stop writing legacy:** in `src/pages/api/reviews/[id].ts` (edit path) remove the `would_recommend = ?` column from the UPDATE and its bound legacy value (`wouldRecommendLegacy`). The POST path already writes only `_new`.
- **Reads:** change scoring's `review.would_recommend_new || review.would_recommend` (`calculateAggregatedScores`) to `review.would_recommend_new` only. Sweep for any other legacy reads.
- **Drop** `would_recommend`.

### C. Move-out year — canonical `move_out_year_new` (Option A)

- **Backfill (idempotent):** `UPDATE reviews SET move_out_year_new = CAST(move_out_year AS TEXT) WHERE move_out_year_new IS NULL AND move_out_year IS NOT NULL;`
- **Recency basis fix — `getReviewYear` (JS, `src/lib/scoring.ts`):** parse
  `move_out_year_new`: if it's a 4-digit year use it; if `'current'`/empty/non-numeric,
  fall back to the UTC year of `created_at`; else `currentYear`. Stop reading legacy
  `move_out_year`.
- **Recency basis fix — `reviewYearSql` (SQL, `src/lib/scoring-sql.ts`):**
  `COALESCE(CASE WHEN <a>.move_out_year_new GLOB '[0-9][0-9][0-9][0-9]' THEN CAST(<a>.move_out_year_new AS INTEGER) END, CAST(strftime('%Y', <a>.created_at, 'unixepoch') AS INTEGER))`.
  (`'current'` and other non-4-digit values fail the GLOB → fall to `created_at`.)
- **Re-verify parity:** the `node:sqlite` SQL⇄JS parity test (`scoring-sql-parity.test.ts`)
  must be updated to feed `move_out_year_new` and still pass; add cases for a
  4-digit year, `'current'`, and null. Re-run the Phase-1 cross-view runtime parity
  (search = detail = map) after the change.
- **Drop** `move_out_year`.

### D. Migration & rollout (the irreversible prod step)

Split into TWO migrations so the backfill can run before the deploy (so the
new code, which reads only `_new`, sees complete data on old rows) while the
drops run after the deploy (so the old code never reads a dropped column):

**`migrations/0026_backfill_new_columns.sql`** — idempotent, safe to run anytime,
touches nothing the old code depends on:
```sql
UPDATE reviews SET would_recommend_new = CASE would_recommend WHEN 1 THEN 'yes' WHEN 0 THEN 'no' END WHERE would_recommend_new IS NULL;
UPDATE reviews SET move_out_year_new = CAST(move_out_year AS TEXT) WHERE move_out_year_new IS NULL AND move_out_year IS NOT NULL;
```

**`migrations/0027_drop_legacy_columns.sql`** — the 15 `DROP COLUMN`s
(`had_pests`, 12 `score_*`, `would_recommend`, `move_out_year`). No index/
table-CHECK references them (verified), so no table rebuild is needed.

**Ordering (like Phase 1's table drop):**
- **Execution step 0 — verify prod distribution** before writing anything:
  count rows where each legacy column holds data the `_new` column lacks, to
  confirm the backfill scope and that nothing unique is lost. (If all prod rows
  already have `_new` populated, `0026` is a no-op and ordering is moot — but we
  keep the split for correctness.)
- Apply `0026` + `0027` to **local** first; run full verification.
- Apply `0026` (backfill) to prod `--remote` — safe, pre- or post-deploy.
- **Deploy the code** (no longer reads/writes legacy columns).
- **Then** apply `0027` (drops) to prod `--remote` — only after the deployed
  code has stopped touching the legacy columns.

**Reversibility:** the `DROP COLUMN`s are one-way. Mitigated: dead columns lose
nothing; redundant columns are backfilled into the canonical column first, so no
unique data is lost. This is the riskiest change of the four phases (it alters the
core `reviews` table on real data) — hence verify-first + deploy-then-drop.

## Testing

- Update `scoring-sql-parity.test.ts` + `scoring.test.ts` to use `move_out_year_new`
  as the recency source; add year / `'current'` / null cases; SQL⇄JS still agree.
- Existing scoring tests stay green (recent reviews: recency weight ~1.0 regardless).
- Runtime re-verification (local seed): cross-view parity (search = detail = map),
  an aged-review case using `move_out_year_new`, would-recommend % unchanged,
  build + full test suite.
- Grep gate: after code changes, zero references to `had_pests`, `score_*` (v1),
  legacy `would_recommend` (non-`_new`), and legacy `move_out_year` (non-`_new`)
  remain in `src/`.

## File summary

| Change | Files |
|--------|-------|
| Drop pest fallback | `src/lib/scoring.ts`, `src/components/reviews/ReviewCard.astro` |
| Remove v1 score type decls | `src/pages/api/reviews/[id].ts`, `src/lib/types.ts` |
| Would-recommend: stop legacy write + read | `src/pages/api/reviews/[id].ts`, `src/lib/scoring.ts` |
| Move-out recency (Option A) | `src/lib/scoring.ts` (`getReviewYear`), `src/lib/scoring-sql.ts` (`reviewYearSql`) |
| Backfill migration (pre-deploy) | `migrations/0026_backfill_new_columns.sql` (new) |
| Drop migration (post-deploy, 15 drops) | `migrations/0027_drop_legacy_columns.sql` (new) |
| Tests | `src/lib/__tests__/scoring-sql-parity.test.ts`, `scoring.test.ts` |
| Seed (if it references dropped cols) | `scripts/db-seed.ts` |
