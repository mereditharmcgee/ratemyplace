# Phase 20: Critical-Flow E2E Coverage - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Two new Playwright E2E tests + one fixture refactor. After this phase: admin moderation has a causal `audit_logs` assertion (TEST-01), cross-view data consistency is verified end-to-end across `/api/search/results`, `/building/[slug]`, and `/profile` (TEST-02), and `clearRateLimits()` is shared infrastructure in `e2e/fixtures.ts` (TEST-03).

This phase delivers test coverage only. No app-code changes. No new endpoints. No schema changes (one new building added to seed data for test isolation).

</domain>

<decisions>
## Implementation Decisions

### Helper extraction (TEST-03)

- **Pattern: standalone export, manual call.** `export function clearRateLimits(): void` added to `e2e/fixtures.ts`. Specs that need it import + call explicitly. Matches the existing security.spec.ts inline pattern (5 explicit calls); no auto-fixture, no implicit beforeEach behavior.
- **No parameters.** Always operates on `--local` D1. Future "remote" support is YAGNI and dangerous.
- **fixtures.ts structure after extraction:**
  - Top: existing Playwright `test`/`expect` extension with `authedPage` and `adminPage` storage-state fixtures (unchanged).
  - Bottom: new section header comment `// --- DB Helpers ---`, then `clearRateLimits()` export.
- **No other helpers extracted in this phase.** TEST-03 names only `clearRateLimits`. `clearSecurityTestDisputes()` stays inline in security.spec.ts (security-test-specific reserved IDs); extract later if a new spec needs it.
- **security.spec.ts updated** to remove its inline `clearRateLimits` and import the shared one. All 5 call sites stay unchanged (just the function source moves).

### Test data strategy (TEST-01 + TEST-02)

