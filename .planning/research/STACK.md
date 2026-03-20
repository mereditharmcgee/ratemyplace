# Stack Research

**Domain:** Tenant housing review platform — v1.4.0 "Open Doors" feature additions
**Researched:** 2026-03-20
**Confidence:** HIGH (existing stack verified; new additions verified via live API testing and codebase review)

---

## Existing Stack (Do Not Re-Research)

The following are validated and in production. This document covers only what is NEW for v1.4.0.

| Technology | Version (current) | Status |
|------------|-------------------|--------|
| Astro | 5.16.11 | Locked — do not upgrade mid-milestone |
| @astrojs/cloudflare | 12.6.12 | Locked |
| @astrojs/react | 3.6.3 | Locked |
| React / React DOM | 18.3.1 | Locked — Cloudflare Workers requires React 18 |
| Lucia | 3.2.2 | Locked |
| Tailwind CSS | 4.1.18 | Locked |
| Resend | 6.9.2 | Locked |
| D1 / SQLite | CF managed | Locked |

---

## New Stack Decisions for v1.4.0

### No New NPM Dependencies Required

All v1.4.0 features can be implemented with the existing stack. The analysis below explains why for each feature area.

---

## Feature: Tenant Dashboard (Core + Extended)

### Recommended Pattern: Single React Island with URL Hash Routing

**Decision:** One React component (`TenantDashboard.tsx`) rendered with `client:load` on a dedicated `/dashboard` Astro page. Tab state is driven by `window.location.hash` (`#reviews`, `#saved`, `#notifications`, `#settings`).

**Why this pattern over alternatives:**

Astro islands cannot share React context across island boundaries. Splitting dashboard tabs into separate islands would require a custom pub/sub mechanism or localStorage to share state (e.g., unread notification counts updating the tab badge). A single island avoids this entirely.

Hash routing requires zero dependencies. `window.location.hash` and `hashchange` events are native browser APIs available in Cloudflare Workers context. Tab state survives page refresh and is bookmarkable with no router library needed.

**SSR data pattern:** Pass initial server-fetched data from the Astro page as props to the island. The island can re-fetch on tab switch for freshness. This prevents flash-of-empty-content on initial load while keeping data current.

```astro
<!-- src/pages/dashboard.astro -->
<TenantDashboard
  client:load
  userId={locals.user.id}
  initialReviews={userReviews}
/>
```

**Why NOT to add a tab library (Radix Tabs, Headless UI, etc.):**
Dashboard tabs are three `<button onClick>` elements and a conditional render. A headless UI tab library adds 5–15 KB of bundle for functionality that is trivial in React. The existing codebase uses no UI component libraries — stay consistent.

**Confidence:** HIGH — this is the standard Astro SSR + island pattern used in the existing admin dashboard pages.

---

## Feature: Tenant Notifications (In-App)

### Recommended Pattern: D1 Polling on Focus, NOT Web Push

**Decision:** Store notifications in a D1 `notifications` table. Poll via `fetch('/api/user/notifications')` on component mount and on `visibilitychange` (tab regains focus). No browser push, no service worker, no WebSocket.

**Why polling, not push:**

Cloudflare Workers are stateless request handlers. There is no persistent connection to push from. Durable Objects could enable WebSocket-based push, but that is a significant architectural addition (new binding, new worker class) for notification types that do not warrant real-time delivery (review approved, building saved). Users checking their dashboard will see current state immediately.

Web Push requires a service worker, VAPID key pair management, push subscription storage, and user opt-in UI. For "your review was approved" notifications, this is engineering overhead that exceeds the user value.

Resend (already integrated) covers email notifications, which are the higher-value delivery channel. In-app notifications are the secondary channel — polling is appropriate.

**Polling strategy:** Fetch on mount + on `visibilitychange` (when user returns to tab). No interval polling. Fire-and-forget on user attention signals only.

**Confidence:** HIGH — verified against Cloudflare Workers runtime constraints.

---

## Feature: Multi-City Auto-Research (Boston + New Haven)

### Boston (Existing — No Changes)

CKAN `datastore_search` API on `data.boston.gov`. Resource ID `ee73430d-96c0-423e-ad21-c4cfb54c8961`. Fully implemented in `src/pages/api/admin/buildings/[id]/enrich.ts`. No modifications needed.

### New Haven (New Addition)

**Decision:** Use the Connecticut state CAMA dataset on `data.ct.gov` (Socrata SODA API).

**Verified endpoint:** `https://data.ct.gov/resource/pqrn-qghw.json`

