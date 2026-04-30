---
phase: 17-public-endpoint-security
verified: 2026-04-27T13:08:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 17: Public Endpoint Security Verification Report

**Phase Goal:** Every public POST and search endpoint has rate limiting and input validation — no unprotected path remains in the request surface
**Verified:** 2026-04-27T13:08:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `isValidEmail` uses `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, rejects 'notanemail', accepts 'a@b.c' | VERIFIED | validation.ts line 115; 8 unit tests pass |
| 2 | All 4 form validators return `ValidationError[]` with collect-all behavior | VERIFIED | validateDisputeForm/BugReport/ContactForm/Search all confirmed; "collects all errors" test passes |
| 3 | `/api/bug-reports` rate limit: 5/hr per IP with Retry-After header on 429 | VERIFIED | bug-reports.ts line 26: `checkRateLimit(db, ip, 'bug-report', 5, 3600)`; Retry-After on line 36 |
| 4 | `/api/search/results` rate limit: 60/min per IP with Retry-After on 429 | VERIFIED | results.ts line 11: `checkRateLimit(db, ip, 'search-results', 60, 60)`; Retry-After on line 21 |
| 5 | `/api/search/autocomplete` rate limit: 120/min per IP with Retry-After on 429 | VERIFIED | autocomplete.ts line 11: `checkRateLimit(db, ip, 'search-autocomplete', 120, 60)`; Retry-After on line 21 |
| 6 | `/api/disputes` uses `validateDisputeForm`; landlordEmail='notanemail' returns 400 with field error | VERIFIED | disputes.ts line 51: `validateDisputeForm(body)`; unit test + E2E test listed |
| 7 | All 3 POST endpoints have content-type guards returning 415 on wrong type | VERIFIED | 415 confirmed in bug-reports.ts (line 16), contact.ts (line 17), disputes.ts (line 15) |
| 8 | `/api/disputes` requires application/json; bug-reports + contact require multipart/urlencoded | VERIFIED | disputes.ts checks `includes('application/json')`; bug-reports/contact check for form types |
| 9 | Search endpoints use `escapeLikePattern` + `ESCAPE '\\'` clause | VERIFIED | 4 ESCAPE clauses confirmed across results.ts and autocomplete.ts |
| 10 | `/api/search/results` returns 400 if query > 200 chars | VERIFIED | results.ts line 28: `validateSearch(rawQuery)`; E2E test listed |
| 11 | contact.ts intentionally does NOT have Retry-After (deferred to Phase 21 SEC-07) | VERIFIED | contact.ts line 26 comment: "Phase 21 SEC-07 will retro-fit Retry-After header" — 429 response has no Retry-After header |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/validation.ts` | Exports isValidEmail, isValidZipCode, enforceMaxLength, escapeLikePattern, validateDisputeForm, validateBugReport, validateContactForm, validateSearch | VERIFIED | 303 lines; 10 exported functions confirmed |
| `src/lib/__tests__/validation.test.ts` | 8 new describe blocks for new exports | VERIFIED | 86 unit tests pass (all 8 new blocks + 2 existing) |
| `e2e/security.spec.ts` | Phase 17 describe block with 10 tests | VERIFIED | 10 tests listed by Playwright at lines 279-400 |
| `src/pages/api/bug-reports.ts` | Content-type guard, 5/hr rate limit, validateBugReport | VERIFIED | All 3 guards wired; Retry-After confirmed |
| `src/pages/api/contact.ts` | Content-type guard, validateContactForm, no Retry-After (intentional) | VERIFIED | Guard at line 11; validator at line 58; no Retry-After in 429 response |
| `src/pages/api/disputes.ts` | Content-type guard (JSON only), validateDisputeForm | VERIFIED | Guard at line 12; validator at line 51 |
| `src/pages/api/search/results.ts` | 60/min rate limit, validateSearch, escapeLikePattern + ESCAPE | VERIFIED | Rate limit confirmed; 3 ESCAPE clauses in buildings/landlords branches |
| `src/pages/api/search/autocomplete.ts` | 120/min rate limit, validateSearch, escapeLikePattern + ESCAPE | VERIFIED | Rate limit confirmed; 2 ESCAPE clauses in buildings/landlords queries |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| validation.ts | ValidationError interface | same-file, `ValidationError[]` return type | VERIFIED | Pattern confirmed throughout all 4 validators |
| validateDisputeForm | isValidEmail + enforceMaxLength | internal calls in function body | VERIFIED | Lines 181, 188, 196, 202 |
| bug-reports.ts | validateBugReport, checkRateLimit | `import { validateBugReport } from '../../lib/validation'` | VERIFIED | Lines 7, 64 |
| contact.ts | validateContactForm, checkRateLimit | `import { validateContactForm } from '../../lib/validation'` | VERIFIED | Lines 7, 58 |
| disputes.ts | validateDisputeForm | `import { sanitizeText, validateDisputeForm } from '../../lib/validation'` | VERIFIED | Lines 5, 51 |
| search/results.ts | validateSearch + escapeLikePattern + ESCAPE clause | `import { validateSearch, escapeLikePattern } from '../../../lib/validation'` | VERIFIED | Lines 4, 28, 56, 47 |
| search/autocomplete.ts | validateSearch + escapeLikePattern + ESCAPE clause | `import { validateSearch, escapeLikePattern } from '../../../lib/validation'` | VERIFIED | Lines 4, 28, 46, 56, 70 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SEC-04 | 17-02 | Rate limiting on /api/bug-reports (5/hr per IP) | SATISFIED | bug-reports.ts `checkRateLimit(db, ip, 'bug-report', 5, 3600)` |
| SEC-05 | 17-02 | Rate limiting on search/results (60/min) and autocomplete (120/min) | SATISFIED | Both search endpoints confirmed |
| VAL-01 | 17-01, 17-02 | validateDisputeForm with email format + length limits | SATISFIED | disputes.ts + validation.ts confirmed |
| VAL-02 | 17-01, 17-02 | validateBugReport with length limits | SATISFIED | bug-reports.ts + validation.ts confirmed |
| VAL-03 | 17-01, 17-02 | validateContactForm with email format + length limits | SATISFIED | contact.ts + validation.ts confirmed |
| VAL-04 | 17-01, 17-02 | validateSearch with 200-char cap + escapeLikePattern | SATISFIED | Both search endpoints confirmed |
| VAL-05 | 17-01 | Shared primitives isValidEmail, isValidZipCode, enforceMaxLength | SATISFIED | All 3 exported from validation.ts; isValidEmail called in 3 validators |

