# Score Model Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `reviews.overall_score` the single source of truth for every aggregate building/landlord/PM score, applying one shared recency weight everywhere (SQL + JS), and delete the never-written `*_scores` cache tables.

**Architecture:** Recency bands are defined once as a shared data table (`RECENCY_BANDS`) that both a JS weight function and a SQL `CASE`-generator derive from, so the two can't diverge. List views aggregate the stored `overall_score` column via a generated SQL fragment; detail pages aggregate the same column in JS (plus compute domain sub-scores from raw items). The `*_scores` tables are dropped.

**Tech Stack:** Astro 5 SSR, Cloudflare D1 (SQLite), TypeScript, Vitest, `wrangler d1` migrations.

**Reference spec:** `docs/superpowers/specs/2026-07-11-score-model-unification-design.md`

**Branch:** Create `refactor/score-model-unification` off `main` before starting.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/lib/scoring.ts` (modify) | Add `RECENCY_BANDS`, refactor `getRecencyWeight` to derive from it, add `getReviewYear`, refactor `calculateAggregatedScores` to aggregate the stored `overall_score` |
| `src/lib/scoring-sql.ts` (create) | SQL emitters (`reviewYearSql`, `recencyWeightSql`, `recencyWeightedOverallSql`, `currentReviewYear`) generated from `RECENCY_BANDS` |
| `src/lib/__tests__/scoring-sql.test.ts` (create) | Unit tests for the SQL emitters (structure + band coverage) |
| `src/lib/__tests__/scoring.test.ts` (modify) | Tests for `RECENCY_BANDS`, `getReviewYear`, header-vs-list agreement |
| `migrations/0025_drop_score_cache_tables.sql` (create) | Drop the three cache tables |
| `scripts/db-seed.ts` (modify) | Stop writing/verifying `*_scores` |
| `src/pages/building/[slug].astro` (modify) | Remove cache read + fallback; always compute; recency-weight per-unit-type averages |
| `src/pages/landlord/[slug].astro` (modify) | Remove cache read + fallback; recency-weight per-building rows |
| `src/pages/property-manager/[slug].astro` (modify) | Remove cache read; recency-weight per-building rows |
| `src/pages/search.astro`, `api/search/results.ts`, `api/search/autocomplete.ts`, `api/buildings/map.ts`, `api/buildings/saved.ts`, `api/admin/buildings/index.ts`, `api/admin/landlords/index.ts`, `api/admin/landlords/[id].ts`, `api/admin/managers/index.ts`, `api/admin/managers/[id].ts` (modify) | Swap `AVG(overall_score)` → recency-weighted fragment |

**Decision — ORDER BY:** `ORDER BY AVG(r.overall_score) DESC` clauses (sort tiebreakers in `search.astro` and `results.ts`) are left as plain `AVG`. They only affect result *ordering*, not displayed values, and recency-weighting a sort key adds complexity for no user-visible benefit. Only the `SELECT` expressions (the displayed numbers) are unified.

---

## Task 1: Shared recency bands + SQL emitters

**Files:**
- Modify: `src/lib/scoring.ts` (the `getRecencyWeight` region, ~lines 100-114)
- Create: `src/lib/scoring-sql.ts`
- Create: `src/lib/__tests__/scoring-sql.test.ts`

- [ ] **Step 1: Write the failing test for the shared bands + JS weight**

Add to `src/lib/__tests__/scoring.test.ts` (new describe block at end):

```typescript
import { RECENCY_BANDS, getRecencyWeight, getReviewYear } from '../scoring';

