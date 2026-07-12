# Dual-Column Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make one canonical column per concept on `reviews`, drop 15 legacy/dead columns, and fix the recency basis to use the real move-out year (`move_out_year_new`).

**Architecture:** Code first stops reading/writing the legacy columns; an idempotent backfill migration fills `_new` columns for any old rows; then a drop migration removes the 15 columns (applied to prod only after the code deploys — deploy-then-drop, like Phase 1).

**Tech Stack:** Astro 5 SSR, Cloudflare D1 (SQLite ≥3.35 supports `DROP COLUMN`), TypeScript, Vitest (+ `node:sqlite` for parity), `wrangler d1` migrations.

**Reference spec:** `docs/superpowers/specs/2026-07-11-dual-column-consolidation-design.md`
**Branch:** `refactor/dual-column-consolidation` (already created).

**Columns to drop (15):** `had_pests`; the 12 `score_building_quality, score_maintenance, score_pest_control, score_safety, score_noise, score_landlord_responsiveness, score_landlord_communication, score_landlord_fairness, score_lease_clarity, score_deposit_handling, score_rent_value, score_amenities`; `would_recommend`; `move_out_year`.

---

## Task 1: Remove dead-column reads (pests fallback + v1 score type decls)

**Files:** `src/lib/scoring.ts`, `src/components/reviews/ReviewCard.astro`, `src/pages/api/reviews/[id].ts`, `src/lib/types.ts`

- [ ] **Step 1: scoring.ts — drop the had_pests fallback.** At ~line 336, change:
```typescript
    if (review.had_pest_issues || review.had_pests) pestCount++;
```
to:
```typescript
    if (review.had_pest_issues) pestCount++;
```

- [ ] **Step 2: ReviewCard.astro — drop had_pests terms.** Around lines 464 and 467, remove the `|| review.had_pests === 1` (line 464) and the `|| review.had_pests === 1` / `review.had_pests` reference (line 467) so the pest-issue display keys only off `had_pest_issues`. READ those lines first; keep the other issue flags (had_heat_issues etc.) intact. Example — line 467 `(review.had_pest_issues === 1 || review.had_pests === 1)` becomes `(review.had_pest_issues === 1)`.

- [ ] **Step 3: reviews/[id].ts + types.ts — remove the 12 v1 score_* type declarations.** In `src/pages/api/reviews/[id].ts` delete the block:
```typescript
  // Legacy score fields (kept for backward compatibility)
  score_building_quality: number | null;
  score_maintenance: number | null;
  score_pest_control: number | null;
  score_safety: number | null;
  score_noise: number | null;
  score_landlord_responsiveness: number | null;
  score_landlord_communication: number | null;
  score_landlord_fairness: number | null;
  score_lease_clarity: number | null;
  score_deposit_handling: number | null;
  score_rent_value: number | null;
  score_amenities: number | null;
```
Then grep `src/lib/types.ts` for the same `score_*` fields and remove them from whatever interface holds them. Confirm nothing SELECTs or writes these columns anywhere (`grep -rnE "score_(building_quality|maintenance|pest_control|safety|noise|landlord_responsiveness|landlord_communication|landlord_fairness|lease_clarity|deposit_handling|rent_value|amenities)" src/` → nothing).

- [ ] **Step 4: Verify build + tests.** `npm run build` (Complete!) and `npm test` (379 pass). Then `grep -rnE "\bhad_pests\b" src/` and the score_* grep above → both empty.

- [ ] **Step 5: Commit.**
```bash
git add src/lib/scoring.ts src/components/reviews/ReviewCard.astro "src/pages/api/reviews/[id].ts" src/lib/types.ts
git commit -m "refactor(reviews): drop dead had_pests + v1 score_* column reads"
```

---

## Task 2: Would-recommend — stop writing/reading the legacy column

**Files:** `src/lib/scoring.ts`, `src/pages/api/reviews/[id].ts`

- [ ] **Step 1: scoring.ts — read only would_recommend_new.** At ~line 303:
```typescript
    const wouldRecommend = review.would_recommend_new || review.would_recommend;
```
to:
```typescript
    const wouldRecommend = review.would_recommend_new;
```

