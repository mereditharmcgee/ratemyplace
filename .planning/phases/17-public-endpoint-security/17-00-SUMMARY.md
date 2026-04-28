---
phase: 17-public-endpoint-security
plan: "00"
subsystem: testing
tags: [tdd, wave-0, validation, security, red-tests]
dependency_graph:
  requires: []
  provides: [wave-0-test-scaffolding]
  affects: [17-01, 17-02]
tech_stack:
  added: []
  patterns: [red-green-refactor, nyquist-wave-0]
key_files:
  created: []
  modified:
    - src/lib/__tests__/validation.test.ts
    - e2e/security.spec.ts
decisions:
  - "Wave 0 scaffolding only — no production code touched. RED state intentional."
  - "escapeLikePattern test uses JS literal '\\\\\\%' to represent bytes backslash+backslash+backslash+percent (escaped backslash + escaped percent in SQL LIKE)"
  - "E2E tests use serial mode because rate-limit state is shared; clearRateLimits() in beforeEach"
  - "Reserved review IDs review-080/081/082 for Phase 17 dispute tests (existing reservations: review-030/040/060/070)"
metrics:
  duration_minutes: 2
  completed_date: "2026-04-28"
  tasks_completed: 2
  files_modified: 2
---

# Phase 17 Plan 00: Wave 0 Failing Test Scaffolding Summary

Wave 0 RED test scaffolding for Phase 17 — 8 unit test describe blocks and 10 E2E tests authored. Every new function import resolves to "is not a function" because no production code was added. Subsequent plans (17-01, 17-02) will turn these RED tests GREEN.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write failing unit tests for validation primitives | 417a072 | src/lib/__tests__/validation.test.ts |
| 2 | Write failing E2E tests for endpoint hardening | b004d4a | e2e/security.spec.ts |

## Test Blocks Added

### Unit Tests (src/lib/__tests__/validation.test.ts)

8 new `describe` blocks added (lines 235–588):

| Block | Function | Requirement | Test Count |
|-------|----------|-------------|-----------|
| A | `isValidEmail` | VAL-05 | 8 |
| B | `isValidZipCode` | VAL-05 | 6 |
| C | `enforceMaxLength` | VAL-05 | 6 |
| D | `escapeLikePattern` | VAL-04 | 5 |
| E | `validateDisputeForm` | VAL-01 | 10 |
| F | `validateBugReport` | VAL-02 | 6 |
| G | `validateContactForm` | VAL-03 | 5 |
| H | `validateSearch` | VAL-04 | 5 |

**Total new unit tests:** 51

**File line count:** 234 lines (before) → 588 lines (after)

### E2E Tests (e2e/security.spec.ts)

1 new `test.describe('Phase 17: Public Endpoint Security')` block with 10 tests:

| Test | Requirement | Expected Status |
|------|-------------|----------------|
| SEC-04: 6th bug-reports POST in 1hr | SEC-04 | 429 + Retry-After |
| SEC-05: 61st search/results GET | SEC-05 | 429 + Retry-After |
| SEC-05: 121st search/autocomplete GET | SEC-05 | 429 + Retry-After |
| VAL-01: disputes text/plain | VAL-01 | 415 |
| VAL-01: disputes notanemail landlordEmail | VAL-01 | 400 + field error |
| VAL-01: disputes explanation > 5000 chars | VAL-01 | 400 + field error |
| VAL-02: bug-reports application/json | VAL-02 | 415 |
| VAL-03: contact application/json | VAL-03 | 415 |
| VAL-04: search/results q=201 chars | VAL-04 | 400 + field error |
| VAL-04: search/autocomplete 5% literal | VAL-04 | 200 + array results |

**File line count:** 262 lines (before) → 407 lines (after)

## Test Run Results

```
Test Files  1 failed (16)
      Tests  51 failed | 260 passed (311)
```

- 260 existing tests still pass (validateReviewForm + sanitizeText + all other suites)
- 51 new tests fail with `TypeError: (0, ...) is not a function` — expected RED state
- E2E: `npx playwright test e2e/security.spec.ts --list` discovers exactly 10 "Phase 17:" tests

## Failure Modes Captured

All 51 unit test failures are `TypeError: X is not a function` for the 8 new imports:
- `isValidEmail is not a function`
- `isValidZipCode is not a function`
- `enforceMaxLength is not a function`
- `escapeLikePattern is not a function`
- `validateDisputeForm is not a function`
- `validateBugReport is not a function`
- `validateContactForm is not a function`
- `validateSearch is not a function`

E2E tests are discoverable but will fail at runtime (endpoints not yet hardened) — not executed in this plan per the Wave 0 contract.

## Production Code

No production code modified. `git diff src/lib/validation.ts src/pages/api/` returns empty diff.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] src/lib/__tests__/validation.test.ts exists and has 8 new describe blocks
- [x] e2e/security.spec.ts exists and has Phase 17 describe block with 10 tests
- [x] Commit 417a072 exists (unit tests)
- [x] Commit b004d4a exists (E2E tests)
- [x] 260 existing tests pass, 51 new tests fail (RED state confirmed)
- [x] No production code modified
