---
phase: 02-landlord-disputes
plan: 03
subsystem: disputes
tags: [admin, ui, api]
dependency_graph:
  requires: [disputes-schema, disputes-utilities, disputes-emails]
  provides: [admin-disputes-queue, dispute-resolution-api]
  affects: [admin-workflow]
tech_stack:
  added: []
  patterns: [react-hooks, side-by-side-layout, admin-authorization]
key_files:
  created:
    - src/pages/admin/disputes.astro
    - src/components/admin/DisputesQueue.tsx
    - src/pages/api/disputes/[id].ts
  modified:
    - src/pages/api/disputes.ts
decisions:
  - "Added GET handler to existing disputes.ts API (created by plan 02-02)"
  - "Fixed datetime('now') to unixepoch() for timestamp consistency with schema"
  - "Required resolution notes field per plan specification"
  - "Side-by-side layout: dispute details left, review details right"
metrics:
  duration: 313
  completed: "2026-02-27T02:21:44Z"
---

# Phase 2 Plan 3: Admin Disputes Queue Summary

**One-liner:** Admin page for reviewing and resolving landlord disputes with side-by-side dispute/review comparison

## Overview

Built the admin disputes queue at /admin/disputes where admins can view all landlord disputes, see original reviews alongside dispute details, and resolve disputes with outcome selection and required notes. Upheld disputes automatically trigger email notifications to landlords.

## Tasks Completed

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Create admin disputes page | ✅ Complete | 3bbce77 |
| 2 | Create DisputesQueue React component | ✅ Complete | 227bedf |
| 3 | Add GET handler and resolution endpoint | ✅ Complete | 14aa085 |

### Task 1: Create admin disputes page (3bbce77)

Created `src/pages/admin/disputes.astro` following existing admin page pattern:
- Imported AdminLayout and DisputesQueue component
- Added auth guards (redirect to /auth/signin if not logged in, redirect to / if not admin)
- Page title: "Dispute Queue" with description
- DisputesQueue component with client:load directive

**Files created:**
- src/pages/admin/disputes.astro (27 lines)

### Task 2: Create DisputesQueue React component (227bedf)

Created `src/components/admin/DisputesQueue.tsx` following ReviewsTable pattern:
- Filter bar: Pending/Resolved/All with counts
- Sort toggle: Oldest First / Newest First
- Disputes list with expandable rows
- Side-by-side expanded view:
  - LEFT: Landlord info, dispute reasons (parsed from JSON), explanation, submission date
  - RIGHT: Review details (building, score, title, text), link to full review
- Resolution form for pending disputes:
  - Outcome select: Dismiss, Uphold, Partially Valid
  - Required notes textarea
  - Disabled submit if notes empty
- Loading spinner and error states matching existing patterns
- Updates local state after resolution

**Files created:**
- src/components/admin/DisputesQueue.tsx (461 lines)

### Task 3: Add GET handler and resolution endpoint (14aa085)

Added GET handler to existing `src/pages/api/disputes.ts` and created resolution endpoint:

**Modified src/pages/api/disputes.ts:**
- Added GET handler for admin dispute queue
- Auth guard: returns 401 if not authenticated, 403 if not admin
- Query with joins: disputes + reviews + buildings
- Returns disputes array with building_address, review_text, review_title, review_overall_score
- Fixed bug: changed `datetime('now')` to `unixepoch()` in POST handler for timestamp consistency

