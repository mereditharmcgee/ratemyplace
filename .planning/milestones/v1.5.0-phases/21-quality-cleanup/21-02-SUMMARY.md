---
phase: 21-quality-cleanup
plan: 02
subsystem: ui
tags: [react, astro, tailwind, empty-state, component, ux]

# Dependency graph
requires:
  - phase: 20-critical-flow-e2e-coverage
    provides: stable test suite and build baseline this refactor verifies against
provides:
  - Shared EmptyState.astro (SSR) and EmptyState.tsx (React island) components with identical Tailwind markup
  - 6 ad-hoc empty-state blocks consolidated under a single component on 4 user-facing pages
  - Heading-element normalization: building detail empty state promoted from <p> to <h3>
affects: [any future phase that adds empty-state surfaces; style/design system changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parallel .astro + .tsx component twins: SSR and React consumers share identical Tailwind markup via two component files, eliminating SSR/island visual drift"
    - "Astro icon slot pattern: EmptyState.astro accepts icons via <slot name=icon /> (JSX props not valid in Astro); callers use <svg slot=icon> syntax"
    - "Second CTA handled inline: search no-query-results has two buttons; first passes via action prop, second rendered as inline markup outside EmptyState (single-action prop kept simple)"

key-files:
  created:
    - src/components/ui/EmptyState.astro
    - src/components/ui/EmptyState.tsx
    - src/lib/__tests__/EmptyState.test.tsx
  modified:
    - src/pages/search.astro
    - src/pages/building/[slug].astro
    - src/components/profile/ProfileDashboard.tsx
    - src/components/profile/NotificationsTab.tsx

key-decisions:
  - "EmptyState.astro and EmptyState.tsx hold byte-identical Tailwind wrapper/heading/description/action markup; visual parity is structural, not tested by Playwright"
  - "Building-detail empty state heading promoted from <p> to <h3> — explicit ROADMAP criterion 3 approval; no copy changes"
  - "Search no-query-results second CTA button kept as inline markup outside EmptyState — single-action prop prevents array-complexity (RESEARCH Pitfall 4)"
  - "Saved-buildings tab included in refactor (RESEARCH discretion 2) — surface is identical in structure to reviews tab"

patterns-established:
  - "EmptyState pattern: wrapper bg-gray-50 rounded-[6px] p-8 text-center; heading h3 text-lg font-medium text-gray-900; description p text-gray-600; CTA a bg-teal-700 text-white px-4 py-2 rounded-[4px]"

requirements-completed: [UX-01]

# Metrics
duration: 2 sessions (Tasks 1-2 prior session; Task 3 checkpoint approved this session)
completed: 2026-04-28
---

# Phase 21 Plan 02: Shared EmptyState Component Summary

**Parallel EmptyState.astro + EmptyState.tsx twins consolidate 6 ad-hoc empty-state blocks across 4 pages with identical Tailwind markup, normalizing heading levels and locking visual consistency for UX-01**

## Performance

- **Duration:** Multi-session (Tasks 1-2 committed prior session; visual QA checkpoint approved this session)
- **Started:** 2026-04-28
- **Completed:** 2026-04-28
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 7

## Accomplishments

- Created `EmptyState.astro` (SSR) and `EmptyState.tsx` (React island) with byte-identical Tailwind markup — single source of truth for empty-state visual style
- Replaced 6 ad-hoc empty-state blocks across 4 files: search.astro (no-query-results + no-listings-yet), building/[slug].astro (zero-reviews), ProfileDashboard.tsx (reviews tab + saved-buildings tab), NotificationsTab.tsx (no-notifications)
- Promoted building-detail empty-state heading from `<p>` to `<h3>` — structural normalization aligning with all other surfaces
- 7 unit tests for EmptyState.tsx (title, description, action present/absent, icon present/absent, className override) all GREEN; full suite 334 tests passing; build clean

## Task Commits

1. **Task 1: Create EmptyState.astro + EmptyState.tsx + unit tests** - `1cf74cb` (feat)
2. **Task 2: Refactor 6 surfaces to consume EmptyState** - `31121f0` (refactor)
3. **Task 3: Visual QA checkpoint** - user-approved (no code changes required)

**Plan metadata:** (this SUMMARY commit — see docs commit below)

## Files Created/Modified

- `src/components/ui/EmptyState.tsx` — React component; props: title, description, icon (JSX node), action ({label, href}), className
- `src/components/ui/EmptyState.astro` — SSR twin; same props except icon is `<slot name="icon" />` (Astro constraint); identical Tailwind markup
- `src/lib/__tests__/EmptyState.test.tsx` — 7 unit tests via @testing-library/react
- `src/pages/search.astro` — 2 EmptyState invocations (no-query-results + no-listings-yet); second CTA button on no-query-results kept inline outside EmptyState
- `src/pages/building/[slug].astro` — 1 EmptyState invocation (zero-reviews); heading promoted <p> → <h3>
- `src/components/profile/ProfileDashboard.tsx` — 2 EmptyState invocations (reviews tab + saved-buildings tab)
- `src/components/profile/NotificationsTab.tsx` — 1 EmptyState invocation (no-notifications, no action prop)

## Per-Surface Summary

| Surface | File | Before | After | Heading change |
|---------|------|--------|-------|----------------|
| Search no-query-results | search.astro | ~21 lines inline | EmptyState + 4-line second-CTA | `<h2>` → `<h3>` (inside component) |
| Search no-listings-yet | search.astro | ~16 lines inline | EmptyState | `<h2>` → `<h3>` (inside component) |
| Building detail zero-reviews | building/[slug].astro | ~15 lines inline | EmptyState | `<p>` → `<h3>` (structural normalization) |
| Profile reviews tab | ProfileDashboard.tsx | ~15 lines inline | EmptyState | `<h3>` → `<h3>` (no change) |
| Profile saved-buildings tab | ProfileDashboard.tsx | ~15 lines inline | EmptyState | `<h3>` → `<h3>` (no change) |
| Notifications no-notifications | NotificationsTab.tsx | ~12 lines inline | EmptyState | `<h3>` → `<h3>` (no change) |

Net: ~94 lines of inline markup removed, replaced by 6 component invocations.

## Copy and Href Preservation

All title text, description text, and CTA hrefs preserved byte-identical to pre-refactor:

| Surface | Title (preserved) | CTA href (preserved) |
|---------|-------------------|----------------------|
| Search no-query-results | `No properties found for "${query}"` | `/search` |
| Search no-listings-yet | `No reviewed properties yet` | `/review/new` |
| Building detail zero-reviews | `No reviews yet for this building.` | `/review/new?building=${building.id}` |
| Profile reviews tab | `No reviews yet` | `/review/new` |
| Profile saved-buildings tab | `No saved buildings yet` | `/search` |
| Notifications | `No notifications yet` | (no CTA) |

## Visual QA Checkpoint

**Status: APPROVED by user**

Verification method:
- Surface 1 (`/search?q=zzzznoresults`): DOM inspected — wrapper `bg-gray-50 rounded-[6px] p-8 text-center`, background `oklch(0.985 0.002 247.839)`, heading `h3 text-lg font-medium text-gray-900`
- Surface 3 (`/building/test-cross-view-consistency`): DOM inspected — identical wrapper class and background, heading promoted from `<p>` to `<h3>`
- Surfaces 4-6 (ProfileDashboard reviews + saved, NotificationsTab): source-code review confirmed all render the same `<EmptyState>` React component; both EmptyState.astro and EmptyState.tsx emit byte-identical Tailwind markup; visual parity structurally guaranteed

## Decisions Made

- EmptyState.tsx and EmptyState.astro use byte-identical Tailwind strings — SSR consumers (Astro pages) and React-island consumers (ProfileDashboard, NotificationsTab) produce identical DOM without Playwright cross-verification
- Building-detail heading `<p>` → `<h3>`: explicit ROADMAP criterion 3 approval; copy unchanged
- Search no-query-results second button (`Or add a new review`) rendered inline outside the EmptyState — action prop is intentionally single-action to avoid array-complexity (RESEARCH Pitfall 4)
- Saved-buildings tab included per RESEARCH discretion 2 — surface is structurally identical to reviews tab; consistent treatment required

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- UX-01 complete; EmptyState component available for any future empty surfaces
- Phase 21 plan 02 is the final plan in the phase; all phase 21 requirements (SEC-07, SEC-08, UX-01) are complete
- No blockers for next milestone

## Self-Check: PASSED

- src/components/ui/EmptyState.astro: FOUND
- src/components/ui/EmptyState.tsx: FOUND
- src/lib/__tests__/EmptyState.test.tsx: FOUND
- .planning/phases/21-quality-cleanup/21-02-SUMMARY.md: FOUND
- commit 1cf74cb (Task 1): FOUND
- commit 31121f0 (Task 2): FOUND
- npm run build: CLEAN
- npm test: 334 passed

---
*Phase: 21-quality-cleanup*
*Completed: 2026-04-28*
