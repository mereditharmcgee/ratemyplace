# Phase 14: Saved Buildings and Verification UX - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can bookmark buildings and view them in a saved list on their dashboard. The verification flow is clear enough that users complete it without confusion — verification is prompted at the right moments, the value is communicated, and verified reviews are visually distinguished on public pages. Mandatory audit of VerificationModal.tsx and ProfileDashboard.tsx gates implementation decisions.

</domain>

<decisions>
## Implementation Decisions

### Bookmark interaction
- **Bookmark icon** (ribbon style), not heart or star
- **Hidden for non-logged-in users** — only show the bookmark icon to authenticated users
- **Brief toast notification** on save/unsave ("Building saved" / "Removed from saved") for ~2 seconds
- **Placement**: Claude's discretion based on existing building page layout

### Verification prompting
- **Prompt in both places**: post-submission success page AND dashboard nudge on unverified reviews
- **Verify directly from success page** — open the upload flow right there, not just a link to dashboard
- **Show document examples** on the success page: lease, utility bill, rent receipt, piece of mail
- **Per-review verification** — each review requires its own verification upload (not per-building)
- **No email reminder** — just the in-app prompts for now
- **Admin approval required** — upload marks review as "pending verification", admin approves/rejects from queue
- **Admin views documents inline** — admin can see the uploaded image/PDF in the verification queue
- **Smart prompt display**: Claude decides whether to skip the verify CTA if the review is already verified

### Verified review distinction
- **Keep chronological sort** — verified reviews do NOT float to the top
- **Tooltip on verified badge** — hovering/tapping shows "This tenant verified their residency with a lease or similar document"
- **Visual treatment**: Claude's discretion on badge prominence, card border/tint, and whether to show verified count
- **Audit VerificationModal.tsx first** — the existing modal flow must be audited before deciding whether to keep the modal pattern or switch to inline

### Dashboard saved tab
- **Tabs pattern**: "My Reviews" and "Saved Buildings" tabs at the top of ProfileDashboard
- **Show "saved on" date** on each saved building entry — useful for apartment hunting timeline
- **Card content**: Claude's discretion on what data to show per saved building
- **Empty state**: Claude's discretion on messaging and whether to link to /search

### Claude's Discretion
- Bookmark icon placement on building page (next to heading vs top-right vs other)
- Verification value proposition copy
- Whether to skip verify CTA on success page if review is already verified
- Verified review visual treatment (badge size, card border/tint, verified count display)
- Saved building card content and layout
- Dashboard empty state messaging
- Whether VerificationModal stays as modal or becomes inline (after audit)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `VerificationModal.tsx`: Existing file upload modal with drag-and-drop, file validation (JPG/PNG/HEIC/PDF, 10MB max), preview — needs audit but core upload logic is reusable
- `VerificationQueue.tsx`: Existing admin verification queue component
- `ProfileDashboard.tsx`: Currently a flat review list with review fetching, verification modal integration — will need tabs added
- `ReviewListItem.tsx`: Existing review list item component used in dashboard
- `VerifiedBadge` / `EmailVerifiedBadge`: Existing badge components rendered on ReviewCard.astro (lines 469-470)
- `ReviewCard.astro`: Already conditionally renders verification badges based on `is_verified` and `user_email_verified` fields

### Established Patterns
- React islands with `client:load` for interactive components (ProfileDashboard, ReviewsTable)
- Admin API routes return JSON, React components fetch on mount
- R2 storage for uploaded files (verification documents already use this)
- `is_verified` integer field on reviews table (0/1)
- Toast notifications: no existing toast pattern — this will be new

### Integration Points
- Building page (`src/pages/building/[slug].astro`): bookmark icon goes here, needs user auth check
- Profile page (`src/pages/profile.astro`): hosts ProfileDashboard island
- Review submission success: currently redirects to building page — needs a success/thank-you page or interstitial
- New `saved_buildings` table needed (user_id, building_id, created_at)
- New API routes: `POST/DELETE /api/buildings/[id]/save`, `GET /api/buildings/saved`

</code_context>

<specifics>
## Specific Ideas

- Document examples on verify prompt should explicitly list: lease, utility bill, rent receipt, piece of mail
- The dashboard tabs pattern sets up future scalability (Settings, Notifications tabs in later phases)
- "Saved on" date matters because users are apartment hunting and want to track their timeline

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-agent-docs-form-ux*
*Context gathered: 2026-03-20*