**Live API verification confirmed:** A direct query to this endpoint for New Haven, 187 County St returned a complete record with owner name, assessed/appraised totals, year built, bedroom/bath counts, building style, and condition. The endpoint is publicly accessible with no API key required.

**Working query pattern (Socrata SODA):**
```
GET https://data.ct.gov/resource/pqrn-qghw.json?
  property_city=New Haven
  &address_number=187
  &street_name=COUNTY ST
  &$limit=10
```

Note: `property_city` uses mixed case "New Haven" (verified). `street_name` should be UPPER case to match stored values.

**Key field mappings for the adapter:**

| CT CAMA Field | Maps to Existing Output Pattern | Notes |
|---------------|--------------------------------|-------|
| `address_number` | `address.number` | Direct |
| `street_name` | `address.street` | Stored in UPPER — normalize input |
| `property_city` | `address.city` | "New Haven" mixed case |
| `owner` | `owner` | Direct |
| `co_owner` | Available | No Boston equivalent |
| `ayb` | `yearBuilt` | Actual Year Built |
| `eyb` | `yearBuilt` fallback | Effective Year Built (use if `ayb` is 0) |
| `number_of_bedroom` | Available as new field | Not in current Boston output |
| `number_of_baths` | Available as new field | Not in current Boston output |
| `state_use_description` | `buildingType` | "Condominium", "Two Family", etc. |
| `assessed_total` | `totalValue` | Assessed total |
| `appraised_total` | Available | Appraised (market) value also present |
| `stories` | Available as new field | Not in current Boston output |
| `condition_description` | `overallCondition` | "Good", "Average", "Fair" |
| `grade_desc` | Available | "Average", "Above Average", etc. |

**Data freshness:** Dataset is "2024 Connecticut Parcel and CAMA Data". Valuation year in tested records is 2021 (last statewide revaluation). Owner data reflects current assessor records. This is acceptable for the human-in-the-loop auto-research use case where an admin reviews results before applying.

**Adapter pattern implementation:**

Refactor the enrich endpoint to use a city-routing adapter pattern:

```
src/lib/enrichAdapters/
  index.ts          — routes by building.city to correct adapter, exports EnrichResult interface
  boston.ts         — Boston CKAN logic extracted from current enrich.ts
  newHaven.ts       — New CT CAMA Socrata adapter
```

The `EnrichResult` interface stays identical between adapters. The API route at `src/pages/api/admin/buildings/[id]/enrich.ts` becomes a thin router.

No new dependencies. Both APIs are plain `fetch()` calls. Zero npm additions.

**Confidence:** HIGH — live API verified, field schema confirmed, adapter pattern maps directly to existing code structure.

**Alternative considered: Regrid API**

Regrid has Connecticut parcel coverage and a polished address lookup API. Rejected because: (1) paid service with pricing requiring a sales contact — opaque cost for an open-source civic tool, (2) the free CT state CAMA dataset covers New Haven at no cost and confirmed working, (3) external paid dependency adds SLA and budget risk. Regrid is the right choice only if the state dataset proves insufficient for other cities in future milestones (small CT towns may lack coverage in the state dataset).

**Confidence on CT CAMA coverage:** MEDIUM — confirmed for New Haven; coverage for smaller CT towns not verified. This is a v1.4.0 concern only for New Haven.

---

## Feature: Contact Form with D1 Storage

### No New Dependencies

The contact form uses only existing patterns:

- Turnstile (already integrated) for bot protection on the public form
- D1 for submission storage (`contact_submissions` table, migration 0019)
- Resend (already integrated) for admin notification email on new submissions
- Standard Astro API route (`POST /api/contact`) + React island form component

**D1 table design:**
```sql
-- migration 0019_contact_submissions.sql
CREATE TABLE contact_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  admin_notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_contact_submissions_status ON contact_submissions(status);
CREATE INDEX idx_contact_submissions_created ON contact_submissions(created_at DESC);
```

Pattern mirrors the `bug_reports` table (migration 0018). Consistent schema, no new patterns introduced.

**Confidence:** HIGH — direct extension of existing bug_reports implementation.

---

## Feature: Saved Buildings

### No New Dependencies

Simple D1 join table. One row per (user_id, building_id) pair. Displayed in the tenant dashboard.

**D1 table design:**
```sql
-- migration 0020_saved_buildings.sql
CREATE TABLE saved_buildings (
  user_id TEXT NOT NULL,
  building_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, building_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (building_id) REFERENCES buildings(id)
);
CREATE INDEX idx_saved_buildings_user ON saved_buildings(user_id);
```

Composite PRIMARY KEY enforces uniqueness at DB level. Mirrors the UNIQUE constraint pattern on the `disputes` table (`UNIQUE(review_id)`).

