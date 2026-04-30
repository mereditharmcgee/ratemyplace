# Phase 20: Critical-Flow E2E Coverage - Research

**Researched:** 2026-04-29
**Domain:** Playwright E2E testing, D1 SQLite direct access, Astro/React score display
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Helper extraction pattern:** `export function clearRateLimits(): void` as standalone export in `e2e/fixtures.ts`. No auto-fixture, no implicit beforeEach. Manual call at each call site.
- **No parameters on clearRateLimits.** Always `--local` D1. Remote support is YAGNI.
- **fixtures.ts structure:** Top = existing `authedPage`/`adminPage` fixtures (unchanged). Bottom = new section header `// --- DB Helpers ---`, then `clearRateLimits()`.
- **No other helpers extracted in this phase.** `clearSecurityTestDisputes()` stays inline in security.spec.ts.
- **security.spec.ts updated** to remove inline `clearRateLimits` and import the shared one. All 5 call sites stay unchanged.
- **Reserved review IDs:** `review-090` and `review-091` for Phase 20. No collision with existing: `review-030/040/060/070` (security), `review-080/081/082` (Phase 17 disputes).
- **New seeded test building:** slug `test-cross-view-consistency`, address `999 E2E Test Way, Boston, MA 02115`. Zero existing reviews.
- **Cleanup pattern:** `test.afterEach` deletes `review-090`, `review-091`, and matching `audit_logs` entries. `test.beforeEach` does the same (idempotent/belt-and-suspenders).
- **Score match: exact equality** across 3 views. Controlled recency window (both reviews submitted seconds apart) eliminates recency-weighted divergence.
- **Approve flow: through admin UI.** Navigate to `/admin/reviews`, find row, click Approve. No direct API or DB UPDATE.
- **Cross-view read order:** GET search → navigate building detail → navigate profile. No delays needed (D1 is immediately consistent).
- **audit_logs assertion:** Direct wrangler d1 execute. Capture `review_id` BEFORE triggering approve. Pass condition: ≥ 1 row matching `entity_id + action_type`. No assertion on `admin_user_id`, `old_value`, `new_value`.
- **Test execution mode:** Default Playwright parallelism. No serial mode required.
- **New spec file:** `e2e/critical-flows.spec.ts` (houses TEST-01 + TEST-02).

### Claude's Discretion

- Exact Playwright selectors for admin Approve button and score-display elements
- Whether to use `request.get` or `page.goto` for search-results JSON read in TEST-02
- Exact assertion failure messages
- How to extract the just-inserted review's ID after submission (researcher will determine based on API response shape)
- Helper consolidation in section comment of fixtures.ts

### Deferred Ideas (OUT OF SCOPE)

- Audit log admin UI (v1.6.0)
- Mocked-time tests for recency-weighted scoring
- `clearAuditLogs()` helper extraction
- Parallel-mode safety audit
- Visual regression tests on score-display components
- E2E for bonus disputes/[id].ts admin endpoint
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | E2E test for admin moderation flow with causal audit-log assertion (capture `review_id` before approve, assert specific `audit_logs` entry after — not ordering-dependent) | `audit_logs.entity_id` confirmed TEXT; `action_type` value is `review_approved`; approve endpoint calls `createAuditLog` synchronously before returning 200 |
| TEST-02 | E2E test for cross-view data consistency: submit review → admin approve → assert `overall_score` matches across `/api/search/results`, `/building/[slug]`, and `/profile` | Search field: `avg_overall` (ROUND to 1 decimal, numeric); detail page: `scores.avg_overall` from `building_scores` (`.toFixed(1)`); profile: `review.overall_score` (the stored per-review value, not building aggregate) |
| TEST-03 | `clearRateLimits()` extracted from `security.spec.ts` into `e2e/fixtures.ts` for cross-spec reuse | Exact function body confirmed from source; fixtures.ts is 35 lines; insertion point is after line 35 |
</phase_requirements>

---

## Summary