- [ ] **Step 2: reviews/[id].ts — stop writing the legacy would_recommend column.** READ lines ~245-247, ~294-295, ~360-365. Remove:
  - line ~247: the `const wouldRecommendLegacy = ...` declaration.
  - line ~295: the `        would_recommend = ?,` line in the UPDATE column list.
  - line ~364: the `      wouldRecommendLegacy,` bind argument.
  Keep `would_recommend_new = ?` and its `wouldRecommendNew` bind. Confirm the counts line up (one fewer column and one fewer bind).

- [ ] **Step 3: Verify build + tests.** `npm run build`, `npm test`. Then `grep -rnE "\bwould_recommend\b" src/ | grep -v would_recommend_new` → should be empty except comments (the `// ancillary items (would_recommend...` comment in scoring.ts is fine; and the `would_recommend: boolean` interface field + `would_recommend: review.would_recommend === 1` row mapping in reviews/[id].ts — remove those too if they reference the dropped column: the interface field at ~line 83 and its use at ~140 read the legacy column from a SELECT, so drop them).

- [ ] **Step 4: Commit.**
```bash
git add src/lib/scoring.ts "src/pages/api/reviews/[id].ts"
git commit -m "refactor(reviews): use would_recommend_new only, stop writing legacy would_recommend"
```

---

## Task 3: Move-out recency (Option A — derive from move_out_year_new)

**Files:** `src/lib/scoring.ts` (`getReviewYear`), `src/lib/scoring-sql.ts` (`reviewYearSql`), tests.

- [ ] **Step 1: Update the JS parity test first (TDD).** In `src/lib/__tests__/scoring.test.ts`, update the `getReviewYear` describe block to use `move_out_year_new` and cover the new cases:
```typescript
describe('getReviewYear (derives recency from move_out_year_new)', () => {
  const tsUtc2025 = Date.UTC(2025, 5, 15) / 1000;
  it('uses a 4-digit move_out_year_new', () => {
    expect(getReviewYear({ move_out_year_new: '2023', created_at: tsUtc2025 }, 2026)).toBe(2023);
  });
  it("falls back to created_at UTC year for 'current'", () => {
    expect(getReviewYear({ move_out_year_new: 'current', created_at: tsUtc2025 }, 2026)).toBe(2025);
  });
  it('falls back to created_at when move_out_year_new is null/empty', () => {
    expect(getReviewYear({ move_out_year_new: null, created_at: tsUtc2025 }, 2026)).toBe(2025);
    expect(getReviewYear({ created_at: tsUtc2025 }, 2026)).toBe(2025);
  });
  it('falls back to currentYear when nothing is available', () => {
    expect(getReviewYear({}, 2026)).toBe(2026);
  });
});
```
Remove/replace the old `getReviewYear` test that referenced `move_out_year`.

- [ ] **Step 2: Run test → FAIL.** `npm test -- scoring` (getReviewYear still reads move_out_year).

- [ ] **Step 3: Implement getReviewYear (scoring.ts).** Replace the function body:
```typescript
export function getReviewYear(
  review: { move_out_year_new?: string | null; created_at?: number | null },
  currentYear: number = new Date().getUTCFullYear()
): number {
  const moy = review.move_out_year_new;
  if (moy && /^\d{4}$/.test(moy)) return parseInt(moy, 10);
  if (review.created_at) return new Date(review.created_at * 1000).getUTCFullYear();
  return currentYear;
}
```
Update the JSDoc: remove the Phase-4 "revisits this" note; state recency now uses the real move-out year (`move_out_year_new`), `'current'`/absent → `created_at`.

- [ ] **Step 4: Implement reviewYearSql (scoring-sql.ts).** Replace:
```typescript
export function reviewYearSql(alias: string): string {
  return `COALESCE(${alias}.move_out_year, CAST(strftime('%Y', ${alias}.created_at, 'unixepoch') AS INTEGER))`;
}
```
with (a 4-digit `move_out_year_new` wins; `'current'`/other non-4-digit → created_at year):
```typescript
export function reviewYearSql(alias: string): string {
  return `COALESCE(
    CASE WHEN ${alias}.move_out_year_new GLOB '[0-9][0-9][0-9][0-9]' THEN CAST(${alias}.move_out_year_new AS INTEGER) END,
    CAST(strftime('%Y', ${alias}.created_at, 'unixepoch') AS INTEGER)
  )`;
}
```

