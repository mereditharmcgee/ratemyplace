---
phase: 09-security-e2e
verified: 2026-03-09T23:00:00Z
status: gaps_found
score: 4/5 must-haves verified
re_verification: false
gaps:
  - truth: "Unauthenticated requests to protected API endpoints return 401"
    status: partial
    reason: >
      Only 1 of 3 SEC-04 tests asserts strict 401. The POST /api/reviews and
      POST /api/verification/upload tests use `toBeGreaterThanOrEqual(400)` (any
      4xx), meaning a Wrangler-level 403 CSRF block would satisfy the assertion
      without ever reaching the application auth guard. The plan required strict
      401 confirmation for all three endpoints.
    artifacts:
      - path: "e2e/security.spec.ts"
        issue: >
          Lines 73 and 82 assert `>= 400` instead of `toBe(401)` for POST
          /api/reviews and POST /api/verification/upload. The CSRF workaround
          (Origin header) was applied only in the rate limit tests, not here,
          so these assertions may be satisfied by Wrangler's own CSRF 403 before
          the auth check runs.
    missing:
      - "Add `headers: { Origin: BASE_URL }` to POST /api/reviews and POST /api/verification/upload requests in the SEC-04 block so requests bypass Wrangler CSRF and reach the application auth guard"
      - "Change assertions on lines 73 and 82 to `expect(response.status()).toBe(401)` once Origin header is added"
human_verification:
  - test: "Run full security.spec.ts suite against local dev server"
    expected: "All 12 tests pass (3 SEC-04, 5 SEC-05, 2 SEC-06, 2 SEC-07, 2 SEC-08)"
    why_human: "Playwright E2E tests require local Wrangler dev server + seeded D1 database — cannot run programmatically in this context"
  - test: "Confirm XSS sentinels are checked correctly after card expansion"
    expected: "window.__xss_sec08_script and window.__xss_sec08_img remain undefined after admin navigates to /admin/disputes"
    why_human: "Runtime browser evaluation cannot be verified statically — requires actual browser execution"
---

# Phase 9: Security E2E Verification Report

**Phase Goal:** Security E2E tests proving auth bypass returns 401, privilege escalation returns 403, rate limiting returns 429, SQL injection is safely stored, and XSS payloads are escaped.
**Verified:** 2026-03-09T23:00:00Z
**Status:** gaps_found — 1 truth partially fails (SEC-04 assertion looseness)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                 | Status      | Evidence                                                                                                                                                                         |
| --- | --------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Unauthenticated requests to protected endpoints return 401            | PARTIAL  | `GET /api/reviews/user` asserts strict `toBe(401)`. The two POST tests assert `>= 400`, which a Wrangler CSRF 403 satisfies — the application auth guard may never be reached. |
| 2   | Non-admin user requests to admin endpoints return 403                 | VERIFIED | 5 tests assert `toBe(403)` using `authedPage` (regular user session with auth cookie); all 4 admin route files confirm `!isAdmin` guard returning 403.                          |
| 3   | Rate limiting returns 429 after threshold is exceeded                 | VERIFIED | `checkRateLimit()` called in signin (5 per 15 min) and signup (3 per 1 hr). Tests send threshold+1 requests with valid Origin header; 6th/4th request asserts `toBe(429)`.     |
| 4   | SQL injection probes are stored as literal text without error         | VERIFIED | `sanitizeText()` strips HTML only (`/<[^>]*>/g`), not SQL chars. SQL probes are stored verbatim. Tests assert 2xx response and find literal probe text in expanded admin card.  |
| 5   | XSS payloads render as escaped text / do not execute                 | VERIFIED | `sanitizeText()` strips `<script>` and `<img>` tags before DB storage. XSS tests check `window.__xss_*` sentinels remain `undefined` after admin renders dispute cards.        |

**Score:** 4/5 truths verified (Truth 1 partial)

### Required Artifacts