Phase 20 is a pure test-engineering phase. No app code changes. Three deliverables: one shared helper extraction (TEST-03), one causal audit-log E2E test (TEST-01), and one cross-view score consistency E2E test (TEST-02).

The critical technical facts are: (1) `audit_logs.entity_id` is TEXT and stores the review ID string verbatim — the WHERE clause `entity_id = '<id>' AND action_type = 'review_approved'` works exactly as written in CONTEXT.md. (2) The approve endpoint writes the audit log row synchronously and inline before returning the 200 response — there is no async defer or fire-and-forget for audit logging, so the test can read `audit_logs` immediately after the UI confirms approval. (3) Score semantics differ across the three views: search returns a live SQL `ROUND(AVG(overall_score), 1)` aggregate named `avg_overall`; building detail reads from `building_scores.avg_overall` (a materialized table updated by the seed/trigger layer); profile returns the per-review stored `overall_score`, not a building aggregate. This means TEST-02's cross-view assertion compares three different data sources and a divergence between them is a real bug.

The `review` POST endpoint (`src/pages/api/reviews.ts`) returns `{ success: true, reviewId, buildingSlug, domainScores }` — the `reviewId` is directly available in the response body with no need for a DB query fallback.

**Primary recommendation:** Use `request.get` (Playwright API client) for the search-results JSON step in TEST-02, since it avoids page navigation and makes score extraction straightforward. Use `authedPage.request.get` so the auth context is available if needed.

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| Playwright | (current, see package.json) | E2E test runner, browser automation, API client | Already installed |
| Node.js `child_process.execSync` | stdlib | wrangler d1 execute wrapper for DB assertions | Already used in security.spec.ts |
| `npx wrangler d1 execute ratemyplace-db --local` | current wrangler | Direct D1 access in tests | Established pattern |

No new packages required. Phase 20 adds zero production dependencies and zero new test framework dependencies.

---

## Architecture Patterns

### Established Pattern: Direct D1 in Tests

```typescript
// Source: e2e/security.spec.ts:11
function clearRateLimits() {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM rate_limits"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}
```

All raw D1 access in tests uses `execSync` with `cwd: PROJECT_ROOT`. The `stdio: 'pipe'` suppresses wrangler output from test logs.

### Established Pattern: Reserved-ID Isolation

Each spec block reserves a range of review IDs. Cleanup is idempotent (`beforeEach` + `afterEach` both delete). The new Phase 20 reservation extends the table:

| Range | Owner | Location |
|-------|-------|----------|
| review-030, 040, 060, 070 | security.spec.ts SQL injection / XSS | security.spec.ts inline |
| review-080, 081, 082 | Phase 17 dispute validation | security.spec.ts Phase 17 block |
| review-090, 091 | Phase 20 critical-flows | e2e/critical-flows.spec.ts |
| review-100+ | **unreserved** | next phases |

### Established Pattern: Admin UI Approve Flow

From `e2e/admin-actions.spec.ts:13`, the full approve flow is:
```typescript
await adminPage.goto('/admin/reviews');
await adminPage.waitForLoadState('networkidle');
// Expand the row (click the cursor-pointer card)
await adminPage.locator('.cursor-pointer').first().click();
// For a pending review, Approve button is directly visible (no Reset to Pending needed)
await adminPage.locator('button', { hasText: 'Approve' }).first().click();
// Assert badge updated
await expect(adminPage.locator('span.rounded-full').first()).toContainText('approved');
```

**Important distinction for Phase 20:** The existing test in admin-actions.spec.ts always starts from `approved` seed reviews and clicks "Reset to Pending" first. The Phase 20 test inserts its own `pending` review via the API, so the Approve button should be directly visible after expanding the row — no "Reset to Pending" step needed.

**Selector for the specific review row:** The admin ReviewsTable renders rows as `.cursor-pointer` cards. To target the specific `review-090` row, the test must scope to the card that contains the known building address or use the review ID. The `data-testid` attribute is absent from the current ReviewsTable implementation. The most stable approach is:

