---
phase: 18-csrf-audit-and-async-email
plan: 02
subsystem: api
tags: [cloudflare-workers, waitUntil, fire-and-forget, async-email, perf, signup, forgot-password, resend-verification, contact, disputes]

# Dependency graph
requires:
  - phase: 18-01
    provides: fireAndForget(context, promise): void and recipientHash helpers in src/lib/runtime.ts
provides:
  - signup.ts with non-blocking email (fireAndForget)
  - forgot-password.ts with non-blocking email (fireAndForget)
  - resend-verification.ts with non-blocking email (fireAndForget); always returns 200
  - contact.ts with both emails fire-and-forgot
  - disputes.ts with non-blocking email; resendApiKey guard preserved
  - REQUIREMENTS.md PERF-01 companion note for resend-verification
affects:
  - All five public/auth email flows now return responses before Resend resolves

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "fireAndForget call site: fireAndForget(context, sendXxxEmail(apiKey, siteUrl, email, token)) — import added to each route"
    - "DB-then-email: token/record INSERT committed before fireAndForget called — enforced at all 5 sites"
    - "resend-verification always 200: email failure is logged via logError in fireAndForget; user retries via resend button"

key-files:
  created: []
  modified:
    - src/pages/api/auth/signup.ts
    - src/pages/api/auth/forgot-password.ts
    - src/pages/api/auth/resend-verification.ts
    - src/pages/api/contact.ts
    - src/pages/api/disputes.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "resend-verification.ts behavior change: 500 on email failure removed; always returns 200 — sanctioned by CONTEXT.md; users have explicit resend buttons"
  - "disputes.ts if (resendApiKey) guard preserved — cheap, defensive, out-of-scope to remove per CONTEXT.md"
  - "contact.ts both emails converted in same commit — confirmation and notification both fire-and-forgot"
  - "signup.ts inner try/catch around email removed; outer DB try/catch preserved — DB errors still bubble correctly"

patterns-established:
  - "All email-send sites in api routes now use fireAndForget(context, sendXxxEmail(...)) — no await sendXxxEmail pattern remaining in these 5 files"

requirements-completed:
  - PERF-01
  - PERF-02
  - PERF-03
  - PERF-04

# Metrics
duration: 20min
completed: 2026-04-28
---

# Phase 18 Plan 02: Convert all five blocking email-send sites to fireAndForget

**Five routes converted from await-blocking email to fire-and-forget — 322/322 unit tests green, TypeScript build clean, 10/10 Phase 17 E2E tests green**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-28T19:53:11Z
- **Completed:** 2026-04-28T20:13:18Z
- **Tasks:** 3
- **Files modified:** 6 (5 routes + REQUIREMENTS.md)

## Accomplishments

- Converted 5 API routes from `await sendXxxEmail(...)` to `fireAndForget(context, sendXxxEmail(...))` — responses now return before Resend resolves
- DB-then-email ordering verified and preserved at every site
- Behavior change documented in code, REQUIREMENTS.md, and SUMMARY: resend-verification.ts now always returns 200 (previously returned 500 on email failure)
- disputes.ts `if (resendApiKey)` guard preserved as required
- contact.ts both confirmation and notification emails converted in same atomic commit
- REQUIREMENTS.md PERF-01 updated with companion note about resend-verification
- 322/322 unit tests green (zero regressions)
- TypeScript build clean
- All 10 Phase 17 E2E tests green under `--no-deps` mode

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert auth routes (signup, forgot-password, resend-verification)** - `ac4b288` (feat)
2. **Task 2: Convert public routes (contact, disputes)** - `7456ebe` (feat)
3. **Task 3: Append companion note to PERF-01 in REQUIREMENTS.md** - `ab9e98d` (docs)

## Per-Route Diff Summary

