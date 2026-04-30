---
phase: 18-csrf-audit-and-async-email
verified: 2026-04-27T16:17:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
notes:
  known_follow_up: >
    src/pages/api/disputes/[id].ts admin update endpoint retains a blocking
    `await sendDisputeUpheldEmail(...)` at line 136. This is out of the locked
    5-file scope for Phase 18 and was explicitly deferred. Not a gap; flagged
    here for the next hardening pass.
---

# Phase 18: CSRF Audit and Async Email Verification Report

**Phase Goal:** CSRF posture is documented and ratified; email sends no longer block API response times
**Verified:** 2026-04-27T16:17:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `fireAndForget(context, promise): void` exported from `src/lib/runtime.ts` with correct waitUntil / void-fallback / catch-on-rejection logic | VERIFIED | Lines 47-66 of runtime.ts; returns void, uses `ctx?.waitUntil`, falls back to `void wrapped`, catches via logError |
| 2 | `recipientHash(email): string` exported — synchronous, uses @oslojs/crypto/sha2, returns 8 lowercase hex chars | VERIFIED | Lines 23-26 of runtime.ts; imports sha256 + encodeHexLowerCase, slices to 8 chars, lowercases input |
| 3 | `src/middleware.ts` contains CSRF audit inline comment with verdict and path to audit doc | VERIFIED | Lines 6-9: `CSRF audit (2026-04-28)`, references `.planning/audits/csrf-2026-04.md`, includes application/json caveat |
| 4 | `.planning/audits/csrf-2026-04.md` exists with 4-category per-endpoint structure and explicit verdict | VERIFIED | 169 lines; sections 5.1-5.4 confirmed; `## Verdict` section present |
| 5 | Audit doc explicitly documents application/json checkOrigin gap and disputes.ts coverage | VERIFIED | Lines 98-103; explicitly states "checkOrigin DOES NOT apply" for JSON, documents Turnstile + rate limit + content-type guard as substitute |
| 6 | `CLAUDE.md` Security Checklist section gained a `### CSRF Protection` subsection — inside existing H2, not a new H2 | VERIFIED | Line 261: `### CSRF Protection` inside `## Security Checklist` (line 251); H2 count unchanged at 12; references audit doc |
| 7 | 5 routes have zero remaining `await sendXxxEmail` patterns | VERIFIED | `grep -rn "await send.*Email" src/pages/api/{auth/signup,auth/forgot-password,auth/resend-verification,contact,disputes}.ts` returns zero matches |
| 8 | All 5 routes use `fireAndForget(context, ...)` for email sends | VERIFIED | signup: 2 occurrences (import + call), forgot-password: 2, resend-verification: 3 (import + call + comment), contact: 3 (import + 2 calls), disputes: 2 |
| 9 | `disputes.ts` preserves `if (resendApiKey)` guard around fireAndForget call | VERIFIED | Line 161 of disputes.ts: `if (resendApiKey)` wraps the fireAndForget call |
| 10 | DB writes precede fireAndForget at every site | VERIFIED | signup: INSERT (line 107) + createVerificationToken (line 112) before fireAndForget (line 115); forgot-password: createPasswordResetToken (line 86) before fireAndForget (line 91); resend-verification: createVerificationToken (line 57) before fireAndForget (line 64); contact: INSERT .run() (line 74) before fireAndForget (line 79); disputes: .run() (line 136) before fireAndForget (line 162) |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/runtime.ts` | Exports getEnv, fireAndForget, recipientHash | VERIFIED | 3 exports confirmed at lines 6, 23, 47; 66 lines total |
| `src/lib/__tests__/runtime.test.ts` | 11+ tests across 2 describe blocks, all passing | VERIFIED | 121 lines; 6 fireAndForget tests + 5 recipientHash tests; all 322 unit tests pass |
| `src/pages/api/auth/signup.ts` | fireAndForget call site, no await sendVerificationEmail | VERIFIED | Contains `fireAndForget(context, sendVerificationEmail(...))` |
| `src/pages/api/auth/forgot-password.ts` | fireAndForget call site, no await sendPasswordResetEmail | VERIFIED | Contains `fireAndForget(context, sendPasswordResetEmail(...))` |
| `src/pages/api/auth/resend-verification.ts` | fireAndForget call site, always returns 200 | VERIFIED | Contains `fireAndForget(context, sendVerificationEmail(...))` at line 64; returns 200 only |
| `src/pages/api/contact.ts` | Both emails fire-and-forgot | VERIFIED | 2 fireAndForget calls (lines 79, 82) covering confirmation + notification emails |
| `src/pages/api/disputes.ts` | fireAndForget inside resendApiKey guard | VERIFIED | guard at line 161; fireAndForget at line 162 |
| `.planning/audits/csrf-2026-04.md` | 4-category structure, verdict, 80+ lines | VERIFIED | 169 lines; 7 required sections; 4 per-endpoint categories |
| `CLAUDE.md` | CSRF subsection inside Security Checklist | VERIFIED | `### CSRF Protection` at line 261 inside `## Security Checklist` at line 251 |
| `.planning/REQUIREMENTS.md` | PERF-01 companion note for resend-verification | VERIFIED | Line 37 contains "Companion: `/api/auth/resend-verification` gets the same treatment..." |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/runtime.ts` | `src/lib/logger.ts` | `import { logError } from './logger'` | WIRED | Line 4 of runtime.ts |
| `src/lib/runtime.ts` | `@oslojs/crypto/sha2` | `import { sha256 } from '@oslojs/crypto/sha2'` | WIRED | Line 2 of runtime.ts |
| `src/lib/runtime.ts` | `@oslojs/encoding` | `import { encodeHexLowerCase } from '@oslojs/encoding'` | WIRED | Line 3 of runtime.ts |
| `src/lib/__tests__/runtime.test.ts` | `src/lib/runtime.ts` | `import { fireAndForget, recipientHash } from '../runtime'` | WIRED | Line 2 of runtime.test.ts |
| `src/pages/api/auth/signup.ts` | `src/lib/runtime.ts` | `import { getEnv, fireAndForget }` | WIRED | Line 4 of signup.ts |
| `src/pages/api/auth/forgot-password.ts` | `src/lib/runtime.ts` | `import { getEnv, fireAndForget }` | WIRED | Line 3 of forgot-password.ts |
| `src/pages/api/auth/resend-verification.ts` | `src/lib/runtime.ts` | `import { getEnv, fireAndForget }` | WIRED | Line 3 of resend-verification.ts |
| `src/pages/api/contact.ts` | `src/lib/runtime.ts` | `import { getEnv, fireAndForget }` | WIRED | Line 3 of contact.ts |
| `src/pages/api/disputes.ts` | `src/lib/runtime.ts` | `import { getEnv, fireAndForget }` | WIRED | Line 3 of disputes.ts |
| `src/middleware.ts` | `.planning/audits/csrf-2026-04.md` | inline comment with relative path | WIRED | Line 6: `see .planning/audits/csrf-2026-04.md` |
| `CLAUDE.md` | `.planning/audits/csrf-2026-04.md` | Security Checklist subsection | WIRED | Line 271: `Full audit: .planning/audits/csrf-2026-04.md` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEC-06 | 18-03-PLAN.md | CSRF protection audit completed; verdict in middleware.ts and CLAUDE.md | SATISFIED | `.planning/audits/csrf-2026-04.md` (169 lines, 4 categories, verdict section); middleware.ts comment lines 6-9; CLAUDE.md `### CSRF Protection` at line 261 |
| PERF-01 | 18-00, 18-01, 18-02-PLAN.md | `/api/auth/signup` and `/api/auth/resend-verification` converted to fireAndForget | SATISFIED | signup.ts line 115; resend-verification.ts line 64; REQUIREMENTS.md line 37 companion note; both return 200 only |
| PERF-02 | 18-00, 18-01, 18-02-PLAN.md | `/api/auth/forgot-password` converted to fireAndForget | SATISFIED | forgot-password.ts line 91 |
| PERF-03 | 18-00, 18-01, 18-02-PLAN.md | `/api/contact` converted to fireAndForget (both emails) | SATISFIED | contact.ts lines 79, 82 — both confirmation and notification emails fire-and-forgot |
| PERF-04 | 18-00, 18-01, 18-02-PLAN.md | `/api/disputes` converted to fireAndForget | SATISFIED | disputes.ts line 162; resendApiKey guard preserved at line 161 |