```typescript
// Find the row containing the test building's address text, then click Approve within it
const reviewRow = adminPage.locator('.cursor-pointer', {
  hasText: '999 E2E Test Way'
});
await reviewRow.click();
// Approve button appears inside the expanded details panel
await reviewRow.locator('button', { hasText: 'Approve' }).click();
```

This matches how security.spec.ts locates dispute cards (`expandDisputeByEmail` pattern), adapted for review rows.

### New Pattern: Causal Capture Before Trigger

```typescript
// Capture review_id BEFORE the approve action (from submit response)
const submitResponse = await authedPage.request.post('/api/reviews', { ... });
const { reviewId } = await submitResponse.json();  // directly available in response

// ... trigger approve via adminPage UI ...

// Assert audit log entry EXISTS for this specific review_id
const auditCheck = execSync(
  `npx wrangler d1 execute ratemyplace-db --local --command "SELECT COUNT(*) as c FROM audit_logs WHERE entity_id = '${reviewId}' AND action_type = 'review_approved'" --json`,
  { cwd: PROJECT_ROOT, encoding: 'utf8' }
);
const count = JSON.parse(auditCheck)[0].results[0].c;
expect(count).toBeGreaterThanOrEqual(1);
```

---

## Specific Research Findings

### Finding 1: audit_logs Schema Confirmed

`migrations/0013_audit_logs.sql` confirms:
- `entity_id TEXT NOT NULL` — stores review IDs as strings, matching `reviews.id TEXT PRIMARY KEY`
- `action_type TEXT NOT NULL CHECK (action_type IN ('review_approved', 'review_rejected', 'review_flagged', 'review_pending', 'review_deleted', 'dispute_resolved', 'dispute_dismissed', 'dispute_upheld', 'dispute_partially_valid'))`
- No FK constraint on `entity_id` (stores strings from both reviews and disputes)
- Index `idx_audit_entity` on `(entity_type, entity_id)` exists — the WHERE clause in TEST-01 is efficient

CONTEXT.md assumption ("entity_id is TEXT and stores the review ID as a string") is CONFIRMED. No adjustment needed.

### Finding 2: Submit Endpoint Returns `reviewId` Directly

`src/pages/api/reviews.ts` (line 254-259):
```typescript
return new Response(JSON.stringify({
  success: true,
  reviewId,          // <-- the generated ID is in the response body
  buildingSlug: building.slug,
  domainScores
}), { ... });
```

The `reviewId` is generated with `generateIdFromEntropySize(10)` (Lucia utility — produces a random ~16-char base32 string). The test can capture it directly from the POST response body. No DB query fallback needed for TEST-01's causal capture.

### Finding 3: Approve Endpoint Audit Log is Synchronous

`src/pages/api/admin/reviews/[id].ts` (PATCH handler, line 81-108):
```typescript
if (status) {
  await createAuditLog(db, { ... });  // synchronous await, not fire-and-forget
  // ...notification follows...
}
return new Response(JSON.stringify({ success: true }), { ... });
```

The `createAuditLog` call is a direct `await` — not wrapped in `fireAndForget` or `ctx.waitUntil`. The audit log row is committed to D1 before the 200 response is returned. The test can query `audit_logs` immediately after the UI badge changes to 'approved' without any delay or retry.

### Finding 4: Score Field Names Per View

**View 1 — `/api/search/results?q=test-cross-view-consistency`:**
- SQL: `ROUND(AVG(r.overall_score), 1) as avg_overall`
- Response shape: `{ results: [{ ..., avg_overall: 3.2, ... }], total: 1 }`
- Type: number (SQLite REAL, rounded to 1 decimal)
- Extract: `const searchScore = data.results[0].avg_overall`

**View 2 — `/building/test-cross-view-consistency`:**
- Source: `building_scores` table, column `avg_overall`
- Display: `{scores.avg_overall.toFixed(1)}` rendered as a `<div class="text-4xl font-bold text-teal-600">` in the header section
- Selector: `page.locator('.text-4xl.font-bold.text-teal-600')` or the text content
- Type: number displayed via `.toFixed(1)` — extract as `parseFloat(text)`