describe('RECENCY_BANDS (single source of recency weighting)', () => {
  it('is ordered and covers all ages with a terminal Infinity band', () => {
    expect(RECENCY_BANDS.map(b => b.weight)).toEqual([1.0, 0.95, 0.90, 0.85]);
    expect(RECENCY_BANDS[RECENCY_BANDS.length - 1].maxAge).toBe(Infinity);
  });

  it('getRecencyWeight derives from the bands', () => {
    expect(getRecencyWeight(2026, 2026)).toBe(1.0);  // age 0
    expect(getRecencyWeight(2024, 2026)).toBe(1.0);  // age 2
    expect(getRecencyWeight(2023, 2026)).toBe(0.95); // age 3
    expect(getRecencyWeight(2022, 2026)).toBe(0.90); // age 4
    expect(getRecencyWeight(2021, 2026)).toBe(0.85); // age 5
    expect(getRecencyWeight(2010, 2026)).toBe(0.85); // very old
    expect(getRecencyWeight(null, 2026)).toBe(1.0);  // unknown → no decay
  });
});

describe('getReviewYear', () => {
  it('prefers move_out_year, falls back to created_at UTC year, then currentYear', () => {
    expect(getReviewYear({ move_out_year: 2023 }, 2026)).toBe(2023);
    // 2025-06-15T00:00:00Z = 1750000000-ish; use a known UTC timestamp
    const tsUtc2025 = Date.UTC(2025, 5, 15) / 1000;
    expect(getReviewYear({ created_at: tsUtc2025 }, 2026)).toBe(2025);
    expect(getReviewYear({}, 2026)).toBe(2026);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- scoring`
Expected: FAIL — `RECENCY_BANDS` / `getReviewYear` not exported.

- [ ] **Step 3: Implement `RECENCY_BANDS`, refactor `getRecencyWeight`, add `getReviewYear`**

In `src/lib/scoring.ts`, replace the existing `getRecencyWeight` function (currently ~lines 105-114) with:

```typescript
/**
 * Recency weight bands — the single source of truth for review-age decay.
 * Both the JS weight (getRecencyWeight) and the SQL CASE generator
 * (src/lib/scoring-sql.ts) derive from this array, so they cannot diverge.
 * A review of `age` years gets the weight of the first band whose maxAge it
 * does not exceed. Based on Hu, Pavlou & Zhang (2017) - MIS Quarterly.
 */
export const RECENCY_BANDS: ReadonlyArray<{ maxAge: number; weight: number }> = [
  { maxAge: 2, weight: 1.0 },
  { maxAge: 3, weight: 0.95 },
  { maxAge: 4, weight: 0.90 },
  { maxAge: Infinity, weight: 0.85 },
];

export function getRecencyWeight(
  reviewYear: number | null,
  currentYear: number = new Date().getUTCFullYear()
): number {
  if (!reviewYear) return 1.0;
  const age = currentYear - reviewYear;
  for (const band of RECENCY_BANDS) {
    if (age <= band.maxAge) return band.weight;
  }
  return RECENCY_BANDS[RECENCY_BANDS.length - 1].weight;
}

/**
 * A review's recency basis year: its move-out year, else the UTC year of its
 * created_at, else the current year. UTC is used so this matches the SQL
 * strftime(...'unixepoch') in scoring-sql.ts deterministically at year edges.
 * NOTE (Phase 4): new reviews store move-out in `move_out_year_new`, not the
 * legacy `move_out_year` read here, so today this falls back to created_at for
 * new reviews. Preserved deliberately; the dual-column phase revisits this.
 */
export function getReviewYear(
  review: { move_out_year?: number | null; created_at?: number | null },
  currentYear: number = new Date().getUTCFullYear()
): number {
  if (review.move_out_year) return review.move_out_year;
  if (review.created_at) return new Date(review.created_at * 1000).getUTCFullYear();
  return currentYear;
}
```

- [ ] **Step 4: Run to verify JS side passes**

Run: `npm test -- scoring`
Expected: PASS for the new blocks; existing scoring tests still PASS (outputs unchanged).

- [ ] **Step 5: Write the failing test for the SQL emitters**

Create `src/lib/__tests__/scoring-sql.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RECENCY_BANDS } from '../scoring';
import {
  reviewYearSql,
  recencyWeightSql,
  recencyWeightedOverallSql,
  currentReviewYear,
} from '../scoring-sql';

describe('reviewYearSql', () => {
  it('uses move_out_year then created_at UTC year for the given alias', () => {
    const sql = reviewYearSql('r');
    expect(sql).toContain('r.move_out_year');
    expect(sql).toContain("strftime('%Y', r.created_at, 'unixepoch')");
  });
});

describe('recencyWeightSql', () => {
  it('inlines the current year as an integer literal (safe, not user input)', () => {
    expect(recencyWeightSql('r', 2026)).toContain('2026');
  });
  it('rejects a non-numeric year', () => {
    // @ts-expect-error deliberate misuse
    expect(() => recencyWeightSql('r', 'oops')).toThrow();
  });
  it('emits a weight branch for every band in RECENCY_BANDS', () => {
    const sql = recencyWeightSql('r', 2026);
    for (const band of RECENCY_BANDS) {
      expect(sql).toContain(String(band.weight));
    }
  });
});

describe('recencyWeightedOverallSql', () => {
  it('is a NULL-safe weighted mean of overall_score rounded to 1 decimal', () => {
    const sql = recencyWeightedOverallSql('r', 2026);
    expect(sql).toContain('r.overall_score');
    expect(sql).toContain('SUM(');
    expect(sql).toContain('NULLIF(');
    expect(sql).toContain('ROUND(');
  });
});

describe('currentReviewYear', () => {
  it('returns a 4-digit UTC year', () => {
    expect(currentReviewYear()).toBeGreaterThanOrEqual(2024);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- scoring-sql`
Expected: FAIL — module `../scoring-sql` not found.

- [ ] **Step 7: Implement `src/lib/scoring-sql.ts`**

Create `src/lib/scoring-sql.ts`:

```typescript
/**
 * SQL counterparts to the JS recency weighting in scoring.ts. Both are generated
 * from the shared RECENCY_BANDS array, so list-view aggregation (SQL) and
 * detail-page aggregation (JS) cannot diverge.
 *
 * The current year is inlined as an integer LITERAL (never a bind), which keeps
 * each emitted fragment self-contained so heterogeneous call sites don't have to
 * manage bind positions. It is safe: the year is server-computed and coerced to
 * an integer here — it is never user input. (Same category as the ALL_SCORE_FIELDS
 * column-list interpolation already used elsewhere.)
 */
import { RECENCY_BANDS } from './scoring';

function safeYear(currentYear: number): number {
  const y = Math.trunc(Number(currentYear));
  if (!Number.isFinite(y)) throw new Error(`Invalid currentYear: ${currentYear}`);
  return y;
}

/** SQL expression for a review's recency-basis year (mirrors getReviewYear). */
export function reviewYearSql(alias: string): string {
  return `COALESCE(${alias}.move_out_year, CAST(strftime('%Y', ${alias}.created_at, 'unixepoch') AS INTEGER))`;
}

/** SQL CASE expression for a review's recency weight (mirrors getRecencyWeight). */
export function recencyWeightSql(alias: string, currentYear: number): string {
  const cy = safeYear(currentYear);
  const age = `(${cy} - ${reviewYearSql(alias)})`;
  const branches = RECENCY_BANDS
    .filter((b) => Number.isFinite(b.maxAge))
    .map((b) => `    WHEN ${age} <= ${b.maxAge} THEN ${b.weight}`)
    .join('\n');
  const terminal = RECENCY_BANDS[RECENCY_BANDS.length - 1].weight;
  return `CASE\n${branches}\n    ELSE ${terminal}\n  END`;
}

/**
 * SQL expression: recency-weighted mean of overall_score over a GROUP BY (or a
 * correlated subquery) of reviews aliased `alias`. Rounded to 1 decimal to match
 * JS. Reviews with a NULL overall_score are excluded (matching AVG). NULLIF
 * guards the all-null / no-rows case → NULL (same as AVG).
 */
export function recencyWeightedOverallSql(alias: string, currentYear: number): string {
  const w = recencyWeightSql(alias, currentYear);
  return `ROUND(
    SUM(CASE WHEN ${alias}.overall_score IS NOT NULL THEN ${alias}.overall_score * (${w}) ELSE 0 END)
    / NULLIF(SUM(CASE WHEN ${alias}.overall_score IS NOT NULL THEN (${w}) ELSE 0 END), 0)
  , 1)`;
}

/** Current year for recency (UTC, to match strftime 'unixepoch'). */
export function currentReviewYear(): number {
  return new Date().getUTCFullYear();
}
```

- [ ] **Step 8: Run to verify all pass**

Run: `npm test -- scoring`
Expected: PASS (both `scoring` and `scoring-sql` suites).

- [ ] **Step 9: Commit**

```bash
git add src/lib/scoring.ts src/lib/scoring-sql.ts src/lib/__tests__/scoring-sql.test.ts src/lib/__tests__/scoring.test.ts
git commit -m "feat(scoring): shared recency bands + SQL emitters (single source of truth)"
```

---

## Task 2: Aggregate the stored overall_score in calculateAggregatedScores

**Files:**
- Modify: `src/lib/scoring.ts` (`calculateAggregatedScores`, ~lines 211-291)
- Modify: `src/lib/__tests__/scoring.test.ts`

- [ ] **Step 1: Write the failing test (header == list agreement)**

Add to `src/lib/__tests__/scoring.test.ts`:

```typescript
describe('calculateAggregatedScores uses the stored overall_score', () => {
  it('avgOverall equals the recency-weighted mean of the stored column', () => {
    // Two recent reviews with explicit stored overall_score that DIFFERS from
    // what recomputing-from-items would give — proves we use the stored value.
    const reviews = [
      { overall_score: 4.0, move_out_year: 2026, unit_structural: 1 }, // items would ~1
      { overall_score: 2.0, move_out_year: 2026, unit_structural: 5 }, // items would ~5
    ];
    // recency weight 1.0 each → (4.0 + 2.0)/2 = 3.0 from the STORED column
    expect(calculateAggregatedScores(reviews, 2026).avgOverall).toBe(3.0);
  });

  it('excludes reviews with a null overall_score from avgOverall', () => {
    const reviews = [
      { overall_score: 4.0, move_out_year: 2026 },
      { overall_score: null, move_out_year: 2026 },
    ];
    expect(calculateAggregatedScores(reviews, 2026).avgOverall).toBe(4.0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- scoring`
Expected: FAIL — current code recomputes overall from items (the differing-stored-vs-items case fails) and `calculateAggregatedScores` doesn't accept a `currentYear` arg.

- [ ] **Step 3: Update the test helpers to carry a stored `overall_score`**

The refactor makes `calculateAggregatedScores` read `review.overall_score`. The shared fixtures build reviews from the 27 items only, so give them a consistent stored overall (mirrors production, where the column is always set). In `src/lib/__tests__/scoring.test.ts`, update both helpers to set `overall_score` before returning:

In `allScores(value)`, before `return scores;`:
```typescript
  scores.overall_score = calculateOverallScore(scores);
```
In `domainScores(fields, value)`, before `return scores;`:
```typescript
  scores.overall_score = calculateOverallScore(scores);
```
(`calculateOverallScore` is already imported. It ignores the added `overall_score` key because it only reads `ALL_SCORE_FIELDS`, so the write-path parity tests are unaffected.)

- [ ] **Step 4: Refactor `calculateAggregatedScores`**

In `src/lib/scoring.ts`, change the signature and the overall accumulation. Replace the function's signature line and the per-review overall block:

Signature — from:
```typescript
export function calculateAggregatedScores(reviews: any[]): {
```
to:
```typescript
export function calculateAggregatedScores(
  reviews: any[],
  currentYear: number = new Date().getUTCFullYear()
): {
```

Inside the loop, replace the recency-year + overall block. From:
```typescript
    const reviewYear = review.move_out_year
      ? review.move_out_year
      : review.created_at
        ? new Date((review.created_at || 0) * 1000).getFullYear()
        : currentYear;
    const recencyWeight = getRecencyWeight(reviewYear, currentYear);

    // Calculate domain scores for this review
    const domainScores = calculateDomainScores(review);

    if (domainScores.overall !== null) {
      overallSum += domainScores.overall * recencyWeight;
      overallWeight += recencyWeight;
    }
```
to:
```typescript
    const reviewYear = getReviewYear(review, currentYear);
    const recencyWeight = getRecencyWeight(reviewYear, currentYear);

    // Calculate domain sub-scores from items (no stored column for these).
    const domainScores = calculateDomainScores(review);

    // The AGGREGATE overall uses the STORED overall_score column — the single
    // source of truth — so it matches the SQL fragment used by list views.
    const storedOverall = review.overall_score;
    if (storedOverall !== null && storedOverall !== undefined) {
      overallSum += storedOverall * recencyWeight;
      overallWeight += recencyWeight;
    }
```

Also remove the now-redundant local `const currentYear = new Date().getFullYear();` line near the top of the function body (the parameter replaces it).

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- scoring`
Expected: PASS (new + existing). All existing avgOverall assertions still hold because the helpers now set `overall_score` to the same value the old code derived from items.

- [ ] **Step 6: Commit**

```bash
git add src/lib/scoring.ts src/lib/__tests__/scoring.test.ts
git commit -m "refactor(scoring): aggregate stored overall_score for provable header/list parity"
```

---

## Task 3: Drop the cache tables + stop seeding them

**Files:**
- Create: `migrations/0025_drop_score_cache_tables.sql`
- Modify: `scripts/db-seed.ts`

- [ ] **Step 1: Create the migration**

Create `migrations/0025_drop_score_cache_tables.sql`:

```sql
-- Drop the precomputed score cache tables. They were only ever written by the
-- seed script (never by application code) and are fully recomputable from the
-- reviews table, so dropping them loses no authoritative data. All views now
-- compute scores on read via the shared recency-weighted aggregation.
DROP TABLE IF EXISTS building_scores;
DROP TABLE IF EXISTS landlord_scores;
DROP TABLE IF EXISTS property_manager_scores;
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx wrangler d1 migrations apply ratemyplace-db --local`
Expected: migration `0025` applies cleanly.

- [ ] **Step 3: Remove `*_scores` writes from the seed script**

In `scripts/db-seed.ts`, delete the seed phases that INSERT into `building_scores`, `landlord_scores`, `property_manager_scores` and the "Compute … scores" / "Verifying scores" steps that reference them. (Search the file for `building_scores`, `landlord_scores`, `property_manager_scores` and remove those blocks and their progress log lines. Leave the users/landlords/buildings/reviews/disputes phases intact.)

- [ ] **Step 4: Verify a fresh seed works without the cache tables**

Run: `npm run db:setup`
Expected: completes; summary prints users/landlords/buildings/reviews/disputes with no error about missing `*_scores` tables.

- [ ] **Step 5: Commit**

```bash
git add migrations/0025_drop_score_cache_tables.sql scripts/db-seed.ts
git commit -m "feat(db): drop dead *_scores cache tables (migration 0025) + stop seeding them"
```

---

## Task 4: Detail pages — always compute, remove fallbacks, recency-weight sub-aggregations

**Files:**
- Modify: `src/pages/building/[slug].astro`
- Modify: `src/pages/landlord/[slug].astro`
- Modify: `src/pages/property-manager/[slug].astro`

- [ ] **Step 1: building/[slug].astro — remove cache read + fallback, always compute**

Remove the `building_scores` read (the `const scoresResult = await db.prepare('SELECT * FROM building_scores WHERE building_id = ?')...` block and `scores = scoresResult;`). Replace the fallback branch:

From:
```typescript
    // If we have reviews but building_scores doesn't have domain scores,
    // calculate them from the reviews
    if (reviews.length > 0 && scores && !scores.avg_unit && !scores.avg_building && !scores.avg_landlord) {
      const calculatedScores = calculateBuildingAverages(reviews);
      scores = { ...scores, ...calculatedScores };
    } else if (reviews.length > 0 && !scores) {
      // No building_scores record at all, calculate everything
      scores = calculateBuildingAverages(reviews);
    }
```
to:
```typescript
    // Always compute from the fetched approved reviews — no cache table.
    if (reviews.length > 0) {
      scores = calculateBuildingAverages(reviews);
    }
```
Ensure `let scores: any = null;` remains (unchanged), so a building with zero reviews leaves `scores = null` and the existing "No reviews yet" path renders.

- [ ] **Step 2: building/[slug].astro — recency-weight the per-unit-type average**

The per-unit-type loop currently averages `calculateDomainScores(review).overall` with no recency. Import the helpers at the top of the frontmatter (add to the existing scoring import line):

```typescript
import { calculateBuildingAverages, calculateDomainScores, getRecencyWeight, getReviewYear } from '../../lib/scoring';
```

Replace the per-unit average accumulation (currently `let scoreSum=0; let scoreCount=0; stats.reviews.forEach(... scoreSum += domainScores.overall ... ); stats.avgScore = scoreCount > 0 ? scoreSum / scoreCount : 0;`) with a recency-weighted mean of the stored overall, matching the headline method:

```typescript
  // Recency-weighted mean of the stored overall_score, matching the headline method.
  const currentYear = new Date().getUTCFullYear();
  let weightedSum = 0;
  let weightTotal = 0;
  stats.reviews.forEach(review => {
    const stored = review.overall_score;
    if (stored === null || stored === undefined) return;
    const w = getRecencyWeight(getReviewYear(review, currentYear), currentYear);
    weightedSum += stored * w;
    weightTotal += w;
  });
  stats.avgScore = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : 0;
```

- [ ] **Step 3: landlord/[slug].astro — remove cache read + fallback**

Remove the `landlord_scores` read and replace the two-branch fallback (the `if (recentReviews.length > 0 && scores && !scores.avg_landlord) {...} else if (recentReviews.length > 0 && !scores) {...}` block that fetches all reviews) with a single always-compute path. After `recentReviews` are loaded and `buildings` known, compute:

```typescript
      // Always compute landlord scores from approved reviews — no cache table.
      const allReviewsResult = await db.prepare(`
        SELECT r.* FROM reviews r
        JOIN buildings b ON r.building_id = b.id
        WHERE b.landlord_id = ? AND r.status = 'approved'
      `).bind(landlord.id).all();
      const allReviews = allReviewsResult.results || [];
      if (allReviews.length > 0) {
        scores = { ...calculateLandlordAverages(allReviews), building_count: buildings.filter(b => (b.review_count || 0) > 0).length };
      }
```
Remove the now-unused `const scoresResult = await db.prepare('SELECT * FROM landlord_scores ...')` and `scores = scoresResult;`. Keep `let scores: any = null;`.

- [ ] **Step 4: property-manager/[slug].astro — remove cache read (fallback already added)**

Remove the `const scoresResult = await db.prepare('SELECT * FROM property_manager_scores WHERE property_manager_id = ?')...` block and `scores = scoresResult;`. The recompute block added in the prior pass (`if (!scores) { ... calculateLandlordAverages ... }`) already computes scores; with the cache read gone, `scores` starts `null` and that block always runs. Confirm `let scores: any = null;` remains.

- [ ] **Step 5: Rewire the per-building `AVG` rows on landlord + PM pages**

In `landlord/[slug].astro` (line ~36) and `property-manager/[slug].astro` (line ~36), the per-building list uses `ROUND(AVG(r.overall_score), 1) as avg_overall`. Add the import and current-year, and swap the expression. Add to each file's frontmatter imports:
```typescript
import { recencyWeightedOverallSql, currentReviewYear } from '../../lib/scoring-sql';
```
Before the buildings query in each, add:
```typescript
    const currentYear = currentReviewYear();
```
Then in the buildings query template literal, replace `ROUND(AVG(r.overall_score), 1) as avg_overall` with:
```
${recencyWeightedOverallSql('r', currentYear)} as avg_overall
```
(Note: `building/[slug].astro` already declares `const currentYear` in Step 2 — reuse it; do not redeclare.)

- [ ] **Step 6: Verify build + run the app**

Run: `npm run build`
Expected: `Complete!` with no errors.

- [ ] **Step 7: Commit**

```bash
git add "src/pages/building/[slug].astro" "src/pages/landlord/[slug].astro" "src/pages/property-manager/[slug].astro"
git commit -m "refactor(detail): always compute scores, drop cache reads, recency-weight sub-aggregations"
```

---

## Task 5: Rewire list-view AVG sites to the recency-weighted fragment

For each file: add `import { recencyWeightedOverallSql, currentReviewYear } from '<relative>/lib/scoring-sql';`, add `const currentYear = currentReviewYear();` before the relevant `db.prepare(...)`, and swap the expression. Import depth: API routes under `src/pages/api/**` use `'../../lib/scoring-sql'` or `'../../../lib/scoring-sql'` matching the file's existing `getDB` import depth.

- [ ] **Step 1: `src/pages/api/search/results.ts`**

Two SELECTs. Replace `ROUND(AVG(r.overall_score), 1) as avg_overall` (buildings query, ~line 65) and `ROUND(AVG(r.overall_score), 1) as avg_overall` (landlords query, ~line 100) each with `${recencyWeightedOverallSql('r', currentYear)} as avg_overall`. Add the import and a `const currentYear = currentReviewYear();` at the top of the handler. Leave `ORDER BY ... AVG(r.overall_score) DESC` unchanged.

- [ ] **Step 2: `src/pages/search.astro`**

Four SELECT occurrences of `ROUND(AVG(r.overall_score), 1) as avg_overall` (lines ~45, ~79, ~113, ~143). Add the import and `const currentYear = currentReviewYear();` in the frontmatter (once, near the top). Replace each SELECT occurrence with `${recencyWeightedOverallSql('r', currentYear)} as avg_overall`. Leave both `ORDER BY ... AVG(r.overall_score) DESC` (lines ~53, ~120) unchanged.

- [ ] **Step 3: `src/pages/api/search/autocomplete.ts`**

Two occurrences (~lines 53, 66): replace `ROUND(AVG(r.overall_score), 1) as avg_overall` with `${recencyWeightedOverallSql('r', currentYear)} as avg_overall`. Add import + `const currentYear = currentReviewYear();` at the top of the handler.

- [ ] **Step 4: `src/pages/api/buildings/map.ts`**

Line ~45: replace `AVG(r.overall_score) as avg_score` with `${recencyWeightedOverallSql('r', currentYear)} as avg_score`. Add import + `const currentYear = currentReviewYear();` before the query. (`avg_score` is later mapped through `Math.round(row.avg_score*10)/10` — harmless double-round; leave the mapping as-is.)

- [ ] **Step 5: `src/pages/api/buildings/saved.ts`**

Line ~27 (correlated subquery): replace `ROUND(AVG(r.overall_score), 1)` with `${recencyWeightedOverallSql('r', currentYear)}` (keep the surrounding `(SELECT ... FROM reviews r WHERE ...) as avg_overall`). Add import + `const currentYear = currentReviewYear();` before the query.

- [ ] **Step 6: `src/pages/api/admin/buildings/index.ts`**

Line ~65: replace `AVG(r.overall_score) as avg_score` with `${recencyWeightedOverallSql('r', currentYear)} as avg_score`. Add import + `const currentYear = currentReviewYear();` before the query.

- [ ] **Step 7: `src/pages/api/admin/landlords/index.ts`**

Two occurrences: line ~46 uses alias `r2` (`AVG(r2.overall_score) as avg_score`) → `${recencyWeightedOverallSql('r2', currentYear)} as avg_score`; line ~66 uses alias `r` → `${recencyWeightedOverallSql('r', currentYear)} as avg_score`. Add import + `const currentYear = currentReviewYear();` before the query.

- [ ] **Step 8: `src/pages/api/admin/landlords/[id].ts`**

Line ~146: replace `AVG(r.overall_score) as avg_score` with `${recencyWeightedOverallSql('r', currentYear)} as avg_score`. Add import + `const currentYear = currentReviewYear();` before the query.

- [ ] **Step 9: `src/pages/api/admin/managers/index.ts`**

Line ~38: replace `AVG(r.overall_score) as avg_score` with `${recencyWeightedOverallSql('r', currentYear)} as avg_score`. Add import + `const currentYear = currentReviewYear();` before the query.

- [ ] **Step 10: `src/pages/api/admin/managers/[id].ts`**

Line ~148: replace `AVG(r.overall_score) as avg_score` with `${recencyWeightedOverallSql('r', currentYear)} as avg_score`. Add import + `const currentYear = currentReviewYear();` before the query.

- [ ] **Step 11: Verify build**

Run: `npm run build`
Expected: `Complete!` no errors.

- [ ] **Step 12: Commit**

```bash
git add src/pages/api/search/results.ts src/pages/search.astro src/pages/api/search/autocomplete.ts src/pages/api/buildings/map.ts src/pages/api/buildings/saved.ts src/pages/api/admin/buildings/index.ts src/pages/api/admin/landlords/index.ts "src/pages/api/admin/landlords/[id].ts" src/pages/api/admin/managers/index.ts "src/pages/api/admin/managers/[id].ts"
git commit -m "refactor(scoring): route all list-view score aggregation through the recency-weighted fragment"
```

---

## Task 6: End-to-end verification (parity across views)

**Files:** none (verification only).

- [ ] **Step 1: Full test + build**

Run: `npm test && npm run build`
Expected: all tests PASS; build `Complete!`.

- [ ] **Step 2: Seed + run the app**

Run: `npm run db:setup`, then start the dev server (preview `dev`).

- [ ] **Step 3: Cross-view parity spot-check (3 buildings)**

Pick 3 buildings with reviews. For each, confirm the aggregate overall is identical on: search results (`/search?q=<addr>`), the building detail header (`/building/<slug>`), the map endpoint (`/api/buildings/map`), and the admin buildings list (`/api/admin/buildings`). Record the numbers; they must match.

- [ ] **Step 4: Aged-review check**

Temporarily set one review's `move_out_year` to `currentYear - 5` via `wrangler d1 execute ... --local`. Confirm the same decayed score now appears in BOTH the search results and the detail header for that building (proving recency parity across SQL and JS). Restore the value afterward.

- [ ] **Step 5: Zero-review + missing-entity checks**

Confirm a building/landlord/PM with no reviews still renders "No reviews yet" (not a crash), and an unknown slug still 404s (unchanged behavior).

- [ ] **Step 6: Preview deploy smoke-test**

Push the branch, wait for the Cloudflare preview, and repeat Step 3's parity spot-check against real production data on the preview URL (score outputs are server-rendered, so preview fully verifies them). Merge to `main` only after parity holds.

---

## Self-review notes

- **Spec coverage:** invariant (Tasks 1-2, 5), shared recency SQL/JS (Task 1), calculateAggregatedScores refactor (Task 2), 12 AVG sites (Tasks 4-5), drop tables + seed (Task 3), detail-page fallbacks + per-unit alignment (Task 4), tests + preview verification (Tasks 1-2, 6). All covered.
- **Types/names consistent:** `RECENCY_BANDS`, `getRecencyWeight`, `getReviewYear`, `reviewYearSql`, `recencyWeightSql`, `recencyWeightedOverallSql`, `currentReviewYear` are used identically across tasks.
- **No score change today:** all production reviews are recent → weight 1.0 → outputs identical pre/post refactor (verified in Task 6).
