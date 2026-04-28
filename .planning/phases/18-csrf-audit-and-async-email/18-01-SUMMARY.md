---
phase: 18-csrf-audit-and-async-email
plan: 01
subsystem: infra
tags: [cloudflare-workers, waitUntil, fire-and-forget, sha256, oslojs, runtime, async-email]

# Dependency graph
requires:
  - phase: 16-typed-runtime-foundation
    provides: src/lib/runtime.ts with getEnv() — new exports extend this file
  - phase: 18-00
    provides: Wave 0 RED tests in src/lib/__tests__/runtime.test.ts
provides:
  - fireAndForget(context, promise): void helper in src/lib/runtime.ts
  - recipientHash(email): string helper in src/lib/runtime.ts
  - All 11 Wave 0 RED tests turned GREEN
affects:
  - 18-02 (5-route async email conversion can now call fireAndForget from runtime.ts)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fireAndForget: ctx.waitUntil path in production, void-fallback in tests/dev — single null-guard point"
    - "recipientHash: synchronous oslo sha256 + encodeHexLowerCase, sliced to 8 chars for log correlation without PII"
    - "instanceof Error guard in unknown catch: TypeScript-safe without changing real-world behavior"

key-files:
  created: []
  modified:
    - src/lib/runtime.ts

key-decisions:
  - "fireAndForget uses void wrapped (not await) in fallback — preserves non-blocking behavior in dev/tests"
  - "instanceof Error guard added over literal CONTEXT.md snippet for TypeScript safety on unknown catch type"
  - "recipient_hash NOT included in fireAndForget logError call — helper is generic; call sites add it per CONTEXT.md"

patterns-established:
  - "fireAndForget pattern: wrap promise in .catch(logError) before registering with waitUntil — prevents unhandled rejection crashing Worker"

requirements-completed:
  - PERF-01
  - PERF-02
  - PERF-03
  - PERF-04

# Metrics
duration: 1min
completed: 2026-04-28
---

# Phase 18 Plan 01: fireAndForget and recipientHash helpers with ctx.waitUntil null-guard and @oslojs/crypto sha256 hashing

**fireAndForget(context, promise): void and recipientHash(email): string added to src/lib/runtime.ts — 11 Wave 0 RED tests turned GREEN, 322/322 suite passing, TypeScript build clean**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-28T19:49:39Z
- **Completed:** 2026-04-28T19:50:49Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Implemented `fireAndForget(context: APIContext, promise: Promise<unknown>): void` with `ctx.waitUntil` path and `void wrapped` fallback
- Implemented `recipientHash(email: string): string` using `@oslojs/crypto/sha2` sha256 + `encodeHexLowerCase`, sliced to 8 characters
- All 11 Wave 0 RED tests turned GREEN (6 fireAndForget + 5 recipientHash)
- Zero regressions — 311 pre-existing tests remain GREEN (322 total)
- TypeScript build passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement fireAndForget and recipientHash in src/lib/runtime.ts** - `2839d4c` (feat)

**Plan metadata:** (pending final commit)

## Files Created/Modified

- `src/lib/runtime.ts` — Extended from 9 lines to 66 lines; added `recipientHash` and `fireAndForget` exports alongside preserved `getEnv`

## Exports in src/lib/runtime.ts

```typescript
export function getEnv(context: APIContext): App.Platform['env']
export function recipientHash(email: string): string
export function fireAndForget(context: APIContext, promise: Promise<unknown>): void
```

## Test Results

```
npm test -- runtime
Test Files  1 passed (1)
      Tests  11 passed (11)

npm test (full suite)
Test Files  17 passed (17)
      Tests  322 passed (322)
```

## Build Result

```
npm run build
[build] Complete! (exit 0 — zero TypeScript errors)
```

## Decisions Made

- `instanceof Error` guard added in the `.catch` handler over the literal CONTEXT.md snippet — avoids `unknown.message` TypeScript errors without changing real-world behavior (email libs always throw `Error` instances)
- `recipient_hash` field deliberately NOT included in `fireAndForget`'s own `logError` call — the helper is generic and doesn't know which argument of the wrapped promise is the recipient; Plan 18-02 call sites will add it inline per CONTEXT.md
- No third parameter added to `fireAndForget` — locked two-parameter contract from CONTEXT.md preserved exactly

## Deviations from Plan

None - plan executed exactly as written. The `instanceof Error` guard is documented in the plan's implementation notes as an explicitly sanctioned TypeScript-safety addition.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 18-02 has a working `fireAndForget` and `recipientHash` to import from `src/lib/runtime.ts`
- Call site pattern is verified working in tests
- Five-route async email conversion (signup, forgot-password, resend-verification, contact, disputes) can begin immediately
- No blockers

---
*Phase: 18-csrf-audit-and-async-email*
*Completed: 2026-04-28*
