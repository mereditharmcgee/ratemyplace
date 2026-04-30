---
phase: 21-quality-cleanup
plan: "01"
subsystem: api-rate-limiting
tags: [security, headers, sec-07, sec-08, rate-limiting]
dependency_graph:
  requires: []
  provides: [buildRateLimitHeaders, RateLimitResult-export]
  affects: [all-9-rate-limited-endpoints]
tech_stack:
  added: []
  patterns: [helper-function-colocated-with-module, spread-into-response-headers]
key_files:
  created: []
  modified:
    - src/lib/rateLimit.ts
    - src/lib/__tests__/rateLimit.test.ts
    - src/pages/api/auth/signin.ts
    - src/pages/api/auth/signup.ts
    - src/pages/api/auth/forgot-password.ts
    - src/pages/api/auth/resend-verification.ts
    - src/pages/api/bug-reports.ts
    - src/pages/api/contact.ts
    - src/pages/api/disputes.ts
    - src/pages/api/search/results.ts
    - src/pages/api/search/autocomplete.ts
    - e2e/security.spec.ts
decisions:
  - "X-RateLimit-Reset deliberately omitted (research open question 1 — retryAfterSeconds is sufficient)"
  - "forgot-password.ts successResponse rebuilt with headers rather than rewritten as multiple inline responses (preserves anti-enumeration pattern)"
  - "search/results.ts has 4 success return paths — all 4 received the spread to cover buildings, landlords, and fallback branches"
  - "search/autocomplete.ts min-length early-return also receives headers (it is on the allowed path, past the rate-limit check)"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-29T15:55:12Z"
  tasks_completed: 2
  files_changed: 12
requirements:
  - SEC-07
  - SEC-08
---

# Phase 21 Plan 01: Rate Limit Header Standardization Summary

**One-liner:** Exported `buildRateLimitHeaders(result, limit)` helper and spread it across all 9 rate-limited endpoints to emit `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and (on blocked paths) `Retry-After` on every response, closing the SEC-07 `contact.ts` 429 gap.

---

## What Was Built

### Helper Function

`buildRateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string>` added to `src/lib/rateLimit.ts`:

- Always returns `X-RateLimit-Limit` (stringified `limit`) and `X-RateLimit-Remaining` (stringified `result.remaining`)
- Returns `Retry-After` (stringified `result.retryAfterSeconds`) iff `!result.allowed` — covers both 429 and 503 fail-closed paths
- `RateLimitResult` interface changed from `interface` to `export interface` (one-word diff at line 6)

### Unit Tests (buildRateLimitHeaders)

5 new tests in `describe('buildRateLimitHeaders')` block:

| Test | Input shape | Expected |
|------|-------------|----------|
| 1 | allowed=true, remaining=4 | 2 headers, no Retry-After |
| 2 | allowed=false, retryAfterSeconds=1800 (429-shape) | 3 headers, Retry-After=1800 |
| 3 | error=true, retryAfterSeconds=60 (503-shape) | 3 headers, Retry-After=60 |
| 4 | any | typeof all values === 'string' |
| 5 | limit=60, limit=120 | X-RateLimit-Limit='60', '120' |

### Endpoint Retrofits

Per-endpoint change count (each `3` = import line + failure-path spread + success-path spread):

| File | buildRateLimitHeaders occurrences | maxAttempts | Notes |
|------|----------------------------------|-------------|-------|
| auth/signin.ts | 3 | 5 | |
| auth/signup.ts | 3 | 3 | |
| auth/forgot-password.ts | 3 | 3 | successResponse rebuilt to include headers |
| auth/resend-verification.ts | 3 | 3 | |
| bug-reports.ts | 3 | 5 | |
| contact.ts | 3 | 3 | SEC-07 closed; 503-vs-429 branching added |
| disputes.ts | 3 | 3 | Success status 201 |
| search/results.ts | 5 | 60 | 4 success paths (buildings, landlords, fallback) + 1 failure |
| search/autocomplete.ts | 4 | 120 | Min-length early return + main result + failure |

### SEC-07 Closure (contact.ts)

The `contact.ts` 429 response previously had no `Retry-After` header and no 503-vs-429 status branching. After this plan:

```typescript
// Before (SEC-07 gap):
if (!rateLimitResult.allowed) {
  return new Response(JSON.stringify({ error: '...' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' }  // Retry-After missing
  });
}

// After (SEC-07 fixed, SEC-08 added):
if (!rateLimitResult.allowed) {
  const status = rateLimitResult.error ? 503 : 429;
  const message = rateLimitResult.error ? 'Service temporarily unavailable...' : 'Too many submissions...';
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimitResult, 3) }
  });
}
```

---

## E2E Header Assertion Outcomes (Phase 21 block — 3 tests)

All 3 tests GREEN via `npx playwright test e2e/security.spec.ts -g "Phase 21" --no-deps --project=chromium`:

| Test | Endpoint | Status | Headers asserted |
|------|----------|--------|-----------------|
| A | POST /api/contact (4th hit) | 429 | retry-after defined, >0; x-ratelimit-limit=3; x-ratelimit-remaining=0 |
| B | GET /api/search/results?q=test | 200 | x-ratelimit-limit=60; x-ratelimit-remaining defined <60; retry-after ABSENT |
| C | POST /api/bug-reports (under limit) | 200 | x-ratelimit-limit=5; x-ratelimit-remaining defined; retry-after ABSENT |

Header keys use Playwright-lowercased format in E2E assertions; canonical Title-Case used in source.

---

## Deviations from Plan

None — plan executed exactly as written.

The `forgot-password.ts` `successResponse` pattern (anti-enumeration) was noted in the plan interface section and handled by rebuilding the Response with headers included — matching the documented approach.

`X-RateLimit-Reset` deliberately NOT implemented per plan note (research open question 1 deferred).

---

## Self-Check

### Files Created/Modified
- [x] `src/lib/rateLimit.ts` — `buildRateLimitHeaders` exported, `RateLimitResult` exported
- [x] `src/lib/__tests__/rateLimit.test.ts` — 5 new tests in `describe('buildRateLimitHeaders')`
- [x] All 9 endpoint files — `buildRateLimitHeaders` in import + failure + success
- [x] `e2e/security.spec.ts` — `Phase 21: Rate Limit Headers` describe block added

### Commits
- `27d37ce` — test(21-01): Wave 0 RED tests
- `abe9a2d` — feat(21-01): standardize rate-limit headers (SEC-07, SEC-08)

### Test Results
- Unit: 334/334 passing (includes 5 new buildRateLimitHeaders tests)
- E2E Phase 21: 3/3 passing
- Build: clean (no TypeScript errors)

## Self-Check: PASSED
