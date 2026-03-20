---
phase: 10-foundations-and-legal-hardening
plan: "02"
subsystem: review-forms, admin
tags: [consent, ugc, admin-moderation, review-workflow]
dependency_graph:
  requires: []
  provides: [consent-gate-on-submit, consent-gate-on-edit, admin-full-review-detail]
  affects: [src/components/reviews/form-steps/ConfirmStep.tsx, src/components/reviews/ReviewEditForm.tsx, src/components/admin/ReviewsTable.tsx]
tech_stack:
  added: []
  patterns: [fetch-on-expand, detail-caching, score-badge-display]
key_files:
  modified:
    - src/components/reviews/form-steps/ConfirmStep.tsx
    - src/components/reviews/ReviewEditForm.tsx
    - src/components/admin/ReviewsTable.tsx
decisions:
  - "Consent initializes to false on edit form — users must re-consent per plan intent"
  - "Detail cache is kept on collapse to avoid re-fetching on re-expand"
  - "Old basic detail grid removed; new fetch-loaded detail view replaces it entirely"
metrics:
  duration: "~15 minutes"
  completed: "2026-03-20"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
---

# Phase 10 Plan 02: Consent Checkbox and Admin Review Detail Summary

Consent checkbox text updated to "honest personal experience" wording in new-review flow; identical consent checkbox added to edit-review form gated to false on mount. Admin review expansion now fetches full detail from `/api/admin/reviews/{id}` and renders all 27 score fields in color-coded badges, plus written content, metadata, and inline approve/reject buttons.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update consent checkbox text and add consent to edit form | 61a507b | ConfirmStep.tsx, ReviewEditForm.tsx |
| 2 | Wire admin review expansion with full detail fetch and rendering | ed19aba | ReviewsTable.tsx |

## What Was Built

### Task 1: Consent Checkbox Updates
- `ConfirmStep.tsx`: Updated consent label to "I confirm this review reflects my honest personal experience and agree to the Terms of Service and Review Guidelines." — preserving existing `privacyAcknowledged` prop and disabled-submit gate
- `ReviewEditForm.tsx`: Added `consentAcknowledged` state (initializes to `false`), amber-styled consent checkbox identical in wording to ConfirmStep, submit button disabled when `!consentAcknowledged || loading`

### Task 2: Admin Review Detail Expansion
- Added `reviewDetails: Record<string, any>` cache and `loadingDetail: string | null` state
- Expand click handler: fetches `GET /api/admin/reviews/${reviewId}` only when not yet cached; cached results reused on re-expand
- Loading spinner shown while fetch in progress
- Detail view renders:
  - **Score Grid** — 10 unit fields, 9 building fields, 8 landlord fields as color-coded badges (emerald/amber/orange/red per project conventions). Labels auto-formatted from field keys (strip prefix, title-case words)
  - **Written Content** — review title (bold), review text, comments (if distinct from review text)
  - **Metadata** — reviewer email, verification badge, move-in, unit type, unit number, rent, recommendation
  - **Inline Approve/Reject** — quick action buttons duplicated from bottom for convenience
- Existing landlord linking section and bottom action buttons fully preserved

## Deviations from Plan

None — plan executed exactly as written. The old basic details grid (unit type, move-in, rent, review text) was removed as it is superseded by the richer fetched detail view; this was implicitly required by "Replace the current expanded panel content."

## Self-Check

All files checked:
- `src/components/reviews/form-steps/ConfirmStep.tsx` — FOUND
- `src/components/reviews/ReviewEditForm.tsx` — FOUND
- `src/components/admin/ReviewsTable.tsx` — FOUND

Build: `npm run build` passes with no errors.

Commits verified:
- `61a507b` — feat(10-02): update consent checkbox text and add consent to edit form
- `ed19aba` — feat(10-02): wire admin review expansion with full detail fetch and rendering

## Self-Check: PASSED