**Confidence:** HIGH — standard SQLite join table pattern.

---

## Feature: In-App Notifications Table

**D1 table design:**
```sql
-- migration 0021_notifications.sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  entity_type TEXT,
  entity_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
```

`type` values: `review_approved`, `review_rejected`, `dispute_resolved`, `building_saved_new_review`

The composite index on `(user_id, read)` is the critical query path — fetching unread count per user without a full table scan.

**Confidence:** HIGH — standard pattern, no D1-specific concerns.

---

## D1 Migration Plan for v1.4.0

**Next migration number:** 0019 (current latest is 0018_bug_reports.sql)

| Migration # | Name | Contents |
|-------------|------|----------|
| 0019 | contact_submissions | Contact form storage |
| 0020 | saved_buildings | Saved buildings join table |
| 0021 | notifications | In-app notification queue |
| 0022 | new_survey_fields | `section_8_accepted`, `safely_lit` columns on reviews |

**D1 constraints relevant to new tables:**

- No `RETURNING` clause — generate IDs before INSERT using `generateIdFromEntropySize(10)` from Lucia (existing pattern).
- No cross-request transactions — each API endpoint is atomic on its own request.
- Composite index `(user_id, read)` on notifications is critical for dashboard unread count query performance.
- `INTEGER DEFAULT (unixepoch())` for all timestamps — consistent with all existing tables.

**Confidence:** HIGH — verified against existing D1 patterns throughout the codebase.

---

## Features Requiring No Stack Research

| Feature | Why No New Stack |
|---------|-----------------|
| Move-in date display bug | Pure logic fix in existing component |
| Full review in admin pending view | UI additions to existing admin Astro page |
| UGC disclaimers | Copy/markup additions to existing Astro pages |
| Review verification UX | UI changes to existing flows, no new libraries |
| New survey fields (Section 8, safely lit) | D1 migration + existing form/scoring patterns |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Radix UI / Headless UI | Adds bundle weight for tab/dialog primitives achievable with Tailwind + `useState` | Native React state + Tailwind |
| Zustand / Jotai / React Context providers | State management overkill for a dashboard with 4 tabs and shallow component tree | Local `useState` + prop drilling |
| React Router / TanStack Router | Full router for hash-based tab navigation is unnecessary complexity | `window.location.hash` + `hashchange` listener |
| Web Push / service worker | Stateless Workers runtime cannot maintain push connections; setup complexity exceeds value for this notification scope | D1 polling on `visibilitychange` |
| Regrid API (paid) | Paid, requires sales contact for pricing, adds external dependency and SLA risk | Free CT state CAMA dataset (`data.ct.gov`) |
| tRPC / GraphQL | API abstraction not needed; existing `fetch` patterns in React islands are sufficient | Plain Astro API routes |
| React 19 | Cloudflare Workers constraint — React 18 only until Workers runtime adds full React 19 support | Stay on React 18.3.1 |
| `@faker-js/faker` (already dev dep) | Was added in v1.3.0 for seeding — already installed | Already available |

---

## Installation

No new packages required for any v1.4.0 feature.

```bash
# No npm install needed — all features use existing dependencies
```

All features use: existing D1 queries, existing Resend integration, existing Turnstile integration, native `fetch()` for external APIs, and React `useState`/`useEffect` for dashboard interactivity.

---

## Sources

| Claim | Source | Confidence |
|-------|--------|------------|
| CT CAMA endpoint and New Haven field schema | Live API test: `https://data.ct.gov/resource/pqrn-qghw.json?property_city=New%20Haven&address_number=187&$limit=2` | HIGH |
| CT CAMA dataset scope and coverage | [2024 Connecticut Parcel and CAMA Data — catalog.data.gov](https://catalog.data.gov/dataset/2024-connecticut-parcel-and-cama-data) | HIGH |
| Astro islands cannot share React context | [Astro Islands Architecture docs](https://docs.astro.build/en/concepts/islands/) | HIGH |
| Cloudflare Workers are stateless (no push) | [Cloudflare D1 and Workers docs](https://developers.cloudflare.com/d1/) | HIGH |
| Regrid Connecticut parcel coverage | [Regrid Parcel API](https://regrid.com/api) — coverage confirmed, pricing opaque (sales required) | MEDIUM |
| Boston adapter — existing implementation | `src/pages/api/admin/buildings/[id]/enrich.ts` in codebase | HIGH |
| Migration numbering | `migrations/` directory inspection — latest is 0018 | HIGH |

---
*Stack research for: RateMyPlace v1.4.0 "Open Doors" — new feature additions only*
*Researched: 2026-03-20*
