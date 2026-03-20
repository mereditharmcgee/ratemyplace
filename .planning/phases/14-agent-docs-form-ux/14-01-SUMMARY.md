---
phase: 14-agent-docs-form-ux
plan: 01
subsystem: ui
tags: [react, bookmarks, saved-buildings, profile, sqlite, d1]

# Dependency graph
requires: []
provides:
  - saved_buildings table with user_id/building_id/created_at and UNIQUE constraint
  - POST/DELETE /api/buildings/[id]/save endpoints (auth-required, idempotent)
  - GET /api/buildings/saved endpoint with joined score data
  - BookmarkButton React island with toggle, teal/gray icon states, 2s toast
  - ProfileDashboard tabbed layout: My Reviews and Saved Buildings tabs
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "isSaved SSR query pattern: query saved status server-side for initial BookmarkButton state"
    - "Lazy tab fetch with cache: fetch saved buildings only on first tab switch, memoize with savedLoaded flag"
    - "Idempotent save API: UNIQUE constraint violation caught and returns 200 instead of 409"

key-files:
  created:
    - migrations/0023_saved_buildings.sql
    - src/pages/api/buildings/[id]/save.ts
    - src/pages/api/buildings/saved.ts
    - src/components/ui/BookmarkButton.tsx
  modified:
    - src/lib/api-types.ts
    - src/pages/building/[slug].astro
    - src/components/profile/ProfileDashboard.tsx

key-decisions:
  - "UNIQUE constraint on (user_id, building_id) caught in try/catch returning 200 (idempotent) rather than 409"
  - "isSaved queried server-side in Astro frontmatter so BookmarkButton renders correct initial state without client flash"
  - "Saved buildings tab lazy-loads on first switch and caches result in component state — no re-fetch on re-click"
  - "BookmarkButton placed inline with the Write a Review CTA in the building header flex row"

patterns-established:
  - "Idempotent save/unsave: POST returns {saved:true}, DELETE returns {saved:false} regardless of prior state"
  - "Toast cleared via setTimeout in component state — no external library needed"

requirements-completed: [DASH-05]

# Metrics
duration: 5min
completed: 2026-03-20
---

# Phase 14 Plan 01: Building Bookmarks Summary

**Ribbon-style bookmark toggle on building pages backed by saved_buildings D1 table, with Saved Buildings tab in ProfileDashboard using lazy fetch and formatted saved-on dates**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-20T20:52:31Z
- **Completed:** 2026-03-20T20:57:08Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Saved buildings migration (0023) with UNIQUE constraint and user index applied locally
- POST/DELETE save endpoints with auth guard, 404 building check, and idempotent UNIQUE handling
- GET saved buildings endpoint with review_count subquery and building_scores join
- BookmarkButton React island: filled teal when saved, outline gray when not, 2s toast on toggle
- Building page queries isSaved server-side so button renders correct initial state with no flash
- Non-logged-in users see no bookmark icon (conditional render in Astro template)
- ProfileDashboard now has My Reviews / Saved Buildings tab bar with lazy-load and cache

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration, API types, and save/unsave API routes** - `8e03a00` (feat)
2. **Task 2: BookmarkButton component, building page integration, and ProfileDashboard tabs** - `01aa7dd` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `migrations/0023_saved_buildings.sql` - saved_buildings table with UNIQUE(user_id, building_id) and index
- `src/lib/api-types.ts` - Added SavedBuilding and SavedBuildingsResponse interfaces
- `src/pages/api/buildings/[id]/save.ts` - POST (save) and DELETE (unsave) with auth + idempotency
- `src/pages/api/buildings/saved.ts` - GET user's saved buildings with scores joined
- `src/components/ui/BookmarkButton.tsx` - React island with toggle, icon states, toast
- `src/pages/building/[slug].astro` - Added BookmarkButton import, isSaved SSR query, conditional render
- `src/components/profile/ProfileDashboard.tsx` - Tabbed layout with My Reviews and Saved Buildings tabs

## Decisions Made
- UNIQUE constraint violation on double-save caught in try/catch and returned as 200 (idempotent) rather than 409 error — cleaner client UX
- isSaved queried server-side in Astro frontmatter so BookmarkButton renders correct initial state without client-side flash
- Saved buildings tab data is fetched lazily (only on first tab switch) and cached via `savedLoaded` flag — avoids unnecessary requests
- BookmarkButton placed inline with the "Write a Review" CTA in the building header's right-side flex column

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Building bookmarking complete and ready for use
- saved_buildings table is local-only; must apply migration to production before deploying
- ProfileDashboard tabs work client-side; no Astro page changes needed

---
*Phase: 14-agent-docs-form-ux*
*Completed: 2026-03-20*