**Deferred (not Phase 17 scope, correctly absent):**
- SEC-06 → Phase 18 (CSRF audit)
- SEC-07 → Phase 21 (Retry-After on contact.ts)
- SEC-08 → Phase 21 (X-RateLimit headers)
- PERF-03/04 → Phase 18

---

### Anti-Patterns Found

No anti-patterns detected. Scan of all 6 modified production files found:
- No TODO/FIXME/PLACEHOLDER comments
- No return null / empty stub implementations
- No console.log-only handlers
- All functions substantively implemented

---

### Human Verification Required

The following items require runtime confirmation against a running server:

#### 1. 6th Bug Report 429 Behavior

**Test:** Submit 5 bug reports, then submit a 6th. Verify the 6th returns 429 with a numeric Retry-After header.
**Expected:** HTTP 429, `Retry-After: <seconds>` header present with value > 0
**Why human:** Rate-limit state depends on the D1 `rate_limits` table; can only be fully validated against a running Cloudflare Worker environment or local `wrangler dev`.

#### 2. Literal % Search Does Not Match All Records

**Test:** Search for `5%` in the search bar. Verify results show only buildings/landlords with literal "5%" in their name, not all records.
**Expected:** Narrow result set (not all buildings), confirming `escapeLikePattern` + `ESCAPE '\\'` functions correctly end-to-end in D1.
**Why human:** SQL ESCAPE behavior requires a live D1 query against real data; unit tests cover the JS-side escaping but not the SQLite runtime interpretation.

---

### Build and Test Summary

| Check | Result |
|-------|--------|
| `npm run build` | Clean — "Complete!" |
| `npm test` (all) | 311/311 tests pass (16 test files) |
| `npm test -- validation` | 86/86 tests pass |
| `npx playwright test --list` Phase 17 | 10 tests discoverable |
| Anti-pattern scan | 0 issues |

---

_Verified: 2026-04-27T13:08:00Z_
_Verifier: Claude (gsd-verifier)_
