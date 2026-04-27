# Pitfalls Research

**Domain:** Adding tenant dashboards, contact forms, notification systems, multi-source data adapters, and UGC disclaimers to an existing Astro 5 + Cloudflare Pages + D1 review platform
**Researched:** 2026-03-20
**Confidence:** HIGH — based on direct codebase inspection (migrations 0001–0018, all API routes, scoring system, email.ts, rateLimit.ts) and verified patterns from the v1.3.0 QA milestone

---

## Critical Pitfalls

Mistakes that require schema rollbacks, data loss, broken production pages, or legal exposure.

---

### Pitfall 1: Adding NOT NULL Columns to the Reviews Table Without DEFAULT Values

**What goes wrong:**
Adding `section_8_accepted` or `safely_lit` as `NOT NULL INTEGER` columns without a DEFAULT on a table that already has real production reviews fails in D1. SQLite (and D1) rejects `ALTER TABLE ... ADD COLUMN col INTEGER NOT NULL` unless a DEFAULT is provided, because existing rows would violate the constraint immediately.

**Why it happens:**
Developers write migration SQL that works for fresh inserts but forget existing rows. The reviews table currently has 100+ rows in the seed data and will have real rows in production. Running a migration like:
```sql
ALTER TABLE reviews ADD COLUMN section_8_accepted INTEGER NOT NULL;
```
will throw `Cannot add a NOT NULL column with no default value` in D1.

**How to avoid:**
Always provide a DEFAULT when adding NOT NULL columns to existing tables:
```sql
-- Migration 0019_add_survey_fields.sql
ALTER TABLE reviews ADD COLUMN section_8_accepted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN safely_lit INTEGER NOT NULL DEFAULT 0;
```
If a DEFAULT of 0 is semantically wrong for some rows (e.g., 0 means "No" but you want "Unknown" for old reviews), use a nullable column with NULL representing "not answered":
```sql
ALTER TABLE reviews ADD COLUMN section_8_accepted INTEGER;  -- NULL = not answered
ALTER TABLE reviews ADD COLUMN safely_lit INTEGER;
```
Then handle NULL in the scoring logic — skip fields where value IS NULL rather than treating them as 0.

**Warning signs:**
Migration runs locally but throws an error against the remote D1. Or migration appears to succeed locally but existing reviews have unexpected 0 values in scoring calculations.

**Phase to address:** Survey fields phase (adding `section_8_accepted`, `safely_lit`). Also applies to any new nullable columns added for saved buildings, notification preferences, or contact message metadata.

---

### Pitfall 2: Migration 0019+ Number Collision — Assuming Sequential Is Safe

**What goes wrong:**
Two features in v1.4.0 both need new migrations (survey fields + contact form storage + notification preferences + saved buildings). If multiple migrations are written in parallel or assigned numbers without checking, two migrations get the same number (e.g., both become `0019_xxx.sql`). Wrangler applies migrations by filename order. A collision means one migration silently overwrites the other in the applied-migrations tracking, and one schema change never runs.

**Why it happens:**
The current highest migration is `0018_bug_reports.sql`. If two phases both start their migration at `0019_`, the second one will either conflict on filename or (if named differently) both be `0019` in the wrangler migration log, causing one to be skipped.

**How to avoid:**
Assign migration numbers sequentially with a strict plan before writing any migration:
- `0019_` — survey fields (section_8_accepted, safely_lit)
- `0020_` — contact messages table
- `0021_` — saved buildings table
- `0022_` — notification preferences column on users (or separate table)

Write the list before writing any SQL. If phases are built in a different order, renumber before applying.

**Warning signs:**
`wrangler d1 migrations apply` reports "already applied" for a migration you just wrote. Or the `d1_migrations` table shows duplicate version numbers.

**Phase to address:** Before any migration is written for v1.4.0. Establish the numbering plan in the first phase.

---

### Pitfall 3: Tenant Notifications Without an Unsubscribe Mechanism

