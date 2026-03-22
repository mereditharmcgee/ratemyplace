# Phase 13: Tenant Dashboard Core - Research

**Researched:** 2026-03-22
**Domain:** React dashboard components, D1 schema design, Astro SSR patterns, in-app notification system
**Confidence:** HIGH

## Summary

Phase 13 extends an existing, well-structured React dashboard (`ProfileDashboard.tsx`) with four concrete additions: richer review status display (including rejection reasons and edit/resubmit CTA for DASH-01/02), a verification status banner (DASH-03, already partially present), an account settings tab (DASH-04), and an in-app notification system with a header badge (DASH-06/07).

The codebase patterns are consistent and mature. Tab-switching, lazy-loading per tab, server-side data in Astro frontmatter, and the `{ data } | { error }` API response shape are all established. The notification system is the only net-new infrastructure concern — it requires a D1 migration (slot 0021 reserved and currently a stub `SELECT 1`) and wiring into the existing admin review/dispute PATCH endpoints.

The `UserReview` type in `api-types.ts` currently lacks `moderation_notes` (rejection reason) and `disputed` as a status value. Both need to be added before the review list can surface rejection context. The `users` table currently has no `notification_opt_in` column — STATE.md notes this must be added before first review-status email ships; this phase should add that column even though email notifications are deferred.

**Primary recommendation:** Implement in four sequential waves: (1) migration 0021 for notifications + users.notification_opt_in, (2) review status enhancements + settings tab, (3) notification creation wired into admin routes, (4) header bell badge.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Review Status Display**
- Status labels on each review: Pending / Approved / Rejected / Disputed
- Rejected reviews show inline red banner below the review card: "Rejected: [reason]" with "Edit & Resubmit" button
- Editing a rejected review resets status to "pending" (goes back into admin queue)
- Approved reviews link to the live building page

**Account Settings Tab**
- New "Settings" tab in ProfileDashboard alongside Reviews, Saved
- Editable fields: display name, notification preferences, email address, password
- Google OAuth users see a "Set a password" option (not hidden)
- Email change approach: Claude decides — either verify-new-email-only or require-current-password

**Notification System**
- In-app only — no email notifications for now (CAN-SPAM/unsubscribe deferred to v1.5.0)
- Events that trigger notifications: review approved, review rejected, review disputed, dispute resolved
- notification_opt_in column still needed on users table (for future email notifications — STATE.md decision)
- Notifications stored in D1 with migration 0021 (reserved slot)
- Header indicator: bell icon with red count badge next to Profile link
- Mark-as-read: viewing the notifications tab marks all as read (batch, not individual)
- Notifications tab in ProfileDashboard alongside Reviews, Saved, Settings

### Claude's Discretion
- Disputed status display — show label + brief explanation or just label
- Approved review link — building page or deep-link with anchor (Claude picks simpler)
- Email change confirmation flow design
- Settings form layout and grouping
- Validation and error messaging
- Notification message text for each event type
- Notification table schema (columns, indexes)
- createNotification() helper design
- Where to wire createNotification into admin review routes
- Bell icon design and positioning in Header.astro

### Deferred Ideas (OUT OF SCOPE)
- Email notifications for review status changes — deferred to v1.5.0 (needs CAN-SPAM unsubscribe infrastructure)
- Account deletion — not in v1.4.0 scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Logged-in user can view all their submitted reviews with status (pending/approved/rejected/disputed) | `UserReview` type needs `disputed` status + `moderation_notes` field; `/api/reviews/user` query needs those columns; `ReviewListItem` already has status badge logic but no disputed case |
| DASH-02 | Approved reviews link to live review; rejected reviews show reason and option to edit/resubmit | Approved already links to building page (sufficient); rejected banner + "Edit & Resubmit" → `/review/edit/[id]` + reset status to pending on save |
| DASH-03 | Dashboard shows verification status with clear path to verify if not yet verified | Already implemented as a standalone card above tabs in ProfileDashboard; needs to move into a persistent banner pattern or remain as-is (no functional gap) |
| DASH-04 | Basic account settings accessible from dashboard (display name, email, notification preferences) | Needs new Settings tab + 3 API endpoints: PATCH /api/user/profile, PATCH /api/user/password, PATCH /api/user/email |
| DASH-06 | User receives in-app notifications for review status changes (approved, rejected, disputed) | Needs notifications table (migration 0021 slot), createNotification() helper, wiring into admin review PATCH + dispute resolution endpoints |
| DASH-07 | Notification indicator visible in nav/header | Header.astro needs server-side unread count query + bell icon with badge; follows same pattern as emailVerified in profile.astro |
</phase_requirements>

