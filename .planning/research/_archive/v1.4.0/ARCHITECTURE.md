# Architecture Research

**Domain:** Tenant housing review platform — v1.4.0 "Open Doors" feature integration
**Researched:** 2026-03-20
**Confidence:** HIGH (based on direct codebase inspection)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Cloudflare Pages (CDN edge)                     │
├─────────────────────────────────────────────────────────────────────┤
│  Astro SSR Pages (.astro)             React Islands (.tsx)            │
│  ┌──────────────────────┐  ┌────────────────────────────────────┐    │
│  │ profile.astro        │  │ TenantDashboard.tsx (new)           │    │
│  │ (modify: more props) │  │  - tab: My Reviews (existing)       │    │
│  │                      │  │  - tab: Saved Buildings (new)       │    │
│  │ contact.astro        │  │  - tab: Notifications (new)         │    │
│  │ (modify: wire POST)  │  └────────────────────────────────────┘    │
│  └──────────────────────┘  ┌────────────────────────────────────┐    │
│  ┌──────────────────────┐  │ UGCDisclaimer.astro (new, static)   │    │
│  │ building/[slug].astro│  │  - variant: banner | inline         │    │
│  │ (modify: add         │  │  - used on 6+ surfaces              │    │
│  │  UGCDisclaimer)      │  └────────────────────────────────────┘    │
│  └──────────────────────┘                                            │
├─────────────────────────────────────────────────────────────────────┤
│                    src/pages/api/ (API Routes)                        │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────────┐  │
│  │ /api/contact     │ │ /api/dashboard/  │ │ /api/admin/          │  │
│  │ (new)            │ │  saved-buildings │ │  buildings/[id]/     │  │
│  │                  │ │  notifications   │ │  enrich (refactor)   │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────────┘  │
├─────────────────────────────────────────────────────────────────────┤
│                       src/lib/ (Business Logic)                       │
│  ┌──────────────┐ ┌──────────────────────────────┐ ┌─────────────┐   │
│  │ scoring.ts   │ │ enrichment/                  │ │ email.ts    │   │
│  │ surveyItems  │ │   index.ts  (dispatcher)     │ │ (add contact│   │
│  │ (add 2 items)│ │   types.ts  (interfaces)     │ │  template)  │   │
│  │              │ │   adapters/boston.ts         │ │             │   │
│  │              │ │   adapters/new-haven.ts      │ │             │   │
│  └──────────────┘ └──────────────────────────────┘ └─────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ notifications.ts (new helper — createNotification())         │    │
│  └──────────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────┤
│                    Cloudflare D1 (SQLite at edge)                     │
│  existing tables (10)          new tables (3)    schema changes (1)  │
│  ┌─────────────┐               ┌───────────────┐ ┌───────────────┐   │
│  │ reviews     │               │ contact_msgs  │ │ reviews:      │   │
│  │ buildings   │               │ saved_bldgs   │ │  section_8    │   │
│  │ users       │               │ notifications │ │  safely_lit   │   │
│  │ ...7 more   │               └───────────────┘ └───────────────┘   │
│  └─────────────┘                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | v1.4.0 Change |
|-----------|----------------|---------------|
| `src/pages/profile.astro` | Auth gate + SSR data load | Extend: pass unread notification count as prop |
| `src/components/profile/ProfileDashboard.tsx` | Review list + email verification | Replace with TenantDashboard.tsx or extend in-place |
| `src/components/dashboard/TenantDashboard.tsx` | Tabbed tenant self-service | New: wraps existing + adds saved + notifications tabs |
| `src/pages/api/reviews/user.ts` | Fetch user's own reviews | No change needed |
| `src/lib/email.ts` | All Resend email templates | Add `sendContactNotificationEmail()` |
| `src/lib/scoring.ts` + `surveyItems.ts` | Survey definitions + weighted scoring | Add `section_8_accepted`, `safely_lit` fields |
| `src/pages/api/admin/buildings/[id]/enrich.ts` | Boston assessing API lookup | Refactor: delegate to `lib/enrichment/index.ts` |
| `src/lib/enrichment/` | Multi-city property data adapter | New module extracted from enrich route |
| `src/components/ui/UGCDisclaimer.astro` | Shared disclaimer banner/callout | New |
| `src/lib/notifications.ts` | Notification row creation helper | New |