**What goes wrong:**
Sending notification emails (review status changes, moderation outcomes, contact form replies) without a one-click unsubscribe link violates CAN-SPAM (US), CASL (Canada), and GDPR (EU). Resend's sending reputation degrades when recipients mark emails as spam. At scale, this can cause Resend to suspend the account or reduce deliverability to zero.

**Why it happens:**
Transactional email flows (password reset, email verification) legally don't require unsubscribe. But "your review was approved" or "you have a new notification" are borderline marketing/notification emails. Developers treat them like transactional email and skip unsubscribe infrastructure.

The existing `email.ts` has no unsubscribe mechanism in any of its four email functions. This was fine for purely transactional emails (password reset, verification, dispute confirmation). It becomes a legal requirement the moment notification emails go out to tenants who didn't explicitly request them.

**How to avoid:**
Before sending any notification email that isn't a direct response to a user action (password reset, email verification), add:
1. A `notification_opt_in` column to the users table (default 1 for new users, present a preference toggle in the dashboard)
2. A signed, one-click unsubscribe link in every notification email body (not just a footer link to settings)
3. An API endpoint `/api/notifications/unsubscribe?token=...` that sets `notification_opt_in = 0` without requiring sign-in

For the contact form reply emails (admin replying to a contact message), include a plain-text unsubscribe line. It takes 10 minutes and eliminates legal risk.

**Warning signs:**
The notification email template in `email.ts` has no unsubscribe footer. The users table has no opt-in column.

**Phase to address:** Contact form + notification system phase. Must be built before the first notification email is sent to real users.

---

### Pitfall 4: UGC Disclaimers on Review Pages Without Inline Proximity

**What goes wrong:**
Adding disclaimers only to the Terms of Service page (which already exists at `/terms`) or the footer provides no meaningful legal protection. Courts and regulators in defamation cases have found that disclaimers buried in ToS, reached via a footer link, provide weak protection compared to disclaimers shown in close proximity to the content itself — particularly for statements of fact (e.g., "this landlord has pests").

The existing ToS has good language (Section 230 citation, "your reviews represent your personal opinions," indemnification). But review pages — where a landlord is most likely to object — currently show reviews with no inline disclaimer.

**Why it happens:**
Developers add disclaimers to legal pages and consider the job done. Inline disclaimers feel cluttered and are deferred.

**How to avoid:**
Add a concise inline disclaimer to:
1. **Every building review page** (`/building/[slug]`) — a single sentence above or below the reviews list: *"Reviews reflect individual tenant experiences and personal opinions. RateMyPlace does not verify or endorse review content."*
2. **The review submission confirmation** — immediately after a review is submitted: *"Your review will be visible once approved. By submitting, you confirm you lived at this property and take responsibility for the accuracy of your statements."*
3. **The review form itself** — a checkbox or acknowledged consent before the final submit button (a submission-time consent record is stronger evidence than a ToS scroll).

The disclaimer does not need to be visually prominent — even small gray text is sufficient — but it must be on the same page as the content.

**Warning signs:**
Building pages render review cards with no disclaimer text near them. The review submission form has no consent acknowledgment near the submit button.

**Phase to address:** UGC disclaimers phase. Treat as a prerequisites block before any real-user launch.

---

### Pitfall 5: Multi-City Adapter Pattern Without City Routing in the Enrich Endpoint

**What goes wrong:**
The current `/api/admin/buildings/[id]/enrich` endpoint hardcodes the Boston Assessing API. Adding New Haven support by adding `if (building.city === 'New Haven') ...` inline in the same file creates a God Function that grows with every new city, making it impossible to test individual city adapters in isolation, and making the URL no longer reflect a single responsibility.

More concretely: if the Boston API goes down, the adapter should fail gracefully for Boston buildings without impacting New Haven. If they are in the same function with shared error handling, a failure in one city's adapter can affect the other.

**Why it happens:**
The adapter pattern is easy to defer — "I'll just add an if/else for now." It works for two cities but immediately becomes a problem at three.

