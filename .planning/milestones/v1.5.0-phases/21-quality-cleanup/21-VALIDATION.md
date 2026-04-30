---
phase: 21
slug: quality-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (unit), Playwright 1.x (E2E) |
| **Config file** | `vitest.config.ts` (happy-dom), `playwright.config.ts` |
| **Quick run command** | `npm test -- rateLimit` (rate-limit unit) / `npx playwright test e2e/security.spec.ts -g "Phase 21" --no-deps` (header E2E) |
| **Full suite command** | `npm test && npx playwright test e2e/security.spec.ts --no-deps` |
| **Estimated runtime** | ~10s unit (rateLimit only), ~3min Phase 21 E2E block |

---

## Sampling Rate

- **After every task commit:** Run scope-relevant tests:
  - Helper-touching task → `npm test -- rateLimit`
  - Endpoint-touching task → spec for that endpoint, e.g. `npx playwright test e2e/security.spec.ts -g "Phase 21"`
  - EmptyState component task → `npm test -- EmptyState` (if added) + manual visual check via dev server
- **After every plan wave:** `npm test` (full unit suite, ~30s)
- **Before `/gsd:verify-work`:** Full suite must be green (unit + Phase 21 E2E block)
- **Max feedback latency:** ~10s (unit), ~3min (E2E)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | SEC-08 | Unit | `npm test -- rateLimit` (new `buildRateLimitHeaders` describe block) | ❌ W0 (new helper + tests) | ⬜ pending |
| 21-01-02 | 01 | 1 | SEC-07, SEC-08 | E2E | `npx playwright test e2e/security.spec.ts -g "Phase 21" --no-deps` | ❌ W0 (new test block) | ⬜ pending |
| 21-02-01 | 02 | 1 | UX-01 | Unit (optional) | `npm test -- EmptyState` OR visual check via `npm run dev` | ❌ W0 (new component) | ⬜ pending |
| 21-02-02 | 02 | 2 | UX-01 | E2E + visual | E2E selector check on each of 4-6 surfaces | Partial — surfaces exist | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Final task IDs to be set by gsd-planner. Plan 21-01 (rate-limit headers) and Plan 21-02 (EmptyState) are independent — can run in parallel within Wave 1 if planner chooses.*

---

## Wave 0 Requirements

### Rate-limit headers (21-01)

- [ ] `src/lib/rateLimit.ts` — add `buildRateLimitHeaders(result, limit)` export returning `{ 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'? }`
- [ ] `src/lib/__tests__/rateLimit.test.ts` — add `describe('buildRateLimitHeaders')` block: allowed result → no `Retry-After`; blocked result → all three headers
- [ ] `e2e/security.spec.ts` — add `test.describe('Phase 21: Rate Limit Headers')` block with assertions for `/api/contact` 429, `/api/search/results` 200, one other endpoint 200

### EmptyState component (21-02)

- [ ] `src/components/EmptyState.astro` — for SSR consumers (`search.astro`, `building/[slug].astro`)
- [ ] `src/components/EmptyState.tsx` — for React island consumers (`ProfileDashboard.tsx` reviews/saved tabs, `NotificationsTab.tsx`)
- [ ] (Optional) `src/lib/__tests__/EmptyState.test.tsx` — title/description/action render assertions; `@testing-library/react` already in devDependencies

*No new framework install needed — Vitest and Playwright already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EmptyState visual consistency across the 4-6 surfaces | UX-01 | Snapshot tests catch DOM but not visual layout/spacing | `npm run dev`; visit `/search?q=zzzznoresults`, `/building/test-cross-view-consistency` (zero reviews), `/profile` (logged-in test user with no reviews), and the notifications panel; confirm consistent title size, description typography, icon position, and color across all four |

*Rate-limit header behavior is fully automated.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (helper, headers tests, EmptyState components)
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s (unit), < 3min (E2E)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner finalizes Wave 0 task definitions)

**Approval:** pending