## Recommended Project Structure (v1.4.0 additions)

```
src/
├── lib/
│   ├── enrichment/                  # NEW: multi-city adapter module
│   │   ├── index.ts                 # enrichBuilding() dispatcher
│   │   ├── types.ts                 # CityAdapter interface, EnrichmentResult type
│   │   └── adapters/
│   │       ├── boston.ts            # Extracted from enrich.ts (existing logic)
│   │       └── new-haven.ts         # New Haven open data API adapter
│   ├── notifications.ts             # NEW: createNotification() helper
│   ├── scoring.ts                   # MODIFY: add section_8_accepted, safely_lit
│   ├── surveyItems.ts               # MODIFY: add 2 new SurveyItem entries
│   ├── email.ts                     # MODIFY: add sendContactNotificationEmail()
│   └── validation.ts                # MODIFY: add contact form validation schema
├── components/
│   ├── ui/
│   │   └── UGCDisclaimer.astro      # NEW: shared disclaimer (static Astro)
│   ├── dashboard/                   # NEW: tenant dashboard islands
│   │   ├── TenantDashboard.tsx      # Main tabbed island
│   │   ├── SavedBuildings.tsx       # Saved buildings tab panel
│   │   └── NotificationsList.tsx   # Notifications tab panel
│   └── profile/
│       └── ProfileDashboard.tsx     # MODIFY or replace with TenantDashboard
├── pages/
│   ├── profile.astro                # MODIFY: pass unreadNotifications prop
│   ├── contact.astro                # MODIFY: wire to /api/contact POST
│   ├── building/[slug].astro        # MODIFY: add UGCDisclaimer
│   ├── landlord/[slug].astro        # MODIFY: add UGCDisclaimer
│   └── api/
│       ├── contact.ts               # NEW: POST handler
│       ├── dashboard/
│       │   ├── saved-buildings.ts   # NEW: GET/POST/DELETE
│       │   └── notifications.ts     # NEW: GET, PATCH (mark read)
│       └── admin/
│           └── buildings/[id]/enrich.ts  # MODIFY: delegate to lib/enrichment/
└── migrations/
    ├── 0019_contact_messages.sql    # NEW
    ├── 0020_saved_buildings.sql     # NEW
    ├── 0021_notifications.sql       # NEW
    └── 0022_survey_section8_lit.sql # NEW (ALTER TABLE, nullable columns)
```

### Structure Rationale

- **`src/lib/enrichment/`:** The existing Boston enrichment logic is ~200 lines of API-specific code embedded in an API route. Project convention is that all business logic lives in `src/lib/`. An adapter interface keeps city-specific parsing isolated — adding New Haven requires only a new adapter file with no changes to the route or dispatcher.
- **`src/components/dashboard/`:** The current `ProfileDashboard.tsx` handles email verification and review listing. Adding saved buildings and notifications is enough scope to warrant a dedicated directory rather than growing one file. The existing component can be refactored to delegate to `TenantDashboard.tsx`.
- **`src/components/ui/UGCDisclaimer.astro`:** Static Astro component, no client JS needed. Used on building pages, landlord pages, review submission confirmation, and terms/about. Centralizing ensures legal copy stays consistent and is updated in one place.
- **`src/pages/api/dashboard/`:** Dashboard APIs are user-facing (not admin), so they live under `/api/` not `/api/admin/`. They follow the same auth-check-first pattern as all other user APIs.
- **`src/lib/notifications.ts`:** Same pattern as `src/lib/audit.ts` — a best-effort helper called inline from state-changing routes. The notification creation must not block or fail the primary action.

## Architectural Patterns

### Pattern 1: City Enrichment Adapter

**What:** A typed `CityAdapter` interface that each city adapter implements. A dispatcher in `index.ts` selects the adapter based on the building's `city` field, calls it, and returns a normalized `EnrichmentResult`.