| Artifact                | Expected                                        | Status      | Details                                                                                    |
| ----------------------- | ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `e2e/security.spec.ts`  | Auth bypass and privilege escalation tests      | VERIFIED    | 266 lines, 5 describe blocks, 12 test cases. Created in commit `f044452`, extended in `9340126` and `da3fe31`. |
| `e2e/security.spec.ts`  | Rate limiting, SQL injection, XSS tests         | VERIFIED    | Same file — all three blocks present with full assertions and helpers.                     |
| `src/pages/api/reviews/user.ts` | Returns 401 for unauthenticated GET    | VERIFIED    | Line 21: `if (!context.locals.user)` → status 401.                                        |
| `src/pages/api/reviews.ts` | Returns 401 for unauthenticated POST        | VERIFIED    | Line 8: `if (!context.locals.user)` → status 401. App guard exists; test assertion is the gap. |
| `src/pages/api/verification/upload.ts` | Returns 401 for unauthenticated POST | VERIFIED | Line 8: `if (!context.locals.user)` → status 401. App guard exists; test assertion is the gap. |
| `src/pages/api/admin/reviews/index.ts` | Returns 403 for non-admin         | VERIFIED    | Lines 14–16: `if (!context.locals.user.isAdmin)` → status 403.                            |
| `src/pages/api/admin/users/index.ts` | Returns 403 for non-admin           | VERIFIED    | Lines 14–16: `isAdmin` guard confirmed.                                                    |
| `src/pages/api/admin/buildings/index.ts` | Returns 403 for non-admin       | VERIFIED    | Lines 14–16: `isAdmin` guard confirmed.                                                    |
| `src/pages/api/admin/audit.ts` | Returns 403 for non-admin                  | VERIFIED    | Lines 28–30: `isAdmin` guard confirmed.                                                    |
| `src/lib/validation.ts` | `sanitizeText()` strips HTML tags                | VERIFIED    | Lines 94–99: `replace(/<[^>]*>/g, '')` strips all HTML tags before storage.               |
| `src/pages/api/disputes.ts` | Calls `sanitizeText()` on user content      | VERIFIED    | Lines 109, 111, 113: `sanitizeText()` applied to landlordName, landlordPhone, disputeExplanation. |
| `src/pages/api/auth/signin.ts` | `checkRateLimit` with 5 per 900s threshold | VERIFIED   | Line 39: `checkRateLimit(db, clientIP, 'signin', 5, 900)`.                                |
| `src/pages/api/auth/signup.ts` | `checkRateLimit` with 3 per 3600s threshold | VERIFIED  | Line 50: `checkRateLimit(db, clientIP, 'signup', 3, 3600)`.                               |
| `migrations/0010_rate_limits.sql` | rate_limits table schema              | VERIFIED    | Table and index confirmed.                                                                 |
| `migrations/0012_disputes.sql` | UNIQUE constraint on review_id            | VERIFIED    | Line 6: `review_id TEXT NOT NULL UNIQUE`.                                                  |

### Key Link Verification

| From                       | To                                    | Via                                      | Status      | Details                                                                                                           |
| -------------------------- | ------------------------------------- | ---------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `e2e/security.spec.ts`     | `/api/reviews/user`                   | `request.get()` → `expect(status).toBe(401)` | WIRED   | Line 63–64: GET call + strict 401 assertion.                                                                      |
| `e2e/security.spec.ts`     | `/api/reviews` POST                   | `request.post()` → `expect(status).toBeGreaterThanOrEqual(400)` | PARTIAL | Lines 68–74: POST call exists but assertion is too loose — Wrangler CSRF 403 satisfies it. No Origin header means app auth guard may not run. |
| `e2e/security.spec.ts`     | `/api/verification/upload` POST       | `request.post()` → `expect(status).toBeGreaterThanOrEqual(400)` | PARTIAL | Lines 77–83: Same CSRF problem as above.                                                                          |
| `e2e/security.spec.ts`     | `/api/admin/reviews, /users, /buildings, /audit` | `authedPage.request.get()` → `toBe(403)` | WIRED | Lines 88–112: `authedPage` fixture carries user session; 4 GET endpoints + 1 PATCH all assert strict 403.        |
| `e2e/security.spec.ts`     | `/api/auth/signin`                    | 5 POSTs with `form:` + `Origin` header → 6th `toBe(429)` | WIRED | Lines 121–138: `clearRateLimits()` + 5 valid-format requests + 6th blocked with 429.                             |
| `e2e/security.spec.ts`     | `/api/auth/signup`                    | 3 POSTs with `form:` + `Origin` header → 4th `toBe(429)` | WIRED | Lines 140–163: Same pattern; 4th attempt blocked.                                                                 |
| `e2e/security.spec.ts`     | `/api/disputes`                       | POST with SQL probe → 2xx + literal text visible in admin UI | WIRED | Lines 173–213: `makeDisputePayload()` + `expandDisputeByEmail()` + text assertion.                               |
| `e2e/security.spec.ts`     | `/api/disputes` + admin UI            | POST with XSS payload → window sentinel undefined | WIRED | Lines 222–264: payload posted, admin page navigated, `evaluate(() => window.__xss_*)` confirmed undefined.       |

### Requirements Coverage