**How to avoid:**
Create a proper adapter interface before writing the second city:
```typescript
// src/lib/enrichment/types.ts
export interface CityAdapter {
  city: string;         // e.g., 'Boston'
  canEnrich(building: { city: string }): boolean;
  enrich(building: Building): Promise<EnrichmentResult>;
}

// src/lib/enrichment/boston.ts
export const bostonAdapter: CityAdapter = { ... };

// src/lib/enrichment/new-haven.ts
export const newHavenAdapter: CityAdapter = { ... };

// src/lib/enrichment/index.ts
const adapters: CityAdapter[] = [bostonAdapter, newHavenAdapter];
export function getAdapter(building: Building): CityAdapter | null {
  return adapters.find(a => a.canEnrich(building)) ?? null;
}
```

The API route becomes trivially simple:
```typescript
const adapter = getAdapter(building);
if (!adapter) return 200 with { results: [], message: 'No adapter for this city' };
return adapter.enrich(building);
```

Each adapter is independently testable. Adding a third city is a new file, not a modified existing file.

**Warning signs:**
The enrich endpoint has any `if (city === ...)` branching logic. There is no `src/lib/enrichment/` directory.

**Phase to address:** Multi-city auto-research phase. Write the adapter interface first, before implementing the New Haven adapter.

---

### Pitfall 6: Dashboard N+1 Queries — One DB Call Per Review

**What goes wrong:**
The tenant dashboard loads a user's reviews, then for each review also loads the building details, verification status, and dispute status in separate queries — one query per review. With 5 reviews, that is 5 × 3 = 15 queries on a single page load. D1's per-request pricing and cold start latency makes N+1 patterns more expensive than in a traditional hosted database.

The existing `/api/reviews/user` endpoint already does this correctly with a JOIN. But the dashboard may call multiple endpoints — `/api/reviews/user`, then individually fetch verification status or dispute status per review — especially if the dashboard is built as a React island making multiple `useEffect` calls.

**Why it happens:**
React island dashboards fetch data independently via multiple `useEffect` hooks ("load reviews, load verification status, load saved buildings"), making parallel requests but duplicating data across calls and sometimes sequencing them when they could be joined server-side.

**How to avoid:**
Create a single `/api/dashboard` endpoint that returns all data the dashboard needs in one response:
```json
{
  "reviews": [...with building + dispute + verification status],
  "savedBuildings": [...],
  "notificationPreferences": { ... },
  "unreadNotifications": 0
}
```
Perform all necessary JOINs server-side. The React island receives one prop object. Only one D1 round-trip occurs on page load.

If the dashboard grows complex, split into logical sections (reviews vs. saved buildings) with separate endpoints, but each endpoint should still do a single query with JOINs, not multiple queries per item.

**Warning signs:**
Dashboard React component has multiple `useEffect(() => fetch('/api/...'), [])` calls at the top level. Each call hits a different endpoint and all run on mount.

**Phase to address:** Tenant dashboard phase. Design the API contract before building the React component.

---

### Pitfall 7: Contact Form Without Rate Limiting Enables Spam and Admin Inbox Flooding

**What goes wrong:**
The new contact form stores messages in D1 and sends a Resend notification to the admin. Without rate limiting, a malicious actor can POST thousands of messages to `/api/contact`, filling the `contact_messages` D1 table and triggering thousands of Resend notification emails, which will exhaust the Resend free tier (100 emails/day) and potentially flag the account for spam behavior.

The bug report form (`/api/bug-reports`) uses Turnstile but no database-level rate limiting. The contact form needs both.

**How to avoid:**
Apply the existing `checkRateLimit` pattern (already in `src/lib/rateLimit.ts`) to the contact form endpoint:
```typescript
const rl = await checkRateLimit(db, getClientIP(context), 'contact', 3, 3600); // 3/hour per IP
if (!rl.allowed) return 429;
```
Also: cap the Resend notification to a digest (if more than 5 contact messages arrive in an hour, send one "you have 5 new messages" email, not 5 individual emails). Store messages in D1 (which the contact form already plans to do) and let the admin read them in the admin panel rather than relying on email for every message.

