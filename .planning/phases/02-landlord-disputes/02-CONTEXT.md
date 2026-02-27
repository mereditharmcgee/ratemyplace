# Phase 2: Landlord Disputes - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Landlords can submit formal disputes about reviews, and admins can review and resolve them. This includes a public dispute submission form at `/dispute` and an admin queue at `/admin/disputes`. Landlord verification, appeal processes, and automated dispute handling are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Dispute Form Design
- Collect landlord info: name, email, phone (all required)
- No ownership verification — trust-based, admin reviews legitimacy manually
- Structured form with checkboxes for dispute reasons + optional text details
- Send confirmation email after submission with dispute details

### Review Matching
- Landlord must select a specific review to dispute (required, not optional)
- Identification method: paste the review URL into the form
- Validate URL — block submission if URL doesn't match a valid review
- One dispute per review — block duplicate submissions for same review

### Admin Queue Workflow
- Sort toggle: oldest first or newest first (user choice)
- Queue row shows: building, date, status, dispute reason snippet (full preview)
- Filter by status only: Pending / Resolved / All
- Side-by-side view when clicking a dispute: dispute details on left, review on right

### Resolution Actions
- Three resolution outcomes: Uphold / Dismiss / Partially valid
- Admin decides action per case: remove review, flag as disputed, or edit review
- Notify landlord by email only if dispute is upheld
- Resolution notes are required — admin must explain the decision

### Claude's Discretion
- Form layout and styling
- Exact checkbox options for dispute reasons
- Admin queue pagination behavior
- Email content and formatting
- Error message wording

</decisions>

<specifics>
## Specific Ideas

- Confirmation email should include the dispute details so landlord has a record
- Side-by-side view should make it easy to compare the review text with the dispute explanation
- Resolution notes serve as audit trail for future reference

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-landlord-disputes*
*Context gathered: 2026-02-26*
