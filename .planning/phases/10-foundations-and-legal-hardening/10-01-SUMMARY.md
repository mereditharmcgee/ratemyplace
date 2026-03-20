---
phase: 10-foundations-and-legal-hardening
plan: 01
subsystem: legal-hardening
tags: [ugc, disclaimer, terms-of-service, about, legal]
dependency_graph:
  requires: []
  provides: [ugc-disclaimer-component, expanded-tos, reframed-about]
  affects: [building-page, landlord-page, property-manager-page, terms-page, about-page]
tech_stack:
  added: []
  patterns: [astro-component-import, shared-disclaimer-component]
key_files:
  created:
    - src/components/reviews/UGCDisclaimer.astro
  modified:
    - src/pages/building/[slug].astro
    - src/pages/landlord/[slug].astro
    - src/pages/property-manager/[slug].astro
    - src/pages/terms.astro
    - src/pages/about.astro
decisions:
  - "UGCDisclaimer placed after reviews section (not inside map loop) on all three review-displaying pages"
  - "Terms Content Moderation section expanded in-place rather than rewritten"
  - "About page How We Rate section prepended with explicit tenant-submitted framing sentence"
metrics:
  duration_minutes: 2
  completed_date: "2026-03-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 5
requirements: [UGC-01, UGC-03, UGC-04]
---

# Phase 10 Plan 01: UGC Disclaimers and Legal Hardening Summary

**One-liner:** Shared UGC disclaimer component deployed on 3 review pages, ToS expanded with removal policy and dispute link, About page reframed as tenant-experience hosting platform.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create UGCDisclaimer component and deploy on review pages | cf754fd | UGCDisclaimer.astro, building/[slug].astro, landlord/[slug].astro, property-manager/[slug].astro |
| 2 | Expand Terms of Service and reframe About page | 140787a | terms.astro, about.astro |

## What Was Built

### UGCDisclaimer Component (`src/components/reviews/UGCDisclaimer.astro`)
A pure Astro component (no props) with the locked disclaimer text: "These reviews come from real tenants sharing their experiences. While we moderate for guidelines, we can't verify every detail." — with a link to `/terms`. Styled with `text-sm text-gray-500 italic mt-4 mb-2 border-t border-gray-100 pt-4`.

Deployed on all three review-displaying pages, placed after the reviews section, outside any map loop — rendering exactly once per page.

### Terms of Service Expansion (`src/pages/terms.astro`)
- "Content Moderation" section renamed to "Content Moderation & Removal Policy" and expanded with:
  - How to request removal (link to `/dispute` + email)
  - No specific SLA — "within a reasonable timeframe"
  - Removal decisions are final at RateMyPlace's sole discretion
  - Added Review Guidelines subsection linking to `/guidelines`
- "User Content & Responsibility" section updated: first bullet now explicitly states reviews "reflect individual tenant experiences" and are "not platform assessments or endorsements by RateMyPlace"
- Last Updated date advanced to March 2026
- Section 230 safe harbor block untouched (as required)

### About Page Reframing (`src/pages/about.astro`)
- "How We Rate" section prepended with: "These scores are calculated from tenant-submitted ratings. RateMyPlace does not independently evaluate properties."
- Intro paragraph reworded from "Our comprehensive rating system" to "Our scoring framework ... based on what tenants reported"
- Scoring Transparency section updated throughout: "what tenants reported", "tenant-submitted reviews", "where tenants reported" qualifiers added

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/components/reviews/UGCDisclaimer.astro
- FOUND: src/pages/terms.astro
- FOUND: src/pages/about.astro
- FOUND commit cf754fd
- FOUND commit 140787a
- Build succeeded: `npm run build` with no errors
