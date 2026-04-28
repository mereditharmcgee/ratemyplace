---
phase: 17
slug: public-endpoint-security
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 (unit) + Playwright (e2e) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npm test -- validation` (filter to validation tests, ~1s) |
| **Full suite command** | `npm test && npm run build && npm run test:e2e` |
| **Estimated runtime** | ~2s unit, ~30s build, ~2-3min e2e |

---

## Sampling Rate

- **After every task commit:** `npm test` (unit suite, ~2s — fastest signal for validator changes)
- **After every plan wave:** `npm test && npm run build`
- **Before `/gsd:verify-work`:** Full unit suite green + e2e suite green (rate-limit and content-type tests pass)
- **Max feedback latency:** ~2 seconds (unit suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | VAL-05 | unit | `npm test -- validation` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | VAL-01,02,03,04 | unit | `npm test -- validation` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 2 | SEC-04, VAL-02 | unit + e2e | `npm test && npx playwright test e2e/security.spec.ts` | ❌ W0 | ⬜ pending |
| 17-02-02 | 02 | 2 | SEC-05, VAL-04 | unit + e2e | `npm test && npx playwright test e2e/security.spec.ts` | ❌ W0 | ⬜ pending |
| 17-02-03 | 02 | 2 | VAL-01, VAL-03 | unit + e2e | `npm test && npx playwright test` | ✅ partial | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders — the planner will populate exact IDs after PLAN.md generation.*

---

## Wave 0 Requirements

- [ ] `src/lib/__tests__/validation.test.ts` — add test blocks for:
  - `isValidEmail` (boundary: `notanemail` rejected, `a@b.c` accepted)
  - `isValidZipCode` (boundary: 5-digit + 5+4 accepted, 4-digit rejected)
  - `enforceMaxLength` (boundary: at-cap accepted, over-cap rejected)
  - `escapeLikePattern` (verifies `%`, `_`, `\` literals are escaped correctly)
  - `validateDisputeForm` (covers VAL-01 success criteria including `notanemail` and 5001-char explanation)
  - `validateBugReport` (covers VAL-02 length caps)
  - `validateContactForm` (covers VAL-03 email format and length caps)
  - `validateSearch` (covers VAL-04 query length cap and wildcard handling)

- [ ] `e2e/security.spec.ts` — add test blocks for:
  - SEC-04: 6th bug-report POST in 1hr returns 429 with `Retry-After`
  - SEC-05: 61st `/api/search/results` GET in 1min returns 429; 121st `/api/search/autocomplete` GET in 1min returns 429
  - VAL-02: POST `/api/bug-reports` with `Content-Type: application/json` returns 415
  - VAL-03: POST `/api/contact` with `Content-Type: application/json` returns 415
  - VAL-01: POST `/api/disputes` with `Content-Type: text/plain` returns 415
  - VAL-04: GET `/api/search/results?q=` (200+ chars) returns 400
  - VAL-04: GET `/api/search/results?q=5%25` correctly escapes `%` to literal

*(Existing `e2e/security.spec.ts` covers contact rate limit and signup/signin rate limits but does not cover the new endpoints. Existing `validation.test.ts` covers `validateReviewForm` and `sanitizeText` only.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bug-report widget still posts FormData successfully after content-type guard added | VAL-02 (no regression) | UI smoke test cannot be automated cleanly without full Playwright fixture | Click bug-report widget on `/`, fill description, submit, confirm 200 response in browser DevTools Network tab |
| Search UI still returns results when user types `%` (e.g., apartment 5%) | VAL-04 (no regression) | Validates the user-facing escape works end-to-end | Type `5%` into search bar, confirm building "Studio 5%" or similar literal-match result appears |

*(All other phase behaviors have automated verification via Vitest unit tests and Playwright e2e tests.)*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (every task has unit-test coverage)
- [ ] Wave 0 covers all MISSING references (validation.test.ts new blocks + security.spec.ts new blocks)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s (unit suite gate)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