**When to use:** Any time a city is added, or when an existing adapter needs to swap its data source.

**Trade-offs:** Adds one indirection layer. Worth it because the alternative (if/else chains in the route) grows unmaintainably at 3+ cities and blends HTTP transport concerns with business logic. Testing each adapter in isolation also becomes possible.

**Example:**
```typescript
// src/lib/enrichment/types.ts
export interface EnrichmentResult {
  yearBuilt: number | null;
  unitCount: number | null;
  buildingType: string | null;
  ownerName: string | null;
  ownerEntity: string | null;
  source: string;                     // e.g. "boston_assessing" | "new_haven_opendata"
  confidence: 'exact' | 'fuzzy' | 'none';
}

export interface CityAdapter {
  city: string;                       // matches buildings.city value (case-insensitive)
  enrich(address: string, zipCode: string | null): Promise<EnrichmentResult>;
}

// src/lib/enrichment/index.ts
import { bostonAdapter } from './adapters/boston';
import { newHavenAdapter } from './adapters/new-haven';

const adapters: CityAdapter[] = [bostonAdapter, newHavenAdapter];

export async function enrichBuilding(
  city: string,
  address: string,
  zipCode: string | null
): Promise<EnrichmentResult | null> {
  const adapter = adapters.find(
    a => a.city.toLowerCase() === city.toLowerCase()
  );
  if (!adapter) return null;
  return adapter.enrich(address, zipCode);
}
```

The API route becomes a thin coordinator:
```typescript
// src/pages/api/admin/buildings/[id]/enrich.ts (refactored)
const result = await enrichBuilding(building.city, building.address, building.zip_code);
if (!result) {
  return new Response(JSON.stringify({ error: 'No enrichment adapter for this city' }), {
    status: 404, headers: { 'Content-Type': 'application/json' }
  });
}
return new Response(JSON.stringify(result), {
  status: 200, headers: { 'Content-Type': 'application/json' }
});
```

### Pattern 2: Inline Notification Creation (best-effort)

**What:** When an event occurs (review approved, review rejected), the API route that performs the action also creates a notification row in D1 using a shared `createNotification()` helper. Errors are swallowed, same as `createAuditLog()`.

**When to use:** Every event that should surface in the tenant's notification tab.

**Trade-offs:** Notification logic is distributed across multiple routes. Mitigated by the shared helper. No alternative (no background jobs, no queues) is available in Cloudflare Workers.

**Example:**
```typescript
// src/lib/notifications.ts
import type { D1Database } from '@cloudflare/workers-types';
import { generateIdFromEntropySize } from 'lucia';

export type NotificationType = 'review_approved' | 'review_rejected' | 'system';

export async function createNotification(
  db: D1Database,
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  linkUrl?: string
): Promise<void> {
  try {
    const id = generateIdFromEntropySize(10);
    await db.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, link_url) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, userId, type, title, body, linkUrl ?? null).run();
  } catch (err) {
    // Best-effort: notification failure must not break the primary action
    console.error('Failed to create notification:', err);
  }
}
```

Called from existing admin review route after status change:
```typescript
// src/pages/api/admin/reviews/[id].ts (existing, modified)
// After approving a review:
await createNotification(
  db, review.user_id, 'review_approved',
  'Your review was approved',
  `Your review of ${buildingAddress} is now live.`,
  `/building/${buildingSlug}`
);
```

### Pattern 3: Tenant Dashboard as Tabbed Island

**What:** The existing `/profile` page uses `ProfileDashboard.tsx` as a `client:load` React island. The Astro page fetches unread notification count server-side (one fast query) and passes it as a prop to avoid flash. The island renders a tab bar: "My Reviews" (existing), "Saved" (new), "Notifications" (new).

**When to use:** Any time a new top-level section is added to the tenant's self-service area.

**Trade-offs:** All three tabs are bundled together in the initial JS. Acceptable at this scale — lazy tab loading adds complexity that is not warranted for a 3-tab UI. Three separate islands would require shared-state coordination and is messier.