---

## Standard Stack

### Core (all already in use — no new dependencies needed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (via Astro) | Interactive island components | Already used for all dashboard components |
| Astro SSR | 5.x | Server-side data fetching, header badge count | Established pattern; `Astro.locals.user` |
| Cloudflare D1 | SQLite | Notification persistence | Only DB in this stack |
| Lucia v3 | 3.x | Session/user context in API routes | Already wired in all auth checks |
| Tailwind CSS | 4.x | Styling | Already used everywhere |

### No New Dependencies
This phase requires zero new npm packages. All functionality is achievable with existing stack.

## Architecture Patterns

### Recommended Project Structure (additions only)
```
src/
├── components/profile/
│   ├── ProfileDashboard.tsx      # Extend: add 'settings' | 'notifications' to ActiveTab
│   ├── ReviewListItem.tsx        # Extend: disputed badge, rejection banner, resubmit CTA
│   ├── SettingsTab.tsx           # NEW: display name, email, password, notification prefs forms
│   └── NotificationsTab.tsx      # NEW: list of notification events, mark-as-read on view
├── pages/
│   ├── profile.astro             # Extend: pass unreadNotificationCount prop
│   └── api/user/
│       ├── profile.ts            # NEW: PATCH display name, notification_opt_in
│       ├── password.ts           # NEW: PATCH current password + new password
│       └── email.ts              # NEW: PATCH email (with verification step)
│   └── api/notifications/
│       ├── index.ts              # NEW: GET user notifications, PATCH mark-all-read
│       └── unread-count.ts       # Optional: or inline into index with ?count=true
├── lib/
│   └── notifications.ts          # NEW: createNotification() helper
migrations/
└── 0021_notifications.sql        # Replace stub — notifications table + users.notification_opt_in
```

### Pattern 1: Server-Side Count for Header Badge (No Flash)
**What:** Fetch unread notification count in Astro frontmatter and pass to Header as a prop, exactly as `emailVerified` is fetched for the profile page.
**When to use:** Any per-user count that must appear in the header without client-side JS flash.

Header.astro currently does not accept props — it accesses `Astro.locals.user` directly. The bell badge count must be fetched in `BaseLayout.astro` (or a layout that includes Header.astro) and passed down, OR the Header component needs to query D1 directly in its own frontmatter.

**Recommended approach:** Query unread count directly in `Header.astro` frontmatter, since Header already reads `Astro.locals.user`. This keeps the data co-located with the UI that uses it and avoids threading props through every page layout.

```typescript
// In Header.astro frontmatter
const user = Astro.locals.user;
let unreadCount = 0;
if (user) {
  const db = getDB((Astro.locals as any).runtime);
  const result = await db.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL'
  ).bind(user.id).first<{ count: number }>();
  unreadCount = result?.count ?? 0;
}
```

### Pattern 2: Tab Extension in ProfileDashboard
**What:** The existing `ActiveTab` union type gets two new values. The `handleTabSwitch` function gets two new lazy-load branches. This follows the identical pattern used for the `saved` tab.