**Warning signs:**
Contact form API endpoint calls Resend on every successful POST without a rate limit guard. No call to `checkRateLimit` in the handler.

**Phase to address:** Contact form phase. Add rate limiting and Resend digest before deploying.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline city logic in enrich endpoint (`if city === 'Boston'`) | Faster to ship New Haven | Every new city requires modifying a shared file; untestable in isolation | Never — the adapter takes 1 extra hour and is worth it |
| Sending notifications without opt-out | Simpler email.ts | CAN-SPAM liability, Resend suspension, user complaints | Never for unsolicited notification emails |
| Dashboard calls 4 separate API endpoints | Each endpoint is simpler | N+1 latency, D1 cost, Cloudflare Workers request overhead | Never — join server-side, not client-side |
| UGC disclaimer only in ToS | Legal team satisfied | Weak defamation protection when disclaimer is 3 clicks from the content | Never for review-display pages |
| Adding boolean columns as `INTEGER NOT NULL` with no DEFAULT | Strict type checking | Migration fails on existing production data | Never on tables with existing rows |
| Contact form emails sent on every POST | Simple implementation | Resend quota exhaustion, spam risk | Only if contact volume is < 5/day (unacceptable assumption pre-launch) |
| New survey fields scored as 0 when NULL | Simple scoring math | Old reviews (NULL = "not answered") scored lower than new reviews for no reason | Never — NULL should mean "skip" in weighted average |

---

## Integration Gotchas

Common mistakes when connecting to external services or extending existing integrations.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Boston Assessing API (CKAN) | Hardcoding FY2026 resource ID `ee73430d-...` without documenting it | Add a comment with the data source URL and fiscal year so the next developer knows when to update it |
| New Haven property API | Assuming same CKAN format as Boston | Investigate API format before writing adapter — New Haven may use Socrata, GIS REST, or a different schema entirely |
| Resend (notifications) | Creating a new `Resend` instance per email call (already done in email.ts) | This is fine for Cloudflare Workers (no persistent connection cost), but be aware the constructor call counts toward Worker CPU time |
| Resend (notifications) | Adding new email function directly to `email.ts` without an unsubscribe parameter | Pass `unsubscribeUrl` as a required parameter to any new notification email function so it cannot be omitted |
| D1 (saved buildings) | Using the user_id + building_id combination without a UNIQUE constraint | Without `UNIQUE(user_id, building_id)`, a user can save the same building multiple times, corrupting saved count and causing duplicate display |
| Cloudflare Turnstile | Adding Turnstile to the contact form but not validating server-side | The Turnstile token must be verified via the `verifyTurnstile()` function already in `src/lib/turnstile.ts` — client-side validation only is trivially bypassed |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Tenant dashboard fetches all user reviews with no pagination | Dashboard slow for users with 5+ reviews (each includes full building JOINs) | Add LIMIT to the dashboard query; paginate or lazy-load older reviews | Starts degrading at 10+ reviews per user; unlikely pre-launch but design for it |
| Saved buildings table queried with no index on user_id | Slow saved buildings load as table grows | Add `CREATE INDEX idx_saved_buildings_user ON saved_buildings(user_id)` in the creation migration | Breaks at ~10,000 saved building rows across all users |
| Multi-city enrich making sequential API calls | Admin "Auto-Research" button takes 3–5s | Each city adapter should independently time out (2s max) and return empty results, not block | Immediate — external API latency is unpredictable |
| Rate limit table scanned without partial index | Every contact form POST does a full `rate_limits` table scan | The existing `rateLimit.ts` pattern already cleans up expired rows, but add `CREATE INDEX idx_rate_limits_key_created ON rate_limits(rate_key, created_at)` for the contact endpoint specifically | Breaks at ~50,000 rate limit rows (easily reached with spam) |
| `building_scores` / `landlord_scores` not updated after new survey fields | New fields collected but never aggregated | If `section_8_accepted` or `safely_lit` should appear in aggregate displays, the score update trigger/recalculation logic must explicitly include them | Immediate — new fields will show as NULL in aggregate tables |