All 5 requirement IDs satisfied. No orphaned requirements found.

---

### Anti-Patterns Found

None. No TODO/FIXME/PLACEHOLDER markers found in modified files. No stub implementations. No empty return patterns in production code.

---

### Human Verification Required

None. All targeted behaviors are verifiable programmatically for this phase (file existence, content patterns, test suite pass/fail, build clean, DB-before-email ordering via line-number analysis).

The latency improvement (email sends no longer blocking response time) cannot be measured here, but the mechanism is verified: `fireAndForget` registers email promises with `ctx.waitUntil` in production and falls back to `void` scheduling in tests — neither path awaits the email promise before the route returns its response.

---

### Known Follow-Up (Not a Gap)

`src/pages/api/disputes/[id].ts` (admin dispute update endpoint) retains a blocking `await sendDisputeUpheldEmail(...)` at line 136. This is the admin-only endpoint that was explicitly out of the locked 5-file scope for Phase 18, as documented in the phase PLAN and confirmed by the task instructions. The conversion of this endpoint should be treated as a follow-up item in a future hardening pass (e.g., v1.6.0).

---

### Summary

Phase 18 goal is fully achieved:

1. **CSRF posture documented and ratified.** The audit at `.planning/audits/csrf-2026-04.md` covers all 4 endpoint categories with per-endpoint defense analysis. The load-bearing finding — that Astro `checkOrigin` bypasses `application/json` POST requests — is explicitly documented in the audit doc, the middleware inline comment, and the CLAUDE.md subsection. The verdict (SameSite=Lax + Turnstile + checkOrigin sufficient; no token-based CSRF needed) is ratified and cross-referenced in all three artifacts.

2. **Email sends no longer block API response times.** All 5 target routes (signup, forgot-password, resend-verification, contact, disputes) have had their blocking `await sendXxxEmail(...)` calls replaced with `fireAndForget(context, ...)`. The helper is implemented correctly: waitUntil path in production, void-fallback in dev/test, catch-and-log on rejection. DB writes precede every fireAndForget call. The resend-verification behavior change (always 200, never 500 on email failure) is documented in REQUIREMENTS.md PERF-01.

3. **All 322 unit tests pass. TypeScript build clean.**

---

_Verified: 2026-04-27T16:17:00Z_
_Verifier: Claude (gsd-verifier)_