- [ ] **Step 5: Update the node:sqlite parity test.** In `src/lib/__tests__/scoring-sql-parity.test.ts`, the fixture reviews currently set `move_out_year`. Change them to set `move_out_year_new` (TEXT) instead — include a 4-digit year, `'current'`, and null — and ensure the in-memory `CREATE TABLE reviews` has a `move_out_year_new TEXT` column (replace/AUGMENT the `move_out_year` column in the fixture DDL). The SQL fragment (`reviewYearSql`) and JS (`getReviewYear`/`calculateAggregatedScores`) must still agree. READ the test and adapt its DDL + fixtures + the JS-side objects to match.

- [ ] **Step 6: Run tests → PASS.** `npm test -- scoring` then full `npm test`. Fix any other test fixtures that referenced `move_out_year` for recency.

- [ ] **Step 7: Commit.**
```bash
git add src/lib/scoring.ts src/lib/scoring-sql.ts src/lib/__tests__/scoring.test.ts src/lib/__tests__/scoring-sql-parity.test.ts
git commit -m "refactor(scoring): derive recency year from move_out_year_new (Option A), drop legacy move_out_year read"
```

---

## Task 4: Update the seed to use canonical columns

**Files:** `scripts/db-seed.ts`

Context: `makeReview` returns a `ReviewBase` and there's ONE `INSERT INTO reviews (...)`. The seed currently writes legacy `move_out_year` and `had_pests` (NOT the live `had_pest_issues`). It already writes canonical `move_out_year_new` and `would_recommend_new`.

