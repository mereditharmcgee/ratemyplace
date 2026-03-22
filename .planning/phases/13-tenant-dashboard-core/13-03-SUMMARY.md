---
phase: 13-tenant-dashboard-core
plan: 03
subsystem: api, ui, notifications
tags: [notifications, react, astro, d1, sqlite, header]

# Dependency graph
requires: [13-01]
provides:
  - createNotification wired into admin review approve/reject (PATCH /api/admin/reviews/[id])
  - createNotification wired into dispute resolution (PATCH /api/disputes/[id])
  - GET /api/notifications — returns user notifications (last 50, newest first)
  - PATCH /api/notifications — batch mark-all-read
  - NotificationsTab.tsx — event icons, timeAgo, unread bg-blue-50 tint, empty state
  - ProfileDashboard notifications tab with lazy-load and local unread badge clear
  - Header.astro SSR bell icon with red count badge (9+ for overflow)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Notification bell fetched SSR in Header.astro — no client flash on page load"
    - "fetchNotifications fires PATCH mark-all-read as fire-and-forget after GET succeeds"
    - "localUnreadCount useState initialized from server prop, set to 0 after fetch — mirrors BookmarkButton isSaved pattern"

key-files:
  created:
    - src/pages/api/notifications/index.ts
    - src/components/profile/NotificationsTab.tsx
  modified:
    - src/pages/api/admin/reviews/[id].ts
    - src/pages/api/disputes/[id].ts
    - src/components/layout/Header.astro

key-decisions:
  - "createNotification called after createAuditLog in both admin routes — best-effort, never throws so success response is unaffected"
  - "Bell icon in desktop nav links to /profile (opens dashboard where user can switch to Notifications tab)"
  - "Mobile nav shows bell icon inline before Profile text with same count — avoids a separate standalone bell link in mobile"
  - "NotificationsTab lazy-loads on first tab switch and caches via notificationsLoaded flag — matches saved buildings pattern"

requirements-completed: [DASH-06, DASH-07]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 13 Plan 03: Notifications Wiring and Header Bell Badge Summary

**createNotification wired into admin review and dispute resolution routes, notifications API (GET/PATCH), NotificationsTab with event icons and timeAgo, and server-side bell badge with red count in Header.astro.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-22T15:43:22Z
- **Completed:** 2026-03-22T15:48:34Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `createNotification` imported and called in PATCH `/api/admin/reviews/[id]` — fires on `approved` or `rejected` status with a JOIN query for `user_id` and `building.address`
- `createNotification` imported and called in PATCH `/api/disputes/[id]` — fires after audit log with a 3-table JOIN for `review_id`, `user_id`, `address`
- GET `/api/notifications` — auth-gated, returns last 50 notifications newest-first from D1
- PATCH `/api/notifications` — auth-gated, bulk-marks all unread as read via `unixepoch()`
- `NotificationsTab.tsx` (130 lines) — 4 event icons (green check, red X, violet flag, blue info), `timeAgo()` helper, unread `bg-blue-50` left-tint, empty state
- `ProfileDashboard.tsx` — notifications state, `fetchNotifications` (GET then fire-and-forget PATCH), Notifications tab button with live badge count, lazy-load cache
- `Header.astro` — SSR D1 query for unread count, bell SVG + red badge in desktop nav and mobile nav; badge shows `9+` for counts > 9

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire createNotification + notifications API** — `d6a9a5a` (feat)
2. **Task 2: NotificationsTab + Header bell badge** — `dccffc5` (feat)

## Files Created/Modified

- `src/pages/api/notifications/index.ts` — GET (list) and PATCH (mark-all-read) handlers
- `src/components/profile/NotificationsTab.tsx` — notification list with event icons, timeAgo, unread tint, empty state
- `src/pages/api/admin/reviews/[id].ts` — added createNotification import and call after audit log on approve/reject
- `src/pages/api/disputes/[id].ts` — added createNotification import and call after audit log on dispute resolution
- `src/components/layout/Header.astro` — SSR getDB import, unread count query, bell icon + badge in desktop and mobile nav

## Decisions Made

- `createNotification` is called after `createAuditLog` and before the success response — best-effort (never throws), so admin action always succeeds even if notification insert fails
- Bell icon in desktop nav links directly to `/profile` (user clicks through to Notifications tab)
- `localUnreadCount` initialized from SSR prop, set to 0 after `fetchNotifications` completes — avoids stale badge after viewing the tab without a full page reload
- Mobile nav shows bell icon inline with the Profile link text to keep mobile nav compact

## Deviations from Plan

None — plan executed exactly as written. The linter integrated Plan 02's SettingsTab additions into ProfileDashboard during this session, but those changes were already committed by Plan 02 and required no additional work.

## Self-Check: PASSED

- `src/pages/api/notifications/index.ts` — FOUND
- `src/components/profile/NotificationsTab.tsx` — FOUND
- `src/components/layout/Header.astro` — FOUND
- Commit `d6a9a5a` — FOUND
- Commit `dccffc5` — FOUND
- Build: clean (no errors)
- Tests: 234 passing

---
*Phase: 13-tenant-dashboard-core*
*Completed: 2026-03-22*
