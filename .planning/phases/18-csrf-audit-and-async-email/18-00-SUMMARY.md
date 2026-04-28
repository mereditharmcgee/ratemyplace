---
phase: 18-csrf-audit-and-async-email
plan: 00
subsystem: testing
tags: [vitest, unit-test, wave-0, tdd, nyquist, fireAndForget, recipientHash, runtime]

# Dependency graph
requires:
  - phase: 16-typed-runtime-foundation
    provides: src/lib/runtime.ts with getEnv() — new exports will extend this file
provides:
  - Wave 0 RED test scaffold for fireAndForget and recipientHash in src/lib/__tests__/runtime.test.ts
  - Contract specification locking the exact signatures Plan 18-01 must implement
affects:
  - 18-01 (must turn these 11 tests GREEN by implementing fireAndForget + recipientHash in runtime.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 Nyquist rule: write failing tests before implementation so Plan N+1 has an automated observable target"
    - "makeContext() helper: builds minimal APIContext-shaped object for unit tests without needing the full Astro adapter"
    - "console.error spy pattern (vi.spyOn + mockRestore) for testing logError-based structured logging"

key-files:
  created:
    - src/lib/__tests__/runtime.test.ts
  modified: []

key-decisions:
  - "Wave 0 is RED-only — no production code touched in Plan 18-00; fireAndForget and recipientHash added in Plan 18-01"
  - "Test file imports both fireAndForget and recipientHash as named imports from ../runtime — locking the exact export names Plan 18-01 must use"

patterns-established:
  - "makeContext() helper: reusable minimal APIContext fixture for runtime.ts tests — copy pattern for any future API-context-dependent unit tests"

requirements-completed:
  - PERF-01
  - PERF-02
  - PERF-03
  - PERF-04

# Metrics
duration: 6min
completed: 2026-04-28
---

# Phase 18 Plan 00: CSRF Audit and Async Email — Wave 0 Test Scaffold Summary

**11 failing unit tests locking the fireAndForget (6 cases) and recipientHash (5 cases) contracts before Plan 18-01 implementation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-28T19:43:59Z
- **Completed:** 2026-04-28T19:50:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created `src/lib/__tests__/runtime.test.ts` with 11 test cases across two describe blocks
- All 11 tests fail RED with `(0 , __vite_ssr_import_1__.fireAndForget) is not a function` — correct Wave 0 state
- Pre-existing 311 tests across 16 other files remain GREEN (no regressions)
- Contracts locked for both helpers: exact signatures, behavior for waitUntil and void-fallback branches, logError invocation, 8-char hex output shape

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing unit tests for fireAndForget and recipientHash** - `126e99e` (test)

**Plan metadata:** (pending final commit)

## Files Created/Modified

- `src/lib/__tests__/runtime.test.ts` — 120 lines, 11 test cases (6 fireAndForget + 5 recipientHash), imports from `../runtime`

## Test Details

### describe('fireAndForget') — 6 cases

| # | Test | Expected RED reason |
|---|------|---------------------|
| 1 | returns void (not a Promise) regardless of branch taken | fireAndForget is not a function |
| 2 | registers the wrapped promise with ctx.waitUntil when runtime.ctx is available | fireAndForget is not a function |
| 3 | falls back to void-scheduling (no throw) when context.locals.runtime is undefined | fireAndForget is not a function |
| 4 | falls back to void-scheduling when runtime.ctx is undefined (partial runtime object) | fireAndForget is not a function |
| 5 | logs via console.error when the wrapped promise rejects (waitUntil branch) | fireAndForget is not a function |
| 6 | logs via console.error when the wrapped promise rejects (void-fallback branch) | fireAndForget is not a function |

### describe('recipientHash') — 5 cases

| # | Test | Expected RED reason |
|---|------|---------------------|
| 1 | returns an 8-character lowercase hex string | recipientHash is not a function |
| 2 | is deterministic — same input produces same output | recipientHash is not a function |
| 3 | is case-insensitive on the email input (lowercases before hashing) | recipientHash is not a function |
| 4 | produces different output for different emails | recipientHash is not a function |
| 5 | returns synchronously (not a Promise) | recipientHash is not a function |

### RED State Confirmation

```
npm test -- runtime
Test Files  1 failed (1)
      Tests  11 failed (11)
```

First failing line: `TypeError: (0 , __vite_ssr_import_1__.fireAndForget) is not a function`

### Pre-existing Suite Still GREEN

```
npm test (full suite)
Test Files  1 failed | 16 passed (17)
      Tests  11 failed | 311 passed (322)
```

311 pre-existing tests pass. Only the 11 new tests fail.

## Decisions Made

- Wave 0 is RED-only — no production code touched in Plan 18-00; fireAndForget and recipientHash are added in Plan 18-01
- Named imports from `../runtime` lock the export names: Plan 18-01 must export `fireAndForget` and `recipientHash` exactly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 18-01 has a clear automated target: turn these 11 tests GREEN by adding `fireAndForget` and `recipientHash` exports to `src/lib/runtime.ts`
- No blockers

---
*Phase: 18-csrf-audit-and-async-email*
*Completed: 2026-04-28*