---

## Security Mistakes

Domain-specific security issues specific to v1.4.0 features.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Contact form stores message body without sanitization | Stored XSS in admin panel — an attacker submits `<script>` tags in a message, admin views it, script executes | Escape HTML in the admin panel display of contact messages; do not render contact message bodies as raw HTML |
| Saved buildings endpoint returns ALL saved buildings for any authenticated user if user_id is not scoped to `context.locals.user.id` | User A can retrieve User B's saved buildings by calling the API with a different user_id | Always scope saved buildings queries to `WHERE user_id = context.locals.user.id` — never accept user_id from the request body |
| Notification email tokens that expire but are not deleted from DB | Token table grows unboundedly; expired tokens waste storage | Add cleanup: `DELETE FROM notification_tokens WHERE expires_at < unixepoch()` on each token creation (same pattern as email_verification_tokens) |
| Multi-source adapter makes outbound HTTP to untrusted city APIs without timeout | Cloudflare Worker can be held open for 30s by a slow external API, consuming CPU time | Set a 3-second `AbortController` timeout on all external API calls in city adapters |
| Contact form accepts message from unauthenticated users, stores email field as-is | Spam with fake emails; admin wastes time on junk | Require authentication for contact form OR apply strict Turnstile + rate limit (3/hour/IP) for anonymous submissions |

---

## UX Pitfalls

