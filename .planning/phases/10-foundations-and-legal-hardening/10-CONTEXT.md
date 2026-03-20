# Phase 10: Foundations and Legal Hardening - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

The platform is legally hardened for real users and admins can moderate efficiently. Delivers: UGC disclaimers across all review-displaying pages, a submission consent checkbox, ToS audit/expansion, admin pending review inline expansion, and move-in date seasonal display bug fix.

</domain>

<decisions>
## Implementation Decisions

### Disclaimer placement and tone
- Place disclaimer at the **footer of the review section** on building pages and anywhere reviews are displayed
- Use **warm but clear** tone: "These reviews come from real tenants sharing their experiences. While we moderate for guidelines, we can't verify every detail."
- Build as a **shared `UGCDisclaimer.astro` component** imported across all pages that display reviews
- Link to Terms of Service from the disclaimer

### Terms of Service
- **Audit and expand** existing ToS — it already has Section 230 safe harbor, content responsibility, and disclaimer sections
- Check for gaps: removal policy details, dispute mechanism reference, review guidelines link
- Update "Last updated" date
- Do NOT rewrite from scratch — the existing language is solid

### About page framing
- Audit existing About page copy
- Ensure it clearly positions RateMyPlace as a platform that **hosts tenant experiences**, not a rating agency that evaluates landlords
- Adjust any language that could be read as RateMyPlace making claims about specific properties

### Review submission consent
- **Checkbox on the final step** of the multi-step review form, right above the submit button
- **Medium length with links**: "I confirm this review reflects my honest personal experience and agree to the [Terms of Service] and [Review Guidelines]."
- Checkbox must be checked to enable the submit button
- Add to both new review and edit review forms

### Admin pending review expansion
- **Accordion/expandable row** pattern in the existing ReviewsTable React island
- Click a row to expand inline, showing full review content below the summary row
- **Show all fields**: every dimension score (unit, building, landlord), written text, comments, move-in date, unit type, rent, user email, verification status
- **Fetch on expand**: keep the list API lightweight, fetch full review details via a separate API call when admin clicks to expand
- **Approve/reject buttons in both places**: keep existing row-level buttons AND add them in the expanded view

### Move-in date bug
- **Winter rule**: December belongs to the year it occurs in — December 2025 = "Winter 2025", not "Winter 2026"
- **Investigate both form and display**: the bug source is unclear — could be form storing wrong year, or display logic computing wrong season
- **Fix data + display**: if existing reviews have incorrect stored values, write a migration to correct them
- Current storage: `move_in_season` (string) + `move_in_year` (integer) as separate fields
- `formatFuzzyDate()` in `privacy.ts` just concatenates — the bug is likely upstream

### Claude's Discretion
- Exact disclaimer component styling (font size, color, border)
- How to handle the expanded review layout (grid vs stacked sections)
- Loading state for the expand-on-click API call
- Whether the About page needs significant changes or just minor tweaks
- How to structure the data correction migration (if needed)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `BaseLayout.astro`: All pages use this — disclaimer component would be imported alongside it
- `ReviewsTable.tsx`: React island for admin reviews — accordion expansion goes here
- `ReviewForm.tsx` / `ReviewEditForm.tsx`: Multi-step forms — consent checkbox added to final step
- `formatFuzzyDate()` in `privacy.ts`: Season display function (line 8) — just concatenates, bug is upstream

### Established Patterns
- Astro components for static content (disclaimer would be `.astro`, not React)
- React islands with `client:load` for interactive admin components
- Admin API routes return JSON, React components fetch on mount
- Terms/privacy/about pages are simple Astro pages in `src/pages/`

### Integration Points
- Building page (`src/pages/building/[slug].astro`): disclaimer goes in review section footer
- Admin reviews page (`src/pages/admin/reviews.astro`): hosts ReviewsTable island
- Admin reviews API (`src/pages/api/admin/reviews/`): needs a detail endpoint for expand-on-click
- Review submission API (`src/pages/api/reviews.ts`): may need consent_acknowledged field
- `src/lib/validation.ts`: validation for move_in_season + move_in_year

</code_context>

<specifics>
## Specific Ideas

- The existing ToS already has good Section 230 language at lines 53-60 of terms.astro — don't weaken or remove it, just expand if needed
- The admin review expansion should feel like expanding a row in a data table, not opening a separate view
- The consent checkbox text should reference both ToS AND Review Guidelines (there's a /guidelines link already in the ToS)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-foundations-and-legal-hardening*
*Context gathered: 2026-03-20*
