# Phase 11: Schema, Survey Fields, and Contact Form - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Two new public health survey dimensions are collected from new reviews (Section 8 acceptance and safely lit at night), a working contact form replaces the static mailto links on the contact page, and all migration numbers for the milestone are pre-assigned (0019-0022) to prevent collisions across phases.

</domain>

<decisions>
## Implementation Decisions

### Section 8 / Housing Choice Voucher Field
- Standalone context field (not scored, not part of any dimension) — like `would_recommend`
- Placed in the supplementary section of the review form, alongside would_recommend, tenure, and move-out timing
- Optional — reviewers can skip it
- Response options: Yes / No / Unsure
- Question text: "To your knowledge, does this property accept Housing Choice Vouchers (Section 8)?"
- DB column: nullable (D1 constraint — no NOT NULL on ALTER TABLE)

### Safely Lit at Night Field
- Yes/No/Unsure question (not 1-5 Likert scale) — informational, not scored
- Optional — reviewers can skip it
- Question text: "Was the building and surrounding area safely lit at night?"
- Response options: Yes / No / Unsure

### Claude's Discretion (Survey Fields)
- Placement of "safely lit" in the form (supplementary section or after building section — pick best flow)
- DB column names for both new fields
- Whether to add to `supplementaryItems` in surveyItems.ts or create a new structure

### Contact Form
- Open to anyone — no login required. Name + email fields on the form
- Turnstile + rate limiting (3 per hour per IP) for spam protection
- All categories notify contact@ratemyplace.org (single address — Cloudflare catch-all forwards to admin)
- Category dropdown: General, Privacy, Support, Landlord (per requirements)
- Submitter confirmation email from noreply@ratemyplace.org (consistent with existing email patterns)
- Submissions stored in D1 `contact_messages` table
- Separate "Contact" tab in admin panel (not combined with bug reports)

### Claude's Discretion (Contact Form)
- Contact form field validation rules (min/max lengths)
- Admin contact tab UI layout and sorting
- Confirmation email template design (follow existing Resend email patterns in email.ts)
- Whether to add admin notification email or rely on D1 storage + admin panel only

### Migration Pre-Assignment
- Migrations 0019-0022 pre-assigned to this milestone (already decided in STATE.md)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/turnstile.ts`: Turnstile verification helper — ready to use for contact form
- `src/lib/email.ts`: Resend email helpers with 4 existing templates (verification, password reset, dispute confirmation, dispute upheld) — follow same pattern for contact confirmation
- `src/pages/api/bug-reports.ts`: Complete pattern for Turnstile + D1 storage + form submission API — closest analogue for contact form
- `src/lib/surveyItems.ts`: `supplementaryItems` object holds would_recommend, tenure, moveOutTiming — new context fields should integrate here
- `src/lib/scoring.ts`: ITEM_WEIGHTS, UNIT_FIELDS, BUILDING_FIELDS, LANDLORD_FIELDS — new fields are NOT added here (informational only, not scored)
- `src/lib/rateLimit.ts`: `getClientIP()` helper for rate limiting
- `generateIdFromEntropySize` from Lucia for ID generation

### Established Patterns
- Survey items use SurveyItem interface with key, code, dimension, text, category, help
- Supplementary items use a simpler structure with key, text, options array
- API routes follow: Turnstile verify -> validate input -> D1 insert -> return JSON response
- Admin pages follow: Astro SSR page with auth check -> query D1 -> render table/list

### Integration Points
- `src/components/reviews/ReviewForm.tsx`: Add new fields to supplementary section
- `src/components/reviews/ReviewCard.astro`: Display new field values (yes/no/unsure)
- `src/pages/contact.astro`: Replace static mailto content with React form island
- `src/pages/admin/`: Add new Contact tab to admin navigation
- Migrations directory: 0019-0022 slots available (0018 is bug_reports, 0023 is saved_buildings)

</code_context>

<specifics>
## Specific Ideas

- Section 8 question text is locked: "To your knowledge, does this property accept Housing Choice Vouchers (Section 8)?"
- Safely lit question text is locked: "Was the building and surrounding area safely lit at night?"
- "Unsure" responses should display on review cards as neutral (gray indicator), not hidden
- Both fields are optional and use Yes/No/Unsure tristate
- Older reviews without these fields show no field (omitted, not blank/null display)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-schema-survey-fields-and-contact-form*
*Context gathered: 2026-03-21*