**Example:**
```astro
---
// src/pages/profile.astro (modified)
const db = getDB((Astro.locals as any).runtime);
const unreadRow = await db.prepare(
  'SELECT COUNT(*) as n FROM notifications WHERE user_id = ? AND is_read = 0'
).bind(user.id).first<{ n: number }>();
const unreadNotifications = unreadRow?.n ?? 0;
---
<TenantDashboard
  client:load
  userEmail={user.email}
  userName={user.name}
  avatarUrl={user.avatarUrl}
  memberSince={memberSince}
  emailVerified={emailVerified}
  unreadNotifications={unreadNotifications}
/>
```

### Pattern 4: UGC Disclaimer Component

**What:** A single Astro component with a `variant` prop that controls layout. Imported wherever a disclaimer is needed.

**When to use:** Any page or component that displays user-submitted content: building profile pages, landlord profile pages, review cards, review submission confirmation, about page.

**Trade-offs:** None meaningful. This is purely a centralization pattern.

**Example:**
```astro
---
// src/components/ui/UGCDisclaimer.astro
interface Props {
  variant?: 'banner' | 'inline' | 'footer';
}
const { variant = 'inline' } = Astro.props;
---

{variant === 'banner' && (
  <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-6">
    Reviews represent tenant opinions. RateMyPlace does not verify the accuracy of individual claims.
  </div>
)}
{variant === 'inline' && (
  <p class="text-xs text-gray-500 mt-2">
    Content submitted by users. RateMyPlace does not verify accuracy of individual claims.
  </p>
)}
```

## Data Flow

### Contact Form Flow

```
User submits contact form (contact.astro)
    ↓
POST /api/contact (with Turnstile token)
    ↓
validateContactForm() in validation.ts
    → 400 if invalid
    ↓
INSERT into contact_messages (D1)
    ↓
sendContactNotificationEmail() (email.ts, best-effort)
    → notifies admin@ratemyplace.org
    ↓
Return { success: true }
    ↓
contact.astro renders confirmation state (client-side JS or redirect)
```

### Enrichment Flow (multi-city)

```
Admin clicks "Auto-Research" on building
    ↓
GET /api/admin/buildings/[id]/enrich
    ↓ (admin auth check)
Fetch building from D1 → { city, address, zip_code }
    ↓
enrichBuilding(city, address, zipCode) [lib/enrichment/index.ts]
    ↓
Select adapter by city field
    ├── city = "Boston" → bostonAdapter.enrich()
    │     Queries CKAN datastore_search (existing logic, extracted)
    └── city = "New Haven" → newHavenAdapter.enrich()
          Queries New Haven open data API
    ↓
Return EnrichmentResult (normalized shape)
    ↓
API route returns result to admin UI
    ↓
Admin reviews → clicks "Apply" → pre-fills edit form
    ↓
Admin saves → PATCH /api/admin/buildings/[id]
```

### Notification Generation Flow

```
Admin takes action (approve/reject review)
    [src/pages/api/admin/reviews/[id].ts]
    ↓
Primary DB write (UPDATE reviews SET status = ?)
    ↓
createAuditLog() [existing, best-effort]
    ↓
createNotification() [new, best-effort]
    INSERT into notifications (user_id, type, title, body, link_url)
    ↓
Tenant loads /profile → SSR query for unread count
    ↓
TenantDashboard island mounts → badge shown if unread > 0
    ↓
Tenant opens Notifications tab → GET /api/dashboard/notifications
    ↓
Display list → tenant clicks "Mark all read"
    PATCH /api/dashboard/notifications { markAllRead: true }
```

### Saved Buildings Flow

```
Tenant views building page
    ↓
Building page shows bookmark icon (Astro, uses fetch on click)
    ↓
POST /api/dashboard/saved-buildings { buildingId }
    ↓ (auth check, UNIQUE constraint prevents duplicates)
INSERT into saved_buildings (user_id, building_id)
    ↓
TenantDashboard "Saved" tab: GET /api/dashboard/saved-buildings
    SELECT b.*, bs.avg_overall FROM saved_buildings s
    JOIN buildings b ON s.building_id = b.id
    LEFT JOIN building_scores bs ON b.id = bs.building_id
    WHERE s.user_id = ?
```