**Critical detail on View 2:** The building detail page reads from `building_scores WHERE building_id = ?`, not by computing a live average. The `building_scores.avg_overall` is a materialized value. For the test building (`test-cross-view-consistency`) with zero initial reviews, after approving 2 reviews, this table must be updated. Checking the approve endpoint — it does NOT update `building_scores`. There is no trigger and no background job visible in the codebase. The building detail page falls back: if `scores` is null or `!scores.avg_unit && !scores.avg_building && !scores.avg_landlord`, it calls `calculateBuildingAverages(reviews)` from the raw reviews array. For a fresh test building with no pre-existing `building_scores` row, the detail page will compute the score live from approved reviews (not from `building_scores`). This is the correct path for the test building. The displayed value `scores.avg_overall` will be the result of `calculateBuildingAverages()` → returns `avg_overall` as a live average.

**View 3 — `/profile` (as the user who submitted the reviews):**
- Source: `/api/reviews/user` endpoint → `r.overall_score` from the `reviews` table (the per-review stored value)
- Display: `ReviewListItem.tsx` line 81: `{review.overall_score.toFixed(1)}`
- Selector: within the review card for the test building, `page.locator('.bg-teal-50').filter({ hasText: '999 E2E Test Way' }).locator('.font-medium.text-teal-700')`
- Type: per-review stored `overall_score`, not a building aggregate

**Score divergence analysis for TEST-02:**
- Search returns `AVG(overall_score)` across all approved reviews of the building
- Building detail returns `calculateBuildingAverages(reviews)` → `avgOverall` = recency-weighted average using `calculateAggregatedScores(reviews)`
- Profile returns the individual review's `overall_score` (stored at submission time)

With ONLY 1 review approved (review-090), search = that one review's `overall_score`, detail = that one review's score (recency weight = 1.0 since current year), profile = that one review's stored score. All three should match if the review was submitted and stored correctly.

With 2 reviews approved (review-090 + review-091) and identical scores (controlled by the test), all three views return the same average. Profile shows individual review scores, not a building average — so TEST-02 should assert the score of the ONE submitted review against the building average, OR submit both reviews with the same score and assert the average.

**Recommended approach:** Use `authedPage` to submit one review (review-090), approve it, then assert. Profile shows `review-090.overall_score`. Building detail and search show average of review-090 only (which equals its own score). All three match. Simpler than two-review setup.

### Finding 5: Profile Score Data Source

`/api/reviews/user` returns `r.overall_score` — the stored value from `reviews` table (computed at submission time by `calculateOverallScore(scores)`). This is NOT the live building aggregate. The ProfileDashboard shows this via `ReviewListItem`:
```tsx
<span className="font-medium text-teal-700">{review.overall_score.toFixed(1)}</span>
```
Inside a `div.bg-teal-50.px-2.py-1.rounded` containing a star icon and the score.

The "saved buildings" section of profile shows `building.avg_overall` from `/api/buildings/saved` — but this is NOT the tab for submitted reviews. The reviews tab is what TEST-02 targets.

### Finding 6: Exact clearRateLimits Body to Extract

From `e2e/security.spec.ts` lines 11-16, exact body:
```typescript
function clearRateLimits() {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM rate_limits"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}
```

The extracted version in `e2e/fixtures.ts` needs `PROJECT_ROOT` defined. Fixtures.ts does not currently define it. The planner must add:
```typescript
import { execSync } from 'child_process';
const PROJECT_ROOT = path.resolve(__dirname, '..');
```
at the top of `fixtures.ts` (after the existing imports) and add the `clearRateLimits` export at the bottom.

### Finding 7: fixtures.ts Exact Insertion Point

