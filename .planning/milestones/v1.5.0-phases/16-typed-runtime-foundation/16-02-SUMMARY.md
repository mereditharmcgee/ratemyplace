---
phase: 16-typed-runtime-foundation
plan: "02"
subsystem: infrastructure
tags: [typescript, runtime, cloudflare, types, env, refactor]
dependency_graph:
  requires: [16-01]
  provides: [zero-any-casts, typed-runtime-complete, INFRA-03-complete]
  affects:
    - src/middleware.ts
    - src/pages/api/**/*.ts (46 files)
    - src/pages/**/*.astro (10 pages)
    - src/components/layout/Header.astro
    - src/pages/api/disputes.ts
    - src/pages/api/disputes/[id].ts
    - src/pages/email-verified.astro
tech_stack:
  added: []
  patterns: [getDB-context-signature, getEnv-context-pattern, Astro-locals-runtime-direct-access]
key_files:
  created: []
  modified:
    - src/middleware.ts
    - src/pages/api/disputes.ts
    - src/pages/api/disputes/[id].ts
    - src/pages/api/places/autocomplete.ts
    - src/pages/api/places/details.ts
    - src/pages/api/auth/signup.ts
    - src/pages/email-verified.astro
decisions:
  - "16-01 + 16-02 ship as one atomic unit — do not deploy between plans; this plan completes the pair"
  - "email-verified.astro (Astro.locals as any).user cast fixed as part of locals as any pattern sweep"
  - "disputes.ts and disputes/[id].ts refactored to full context parameter pattern (not partial destructure)"
metrics:
  duration_minutes: 10
  tasks_completed: 3
  files_changed: 60
  completed_date: "2026-04-27"
---

# Phase 16 Plan 02: Retire All Runtime Casts — Summary

**One-liner:** Eliminated all 83+ `as any` cast sites accessing `runtime` on `context.locals`/`Astro.locals`/`rawLocals` across 60 files; `bash scripts/verify-typed-runtime.sh` exits 0; `npm run build` and all 260 unit tests pass.

## What Was Built

### Task 1: API routes and middleware (47 .ts files)

All `(context.locals as any).runtime` occurrences retired across:
- `src/middleware.ts` — Pattern 3 (defensive guard): replaced with `context.locals.runtime?.env?.DB` optional chain + `getDB(context)`
- 46 API route files: replaced `getDB((context.locals as any).runtime)` with `getDB(context)`
- Added `getEnv` import and `getEnv(context).VAR` calls to files with env var access:
  - `forgot-password.ts`, `resend-verification.ts`: RESEND_API_KEY + SITE_URL
  - `google.ts`, `google/callback.ts`: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  - `signin.ts`, `signup.ts`, `reviews.ts`, `bug-reports.ts`, `contact.ts`: TURNSTILE_SECRET_KEY
  - `places/autocomplete.ts`, `places/details.ts`: GOOGLE_PLACES_API_KEY with OR fallback
  - `verification/upload.ts`, `admin/verification/[id].ts`: VERIFICATION_BUCKET via `getEnv(context).VERIFICATION_BUCKET`

**Pitfall #4 fix:** `signup.ts` had a duplicate `const runtime = (context.locals as any).runtime` declaration inside an inner try block. The inner declaration was removed; all three cast sites now use `getEnv(context)`.

**Additional fix:** `resend-verification.ts` had `(context.locals as any).user` — replaced with `context.locals.user` (now typed).

### Task 2: .astro pages and components (11 files)

All `(Astro.locals as any).runtime` occurrences retired:
- Pattern: `getDB((Astro.locals as any).runtime)` → `Astro.locals.runtime.env.DB`
- Pattern: `runtime?.env?.GOOGLE_MAPS_API_KEY` → `Astro.locals.runtime.env.GOOGLE_MAPS_API_KEY`
- Removed `import { getDB } from '...' ` from 8 .astro files where `getDB` was no longer used
- Files updated: `search.astro`, `review/new.astro`, `profile.astro`, `map.astro`, `building/[slug].astro`, `admin/index.astro`, `admin/contact.astro`, `Header.astro`, `property-manager/[slug].astro`, `landlord/[slug].astro`, `review/edit/[id].astro`

