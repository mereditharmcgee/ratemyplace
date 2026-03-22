---
phase: 13-tenant-dashboard-core
plan: 02
subsystem: ui, api
tags: [react, tailwind, settings, auth, password, notifications, d1]

# Dependency graph
requires:
  - phase: 13-01
    provides: notification_opt_in column on users table
provides:
  - src/lib/userSettings.ts with validateDisplayName, validatePassword, validateEmail pure helpers
  - PATCH /api/user/profile — update display name and notification_opt_in
  - PATCH /api/user/password — change or set password (OAuth users get set flow; regular users get change flow with session invalidation)
  - PATCH /api/user/email — email change with current password verification; blocks Google OAuth users
  - SettingsTab.tsx React component with four form sections
  - ProfileDashboard extended with settings tab and hasPassword/isGoogleUser/notificationOptIn props
  - profile.astro query extended to fetch hashed_password, google_id, notification_opt_in
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Settings API routes follow same auth check pattern as all other user routes"
    - "Validation helpers are pure functions in src/lib/userSettings.ts — importable for unit tests"
    - "OAuth user edge cases handled at API boundary: set password (no current password required), email read-only"
    - "Session invalidation via lucia.invalidateUserSessions after password change forces re-auth"

key-files:
  created:
    - src/lib/userSettings.ts
    - src/lib/__tests__/userSettings.test.ts
    - src/pages/api/user/profile.ts
    - src/pages/api/user/password.ts
    - src/pages/api/user/email.ts
    - src/components/profile/SettingsTab.tsx
  modified:
    - src/components/profile/ProfileDashboard.tsx
    - src/pages/profile.astro

key-decisions:
  - "Validation helpers extracted to src/lib/userSettings.ts as pure functions so they are unit-testable without mocking HTTP context"
  - "OAuth set-password flow skips currentPassword requirement — google_id non-null + hashed_password null is the gate"
  - "Email change resets email_verified to 0 — user must re-verify after changing email"
  - "Password change calls lucia.invalidateUserSessions so all existing sessions expire; frontend redirects to /auth/signin on success"
  - "SettingsTab sections each have independent state — one form failing does not affect others"

patterns-established:
  - "User settings validation: pure functions returning { valid, value?, error? } union"
  - "OAuth user detection: google_id !== null && hashed_password === null"

requirements-completed: [DASH-04]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 13 Plan 02: Account Settings Tab Summary

**Settings tab with PATCH /api/user/profile, /api/user/password, /api/user/email — display name, notification prefs, password change/set, and email change with OAuth-aware handling.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-22T15:43:25Z
- **Completed:** 2026-03-22T15:47:49Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Three new API endpoints following established auth check pattern with parameterized queries and input validation
- 15 unit tests for pure validation helpers (TDD: RED then GREEN)
- SettingsTab.tsx with four independent form sections: display name, notification preferences, password (change or set for OAuth), email (read-only for OAuth users)
- ProfileDashboard extended with Settings tab button and content; `settings` added to ActiveTab union
- profile.astro query extended to fetch hashed_password, google_id, notification_opt_in server-side; new props computed and passed
- All 234 tests passing (was 219 before Phase 13)

## Task Commits

Each task was committed atomically:

1. **Task 1: Settings API endpoints with validation tests** - `54d77e0` (feat)
2. **Task 2: SettingsTab component and ProfileDashboard integration** - `999efbb` (feat)

**Plan metadata:** (docs commit follows)

_Note: Task 1 used TDD — tests written first (RED), then implementation (GREEN)._

## Files Created/Modified
- `src/lib/userSettings.ts` - Pure validation helpers: validateDisplayName, validatePassword, validateEmail
- `src/lib/__tests__/userSettings.test.ts` - 15 unit tests covering all three validators
- `src/pages/api/user/profile.ts` - PATCH endpoint: update name and notification_opt_in
- `src/pages/api/user/password.ts` - PATCH endpoint: change/set password with session invalidation
- `src/pages/api/user/email.ts` - PATCH endpoint: change email with password verification, blocks OAuth
- `src/components/profile/SettingsTab.tsx` - React component with four settings form sections
- `src/components/profile/ProfileDashboard.tsx` - Added SettingsTab import, settings ActiveTab variant, Settings button, new props
- `src/pages/profile.astro` - Extended DB query, computed hasPassword/isGoogleUser/notificationOptIn, pass to ProfileDashboard

## Decisions Made
- Extracted validation into `src/lib/userSettings.ts` as pure functions so they can be unit tested without any HTTP context mocking — follows the same pattern as `src/lib/audit.ts` and `src/lib/notifications.ts`.
- OAuth users detect as "set password" flow when `google_id !== null && hashed_password === null`. The API handles both branches explicitly.
- Email change resets `email_verified = 0` — enforces re-verification on new email, consistent with the existing sign-up flow.
- Password change calls `lucia.invalidateUserSessions` to force re-authentication. The frontend component detects the "sign in again" message and redirects after 2 seconds.
- Each SettingsTab section has independent `useState` and submit handler — a failed save in one section cannot affect the state of another.

## Deviations from Plan

One environmental deviation: ProfileDashboard and profile.astro had already been updated by Plan 13-03 (NotificationsTab). The new Settings tab was integrated cleanly on top of that state — no conflict, just additive. The plan's target interface matched what was needed.

## Issues Encountered
- ProfileDashboard.tsx had been modified since the plan was written (NotificationsTab and unreadNotificationCount added by Plan 13-03). Adjusted the integration to work with the current file state rather than the snapshot in the plan. No logic changes required.

## User Setup Required
None - no external service configuration required. No migration needed (notification_opt_in column was added by Plan 13-01).

## Next Phase Readiness
- Plan 03: createNotification wiring into admin review actions — foundation complete
- All 234 tests passing, build clean
- Settings tab live at /profile — all four sections functional

## Self-Check: PASSED

All created files exist on disk. Both task commits (54d77e0, 999efbb) confirmed in git log.

---
*Phase: 13-tenant-dashboard-core*
*Completed: 2026-03-22*
