---
phase: 13-tenant-dashboard-core
plan: 01
subsystem: database, ui, api
tags: [notifications, d1, sqlite, react, tailwind, disputes]

# Dependency graph
requires: []
provides:
  - notifications table with CHECK constraint on event_type and partial index on unread
  - notification_opt_in column on users table (DEFAULT 1, CAN-SPAM compliance)
  - createNotification() best-effort helper with typed EVENT_MESSAGES record
  - UserReview type extended with moderation_notes and has_open_dispute
  - /api/reviews/user extended with LEFT JOIN disputes and moderation_notes
  - ReviewListItem with Disputed badge (violet), rejection banner, and Edit & Resubmit CTA
affects: [13-02, 13-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "createNotification follows same best-effort try/catch pattern as createAuditLog"
    - "has_open_dispute derived from LEFT JOIN rather than stored as status value"
    - "Disputed badge checks has_open_dispute BEFORE status switch to take priority"

key-files:
  created:
    - migrations/0021_reserved.sql
    - src/lib/notifications.ts
    - src/lib/__tests__/notifications.test.ts
  modified:
    - src/lib/api-types.ts
    - src/pages/api/reviews/user.ts
    - src/components/profile/ReviewListItem.tsx

key-decisions:
  - "Migration 0021 was already marked applied (from SELECT 1 stub) so DDL was executed directly via wrangler d1 execute --file"
  - "has_open_dispute derived via LEFT JOIN disputes WHERE status=pending, not a stored column"
  - "Rejected banner only shown when not also disputed — disputed takes priority in getStatusBadge"
  - "View link on ReviewListItem shown only for approved reviews (not all statuses)"

patterns-established:
  - "Notification helper: best-effort async with console.error, never throws"
  - "Dispute-derived badge: check has_open_dispute before status switch statement"

requirements-completed: [DASH-01, DASH-02, DASH-03]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 13 Plan 01: Notifications DB Foundation and Review Status Dashboard Summary

**Notifications table (migration 0021) with createNotification helper, plus review status visibility — Disputed badge, rejection reason banner, and Edit & Resubmit CTA — delivered to tenant dashboard.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-22T04:57:09Z
- **Completed:** 2026-03-22T05:00:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Notifications table created in local D1 with event_type CHECK constraint, partial index on unread rows, and notification_opt_in on users (CAN-SPAM ready)
- createNotification() helper with 4 typed EVENT_MESSAGES and best-effort error swallowing — matches createAuditLog pattern
- 4 unit tests added (219 total passing)
- UserReview extended with moderation_notes + has_open_dispute, API extended with LEFT JOIN disputes
- ReviewListItem now shows violet Disputed badge (priority over status), red rejection banner with Edit & Resubmit link, and View link gated to approved-only

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0021, createNotification helper, and unit tests** - `f968ee2` (feat)
2. **Task 2: Review status API enhancement and ReviewListItem UI update** - `58a32cb` (feat)

**Plan metadata:** (docs commit follows)

_Note: Task 1 used TDD — tests written first (RED), then implementation (GREEN)._

## Files Created/Modified
- `migrations/0021_reserved.sql` - Notifications DDL (CREATE TABLE, 2 indexes, ALTER TABLE users)
- `src/lib/notifications.ts` - createNotification() helper with NotificationEventType and EVENT_MESSAGES
- `src/lib/__tests__/notifications.test.ts` - 4 unit tests covering insert, message content, error swallowing, EVENT_MESSAGES map
- `src/lib/api-types.ts` - UserReview extended with moderation_notes and has_open_dispute fields
- `src/pages/api/reviews/user.ts` - SQL extended with LEFT JOIN disputes and moderation_notes SELECT
- `src/components/profile/ReviewListItem.tsx` - Disputed badge, rejection banner, Edit & Resubmit CTA, View link gated to approved

## Decisions Made
- Migration 0021 was already marked as applied in d1_migrations (it contained only `SELECT 1;` from the placeholder). Applied DDL directly via `wrangler d1 execute --file` rather than through the migrations command.
- `has_open_dispute` derived from LEFT JOIN on disputes where status='pending' — not stored as a reviews column. Keeps disputes table as the source of truth.
- Rejected banner is only shown when `!has_open_dispute` — when a review is both rejected and disputed, the Disputed badge takes full priority in the UI to avoid confusing mixed signals.
- View link shown only for approved reviews (simpler, avoids linking to building pages where the review isn't live).

## Deviations from Plan

None — plan executed exactly as written, with one environmental workaround (migration already marked applied, used `--file` execution directly).

## Issues Encountered
- Migration 0021 was pre-marked as applied when it was a stub `SELECT 1;`. Wrangler's `migrations apply` correctly skipped it. Worked around by running `wrangler d1 execute --file` directly against the local DB — all 4 statements executed successfully.

## User Setup Required
None - no external service configuration required. Migration must be applied to production before Plan 03 ships.

## Next Phase Readiness
- Plan 02: Notification preferences UI can be built; notifications table and notification_opt_in column exist
- Plan 03: createNotification() is ready to be wired into review approval/rejection/dispute admin actions
- All 219 tests passing, build clean

---
*Phase: 13-tenant-dashboard-core*
*Completed: 2026-03-22*