```typescript
// Extend existing union
type ActiveTab = 'reviews' | 'saved' | 'settings' | 'notifications';

// Notifications state (same shape as saved buildings)
const [notifications, setNotifications] = useState<Notification[]>([]);
const [notificationsLoaded, setNotificationsLoaded] = useState(false);
const [notificationsLoading, setNotificationsLoading] = useState(false);

// In handleTabSwitch
if (tab === 'notifications' && !notificationsLoaded) {
  fetchNotifications(); // also marks all as read
}
```

### Pattern 3: Notification Table Schema
**What:** Minimal schema optimized for the access patterns in this phase.

```sql
-- migration 0021_notifications.sql
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'review_approved', 'review_rejected', 'review_disputed', 'dispute_resolved'
  )),
  review_id TEXT REFERENCES reviews(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at INTEGER,   -- NULL = unread; set to unixepoch() on batch mark-read
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

-- Also in this migration:
ALTER TABLE users ADD COLUMN notification_opt_in INTEGER NOT NULL DEFAULT 1;
```

**Rationale for INTEGER PRIMARY KEY AUTOINCREMENT:** Notifications are append-only and queried by user, never by a caller-controlled ID. Using autoincrement integer is simpler and sufficient.

**Rationale for `message TEXT`:** Pre-compute the human-readable string at insertion time (e.g., "Your review of 123 Main St was approved"). Avoids reconstructing it from event_type + review data at read time, which would require a join.

### Pattern 4: createNotification() Helper
**What:** A simple insert helper in `src/lib/notifications.ts`. Returns void (best-effort like `createAuditLog`).

```typescript
// src/lib/notifications.ts
import type { D1Database } from '@cloudflare/workers-types';

export type NotificationEventType =
  | 'review_approved'
  | 'review_rejected'
  | 'review_disputed'
  | 'dispute_resolved';

const EVENT_MESSAGES: Record<NotificationEventType, (address: string) => string> = {
  review_approved: (addr) => `Your review of ${addr} has been approved and is now live.`,
  review_rejected: (addr) => `Your review of ${addr} was not approved. See your dashboard for details.`,
  review_disputed: (addr) => `Your review of ${addr} has been disputed by the landlord.`,
  dispute_resolved: (addr) => `The dispute on your review of ${addr} has been resolved.`,
};

export async function createNotification(
  db: D1Database,
  params: {
    userId: string;
    eventType: NotificationEventType;
    reviewId: string;
    buildingAddress: string;
  }
): Promise<void> {
  try {
    const message = EVENT_MESSAGES[params.eventType](params.buildingAddress);
    await db.prepare(
      'INSERT INTO notifications (user_id, event_type, review_id, message) VALUES (?, ?, ?, ?)'
    ).bind(params.userId, params.eventType, params.reviewId, message).run();
  } catch (err) {
    // Best-effort — notification failure must never break the admin action
    console.error('createNotification failed:', err);
  }
}
```

### Pattern 5: Wiring createNotification into Admin Review Routes
**What:** The admin review status update is a single PATCH endpoint at `src/pages/api/admin/reviews/[id].ts`. It handles approve, reject, and flag transitions. There is no separate `approve.ts` / `reject.ts` (the CONTEXT.md lists these as integration points, but the actual implementation is consolidated in `[id].ts`). The dispute routes do not yet exist in the filesystem (globbing returned no results) — they may be pending from a prior phase or handled differently.

**Wire location:** After the `createAuditLog` call in the PATCH handler in `[id].ts`, add:

```typescript
// After audit log, before final response
if (status === 'approved' || status === 'rejected') {
  const reviewWithUser = await db.prepare(
    'SELECT r.user_id, b.address FROM reviews r JOIN buildings b ON r.building_id = b.id WHERE r.id = ?'
  ).bind(reviewId).first<{ user_id: string; address: string }>();

  if (reviewWithUser) {
    await createNotification(db, {
      userId: reviewWithUser.user_id,
      eventType: status === 'approved' ? 'review_approved' : 'review_rejected',
      reviewId,
      buildingAddress: reviewWithUser.address,
    });
  }
}
```