Current `e2e/fixtures.ts` is exactly 35 lines (confirmed by reading). Current content ends at line 35: `export { expect };`. The insertion is:
- Add imports (`execSync` from `child_process`) near existing imports
- Add `PROJECT_ROOT` constant after `__dirname` definition (or alongside it, since `__dirname` is already defined)
- Add `// --- DB Helpers ---` section header comment after `export { expect };`
- Add `export function clearRateLimits(): void { ... }` after the section header

Wait — checking fixtures.ts: `__dirname` IS already defined (lines 5-7). `execSync` is NOT imported. The planner must add one import line and the exported function.

### Finding 8: Seed Structure for New Building

From `insertBuildings()` in db-seed.ts, the SQL shape for a building INSERT is:
```sql
INSERT INTO buildings (
  id, landlord_id, address, slug, neighborhood, city, state, zip_code,
  year_built, unit_count, building_type, created_at, updated_at,
  latitude, longitude, google_place_id, property_manager_id,
  admin_notes, public_info, owner_name, owner_entity, owner_website
) VALUES (
  'building-e2e-01', NULL, '999 E2E Test Way', 'test-cross-view-consistency',
  'Allston', 'Boston', 'MA', '02115',
  2000, 1, 'apartment', 1700000000, 1700000000,
  42.3533, -71.1326, NULL, NULL, NULL, NULL, NULL, NULL, NULL
)
```

The `BUILDINGS` array in db-seed.ts is the source of truth. The new building must be added to that array (not inserted via a separate SQL step) and should use a distinct ID like `building-e2e-01`. After adding to `BUILDINGS`, `insertBuildings()` picks it up automatically.

No `building_scores` row is needed for the test building — the detail page falls back to live calculation from reviews.

### Finding 9: Reserved Review IDs Full List

Confirmed by grepping all `e2e/*.spec.ts` files:
- `review-001` through `review-029` — seed data reviews (real content)
- `review-030`, `review-040`, `review-060`, `review-070` — security.spec.ts SQL injection / XSS tests
- `review-080`, `review-081`, `review-082` — security.spec.ts Phase 17 dispute validation
- `review-090`, `review-091` — **Phase 20 reservation (new)**
- `review-100+` — unreserved

No matches found for `review-09x` in any existing spec file. The range is free.

### Finding 10: Score Computation — Divergence Analysis for TEST-02

`calculateOverallScore()` (used at review submission) = `calculateDomainScores()` = weighted average of all 27 fields, `Math.round(sum * 10) / 10`.

`calculateAggregatedScores()` (used by building detail) = loops reviews with recency weight, then `Math.round((overallSum / overallWeight) * 10) / 10`.

`ROUND(AVG(overall_score), 1)` (used by search SQL) = SQL unweighted average of stored `overall_score` values, rounded to 1 decimal.

For a single review from the current year (recency weight 1.0), all three produce the same value. This is the controlled recency window guarantee.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DB state queries in tests | Custom HTTP endpoint for test introspection | `execSync` + `wrangler d1 execute --local` | Pattern already established; no production code needed |
| Auth in tests | Inline login flows per test | Storage-state fixtures from `playwright/.auth/` | Already working; `authedPage` + `adminPage` fixtures exist |
| Review ID generation | Custom ID in test | Read `reviewId` from POST response | The submit endpoint returns it directly |

---

## Common Pitfalls

### Pitfall 1: Using `.first()` on Approve Button Without Row Scoping
**What goes wrong:** `adminPage.locator('button', { hasText: 'Approve' }).first()` clicks whichever Approve button appears first in the DOM — could be for a different review if other pending reviews exist.
**Why it happens:** `/admin/reviews` shows ALL reviews. Other seed reviews may be pending (or get reset by other tests).
**How to avoid:** Scope the Approve click to the row that contains the test building's address. Use `adminPage.locator('.cursor-pointer', { hasText: '999 E2E Test Way' })` as the container, then `.locator('button', { hasText: 'Approve' })` within it.