- [ ] **Step 1: makeReview — write had_pest_issues instead of had_pests; drop move_out_year from the returned object.** In the return object of `makeReview`: rename `had_pests: scores.unit_pests <= 2 ? 1 : 0,` → `had_pest_issues: scores.unit_pests <= 2 ? 1 : 0,` (preserve the `?? scores.had_pests` override intent by using `scores.had_pest_issues ?? (scores.unit_pests <= 2 ? 1 : 0)` if the ReviewScores override existed — READ the exact line). Remove `move_out_year,` from the returned object (keep the LOCAL `const move_out_year` — it's still used to derive `move_out_year_new`, `is_current_tenant`, `move_out_season`).

- [ ] **Step 2: Interfaces — remove legacy fields.** In `ReviewBase`: remove `move_out_year: number | null;` and rename `had_pests: number;` → `had_pest_issues: number;`. In the `ReviewScores` optional-overrides block: rename `had_pests?: number;` → `had_pest_issues?: number;`. In `ReviewExtras`: keep `move_out_year?` (it's an INPUT param callers pass to derive the new column) — it does NOT map to a DB column anymore, so leaving it as an accepted extra is fine; confirm nothing else breaks.

- [ ] **Step 3: INSERT statement — swap columns.** In the `INSERT INTO reviews (...)` column list: remove `move_out_year,` and change `had_pests,` → `had_pest_issues,`. In the corresponding VALUES/bindings array, remove the `move_out_year` value and change the `had_pests` value binding to `had_pest_issues`. Keep `move_out_year_new` and `would_recommend_new`. Ensure column count == value count.

- [ ] **Step 4: Verify a fresh seed works.** `npm run db:setup` → completes, 128 reviews inserted, no "no such column" error. Then `npm test` (379) and `npm run build`.

- [ ] **Step 5: Commit.**
```bash
git add scripts/db-seed.ts
git commit -m "chore(seed): write canonical had_pest_issues + move_out_year_new (drop legacy cols)"
```

---

## Task 5: Migrations (backfill + drops)

**Files:** `migrations/0026_backfill_new_columns.sql`, `migrations/0027_drop_legacy_columns.sql`

- [ ] **Step 1: Create the backfill migration** `migrations/0026_backfill_new_columns.sql`:
```sql
-- Idempotent backfill of canonical columns from legacy ones, for any rows that
-- predate the *_new columns. Safe to run anytime and to re-run. Old code does
-- not depend on these writes.
UPDATE reviews SET would_recommend_new = CASE would_recommend WHEN 1 THEN 'yes' WHEN 0 THEN 'no' END
  WHERE would_recommend_new IS NULL;
UPDATE reviews SET move_out_year_new = CAST(move_out_year AS TEXT)
  WHERE move_out_year_new IS NULL AND move_out_year IS NOT NULL;
```

- [ ] **Step 2: Create the drop migration** `migrations/0027_drop_legacy_columns.sql`:
```sql
-- Drop the 15 legacy/dead columns now that all code reads/writes the canonical
-- columns. No index or table-level CHECK references these, so no table rebuild
-- is needed. Apply to prod ONLY AFTER the code that stopped using them is deployed.
ALTER TABLE reviews DROP COLUMN had_pests;
ALTER TABLE reviews DROP COLUMN score_building_quality;
ALTER TABLE reviews DROP COLUMN score_maintenance;
ALTER TABLE reviews DROP COLUMN score_pest_control;
ALTER TABLE reviews DROP COLUMN score_safety;
ALTER TABLE reviews DROP COLUMN score_noise;
ALTER TABLE reviews DROP COLUMN score_landlord_responsiveness;
ALTER TABLE reviews DROP COLUMN score_landlord_communication;
ALTER TABLE reviews DROP COLUMN score_landlord_fairness;
ALTER TABLE reviews DROP COLUMN score_lease_clarity;
ALTER TABLE reviews DROP COLUMN score_deposit_handling;
ALTER TABLE reviews DROP COLUMN score_rent_value;
ALTER TABLE reviews DROP COLUMN score_amenities;
ALTER TABLE reviews DROP COLUMN would_recommend;
ALTER TABLE reviews DROP COLUMN move_out_year;
```

- [ ] **Step 3: Apply both locally.** `npx wrangler d1 migrations apply ratemyplace-db --local`. Expect 0026 + 0027 apply cleanly. Verify: `npx wrangler d1 execute ratemyplace-db --local --command "SELECT name FROM pragma_table_info('reviews') WHERE name IN ('had_pests','score_amenities','would_recommend','move_out_year');"` → returns no rows.

- [ ] **Step 4: Re-seed against the migrated schema.** `npm run db:setup` (this runs db:fresh which re-applies all migrations including 0027, then seeds). Confirm it completes (the Task 4 seed changes must be in place first, or the seed INSERT will fail on the dropped columns).

- [ ] **Step 5: Commit.**
```bash
git add migrations/0026_backfill_new_columns.sql migrations/0027_drop_legacy_columns.sql
git commit -m "feat(db): backfill canonical columns (0026) + drop 15 legacy columns (0027)"
```

---

## Task 6: End-to-end verification (local)

- [ ] **Step 1: Full test + build.** `npm test` (all pass) && `npm run build` (Complete!).
- [ ] **Step 2: Grep gate.** In `src/`, zero references remain to: `had_pests`, the 12 `score_*` v1 columns, legacy `would_recommend` (non-`_new`), legacy `move_out_year` (non-`_new`).
- [ ] **Step 3: Cross-view parity (dev server + seed).** For 3 reviewed buildings, confirm the aggregate overall matches across search results, detail header, and map (as in Phase 1). Recency now derives from `move_out_year_new`.
- [ ] **Step 4: Aged-review recency check.** Set one review's `move_out_year_new` to `<currentYear-5>` (a 4-digit string) via `wrangler d1 execute --local`; confirm the detail header and search endpoint decay identically (SQL⇄JS parity on the new basis). Restore.
- [ ] **Step 5: Would-recommend + pests sanity.** Confirm a building's "% would recommend" and pest-issue display still render correctly from the canonical columns (seed now writes `had_pest_issues`).

---

## Task 7: Deploy (GATED — requires explicit user go before prod DB changes)

- [ ] **Step 1: Verify prod distribution** (D1 console or authorized wrangler): count rows where each legacy column holds data its `_new` counterpart lacks. Confirm backfill scope / no unique data at risk.
- [ ] **Step 2: Apply `0026` (backfill) to prod** `--remote` (safe pre-deploy).
- [ ] **Step 3: Merge branch → main → Cloudflare deploys the code** (no longer reads/writes legacy columns). Verify prod parity (as Phase 1).
- [ ] **Step 4: Apply `0027` (drops) to prod** `--remote` — ONLY after Step 3's deploy is live. Verify prod detail/search render correctly post-drop.

---

## Self-review notes
- **Spec coverage:** dead columns (T1), would-recommend (T2), move-out Option A (T3), seed (T4), migrations split (T5), verification (T6), gated deploy (T7). All covered.
- **Type/name consistency:** `getReviewYear` new signature reads `move_out_year_new`; `reviewYearSql` GLOB-parses `move_out_year_new`; seed writes `had_pest_issues`/`move_out_year_new`/`would_recommend_new`; drops list exactly the 15 columns.
- **Deploy safety:** backfill (0026) before deploy; drops (0027) after deploy; both idempotent-safe / no-index-block verified.