### Pattern 6: ReviewListItem — Disputed Status + Rejection Reason
**What:** Two additions to the existing `getStatusBadge()` switch and the action buttons area.

The `UserReview` type in `api-types.ts` must add:
- `status: 'pending' | 'approved' | 'rejected' | 'disputed'` (add 'disputed')
- `moderation_notes: string | null` (add field)

The `/api/reviews/user.ts` query must include `r.moderation_notes` in the SELECT.

The ReviewListItem component logic:
- Disputed: show purple/violet badge with label "Disputed" and brief copy: "Under landlord review"
- Rejected: existing red badge unchanged + NEW inline red banner below card metadata: `"Rejected: [moderation_notes]"` with "Edit & Resubmit" link to `/review/edit/[id]`
- Approved: building page link is already present — keep as-is (the simpler option)

### Pattern 7: Settings Tab — Email Change Design Decision
**What:** For email change, require current password (not just verify-new-email-only). Reasons:
1. OAuth users without a password cannot change email — appropriate, since their identity is Google-managed.
2. Requiring current password prevents session-hijack email takeovers (attacker who steals a session cookie cannot silently reroute the account to a new email).
3. Simpler implementation — no need for a "verify new email before switching" flow (which requires a separate pending_email column and additional token lifecycle).

**Implementation:** PATCH `/api/user/email` accepts `{ currentPassword, newEmail }`. Verifies current password against `hashed_password`, then updates `email` and sets `email_verified = 0` (because new email is unverified). Google OAuth users (where `hashed_password IS NULL`) get a 400 error with a clear message: "Email changes are managed through your Google account."

### Anti-Patterns to Avoid
- **Fetching notification count client-side in Header:** Causes flash of no-badge then badge. Always fetch server-side in Header.astro frontmatter.
- **Individual mark-as-read per notification:** Over-engineered for this phase. Batch mark-all-read when the notifications tab is first opened (same event as lazy-load fetch).
- **Storing notification body as JSON event data (not pre-rendered text):** Complicates rendering and requires joins. Pre-render the message string at insert time.
- **Separate approve.ts / reject.ts files:** The existing PATCH endpoint in `[id].ts` handles all status transitions. Add `createNotification` there, not in separate files.
- **Blocking admin actions on notification failure:** Always wrap `createNotification` in try/catch and swallow errors, like `createAuditLog`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | Custom bcrypt wrapper | `src/lib/password.ts` hashPassword/verifyPassword | Already exists, tested |
| Session invalidation after password change | Manual session DELETE | `lucia.invalidateUserSessions(userId)` | Lucia handles session cleanup atomically |
| Auth checks in new API routes | Custom middleware | Existing pattern: `if (!context.locals.user) return 401` | Established in every API route |

## Common Pitfalls

### Pitfall 1: Disputed Status Not in reviews Table CHECK Constraint
**What goes wrong:** The `reviews` schema has `CHECK (status IN ('pending', 'approved', 'rejected', 'flagged'))`. If admin routes try to set status to `disputed`, D1 will throw a constraint violation.
**Why it happens:** The CONTEXT.md adds `disputed` as a display status for the tenant dashboard, but the DB schema may never have had it, or it may be set via the disputes table workflow rather than as a direct review status.
**How to avoid:** Before wiring `disputed` as a selectable status in the dashboard, verify whether reviews.status can be 'disputed' in the DB, or whether "Disputed" on the dashboard means "this review has an open dispute" (join on disputes table). The safest approach: keep reviews.status as-is, and derive "Disputed" by checking `EXISTS (SELECT 1 FROM disputes WHERE review_id = r.id AND status = 'pending')` in the `/api/reviews/user` query.
**Warning signs:** D1 SQLITE_CONSTRAINT errors in admin routes when setting status = 'disputed'.