- **Reserved review IDs `review-090` and `review-091`** for Phase 20 tests. Avoids collision with existing reservations: `review-030/040/060/070` (security disputes), `review-080/081/082` (Phase 17 dispute tests).
- **New seeded test-only building** added to `scripts/db-seed.ts`:
  - Slug: `test-cross-view-consistency` (clearly non-real, won't collide with real Boston addresses)
  - Address: a clearly-test address like `999 E2E Test Way, Boston, MA 02115`
  - Zero existing reviews — score is fully determined by what the test inserts
- **Cleanup pattern:** `test.afterEach` deletes `review-090` and `review-091` plus any audit_logs entries with matching `entity_id`. `test.beforeEach` does the SAME deletes (idempotent — belt-and-suspenders). If a previous run crashed mid-test, the next run starts clean. Mirrors the security.spec `clearSecurityTestDisputes()` pattern.
- **Test building stays seeded between runs** — its slug never collides with real data, no harm in keeping it there permanently.

### Score-match precision (TEST-02)

- **Test creates ALL reviews fresh in the same recency window.** Submit review-090 + review-091 within seconds of each other; both go through approve. Recency-weighted divergence (the known divergence between search and detail) does NOT show up because all reviews fall in the same recency bucket — recency-weighting and raw averaging produce identical outputs when reviews share recency.
- **Assertion: exact match across the 3 views.** `searchScore === detailScore && detailScore === profileScore`. If they differ even with this controlled setup, that's a real bug and TEST-02 catches it.
- **Score basis: computed average shown to users** (the displayed `overall_score` value at each view). NOT raw stored values. The test asserts what the user actually sees.
- **The 3 view sources:**
  - `/api/search/results?q=test-cross-view-consistency` → JSON response → extract `results[0].avg_overall` (or equivalent field per current API shape)
  - `/building/test-cross-view-consistency` → page → extract score from rendered DOM (test-id selector or visible text)
  - `/profile` → page → load as the user who submitted the reviews → find the building's score in the user's review list
- **Score divergence note:** memory.md flags acceptable recency divergence between search and detail. TEST-02 sidesteps this by controlling the recency window. If recency divergence ever needs first-class testing, that's a separate test, not TEST-02.

### Approve flow (TEST-01 + TEST-02)

- **Through the admin UI.** Test navigates `adminPage` to `/admin/reviews`, finds the row for `review-090` (or `review-091`), clicks Approve. Most realistic E2E flow — exercises the full UI path that triggers audit_logs INSERT. Matches the existing "admin can approve a pending review" test pattern in [e2e/admin-actions.spec.ts:13](e2e/admin-actions.spec.ts).
- **Direct API or DB UPDATE is NOT used.** Both would either skip the UI or skip the audit_logs INSERT.

### Cross-view read order (TEST-02)

- **Sequential GETs, no delays.** After approve completes (UI shows status badge "approved"):
  1. GET `/api/search/results?q=test-cross-view-consistency` (or via `request.get`)
  2. Navigate to `/building/test-cross-view-consistency`
  3. Navigate to `/profile` (as the user who submitted)
- D1 is consistent immediately after writes; no caching layer between writes and reads in this app. No need for delays or retries.

### audit_logs assertion (TEST-01)

- **Direct wrangler d1 execute query** against `audit_logs`. Matches security.spec pattern. No new endpoints, no admin UI page added.
- **Causal capture:** test captures `review_id` BEFORE triggering admin approval (right after submission, from the response or by querying `reviews` for the just-inserted row). The assertion uses that captured ID:
  ```sql
  SELECT * FROM audit_logs
  WHERE entity_id = '<captured_review_id>' AND action_type = 'review_approved'
  ```
- **Pass condition:** query returns ≥ 1 row. NOT ordering-dependent (no LIMIT, no MAX, no LATEST).
- **Assertion stops at:** existence of the row matching `entity_id` + `action_type`. Does NOT additionally assert `admin_user_id`, `old_value`, or `new_value` JSON content. Stricter assertions add brittleness without catching new bug classes.
- **Schema assumption:** `audit_logs.entity_id` is TEXT and stores the review ID as a string (matches reviews.id). Researcher should confirm this against `migrations/0013_audit_logs.sql`. If type mismatch, adjust the test's WHERE clause.

### Test execution mode

- **Default Playwright project parallelism stays.** Both new tests are independent (different reserved IDs, isolated test building). They can run in parallel with each other and other specs.
- **No serial mode required.** The reserved-ID pattern + afterEach cleanup gives enough isolation.

### Claude's Discretion

- Exact Playwright selectors for the admin Approve button and score-display elements (planner verifies against current admin UI)
- Whether to use `request.get` (Playwright API client) or `page.goto` for the search-results JSON read in TEST-02
- Exact error messages on assertion failure (e.g., `expect(searchScore).toBe(detailScore)` vs custom message)
- How to extract the just-inserted review's ID after submission — query reviews table by user+building+timestamp, OR look up via the response from the submission API. Researcher will check what the submit endpoint returns.
- Helper consolidation in section comment of fixtures.ts (e.g., one section header vs two)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/fixtures.ts` (35 lines) — Playwright `test`/`expect` extension with `authedPage` and `adminPage` fixtures. Each fixture creates a context using `playwright/.auth/user.json` or `admin.json` storage-state files.
- `e2e/security.spec.ts` (~280 lines) — current home of `clearRateLimits()` at line 11; uses `execSync` with `npx wrangler d1 execute --local`. 5 call sites in the file. Also defines `clearSecurityTestDisputes()` at line 19 (security-specific, stays inline).
- `e2e/admin-actions.spec.ts` — existing "admin can approve a pending review" test at line 13. Demonstrates the admin-UI approve flow (navigates to `/admin/reviews`, clicks Approve, asserts UI badge change). Phase 20's TEST-01 extends this pattern with the audit_logs assertion the existing test lacks.
- `e2e/review.spec.ts` — existing review submission tests. Demonstrates the user-submission flow (form fill, submit, expect success).
- `migrations/0001_initial.sql` — reviews schema. `id` is TEXT primary key.
- `migrations/0013_audit_logs.sql` — audit_logs schema. Researcher confirms `entity_id` column type.

### Established Patterns
- Direct DB access in tests via `execSync('npx wrangler d1 execute ratemyplace-db --local --command "..."')`. Used for setup, cleanup, and assertions. The pattern is self-contained — tests own their data lifecycle.
- Reserved-review-ID pattern for cross-test isolation: each spec reserves a distinct ID range (`review-030/040/060/070` for security, `review-080/081/082` for Phase 17 disputes, now `review-090/091` for Phase 20 cross-view).
- `test.beforeEach` and `test.afterEach` for setup/cleanup (Playwright standard).
- Storage-state fixtures (`USER_AUTH_FILE`, `ADMIN_AUTH_FILE`) for authenticated test contexts — no inline login flow per test.
- Score values in API responses appear in fields like `avg_overall`, `overall_score`, depending on endpoint shape. Researcher verifies field names per view.

### Integration Points
- `e2e/fixtures.ts` — receives `clearRateLimits()` export.
- `e2e/security.spec.ts` — refactored to import `clearRateLimits` from fixtures; existing test logic untouched.
- New file: `e2e/critical-flows.spec.ts` (or extend admin-actions.spec.ts) — houses TEST-01 + TEST-02. Naming TBD by planner; suggested name: `e2e/critical-flows.spec.ts` for clarity.
- `scripts/db-seed.ts` — adds the new test-only building. Existing seed flow unchanged otherwise.
- `playwright.config.ts` — no changes needed; existing setup runs against `localhost:8788` (Wrangler dev).

</code_context>

<specifics>
## Specific Ideas

- The "controlled recency window" trick for TEST-02 is the load-bearing insight that lets us assert exact equality despite the known recency-weighted divergence. By creating both reviews seconds apart, we avoid the case where a 6-month-old review and a 1-day-old review would weight differently between search and detail. Future tests that intentionally exercise the recency divergence would need a different setup (mock time, or pre-seed reviews at specific timestamps).
- The reserved-ID pattern is now established convention — Phase 20 extends it. Document the assignment so future phases know where the next free range is: `review-100+` is unreserved.
- The "causal" framing for TEST-01 (capture-before-trigger) is the bug that the original failing pattern would have hidden: a test that just queried "latest audit_logs entry" would pass even if the SPECIFIC review's approval didn't get logged (e.g., a different action wrote a row at the same time). Capture-before-trigger forces the test to prove the causal chain.

</specifics>

<deferred>
## Deferred Ideas

- **Audit log admin UI** — would let TEST-01 assert via UI navigation rather than DB query. Out of scope; new capability. v1.6.0 if desired.
- **Mocked-time tests for recency-weighted scoring** — TEST-02 sidesteps this; a dedicated test could exercise the divergence. Future hardening, not in v1.5.0.
- **`clearAuditLogs()` helper extraction** — if Phase 20's afterEach cleanup pattern reappears in 2+ specs, extract to fixtures.ts. Right now only Phase 20 uses it; inline.
- **Parallel-mode safety audit** — verify all existing specs are parallelism-safe with the new shared fixture. Probably already true (each spec uses isolated review IDs); revisit if flakes appear.
- **Visual regression tests on score-display components** — different concern (visual) from data consistency. Not part of TEST-02.
- **E2E for the bonus disputes/[id].ts admin endpoint** (the leftover from Phase 18 spawn-task) — separate follow-up.

</deferred>

---

*Phase: 20-critical-flow-e2e-coverage*
*Context gathered: 2026-04-29*