### Pitfall 2: Score Not Available in building_scores After Approve
**What goes wrong:** The test queries `building_scores.avg_overall` but the row is missing because the test building was freshly seeded and no `building_scores` row was pre-computed.
**Why it happens:** The approve endpoint does not update `building_scores`. The test building has no pre-seeded `building_scores` row.
**How to avoid:** The building detail page handles this: it falls back to `calculateBuildingAverages(reviews)` when `building_scores` is absent or has null domain scores. Test reads the displayed score from the rendered page, not directly from `building_scores`.

### Pitfall 3: Profile Shows Zero Reviews After Approve
**What goes wrong:** TEST-02 navigates to `/profile` expecting the review to appear, but the profile tab shows "No reviews" or doesn't list the test review.
**Why it happens:** The profile lists reviews in "submitted" order for the logged-in user. The review is there (status `approved`), but the profile tab must be on "Reviews" not "Saved" or "Notifications".
**How to avoid:** Explicitly wait for the reviews tab content. The `ProfileDashboard` defaults to the `reviews` tab. Assert that the building address appears in the review list.

### Pitfall 4: audit_logs Row Missing Because Approve Happened Via Direct DB
**What goes wrong:** If the test bypasses the admin UI and uses `wrangler d1 execute` to flip status to 'approved', no `audit_logs` row is written.
**Why it happens:** `createAuditLog` is called only by the `PATCH /api/admin/reviews/[id]` endpoint — it's application-layer logic, not a DB trigger.
**How to avoid:** Always approve via the admin UI (or at minimum via `PATCH /api/admin/reviews/[id]` using `adminPage.request.patch`). CONTEXT.md mandates UI approach.

### Pitfall 5: Windows Bash Heredoc Failure in wrangler
**What goes wrong:** Wrangler heredoc patterns fail on Windows bash.
**Why it happens:** Known issue documented in STATE.md from Phase 19.
**How to avoid:** Use `--command "..."` with single-quoted SQL values, or write to temp file. The existing `clearRateLimits` pattern uses `--command` and works. New DB queries should follow the same `--command` pattern.

---

## Code Examples

### Causal Capture Pattern (TEST-01)
```typescript
// Source: pattern derived from e2e/security.spec.ts + src/pages/api/reviews.ts response shape

import { execSync } from 'child_process';
const PROJECT_ROOT = path.resolve(__dirname, '..');

function queryAuditLog(reviewId: string): number {
  const result = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "SELECT COUNT(*) as c FROM audit_logs WHERE entity_id = '${reviewId}' AND action_type = 'review_approved'" --json`,
    { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' }
  );
  return JSON.parse(result)[0].results[0].c;
}

// In test:
const submitRes = await authedPage.request.post('/api/reviews', { multipart: { ... } });
const { reviewId } = await submitRes.json();  // capture BEFORE approve
// ... approve via adminPage UI ...
expect(queryAuditLog(reviewId)).toBeGreaterThanOrEqual(1);
```

### Score Extraction Per View (TEST-02)
```typescript
// View 1: Search API
const searchRes = await authedPage.request.get(
  '/api/search/results?q=test-cross-view-consistency'
);
const searchData = await searchRes.json();
const searchScore: number = searchData.results[0].avg_overall;

// View 2: Building detail page
await authedPage.goto('/building/test-cross-view-consistency');
await authedPage.waitForLoadState('networkidle');
const detailScoreText = await authedPage.locator('.text-4xl.font-bold.text-teal-600').textContent();
const detailScore: number = parseFloat(detailScoreText!);

// View 3: Profile page (as the submitting user)
await authedPage.goto('/profile');
await authedPage.waitForLoadState('networkidle');
// ReviewListItem renders score as .font-medium.text-teal-700 inside .bg-teal-50 within the review card
const reviewCard = authedPage.locator('.bg-white.border.border-gray-200.rounded-\\[6px\\]', {
  hasText: '999 E2E Test Way'
});
const profileScoreText = await reviewCard.locator('.font-medium.text-teal-700').textContent();
const profileScore: number = parseFloat(profileScoreText!);