| Requirement | Source Plan | Description                                                            | Status      | Evidence                                                                                                           |
| ----------- | ----------- | ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| SEC-04      | 09-01-PLAN  | Unauthenticated requests to protected API endpoints return 401         | PARTIAL  | 1/3 tests asserts strict 401; 2 POST tests use `>= 400` which Wrangler CSRF 403 satisfies without hitting app guard. |
| SEC-05      | 09-01-PLAN  | Non-admin requests to admin API endpoints return 403                   | SATISFIED   | 5 tests assert `toBe(403)` against 4 distinct admin endpoints using authenticated non-admin session.               |
| SEC-06      | 09-02-PLAN  | Rate limiting returns 429 after threshold exceeded                     | SATISFIED   | 2 tests: signin 5+1, signup 3+1. `checkRateLimit()` confirmed in both route files. Origin header CSRF fix applied.|
| SEC-07      | 09-02-PLAN  | SQL injection probes in text inputs are safely handled                 | SATISFIED   | 2 tests: probe strings submitted, 2xx response (no 500), literal text visible in admin disputes UI.                |
| SEC-08      | 09-02-PLAN  | Stored user content is XSS-safe on render                              | SATISFIED   | 2 tests: `sanitizeText()` strips tags before storage; `window.__xss_*` sentinels remain undefined on render.      |

**Orphaned requirements check:** REQUIREMENTS.md maps SEC-04 through SEC-08 exclusively to Phase 9. All 5 IDs are claimed by plans 09-01 and 09-02. No orphaned requirements.

### Anti-Patterns Found

| File                       | Line  | Pattern                                      | Severity | Impact                                                                                                          |
| -------------------------- | ----- | -------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `e2e/security.spec.ts`     | 73–74 | `toBeGreaterThanOrEqual(400)` for POST /api/reviews auth test | Warning | Test can pass if Wrangler blocks at CSRF layer (403) before app auth guard runs — SEC-04 not truly proven for this endpoint. |
| `e2e/security.spec.ts`     | 82–83 | `toBeGreaterThanOrEqual(400)` for POST /api/verification/upload auth test | Warning | Same as above. App auth guard at line 8 of upload.ts is real, but test doesn't confirm it specifically.        |

No TODO/FIXME/placeholder comments found. No empty implementations. No console.log-only stubs.

### Human Verification Required

#### 1. Full Security Suite Execution

**Test:** Run `npx playwright test e2e/security.spec.ts --reporter=list` against a locally seeded dev server.
**Expected:** All 12 tests pass — 3 SEC-04, 5 SEC-05, 2 SEC-06, 2 SEC-07, 2 SEC-08.
**Why human:** Requires running Wrangler Pages dev + seeded D1 local database. Cannot execute in this verification context.

#### 2. SEC-04 POST Endpoint Confirmation

**Test:** In the running test suite, observe the actual HTTP status code returned for the two SEC-04 POST assertions before they pass (e.g., print `response.status()` in test output).
**Expected:** Both `/api/reviews` and `/api/verification/upload` POST requests return exactly 401 (not 403).
**Why human:** Cannot determine at runtime whether Wrangler's CSRF check fires before the app auth guard without executing the test.

#### 3. XSS Sentinel Timing

**Test:** Observe that `window.__xss_sec08_script` and `window.__xss_sec08_img` are checked after the React dispute card finishes expanding (not before).
**Expected:** Both sentinels remain `undefined` — confirming no script ran during React rendering.
**Why human:** `waitForTimeout(400)` timing in `expandDisputeByEmail()` is empirical — needs human judgment that 400ms is sufficient for React to re-render expanded card content.

### Gaps Summary

The phase delivered a complete and substantive `e2e/security.spec.ts` with 12 tests covering all 5 security requirements. Infrastructure (rate limiting, sanitization, auth guards) is real and correct in the application code.

The single gap is in SEC-04 assertion strictness. Two of three auth bypass tests (the POST endpoints) use a permissive `>= 400` assertion instead of strict `toBe(401)`. The application routes do have real 401 guards, but the tests did not apply the `Origin` header workaround (which was discovered and applied only in the rate limiting block). Without Origin header, Wrangler Pages dev may reject the POST with its own CSRF 403 before the Astro middleware and auth guard run — meaning the test passes without ever validating the application-level auth check.

The fix is small and targeted: add `headers: { Origin: BASE_URL }` to the two SEC-04 POST requests and tighten assertions to `toBe(401)`.

---

_Verified: 2026-03-09T23:00:00Z_
_Verifier: Claude (gsd-verifier)_
