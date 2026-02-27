---
phase: 03-security-hardening
plan: 01
subsystem: security
tags: [rate-limiting, logging, fail-closed, security-hardening]
one_liner: "Fail-closed rate limiting with structured JSON logging for DB error observability"

dependency_graph:
  requires: []
  provides:
    - fail-closed-rate-limiting
    - structured-logging-helper
    - db-error-503-response
  affects:
    - src/lib/rateLimit.ts
    - src/pages/api/auth/*

tech_stack:
  added:
    - crypto.randomUUID for request ID generation
  patterns:
    - fail-closed security (deny by default on errors)
    - structured JSON logging for Cloudflare indexing
    - HTTP status distinction (503 DB error vs 429 rate limit)

key_files:
  created:
    - src/lib/logger.ts
    - src/lib/__tests__/logger.test.ts
  modified:
    - src/lib/rateLimit.ts
    - src/lib/__tests__/rateLimit.test.ts
    - src/pages/api/auth/signin.ts
    - src/pages/api/auth/signup.ts
    - src/pages/api/auth/resend-verification.ts

decisions:
  - decision: "Use fail-closed rate limiting (deny on DB error)"
    rationale: "Prevents security bypass via DB attacks or outages"
    alternatives: "fail-open (allow on error) - rejected due to security risk"
  - decision: "Return 503 for DB errors, 429 for rate limit hits"
    rationale: "Semantic HTTP status codes enable proper client retry logic"
    alternatives: "Always return 429 - rejected as less informative"
  - decision: "Fixed 60-second retry on DB errors"
    rationale: "Provides consistent client behavior and prevents retry storms"
    alternatives: "Dynamic retry - rejected for simplicity"

metrics:
  duration_seconds: 171
  tasks_completed: 3
  tests_added: 4
  tests_updated: 1
  files_created: 2
  files_modified: 5
  commits: 3
  completed_at: "2026-02-27T03:30:03Z"
---

# Phase 03 Plan 01: Fail-Closed Rate Limiting Summary

**One-liner:** Fail-closed rate limiting with structured JSON logging for DB error observability

## Overview

Converted rate limiting from fail-open (allows requests on DB error) to fail-closed (blocks requests on DB error), preventing security bypass via database attacks. Added structured JSON logging helper for observability and monitoring. Updated all auth endpoints to distinguish between 503 (DB error) and 429 (rate limit exceeded) responses.

## Tasks Completed

### Task 1: Update rateLimit.ts with fail-closed behavior
**Status:** ✅ Complete
**Commit:** 734ddbe
**Duration:** ~50s

- Extended `RateLimitResult` interface with optional `error?: boolean` field
- Modified catch block to return `allowed: false, error: true, retryAfterSeconds: 60`
- Changed from fail-open (security risk) to fail-closed (secure by default)
- Maintained backward compatibility with optional error field

**Files modified:**
- `src/lib/rateLimit.ts`

### Task 2: Create logger.ts helper and update auth endpoints
**Status:** ✅ Complete
**Commit:** 6bd1c6f
**Duration:** ~70s

- Created `src/lib/logger.ts` with structured JSON logging helper
- Implemented `logError()` function with level, timestamp, event, request_id, context
- Updated signin.ts to distinguish 503 (DB error) from 429 (rate limit)
- Updated signup.ts with same error handling pattern
- Updated resend-verification.ts with same error handling pattern
- All endpoints log `rate_limit_db_failure` events with endpoint and IP context
- All endpoints include `Retry-After` header

**Files created:**
- `src/lib/logger.ts`

**Files modified:**
- `src/pages/api/auth/signin.ts`
- `src/pages/api/auth/signup.ts`
- `src/pages/api/auth/resend-verification.ts`

### Task 3: Update rate limit test and add logger tests
**Status:** ✅ Complete
**Commit:** cfa035f
**Duration:** ~51s

- Updated "gracefully handles database errors" test to expect `allowed: false`
- Added expectations for `error: true`, `remaining: 0`, `retryAfterSeconds: 60`
- Created `src/lib/__tests__/logger.test.ts` with 3 tests
- Tests verify JSON structure, request_id generation, custom request_id usage
- All 15 tests in both files pass

**Files created:**
- `src/lib/__tests__/logger.test.ts`

**Files modified:**
- `src/lib/__tests__/rateLimit.test.ts`

## Verification Results

✅ **All tests pass:** 147 tests across 8 test files
✅ **Build succeeds:** `npm run build` completes without errors
✅ **Pattern verification:**
  - `rateLimit.error` checks present in all 3 auth endpoints
  - Catch block returns fail-closed result
  - Structured JSON logging in all error cases

## Success Criteria

- [x] RateLimitResult interface has optional `error` field
- [x] checkRateLimit() returns `allowed: false, error: true, retryAfterSeconds: 60` on DB error
- [x] logger.ts exports logError() with structured JSON format
- [x] signin.ts, signup.ts, resend-verification.ts return 503 + log on DB error
- [x] signin.ts, signup.ts, resend-verification.ts return 429 on normal rate limit
- [x] All three include Retry-After header
- [x] Test "gracefully handles database errors" expects `allowed: false`
- [x] Logger tests verify JSON structure
- [x] `npm test` passes (147/147 tests)
- [x] `npm run build` passes

## Deviations from Plan

None - plan executed exactly as written.

## Security Impact

**Before:** Rate limiting failed open, allowing unlimited requests during DB outages or attacks targeting the database. This created a security bypass vector.

**After:** Rate limiting fails closed, blocking all requests during DB errors. Structured logging enables monitoring and alerting for DB failures. HTTP status codes enable proper client retry behavior.

**Risk reduction:** Eliminates DB attack vector for bypassing rate limits. Enables observability for security monitoring.

## Next Steps

This plan establishes the foundation for security hardening. Future plans in Phase 03 should build on:
- Fail-closed pattern can be applied to other security-critical paths
- Structured logging can be extended to other events (auth failures, suspicious activity)
- 503/429 distinction enables client-side exponential backoff strategies

## Self-Check

### Created files exist
- ✅ `src/lib/logger.ts` exists
- ✅ `src/lib/__tests__/logger.test.ts` exists

### Modified files updated
- ✅ `src/lib/rateLimit.ts` contains `error?: boolean`
- ✅ `src/lib/__tests__/rateLimit.test.ts` expects `allowed: false`
- ✅ `src/pages/api/auth/signin.ts` checks `rateLimit.error`
- ✅ `src/pages/api/auth/signup.ts` checks `rateLimit.error`
- ✅ `src/pages/api/auth/resend-verification.ts` checks `rateLimit.error`

### Commits exist
- ✅ 734ddbe: feat(03-01): implement fail-closed rate limiting
- ✅ 6bd1c6f: feat(03-01): add structured logging and 503/429 distinction
- ✅ cfa035f: test(03-01): update tests for fail-closed behavior

## Self-Check: PASSED

All files created, all commits present, all tests passing.