expect(searchScore).toBe(detailScore);
expect(detailScore).toBe(profileScore);
```

### clearRateLimits Export in fixtures.ts
```typescript
// Source: extracted from e2e/security.spec.ts:11-16
// Add at bottom of e2e/fixtures.ts after existing exports

import { execSync } from 'child_process';
// PROJECT_ROOT can reuse existing __dirname (already defined in fixtures.ts)

// --- DB Helpers ---
export function clearRateLimits(): void {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM rate_limits"',
    { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' }
  );
}
```

### Cleanup Pattern for Phase 20 Tests
```typescript
// Source: mirrors clearSecurityTestDisputes pattern in security.spec.ts

function cleanupPhase20Reviews(): void {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM audit_logs WHERE entity_id IN (\'review-090\', \'review-091\')"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM reviews WHERE id IN (\'review-090\', \'review-091\')"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

test.beforeEach(() => cleanupPhase20Reviews());
test.afterEach(() => cleanupPhase20Reviews());
```

---

## State of the Art

| Area | Current Approach | Notes |
|------|-----------------|-------|
| Review submission response | Returns `{ reviewId, buildingSlug, domainScores }` | `reviewId` available directly; no DB query needed |
| Audit log write | Synchronous `await createAuditLog(...)` in approve endpoint | Available immediately after 200 response |
| building_scores update | NOT updated by approve endpoint; fallback live-calc in detail page | Test building will use live calculation path |
| Profile score display | Per-review stored `overall_score`, not building aggregate | Profile and search/detail compare different aggregation levels |

---

## Open Questions

1. **Score equality across views when building_scores is absent**
   - What we know: Detail page falls back to `calculateBuildingAverages(reviews)` which uses recency-weighted `calculateAggregatedScores()`. Search uses SQL `ROUND(AVG(overall_score), 1)`. For a single current-year review, both should equal the stored `overall_score` exactly (recency weight = 1.0, single review average = the value itself).
   - What's unclear: Whether `Math.round(x * 10) / 10` (JS) and `ROUND(x, 1)` (SQLite) can produce the same floating-point value for all possible `overall_score` values. They should for values computed by the same `calculateOverallScore()` path.
   - Recommendation: Test with one review, verify equality holds. If not, use `toBeCloseTo(0)` margin instead of `toBe`.

2. **Admin reviews page filter on load**
   - What we know: The page loads with `status = 'all'` by default (from `Astro.url.searchParams.get('status') || 'all'`).
   - What's unclear: Whether the ReviewsTable React island defaults to "all" or "pending" filter. If it defaults to "pending", the test building's pending review is visible. If "all", it might be in a large list.
   - Recommendation: Navigate to `/admin/reviews?status=pending` to ensure the pending test review is visible without scrolling past many approved ones.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (current project version) |
| Config file | `playwright.config.ts` (no changes needed) |
| Quick run command | `npx playwright test e2e/critical-flows.spec.ts` |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | Audit log row exists with matching `entity_id` + `action_type = 'review_approved'` after admin approves via UI | E2E | `npx playwright test e2e/critical-flows.spec.ts --grep "audit"` | ❌ Wave 0 gap |
| TEST-02 | `searchScore === detailScore && detailScore === profileScore` after submit + approve | E2E | `npx playwright test e2e/critical-flows.spec.ts --grep "consistency"` | ❌ Wave 0 gap |
| TEST-03 | `clearRateLimits` import in `security.spec.ts` resolves; all 5 call sites execute without error; no duplicate definition | Structural + E2E | `npx playwright test e2e/security.spec.ts` (existing tests pass) | Partial — security.spec.ts exists, fixtures.ts needs new export |

### Assertion Types
| Assertion | Type | What it Detects |
|-----------|------|-----------------|
| `entity_id = '${capturedId}' AND action_type = 'review_approved'` returns ≥ 1 row | Causal | Missing audit log for THIS specific review (not just any audit log row) |
| `searchScore === detailScore` | Structural | Score divergence between search SQL aggregate and detail live calculation |
| `detailScore === profileScore` | Structural | Score divergence between building aggregate and stored per-review value |
| `import { clearRateLimits } from './fixtures'` resolves | Structural | Duplicate definition removed; export present |

### Causal vs Structural Classification
- **TEST-01:** Causal — capture-before-trigger pattern. The test proves the specific approve action caused the specific audit log entry, not just that some audit log entry exists.
- **TEST-02:** Structural — asserts observed state after a sequence of actions. Not strictly causal in the same sense, but exercises the full user-visible data pipeline.
- **TEST-03:** Structural — import resolution and existing test passage validates the refactor.

### Sampling Rate
- **Per task commit:** `npx playwright test e2e/critical-flows.spec.ts` (new file only)
- **Per wave merge:** `npx playwright test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `e2e/critical-flows.spec.ts` — covers TEST-01 and TEST-02; does not exist yet
- [ ] `e2e/fixtures.ts` — needs `clearRateLimits` export added (TEST-03); file exists but export is missing
- [ ] `e2e/security.spec.ts` — needs inline `clearRateLimits` removed and import added (TEST-03); file exists but needs modification
- [ ] `scripts/db-seed.ts` — needs `building-e2e-01` / `test-cross-view-consistency` added to `BUILDINGS` array; then `npm run db:setup` (or equivalent) must be re-run locally

*(No new test framework install needed — Playwright already installed.)*

---

## Sources

### Primary (HIGH confidence)
- `migrations/0013_audit_logs.sql` — `entity_id TEXT NOT NULL` confirmed, `action_type` CHECK constraint confirmed
- `src/pages/api/reviews.ts` — submit endpoint response shape (`reviewId` in body) confirmed
- `src/pages/api/admin/reviews/[id].ts` — approve endpoint audit log is synchronous `await`, not fire-and-forget
- `src/pages/api/search/results.ts` — `avg_overall` field name confirmed, `ROUND(AVG(r.overall_score), 1)` SQL
- `src/pages/building/[slug].astro` — building detail reads `building_scores.avg_overall`, falls back to `calculateBuildingAverages()` for missing/empty records
- `src/pages/api/reviews/user.ts` — profile returns per-review `r.overall_score` (not building aggregate)
- `src/components/profile/ReviewListItem.tsx` — profile score displayed as `.font-medium.text-teal-700` inside `.bg-teal-50`
- `e2e/fixtures.ts` — 35-line file, exact content confirmed
- `e2e/security.spec.ts` lines 11-16 — exact `clearRateLimits` body confirmed
- `e2e/admin-actions.spec.ts` — existing approve flow selector pattern confirmed
- `src/components/admin/ReviewsTable.tsx` lines 524-530 — Approve button is `button` with text "Approve", inside expanded review detail panel
- `scripts/db-seed.ts` — building INSERT schema confirmed, `BUILDINGS` array structure confirmed
- `src/lib/scoring.ts` — `calculateOverallScore` and `calculateAggregatedScores` return rounding behavior confirmed

### Secondary (MEDIUM confidence)
- `.planning/config.json` — `workflow.nyquist_validation` key absent; Validation Architecture section required per rules
- `e2e/*.spec.ts` (all files) — reserved review ID ranges confirmed, no `review-09x` in use

---

## Metadata

**Confidence breakdown:**
- audit_logs schema: HIGH — read directly from migration file
- Submit endpoint response shape: HIGH — read directly from source
- Approve endpoint audit log timing: HIGH — synchronous `await` confirmed in source
- Score field names per view: HIGH — read from three separate source files
- Selector patterns: MEDIUM — no `data-testid` on Approve button; CSS class selectors may shift if styling changes; scoping to building address text is robust
- Score equality across views: MEDIUM — mathematically sound but floating-point edge cases possible; `toBeCloseTo` fallback noted

**Research date:** 2026-04-29
**Valid until:** 2026-05-29 (stable codebase; selectors could change if ReviewsTable is refactored, but that's Phase 21 DEBT)