Common user experience mistakes in the features being added.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Dashboard shows "Review Pending" with no explanation of what "pending" means or how long it takes | Users submit a review, see "Pending," and re-submit thinking it failed — creating duplicate submission attempts | Inline explanation: "Your review is under moderation. This typically takes 1–3 business days." |
| Move-in date bug fix changes how existing data is displayed without showing what changed | Users see different dates than before; may report as a bug | Add a note to the migration comment explaining the display fix, and verify existing data still renders correctly after the fix |
| Notifications sent for review approved/rejected, but no way to turn them off from within the email | Users mark email as spam; Resend deliverability degrades | One-click unsubscribe link in every notification email footer (also required for CAN-SPAM compliance — see Pitfall 3) |
| Saved buildings feature with no confirmation on "unsave" | Users accidentally unsave a building and cannot recover it | Add a simple undo toast or confirmation for destructive save actions |
| Contact form submits successfully but admin never sees it because Resend notification goes to spam | User believes their message was received; admin misses it | Store all contact messages in D1 admin panel as primary delivery mechanism; Resend notification is secondary |
| Inline UGC disclaimers styled with `text-gray-400` (too low contrast) | Screen reader and accessibility users may miss disclaimer; legally weakens the protection | Use `text-gray-500` minimum; ensure disclaimer passes WCAG 2.1 AA contrast ratio |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Contact form:** Often missing rate limiting — verify `checkRateLimit` is called before the INSERT and before the Resend notification send
- [ ] **Contact form:** Often missing server-side Turnstile validation — verify `verifyTurnstile()` is called (not just client-side widget rendering)
- [ ] **Survey fields (section_8_accepted, safely_lit):** Often missing from the scoring calculation — verify `src/lib/scoring.ts` includes new fields with correct weights AND that NULL handling skips them rather than treating as 0
- [ ] **Survey fields:** Often missing from the `ReviewCard.astro` display — verify new fields are shown in the card or at minimum are not silently dropped
- [ ] **UGC disclaimers:** Often only added to Terms of Service — verify disclaimer text exists on `/building/[slug]` review list AND on the review submission form/confirmation
- [ ] **Tenant dashboard notifications:** Often missing unsubscribe — verify every notification email has a working unsubscribe link that does not require sign-in to use
- [ ] **Saved buildings:** Often missing the UNIQUE constraint — verify `UNIQUE(user_id, building_id)` is in the CREATE TABLE statement
- [ ] **Multi-city adapter:** Often the Boston adapter behavior is changed when adding New Haven — verify Boston enrich still works after adapter refactor (run a manual enrich on a Boston building)
- [ ] **Notification preferences:** Often stored as a user table column without a migration — verify migration 0019+ actually adds the column before the dashboard reads it
- [ ] **Move-in date bug fix:** Often fixes the display but breaks something in the E2E tests that asserted the old (buggy) display format — verify E2E tests updated to match the fix

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| NOT NULL migration failed on production D1 | MEDIUM | Write a new migration that drops and recreates the column as nullable, or adds with a DEFAULT; apply with `wrangler d1 migrations apply --remote` |
| Duplicate migration number applied | HIGH | Inspect `d1_migrations` table in production (`wrangler d1 execute --remote --command "SELECT * FROM d1_migrations"`); manually delete the incorrect entry; rename the file with the next available number and re-apply |
| Notification emails sent without unsubscribe | MEDIUM | Deploy unsubscribe endpoint immediately; add unsubscribe link to email templates; monitor Resend dashboard for spam complaints |
| N+1 dashboard queries degrading performance | LOW | Add a combined `/api/dashboard` endpoint; update the React island to use it; the old individual endpoints can remain for backward compat |
| Contact form spammed before rate limit was added | LOW | Truncate `contact_messages` table; add rate limit; redeploy |
| Adapter refactor broke Boston enrich | LOW | Roll back `src/lib/enrichment/boston.ts` to the inline version; Boston adapter is the only one used in production until the refactor is validated |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| NOT NULL migration without DEFAULT (Pitfall 1) | Survey fields phase | Run migration against local DB with existing seed data; verify old reviews query correctly |
| Migration number collision (Pitfall 2) | First phase that writes a migration | Assign all migration numbers in the roadmap plan before any SQL is written |
| Notifications without unsubscribe (Pitfall 3) | Contact form + notifications phase | Send a test notification to a real email; verify unsubscribe link works without sign-in |
| UGC disclaimers only in ToS (Pitfall 4) | UGC disclaimers phase | Manual review of `/building/[slug]`, review submission form, and confirmation page |
| Multi-city adapter as God Function (Pitfall 5) | Multi-city auto-research phase | Adapter interface defined before New Haven code is written; Boston adapter passes existing manual tests |
| Dashboard N+1 queries (Pitfall 6) | Tenant dashboard phase | Check browser Network tab: exactly one (or two) API calls on dashboard load, not four or more |
| Contact form without rate limiting (Pitfall 7) | Contact form phase | Attempt >3 POST requests in one hour from same IP; verify 429 response on the 4th |

---

## Sources

- Codebase inspection: `migrations/0001–0018`, `src/pages/api/**`, `src/lib/email.ts`, `src/lib/rateLimit.ts`, `src/lib/scoring.ts`, `src/pages/terms.astro`, `src/pages/contact.astro` — HIGH confidence (direct inspection)
- [D1 ALTER TABLE constraints](https://developers.cloudflare.com/d1/sql-api/d1-sql-api/) — NOT NULL column addition requires DEFAULT — HIGH confidence
- [CAN-SPAM Act Requirements](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) — unsubscribe requirement for commercial email — HIGH confidence
- [Section 230 Communications Decency Act](https://www.law.cornell.edu/uscode/text/47/230) — platform safe harbor — HIGH confidence
- [Resend Terms of Service: Spam Policy](https://resend.com/legal/anti-spam-policy) — account suspension for spam behavior — HIGH confidence
- [Cloudflare Workers CPU time limits](https://developers.cloudflare.com/workers/platform/limits/) — AbortController timeout necessity for external calls — HIGH confidence
- General pattern: Astro island dashboard anti-pattern (multiple useEffect fetches) — MEDIUM confidence (common community pattern, verified against project codebase architecture)

---
*Pitfalls research for: v1.4.0 "Open Doors" — feature additions to existing tenant review platform*
*Researched: 2026-03-20*
