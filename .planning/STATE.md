---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: milestone
status: completed
last_updated: "2026-03-22T16:36:40.193Z"
last_activity: 2026-03-22 — Completed 15-01-PLAN.md (review_disputed notification wired into dispute POST handler)
progress:
  total_phases: 6
  completed_phases: 6
  total_plans: 13
  completed_plans: 13
  percent: 100
---

# Project State

**Project:** RateMyPlace Boston
**Milestone:** v1.4.0 "Open Doors"
**Updated:** 2026-03-21

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-20)

**Core value:** Tenants can submit honest, anonymous reviews and see aggregated scores
**Current focus:** Phase 10 — Foundations and Legal Hardening

## Current Position

Phase: 15 of 15 (Notification Gap Closure) — Complete
Plan: 15-01 complete — 1 of 1 plans done
Status: Phase 15 complete; DASH-06 fully satisfied — all four notification event types now have callers
Last activity: 2026-03-22 — Completed 15-01-PLAN.md (review_disputed notification wired into dispute POST handler)

Progress: [██████████] 100% (32/32 plans)

## Completed Milestones

- v1.2.1 Email Verification — Phase 1 (4 plans) — shipped 2026-02-26
- v1.2.2 Launch Ready — Phases 2-3 (6 plans) — shipped 2026-02-27
- v1.3.0 Battle Tested — Phases 4-9 (15 plans) — shipped 2026-03-10

## Accumulated Context

- Production URL: ratemyplace.org (not ratemyplace.boston)
- Cloudflare Email Routing catch-all active for all @ratemyplace.org addresses
- Boston Assessing API: CKAN datastore_search, resource ee73430d-96c0-423e-ad21-c4cfb54c8961
- CT CAMA API (New Haven): data.ct.gov resource pqrn-qghw — live-tested and confirmed working
- Migration numbering: 0019-0022 pre-assigned in Phase 11 to prevent collisions
- Survey fields: use nullable columns (INTEGER, no NOT NULL constraint) — D1 rejects NOT NULL ALTER TABLE on existing rows
- CAN-SPAM: notification_opt_in column needed on users table before first review status email ships (Phase 13)
- Verification UX: mandatory audit of VerificationModal.tsx and ProfileDashboard.tsx must gate Phase 14 implementation
- 235 unit tests passing, build clean as of 2026-03-22

## Blockers

None currently.

## Decisions

- **10-01:** UGCDisclaimer placed after reviews section (not inside map loop) on all three review-displaying pages
- **10-01:** Terms Content Moderation section expanded in-place rather than rewritten; Section 230 block preserved verbatim
- **10-01:** About page How We Rate section prepended with explicit "tenant-submitted" framing sentence rather than replacing existing content
- **10-02:** Consent initializes to false on edit form — users must re-consent on each edit submission
- **10-02:** Admin review detail fetched lazily on expand and cached to avoid re-fetching on re-expand

---
*State updated: 2026-03-21 — Phase 11 context gathered*
- [Phase 10]: Dual-path validation: move_in_month (new) OR move_in_season (legacy) for backward compat
- [Phase 10]: December uses user-provided year: month=12, year=2025 stores as Winter 2025 (not 2026)
- [Phase 14-01]: UNIQUE constraint on (user_id, building_id) caught and returned 200 for idempotent save API
- [Phase 14-01]: isSaved queried server-side in Astro frontmatter so BookmarkButton initial state is correct without client flash
- [Phase 14-01]: Saved buildings tab lazy-loads on first switch and caches via savedLoaded flag
- [Phase 14-02]: Kept VerificationModal modal pattern after audit — overlay works well, avoids confusing page navigation mid-verification
- [Phase 14-02]: Post-submission prompt checks is_verified server-side in Astro frontmatter to avoid client flash if already verified
- [Phase 14-02]: CSS-only tooltip (group/group-hover) on VerifiedBadge for mobile tap support without JS dependency
- [Phase 11-02]: SSR direct D1 query in admin/contact.astro — simpler, avoids extra client JS for read-only table
- [Phase 11-02]: Migration 0019 added as reserved placeholder to close sequence gap between 0018 and 0023
- [Phase 11]: Placed housingVouchers and safelyLit radio groups before wouldRecommend for clustered yes/no/unsure grouping
- [Phase 12]: Dispatcher strips trailing state abbreviation from city (Boston, MA -> boston) before adapter map lookup
- [Phase 12]: Cambridge not routed to BostonAdapter — Boston Assessing is City of Boston only; stays NullAdapter until verified
- [Phase 12]: mapBuildingType() stays in boston.ts adapter — LU_DESC codes are Boston-specific
- [Phase 12]: NewHavenAdapter uses Socrata SoQL with escaped apostrophes and broad $q fallback
- [Phase 12]: Unsupported-city block renders separately from empty-results block in BuildingsTable
- [Phase 13]: Migration 0021 already marked applied (stub SELECT 1) — DDL executed directly via wrangler d1 execute --file
- [Phase 13]: has_open_dispute derived via LEFT JOIN disputes rather than stored as reviews column — disputes table is source of truth
- [Phase 13]: Disputed badge takes UI priority over rejected status in ReviewListItem — has_open_dispute checked before status switch
- [Phase 13]: Validation helpers extracted to src/lib/userSettings.ts as pure functions so they are unit-testable without mocking HTTP context
- [Phase 13]: OAuth set-password flow skips currentPassword requirement — google_id non-null + hashed_password null is the gate
- [Phase 13]: Email change resets email_verified=0 — user must re-verify after changing email
- [Phase 13]: Password change calls lucia.invalidateUserSessions; frontend redirects to /auth/signin after success
- [Phase 13]: createNotification called after createAuditLog in admin routes — best-effort, success response unaffected if notification insert fails
- [Phase 13]: Bell icon in Header.astro SSR-queried — no client flash; localUnreadCount cleared client-side after fetchNotifications
- [Phase 15-01]: review_disputed notification fires after dispute INSERT, before confirmation email — reused buildingAddress already fetched for landlord email, added user_id to review SELECT to avoid second query
