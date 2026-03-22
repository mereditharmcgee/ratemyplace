# Phase 13: Tenant Dashboard Core - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Logged-in tenants can see the status of all their reviews with actionable information (rejection reasons, edit/resubmit), verify their email from the dashboard, manage account settings (display name, email, password, notification prefs), and receive in-app notifications when review status changes. Header shows a notification indicator.

</domain>

<decisions>
## Implementation Decisions

### Review Status Display
- Status labels on each review: Pending / Approved / Rejected / Disputed
- Rejected reviews show inline red banner below the review card: "Rejected: [reason]" with "Edit & Resubmit" button
- Editing a rejected review resets status to "pending" (goes back into admin queue)
- Approved reviews link to the live building page

### Claude's Discretion (Review Status)
- Disputed status display — show label + brief explanation or just label (Claude decides what's useful without oversharing)
- Approved review link — building page or deep-link with anchor (Claude picks simpler)

### Account Settings Tab
- New "Settings" tab in ProfileDashboard alongside Reviews, Saved
- Editable fields: display name, notification preferences, email address, password
- Google OAuth users see a "Set a password" option (not hidden)
- Email change approach: Claude decides — either verify-new-email-only or require-current-password

### Claude's Discretion (Settings)
- Email change confirmation flow design
- Settings form layout and grouping
- Validation and error messaging

### Notification System
- In-app only — no email notifications for now (CAN-SPAM/unsubscribe deferred to v1.5.0)
- Events that trigger notifications: review approved, review rejected, review disputed, dispute resolved
- notification_opt_in column still needed on users table (for future email notifications — STATE.md decision)
- Notifications stored in D1 with migration 0021 (reserved slot)
- Header indicator: bell icon with red count badge next to Profile link
- Mark-as-read: viewing the notifications tab marks all as read (batch, not individual)
- Notifications tab in ProfileDashboard alongside Reviews, Saved, Settings

### Claude's Discretion (Notifications)
- Notification message text for each event type
- Notification table schema (columns, indexes)
- createNotification() helper design
- Where to wire createNotification into admin review routes
- Bell icon design and positioning in Header.astro

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/profile/ProfileDashboard.tsx`: Main dashboard component with tabs (reviews, saved). Extend with settings + notifications tabs
- `src/components/profile/ReviewListItem.tsx`: Individual review display — needs status labels, rejection reason, edit CTA
- `src/components/profile/VerificationModal.tsx`: Email verification modal — already works
- `src/pages/profile.astro`: SSR page passing user data to ProfileDashboard
- `src/components/layout/Header.astro`: Site header — needs bell icon with badge
- `src/pages/api/reviews/user.ts`: Existing endpoint returning user's reviews
- `src/lib/email.ts`: Resend email helpers (for future email notifications)
- `src/pages/api/auth/`: Auth routes for password reset flow (reusable patterns for password change)

### Established Patterns
- Tab state managed via `ActiveTab` union type in ProfileDashboard
- Lazy-load on tab switch (savedBuildings pattern — fetch on first switch, cache)
- Server-side user data passed via Astro frontmatter props
- API routes return JSON with `{ data }` or `{ error }` pattern
- Admin action audit logging with createAuditLog

### Integration Points
- `src/pages/api/admin/reviews/[id]/approve.ts`: Wire createNotification on approval
- `src/pages/api/admin/reviews/[id]/reject.ts`: Wire createNotification on rejection
- `src/pages/api/admin/disputes/`: Wire createNotification on dispute status changes
- `src/components/layout/Header.astro`: Add bell icon with unread count
- Migration 0021 slot reserved for notifications table

</code_context>

<specifics>
## Specific Ideas

- Notification count in header should be fetched server-side in Astro frontmatter (like emailVerified) to avoid client flash
- The "Edit & Resubmit" button on rejected reviews should link to the existing edit form at `/review/edit/[id]`
- Settings tab should clearly indicate which fields are OAuth-sourced vs editable

</specifics>

<deferred>
## Deferred Ideas

- Email notifications for review status changes — deferred to v1.5.0 (needs CAN-SPAM unsubscribe infrastructure)
- Account deletion — not in v1.4.0 scope

</deferred>

---

*Phase: 13-tenant-dashboard-core*
*Context gathered: 2026-03-21*