| File | Emails converted | Pattern before | Pattern after |
|------|-----------------|----------------|---------------|
| `src/pages/api/auth/signup.ts` | 1 | `await sendVerificationEmail(...)` + `if (!emailResult.success)` block | `fireAndForget(context, sendVerificationEmail(...))` |
| `src/pages/api/auth/forgot-password.ts` | 1 | `await sendPasswordResetEmail(...)` + `if (!emailResult.success)` block | `fireAndForget(context, sendPasswordResetEmail(...))` |
| `src/pages/api/auth/resend-verification.ts` | 1 | `await sendVerificationEmail(...)` + `if (!success) return 500` | `fireAndForget(...)` — always returns 200 (BEHAVIOR CHANGE) |
| `src/pages/api/contact.ts` | 2 | `await sendContactConfirmationEmail(...).catch(...)` + `await sendContactNotificationEmail(...).catch(...)` | Two `fireAndForget(...)` calls |
| `src/pages/api/disputes.ts` | 1 | `if (resendApiKey) { try { await sendDisputeConfirmationEmail(...) } catch(...) }` | `if (resendApiKey) { fireAndForget(...) }` — guard preserved |

## REQUIREMENTS.md Change

**PERF-01 before:**
```
- [x] **PERF-01**: `/api/auth/signup` converted to `ctx.waitUntil(emailPromise.catch(logError))` with null guard for local Wrangler dev
```

**PERF-01 after:**
```
- [x] **PERF-01**: `/api/auth/signup` converted to `ctx.waitUntil(emailPromise.catch(logError))` with null guard for local Wrangler dev. Companion: `/api/auth/resend-verification` gets the same treatment for consistency (behavior change: previously returned 500 on email failure, now always returns 200 — users have explicit resend buttons).
```

## Behavior Change Documentation — resend-verification.ts

**File:** `src/pages/api/auth/resend-verification.ts`
**Change:** Route previously returned `{ status: 500 }` when `sendVerificationEmail` reported `success: false`. It now always returns `{ status: 200 }`.
**Rationale (from CONTEXT.md):** Silent email failure is acceptable because users have an explicit resend button. They can click it again and the next attempt typically succeeds. Returning 500 was misleading — the verification token was created successfully in the DB; only the email delivery was uncertain.
**Inline comment added:**
```typescript
// Phase 18 PERF-01 (companion): email is fire-and-forgot. Always return 200 —
// failures log via logError in fireAndForget; user can click resend button to retry.
// BEHAVIOR CHANGE: previously returned 500 on email failure; now always returns 200.
```

## DB-then-Email Ordering Confirmation

| Route | DB write | Email call |
|-------|----------|------------|
| signup.ts | `createVerificationToken(db, userId)` — token row inserted | `fireAndForget(context, sendVerificationEmail(...))` — called after token exists in DB |
| forgot-password.ts | `createPasswordResetToken(db, user.id)` — reset token row inserted | `fireAndForget(context, sendPasswordResetEmail(...))` — called after token exists |
| resend-verification.ts | `createVerificationToken(db, user.id)` — new token created/replaced | `fireAndForget(context, sendVerificationEmail(...))` — called after token exists |
| contact.ts | `INSERT INTO contact_messages` — message row committed | Two `fireAndForget` calls — both after INSERT |
| disputes.ts | `INSERT INTO disputes` — dispute row committed | `fireAndForget` inside `if (resendApiKey)` — called after INSERT |

All five routes have DB writes committed before `fireAndForget` is called. DB-then-email ordering locked per CONTEXT.md.

## Test Results

```
npm test (full suite)
Test Files  17 passed (17)
      Tests  322 passed (322)
Duration:   1.24s

npm run build
[build] Complete! (exit 0 — zero TypeScript errors)

npx playwright test security.spec.ts --no-deps --grep "Phase 17"
10 passed (21.9s)
```

## Deferred Items

- `src/pages/api/disputes/[id].ts` contains `await sendDisputeUpheldEmail(...)` — this admin-only endpoint for updating dispute status was NOT in the scope of this plan (plan scope: the 5 files in the frontmatter). It follows the same blocking pattern and should be converted in a future pass.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 5 routes in scope are converted; REQUIREMENTS.md updated
- Phase 18 PERF-01 through PERF-04 all complete
- Deferred: `disputes/[id].ts` admin endpoint for future follow-up
- No blockers for Phase 19

## Self-Check: PASSED

- All 7 required files exist on disk
- All 3 task commits (ac4b288, 7456ebe, ab9e98d) present in git log
- Zero `await send*Email` in all 5 target route files
- PERF-01 companion note present in REQUIREMENTS.md

---
*Phase: 18-csrf-audit-and-async-email*
*Completed: 2026-04-28*