### Pitfall 2: Header.astro Fetching DB Without Runtime
**What goes wrong:** `getDB()` requires `context.locals.runtime` (the Cloudflare Workers binding). Header.astro uses `Astro.locals` directly, not a context object. The call pattern is the same but must be verified.
**Why it happens:** Some Astro components access locals differently depending on where they sit in the component tree.
**How to avoid:** Use `getDB((Astro.locals as any).runtime)` — this is the established pattern in `profile.astro` and all SSR pages.

### Pitfall 3: notification_opt_in Column as NOT NULL Without Default on Existing Rows
**What goes wrong:** `ALTER TABLE users ADD COLUMN notification_opt_in INTEGER NOT NULL` fails on D1 if there are existing rows, because SQLite rejects NOT NULL additions without a DEFAULT on columns with existing data.
**Why it happens:** D1 (SQLite) does not backfill NULLs for added NOT NULL columns without a default. STATE.md explicitly notes: "use nullable columns (INTEGER, no NOT NULL constraint) — D1 rejects NOT NULL ALTER TABLE on existing rows."
**How to avoid:** Use `ALTER TABLE users ADD COLUMN notification_opt_in INTEGER NOT NULL DEFAULT 1;` — the DEFAULT satisfies the constraint for existing rows.

### Pitfall 4: Lazy-Loading Notifications Tab Doesn't Mark-as-Read on Re-visit
**What goes wrong:** If the user visits notifications once (fetches + marks read), then the bell badge correctly goes to 0. But if they leave and come back (page reload), the header re-queries the count (0 — correct). If they don't reload and just switch tabs again, `notificationsLoaded` is true so the fetch doesn't re-run — which is correct, no re-mark-read needed.
**Why it happens:** Not a real pitfall if the mark-all-read API is called alongside the fetch (not as a separate user action).
**How to avoid:** In `fetchNotifications()`, after setting state, fire a PATCH to `/api/notifications/mark-read` as best-effort (don't block on it). This matches the "viewing tab marks all as read" decision.

### Pitfall 5: Password Change Without Session Invalidation
**What goes wrong:** After a successful password change, existing sessions remain valid — a stolen session cookie continues working.
**Why it happens:** Easy to forget the session cleanup step.
**How to avoid:** In `/api/user/password.ts`, after updating the hash, call `lucia.invalidateUserSessions(userId)` and redirect to sign-in, or issue a new session immediately.

## Code Examples

### Review Status Query Extension
```typescript
// In /api/reviews/user.ts — add moderation_notes and disputed join
const reviews = await db.prepare(`
  SELECT
    r.id,
    r.building_id,
    b.address as building_address,
    b.slug as building_slug,
    b.neighborhood,
    b.city,
    r.overall_score,
    r.status,
    r.is_verified,
    r.created_at,
    r.updated_at,
    r.review_title,
    r.moderation_notes,
    CASE WHEN d.id IS NOT NULL THEN 1 ELSE 0 END as has_open_dispute
  FROM reviews r
  JOIN buildings b ON r.building_id = b.id
  LEFT JOIN disputes d ON d.review_id = r.id AND d.status = 'pending'
  WHERE r.user_id = ?
  ORDER BY r.created_at DESC
`).bind(context.locals.user.id).all<UserReview>();
```

### Mark All Notifications Read (Batch)
```typescript
// PATCH /api/notifications/mark-read
await db.prepare(
  'UPDATE notifications SET read_at = unixepoch() WHERE user_id = ? AND read_at IS NULL'
).bind(userId).run();
```

### Settings Tab — Display Name Update
```typescript
// PATCH /api/user/profile
// Body: { displayName: string; notificationOptIn: boolean }
await db.prepare(
  'UPDATE users SET name = ?, notification_opt_in = ?, updated_at = unixepoch() WHERE id = ?'
).bind(displayName.trim() || null, notificationOptIn ? 1 : 0, userId).run();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate approve.ts / reject.ts | Unified PATCH /api/admin/reviews/[id] | This codebase always had unified | createNotification wires into one place only |
| `datetime('now')` SQLite | `unixepoch()` | Project convention | Must use unixepoch() in migration 0021 |

## Open Questions

1. **Does `disputes` table exist and are disputes created via an existing API?**
   - What we know: Migrations include `0012_disputes.sql`. `api-types.ts` has `Dispute` and `DisputeOutcome` types. The `AuditActionType` in api-types includes `dispute_upheld`, `dispute_dismissed`, `dispute_partially_valid`. Globbing for `src/pages/api/admin/disputes` returned no results.
   - What's unclear: Whether dispute routes exist in an unexpected location, or are pending implementation, or were combined into another file.
   - Recommendation: Planner should add a discovery task early — read `0012_disputes.sql` and search for dispute-related API routes. The `createNotification` wiring for `dispute_resolved` depends on finding this integration point.

2. **Should "Disputed" in the tenant dashboard derive from the disputes table or a reviews.status value?**
   - What we know: The reviews table CHECK constraint allows `'pending', 'approved', 'rejected', 'flagged'` — not `'disputed'`. A disputes table exists (migration 0012).
   - What's unclear: Whether admin workflow sets reviews.status = 'disputed' (violating the constraint) or simply creates a dispute record.
   - Recommendation: Derive "Disputed" from a LEFT JOIN on the disputes table where disputes.status = 'pending'. Do NOT add 'disputed' to reviews.status CHECK constraint unless the admin route explicitly requires it.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via `npm test`) |
| Config file | vitest.config.ts or package.json |
| Quick run command | `npm test -- notifications` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | Reviews query returns moderation_notes and has_open_dispute | unit | `npm test -- user-reviews` | ❌ Wave 0 |
| DASH-02 | Rejected review banner shows moderation_notes; approved links to building | manual (UI) | n/a | manual-only |
| DASH-03 | Verification banner renders when email_verified=0 | manual (UI) | n/a | manual-only — already functional |
| DASH-04 | Profile PATCH validates display name; password PATCH requires current password; email PATCH blocks OAuth users | unit | `npm test -- user-settings` | ❌ Wave 0 |
| DASH-06 | createNotification inserts correct row; mark-read sets read_at | unit | `npm test -- notifications` | ❌ Wave 0 |
| DASH-07 | Unread count query returns 0 for no notifications, N for unread | unit | `npm test -- notifications` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/notifications.test.ts` — covers DASH-06/07 (createNotification, mark-read logic)
- [ ] `src/lib/__tests__/userSettings.test.ts` — covers DASH-04 (profile update, password change, email change rules)
- [ ] Migration 0021_notifications.sql — replace stub `SELECT 1` with actual schema

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `ProfileDashboard.tsx`, `ReviewListItem.tsx`, `profile.astro`, `Header.astro`, `api/reviews/user.ts`, `api/admin/reviews/[id].ts`, `lib/auth.ts`, `lib/api-types.ts`, all migrations
- `13-CONTEXT.md` — locked user decisions
- `STATE.md` — project decisions including NOT NULL + DEFAULT constraint requirement for D1 ALTER TABLE

### Secondary (MEDIUM confidence)
- Inferred from `0012_disputes.sql` existence + `AuditActionType` in api-types — dispute infrastructure exists but routes location unknown

### Tertiary (LOW confidence — needs verification)
- Dispute API route location: flagged as Open Question above

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all patterns confirmed by reading actual source files
- Architecture: HIGH — directly derived from existing ProfileDashboard, Header.astro, and API route patterns in the codebase
- Notification schema: HIGH — D1 SQLite constraints well understood; schema designed around confirmed access patterns
- Dispute integration: MEDIUM — dispute table confirmed; route location unknown

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable codebase, no fast-moving external dependencies)