### Task 3: disputes.ts and disputes/[id].ts; full verification gate

Refactored both disputes files from destructured `{ request, locals: rawLocals }` pattern to full `context: APIContext` parameter:
- `disputes.ts` POST/GET: now `(context: APIContext) => { const { request } = context; ... getDB(context) ... getEnv(context).RESEND_API_KEY }`
- `disputes/[id].ts` PATCH: now `(context: APIContext) => { const { params, request } = context; ... getDB(context) ... getEnv(context).RESEND_API_KEY }`

**Bonus fix found during verification:** `email-verified.astro` had `(Astro.locals as any).user` — the verification script's `locals as any` pattern caught it. Fixed with `Astro.locals.user`.

## Cast Retirement Summary

| Variant | Count | Files |
|---------|-------|-------|
| `(context.locals as any).runtime` | 70 | 46 API routes + middleware |
| `(Astro.locals as any).runtime` | 11 | 10 pages + 1 component |
| `rawLocals as any` | 6 | disputes.ts (2) + disputes/[id].ts (1) |
| `locals as any` (user cast) | 2 | resend-verification.ts + email-verified.astro |
| **Total** | **89** | **~60 files** |

## Final Verification Script Output

```
OK: no cast variants found in src/
Exit code: 0
```

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build` exits 0 | PASS |
| `bash scripts/verify-typed-runtime.sh` exits 0 | PASS |
| `npm test` — 260 tests | PASS |
| `grep context.locals as any` returns 0 matches | PASS |
| `grep Astro.locals as any` returns 0 matches | PASS |
| `grep rawLocals as any` returns 0 matches | PASS |
| `grep locals as any` returns 0 matches | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed (Astro.locals as any).user cast in email-verified.astro**
- **Found during:** Task 3 (verification script run)
- **Issue:** `email-verified.astro` had `(Astro.locals as any).user` which the `locals as any` grep pattern caught
- **Fix:** Replaced with `Astro.locals.user` (now typed via App.Locals declaration from 16-01)
- **Files modified:** `src/pages/email-verified.astro`
- **Commit:** 49c61f1

**2. [Rule 1 - Bug] Fixed (context.locals as any).user cast in resend-verification.ts**
- **Found during:** Task 1
- **Issue:** `resend-verification.ts` had `const user = (context.locals as any).user` even though `context.locals.user` is now typed
- **Fix:** Replaced with `context.locals.user`
- **Files modified:** `src/pages/api/auth/resend-verification.ts`
- **Commit:** c7666f1

## Pitfalls Encountered

1. **signup.ts duplicate runtime variable (pitfall #4):** Inner `const runtime = (context.locals as any).runtime` inside a nested try block shadowed the outer one. Both occurrences removed; replaced with `getEnv(context)` calls.

2. **Verification script catches more than runtime casts:** The `locals as any` pattern is broad — it also caught user casts. Fixed these as correct behavior (they were real `any` casts worth eliminating).

3. **admin/verification/[id].ts had 4 cast sites:** Two `getDB` calls and two `VERIFICATION_BUCKET` env accesses. Required adding `getEnv` import and replacing all four independently.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | c7666f1 | retire all (context.locals as any).runtime casts in API routes and middleware |
| Task 2 | 5891e03 | retire all (Astro.locals as any).runtime casts in .astro pages and components |
| Task 3 | 49c61f1 | retire rawLocals destructure in disputes files; verify full retirement |

## Deploy Note

16-01 + 16-02 ship as one atomic unit. This plan completes INFRA-03. Safe to deploy after 16-02 lands.

## Self-Check: PASSED