## New D1 Tables

### `contact_messages` (migration 0019)

Mirrors the `bug_reports` table structure — admin manages both through similar patterns.

```sql
CREATE TABLE contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'replied', 'closed')),
  admin_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  replied_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_contact_status ON contact_messages(status);
CREATE INDEX idx_contact_created ON contact_messages(created_at DESC);
```

### `saved_buildings` (migration 0020)

UNIQUE constraint on (user_id, building_id) enforced at DB level, same pattern as `review_votes`.

```sql
CREATE TABLE saved_buildings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, building_id)
);
CREATE INDEX idx_saved_user ON saved_buildings(user_id);
```

### `notifications` (migration 0021)

Intentionally no FK to `reviews` — notifications survive review deletion.

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link_url TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  read_at INTEGER
);
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read);
```

### `reviews` column additions (migration 0022)

Nullable columns — NULL means the question was not answered. No data migration needed for existing reviews.

```sql
ALTER TABLE reviews ADD COLUMN section_8_accepted INTEGER;  -- NULL | 0 | 1
ALTER TABLE reviews ADD COLUMN safely_lit INTEGER;          -- NULL | 1-5 scale
```

**Relationships:** All three new tables follow existing FK conventions. `contact_messages.user_id` is nullable (anonymous submissions allowed). `saved_buildings` and `notifications` both cascade-delete with user deletion.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Boston Assessing API (CKAN) | Moved into `adapters/boston.ts` — same HTTP calls | Existing logic extracted, behavior unchanged |
| New Haven Open Data | New `adapters/new-haven.ts` | Research needed: identify resource ID and field mapping before building |
| Resend | Add `sendContactNotificationEmail()` to `email.ts` | Same pattern as existing four templates; sends to admin on contact submission |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Admin enrich route ↔ enrichment lib | Direct function call `enrichBuilding()` | Admin-only; no user-facing enrichment |
| Admin review approval ↔ notifications | `createNotification()` called inline, best-effort | Mirrors audit log pattern exactly |
| Profile Astro page ↔ TenantDashboard island | Props: unreadNotifications, emailVerified, etc. | SSR query for unread count avoids client flash |
| Contact form page ↔ API route | Standard POST with JSON body | Same pattern as bug-reports |
| UGC disclaimer ↔ all consumer pages | Astro component import, no props required for basic use | Static render |
| Saved buildings bookmark ↔ building page | Small inline fetch on click event in Astro page | Does not need a full React island for this interaction |

## Anti-Patterns

### Anti-Pattern 1: Keeping enrichment logic in the API route

**What people do:** Add New Haven as an `else if` block in `enrich.ts`, growing it to 400+ lines.

**Why it's wrong:** City-specific parsing, field mapping, and address normalization are mixed with HTTP response handling. Testing requires mocking the Astro API context. Three cities makes this unmanageable.

**Do this instead:** Extract to `src/lib/enrichment/` with the adapter interface. The route becomes ~20 lines: auth check, fetch building, call `enrichBuilding()`, return result.

### Anti-Pattern 2: Separate Astro page for the tenant dashboard

**What people do:** Create `/dashboard.astro` as a distinct route from `/profile.astro`.

**Why it's wrong:** Duplicates the auth check, SSR data load, and layout. Creates navigation confusion. Forces a URL change that breaks any existing links or bookmarks. The profile page already exists and already has auth gating.

**Do this instead:** Extend `/profile.astro` to pass additional props to a `TenantDashboard.tsx` island. URL stays `/profile`. Existing behavior is preserved, new features are additive.

### Anti-Pattern 3: Generating notifications from a separate scheduled endpoint

**What people do:** Create a background job or cron endpoint that scans for review status changes and generates notifications.

**Why it's wrong:** Cloudflare Workers have no persistent background tasks outside of Cloudflare Cron Triggers (which would require wrangler.jsonc configuration, a new route, and polling logic). It introduces a delay between the event and the notification.

**Do this instead:** Call `createNotification()` inline in the same API route that changes the review status. Best-effort (errors swallowed). Same pattern as the existing `createAuditLog()` calls — already proven in production.

### Anti-Pattern 4: Hardcoding UGC disclaimer text in each template

**What people do:** Copy-paste the disclaimer paragraph into building pages, landlord pages, review cards, and submission confirmation.

**Why it's wrong:** Legal language needs consistency and easy updating. Five separate strings will diverge over time. Any copy change requires hunting down all instances.

**Do this instead:** `UGCDisclaimer.astro` with a `variant` prop. All surfaces import and render it. One place to update copy.

### Anti-Pattern 5: Making `section_8_accepted` and `safely_lit` required survey fields

**What people do:** Add new survey questions as `required: true` with `NOT NULL` constraints, requiring all existing reviews to be migrated.

**Why it's wrong:** 100+ existing reviews have no data for these fields. A NOT NULL constraint requires a migration that either deletes existing reviews or sets a default that misrepresents historical data.

**Do this instead:** Nullable columns with `allowNA: true` in `surveyItems.ts`. NULL means unanswered. Scoring logic skips NULL scores (already the pattern for NA items). The review form shows these as optional questions.

## Suggested Build Order

Dependencies drive this order. Features in the same group can be built in parallel.

**Group 1 — No dependencies (isolated changes):**
1. Fix move-in date seasonal display bug — isolated to display component rendering the date string
2. Full review content in admin pending reviews view — UI-only change to `ReviewsTable.tsx` + `AdminReview` type in `api-types.ts`
3. `UGCDisclaimer.astro` component + placement on building, landlord, review pages, submission flow
4. New survey fields: migration 0022 + `surveyItems.ts` + `scoring.ts` + `ReviewForm.tsx`

**Group 2 — Depends on Group 1 being stable:**
5. Contact form: migration 0019 + `/api/contact.ts` + `email.ts` template + `contact.astro` UI + `validation.ts`
6. Multi-city enrichment refactor: create `src/lib/enrichment/`, extract Boston adapter, add New Haven adapter, update route

**Group 3 — Depends on schema from Group 2:**
7. Tenant dashboard core: migration 0021 notifications + `notifications.ts` helper + modify admin review routes to call it + `TenantDashboard.tsx` + `/api/dashboard/notifications.ts` + extend `profile.astro`
8. Tenant dashboard extended: migration 0020 saved buildings + `SavedBuildings.tsx` + `/api/dashboard/saved-buildings.ts` + bookmark UI on building pages

**Group 4 — Depends on dashboard foundation:**
9. Review verification UX improvements — audit current `VerificationModal.tsx` flow first, then implement UX changes; benefits from dashboard already being stable

**Rationale:**
- Bug fixes and display-only changes first to eliminate noise before adding features.
- Survey fields early because they affect the review submission form — best to stabilize before the dashboard displays review data.
- Contact form and enrichment refactor are independent of each other but both involve new files — can proceed in parallel within Group 2.
- Tenant dashboard last because it depends on the notifications schema and the `createNotification()` calls in admin routes (Group 3), and the saved buildings feature depends on the dashboard shell existing (Group 3 before Group 3 extended).
- Verification UX last because it requires auditing the existing flow before implementing changes — that audit can happen in parallel with Groups 1-3 but implementation should come after dashboard is settled.

---

## Sources

- Direct inspection of `src/pages/api/admin/buildings/[id]/enrich.ts` (existing Boston adapter logic)
- Direct inspection of `src/components/profile/ProfileDashboard.tsx` (existing dashboard structure)
- Direct inspection of `src/lib/audit.ts`, `src/lib/email.ts` (patterns to replicate)
- Direct inspection of `migrations/0018_bug_reports.sql` (contact_messages table model)
- Direct inspection of `src/lib/types.ts`, `src/lib/api-types.ts` (type conventions)
- Direct inspection of `src/middleware.ts`, `src/pages/profile.astro` (auth and SSR data load patterns)

---
*Architecture research for: RateMyPlace v1.4.0 "Open Doors" feature integration*
*Researched: 2026-03-20*