**Created src/pages/api/disputes/[id].ts:**
- PATCH handler for dispute resolution (admin only)
- Validates outcome: 'uphold', 'dismiss', or 'partially_valid'
- Validates resolution notes are required (non-empty string)
- Returns 404 if dispute not found
- Updates dispute: status='resolved', outcome, notes, resolved_at, resolved_by (user.id)
- Sends upheld notification email if outcome is 'uphold'
- Best-effort email sending (logs errors but doesn't fail request)

**Files modified:**
- src/pages/api/disputes.ts (+64 lines, 1 bug fix)

**Files created:**
- src/pages/api/disputes/[id].ts (117 lines)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed timestamp function inconsistency**
- **Found during:** Task 3 - reviewing existing POST handler
- **Issue:** POST handler used `datetime('now')` which returns ISO string, but schema expects unix timestamp (INTEGER)
- **Fix:** Changed to `unixepoch()` to match database schema and other timestamp fields
- **Files modified:** src/pages/api/disputes.ts
- **Commit:** 14aa085 (included in Task 3)

**2. [Rule 3 - Blocking] Added updated_at to INSERT statement**
- **Found during:** Task 3 - reviewing existing POST handler
- **Issue:** INSERT didn't include updated_at column, would fail since table has this column
- **Fix:** Added `updated_at = unixepoch()` to INSERT statement
- **Files modified:** src/pages/api/disputes.ts
- **Commit:** 14aa085 (included in Task 3)

## Verification Results

All verification criteria met:

- ✅ /admin/disputes redirects non-admins to signin (auth guard in place)
- ✅ Admin can see list of disputes (GET handler returns joined data)
- ✅ Filter by Pending/Resolved/All works (statusFilter state)
- ✅ Sort by oldest/newest works (sortOrder state)
- ✅ Clicking dispute expands to show details (expandedDispute state)
- ✅ Side-by-side layout shows dispute on left, review on right (grid layout)
- ✅ Resolution form appears for pending disputes (conditional rendering)
- ✅ Notes field is required for resolution (validation + disabled button)
- ✅ Uphold/Dismiss/Partially Valid options available (select dropdown)
- ✅ Resolving dispute updates status in list (local state update)
- ✅ Upheld disputes send email to landlord (sendDisputeUpheldEmail call)

## Success Criteria

All criteria achieved:

- ✅ Admin queue shows disputes with building, date, status, reason snippet
- ✅ Admins can filter and sort the queue
- ✅ Expanded view shows full dispute alongside original review
- ✅ Resolution requires selecting outcome and writing notes
- ✅ Upheld disputes trigger landlord notification email
- ✅ Non-admins cannot access queue or resolve disputes

## Technical Notes

**Component Architecture:**
Followed existing ReviewsTable pattern for consistency:
- Same filter button styling (teal active, gray inactive)
- Same loading spinner (teal border-b-2)
- Same error box styling (red-50 background)
- Same expandable row pattern with chevron rotation
- Same action button patterns

**Side-by-Side Layout:**
Used grid-cols-1 lg:grid-cols-2 for responsive layout:
- Stacks vertically on mobile
- Side-by-side on desktop
- Left border between columns on desktop (lg:border-l)

**JSON Parsing:**
Dispute reasons stored as JSON array in database, parsed to bullet list:
- parseReasons() helper with try/catch for safety
- Returns empty array if parsing fails
- Displays as unordered list with list-disc styling

**Email Integration:**
Upheld disputes trigger automatic notification:
- Only sent when outcome is 'uphold'
- Uses existing sendDisputeUpheldEmail from plan 02-01
- Best-effort sending (logs errors, doesn't fail request)
- Warns if RESEND_API_KEY not configured

**Timestamp Fix:**
Fixed critical bug in existing POST handler:
- Schema expects unix timestamp (INTEGER)
- Code was using datetime('now') which returns ISO string
- Changed to unixepoch() for consistency
- Also added missing updated_at column

## What's Next

This completes the core landlord disputes feature:
- Plan 01: Database schema, utilities, emails ✅
- Plan 02: Public dispute form ✅ (executed concurrently)
- Plan 03: Admin queue and resolution ✅

The feature is now ready for testing and UAT. Admins can:
1. View all disputes in filterable/sortable queue
2. Compare disputes against original reviews
3. Resolve with outcome and required notes
4. Automatically notify landlords when upheld

## Files Summary

**Created (3 files):**
- src/pages/admin/disputes.astro - Admin disputes queue page
- src/components/admin/DisputesQueue.tsx - React disputes queue component
- src/pages/api/disputes/[id].ts - PATCH endpoint for resolution

**Modified (1 file):**
- src/pages/api/disputes.ts - Added GET handler, fixed timestamp bug

**Total changes:** +605 lines (3 new files, 1 modified file)

## Self-Check: PASSED

**Files verified:**
- ✅ src/pages/admin/disputes.astro exists
- ✅ src/components/admin/DisputesQueue.tsx exists
- ✅ src/pages/api/disputes/[id].ts exists
- ✅ src/pages/api/disputes.ts modified

**Commits verified:**
- ✅ 3bbce77 exists (Task 1: admin disputes page)
- ✅ 227bedf exists (Task 2: DisputesQueue component)
- ✅ 14aa085 exists (Task 3: GET handler and resolution endpoint)
