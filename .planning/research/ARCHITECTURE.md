# Architecture Research

**Domain:** Hardening retrofit — Astro 5 SSR + Cloudflare Workers + D1 + Lucia v3
**Researched:** 2026-04-26
**Confidence:** HIGH (based on direct source reading + official docs)

---

## Standard Architecture

### System Overview (Current v1.4.0 → v1.5.0 Delta)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser                                                              │
│   React islands (client:load) ←→ fetch() → /api/**                   │
│   Astro pages (SSR, zero client JS unless island)                    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ HTTP
┌──────────────────────────────▼───────────────────────────────────────┐
│  Cloudflare Workers (SSR runtime)                                     │
│                                                                       │
│  src/middleware.ts  ←── ALL requests pass here first                 │
│   [1] Auth: Lucia session validate → context.locals.user              │
│   [2] Security headers: CSP, X-Frame, etc.                           │
│   [3] v1.5.0 NEW: Origin check assertion (Astro built-in, verify OK) │
│                                                                       │
│  src/pages/api/**/*.ts  ←── API routes                               │
│   [inline] Rate limit check (checkRateLimit)                         │
│   [inline] Auth/admin guard                                          │
│   [inline] Input validation                                          │
│   [inline] D1 query                                                   │
│   [async]  Email send (fire-and-forget via ctx.waitUntil)            │
│                                                                       │
│  src/pages/*.astro  ←── SSR pages                                    │
│   Direct D1 queries, no rate limiting (reads only)                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ D1 SQLite API
┌──────────────────────────────▼───────────────────────────────────────┐
│  Cloudflare D1 (SQLite)                                               │
│   14 tables: users, sessions, reviews, buildings, landlords,          │
│   rate_limits, disputes, audit_logs, contact_messages,               │
│   notifications, saved_buildings, bug_reports, ...                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities (v1.5.0 targets)

| Component | Responsibility | v1.5.0 Change |
|-----------|----------------|---------------|
| `src/middleware.ts` | Auth context, security headers | No change; rate limiting stays in routes |
| `src/lib/rateLimit.ts` | D1-backed sliding-window rate limiter | Add `Retry-After` header helper; add typed signature |
| `src/lib/validation.ts` | Input validation rules | Add schemas for contacts, bug-reports, disputes, search |
| `src/lib/db.ts` | D1 connection wrapper | Add typed `getRuntime()` wrapper to retire 71 `any` casts |
| `src/lib/email.ts` | Resend transactional email | Switch to fire-and-forget caller pattern |
| `src/components/reviews/ReviewEditForm.tsx` | 907-line edit form | Split into step sub-components |
| `src/components/admin/BuildingsTable.tsx` | 844-line admin table | Split into sub-components + custom hooks |
| `src/components/admin/ReviewsTable.tsx` | 733-line admin table | Split into sub-components + custom hooks |
| `src/components/ui/EmptyState.tsx` | (new) Shared empty-state UI | Create once, use everywhere |
| `e2e/admin-moderation.spec.ts` | (new) Admin approve/reject + audit-log assertion | New spec |
| `e2e/data-consistency.spec.ts` | (new) Cross-view score consistency | New spec |

---

## Architectural Patterns

### Pattern 1: Typed Cloudflare Runtime Wrapper

**What:** Retire the 71 `(context.locals as any).runtime` casts by declaring `runtime` in `App.Locals` and creating a typed `getRuntime()` helper. The project uses `@astrojs/cloudflare` v12 (Astro 5), where `locals.runtime` maps to the `App.Platform` object. The `App.Platform` interface is already defined in `src/env.d.ts` with typed `env`, `cf`, and `ctx`. The missing step is declaring `runtime: App.Platform` in `App.Locals`.

**When to use:** This is the foundation of the hardening work — build it first; every subsequent API route change becomes typesafe.

**Build order:** Must happen BEFORE other API route changes, so each route edit benefits from typed access.

**Two-file change:**

```typescript
// src/env.d.ts — add `runtime` to App.Locals
declare namespace App {
  interface Platform {
    env: {
      DB: D1Database;
      VERIFICATION_BUCKET: R2Bucket;
      TURNSTILE_SECRET_KEY: string;
      RESEND_API_KEY: string;
      GOOGLE_MAPS_API_KEY: string;
      GOOGLE_PLACES_API_KEY: string;
      SITE_URL: string;
    };
    cf: import('@cloudflare/workers-types').IncomingRequestCfProperties;
    ctx: import('@cloudflare/workers-types').ExecutionContext;
  }

  interface Locals {
    user: import('lucia').User | null;
    session: import('lucia').Session | null;
    runtime: App.Platform;          // ADD THIS LINE
  }
}
```

```typescript
// src/lib/db.ts — update getDB to accept typed runtime
import type { D1Database } from '@cloudflare/workers-types';

export function getDB(runtime: App.Platform): D1Database {
  const db = runtime?.env?.DB;
  if (!db) {
    throw new Error('D1 Database not found. Make sure you have configured the DB binding.');
  }
  return db;
}
```

**After this change**, all 71 call sites change from:
```typescript
const runtime = (context.locals as any).runtime;
const db = getDB(runtime);
```
to:
```typescript
const db = getDB(context.locals.runtime);
```

This is a purely mechanical find-and-replace. Run it last in a single PR to batch all 71 changes cleanly. Do not mix with other logic changes in the same PR.

**Note on Astro 6 migration:** In `@astrojs/cloudflare` v13+ (Astro 6), `locals.runtime` is removed and `waitUntil` moves to `Astro.locals.cfContext`. The typed wrapper insulates call sites from this future change — only `db.ts` would need updating at migration time.

---

### Pattern 2: Middleware Ordering (Rate Limit vs. Auth)

**What:** Rate limiting should run **inside the route handler**, NOT as a middleware layer before auth. This is the existing pattern in `signin.ts` and `contact.ts` and it is correct.

**Why rate limit stays in route handlers (not middleware):**
- Rate limit keys are endpoint-specific (e.g., `signin:1.2.3.4`, `contact:1.2.3.4`). A middleware would need to map URL paths to configs.
- Auth context is NOT needed before rate limiting public endpoints — the IP is extracted from request headers before any user lookup.
- Middleware in Astro runs for ALL requests including static assets and admin routes. Adding rate limiting there would require URL filtering that is error-prone.
- The existing pattern in `checkRateLimit()` already accepts `db` — requiring the runtime to be available — which is only guaranteed after the middleware runs and sets `context.locals`.

**Correct execution order per request:**

```
middleware.ts
  → Lucia session validate (sets context.locals.user)
  → Security headers (post-response)
  → [call next()]

route handler (e.g., /api/disputes.ts POST)
  → 1. Extract IP: getClientIP(context)
  → 2. Get runtime: context.locals.runtime
  → 3. Get DB: getDB(context.locals.runtime)
  → 4. Rate limit: checkRateLimit(db, ip, 'dispute', 3, 3600)
     ↳ 429 if exceeded
  → 5. Auth check (if route requires it): context.locals.user
     ↳ 401 if missing
  → 6. Admin check (if admin route): context.locals.user?.isAdmin
     ↳ 403 if not admin
  → 7. Input validation: validateXxx(body)
     ↳ 400 if invalid
  → 8. D1 query
  → 9. Fire-and-forget email (ctx.waitUntil)
  → 10. Return 2xx response
```

**Routes that need rate limiting added in v1.5.0:**
- `src/pages/api/bug-reports.ts` — has Turnstile but no `checkRateLimit` call (line 6 only imports `getClientIP`, never calls `checkRateLimit`)
- `src/pages/api/search/results.ts` — GET endpoint, no rate limiting, LIKE queries on full table
- `src/pages/api/search/autocomplete.ts` — GET endpoint, no rate limiting

Routes already covered: `contact.ts` (3/hr), `disputes.ts` (3/hr), `auth/signin.ts` (5/15min), `auth/signup.ts` (3/hr).

**Rate limit config for new routes:**

| Route | Key | Limit | Window | Rationale |
|-------|-----|-------|--------|-----------|
| `bug-reports.ts` | `bug-report` | 5 | 3600 | Low-frequency form |
| `search/results.ts` | `search` | 60 | 60 | 1/sec average; LIKE is O(n) |
| `search/autocomplete.ts` | `autocomplete` | 120 | 60 | Keystroke-driven, higher tolerance |

---

### Pattern 3: Input Validation — Shared Schema Library

**What:** Validation schemas live in `src/lib/validation.ts` (shared), NOT inline per-route. The existing `validateReviewForm()` function is already in the library. v1.5.0 adds sibling validators for the unprotected public endpoints.

**When to use:** Any route that accepts POST body data from unauthenticated or low-trust callers.

**Where new validators go:**

```typescript
// src/lib/validation.ts — ADD alongside existing validateReviewForm()

export interface BugReportInput {
  description: string;
  category?: string;
  email?: string;
  url?: string;
}

export function validateBugReport(data: Partial<BugReportInput>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!data.description || data.description.trim().length < 10) {
    errors.push({ field: 'description', message: 'Description must be at least 10 characters' });
  }
  if (data.description && data.description.length > 5000) {
    errors.push({ field: 'description', message: 'Description must be 5000 characters or less' });
  }
  if (data.email && !data.email.includes('@')) {
    errors.push({ field: 'email', message: 'Invalid email format' });
  }
  if (data.url && data.url.length > 2000) {
    errors.push({ field: 'url', message: 'URL too long' });
  }
  return errors;
}

export interface ContactInput {
  name: string;
  email: string;
  message: string;
  category?: string;
}

export function validateContact(data: Partial<ContactInput>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!data.name || data.name.trim().length < 2 || data.name.length > 100) {
    errors.push({ field: 'name', message: 'Name must be 2-100 characters' });
  }
  if (!data.email || !data.email.includes('@')) {
    errors.push({ field: 'email', message: 'Valid email required' });
  }
  if (!data.message || data.message.trim().length < 10 || data.message.length > 3000) {
    errors.push({ field: 'message', message: 'Message must be 10-3000 characters' });
  }
  return errors;
}

export interface SearchInput {
  q?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export function validateSearch(params: SearchInput): ValidationError[] {
  const errors: ValidationError[] = [];
  if (params.q && params.q.length > 200) {
    errors.push({ field: 'q', message: 'Search query too long (max 200 chars)' });
  }
  if (params.type && !['buildings', 'landlords'].includes(params.type)) {
    errors.push({ field: 'type', message: 'Type must be buildings or landlords' });
  }
  if (params.limit !== undefined && (params.limit < 1 || params.limit > 50)) {
    errors.push({ field: 'limit', message: 'Limit must be 1-50' });
  }
  return errors;
}
```

**Contact.ts already has inline validation** (lines 40-64) that duplicates the library approach. Keep the inline validation working for now; the new validators replace it in a follow-up cleanup PR to avoid scope creep in v1.5.0.

---

### Pattern 4: CSRF Protection — Astro Built-in + Lucia SameSite

**What:** Astro 5 has built-in CSRF protection enabled by default via `security.checkOrigin`. It validates the `Origin` request header matches the site origin for all non-safe methods (POST, PUT, PATCH, DELETE). Lucia sets session cookies with `sameSite: 'lax'` by default (confirmed in `middleware.ts` lines 28-31).

**Current status (verified by reading middleware.ts):**
- Session cookies use `sameSite: 'lax'` — confirmed in `middleware.ts` lines 28-31 and 40-43
- The security test suite (`e2e/security.spec.ts` line 116) already includes `headers: { Origin: ORIGIN }` on form POST tests, which implies Astro's Origin check IS active

**CVE-2024-56140 status:** This bypass (Content-Type header manipulation) was patched in Astro 5.x. Running Astro 5.16.x is not affected by the original CVE.

**What v1.5.0 needs to verify:**
1. Confirm `security.checkOrigin` is not explicitly disabled in `astro.config.mjs` — currently it is not present, meaning it defaults to `true` (safe)
2. JSON body API routes (e.g., `disputes.ts` uses `request.json()`) — Origin check covers these since the header is still sent by browsers
3. No explicit CSRF token infrastructure is needed; SameSite=Lax + Origin check is the defense-in-depth approach sufficient for this app

**Where to check if adding CSRF tokens becomes necessary:**
- If any endpoint accepts cross-origin requests from third parties (currently none do)
- If Cloudflare Turnstile is removed from form endpoints (unlikely)

**No new files needed for CSRF.** The audit outcome is: "Origin check active, SameSite=Lax confirmed, no token implementation required."

---

### Pattern 5: waitUntil for Fire-and-Forget Email

**What:** Email sends currently block the API response. The fix is to call `ctx.waitUntil(emailPromise)` so the response returns immediately and email sends happen asynchronously (up to 30 seconds after response).

**How to access `ctx` in `@astrojs/cloudflare` v12 / Astro 5:**

```typescript
// In any API route handler:
const ctx = (context.locals.runtime as App.Platform).ctx;
// After typed wrapper: context.locals.runtime.ctx
ctx.waitUntil(
  sendVerificationEmail(resendApiKey, siteUrl, email, token).catch((err) => {
    console.error('Verification email failed (background):', err);
  })
);
```

**After the typed runtime wrapper** (Pattern 1), this simplifies to:
```typescript
const ctx = context.locals.runtime.ctx;
ctx.waitUntil(
  sendVerificationEmail(resendApiKey, siteUrl, email, token).catch(logErr)
);
```

**Files that need this change** (email sends that block response):

| File | Current pattern | Change |
|------|----------------|--------|
| `src/pages/api/auth/signup.ts` | `await sendVerificationEmail(...)` | `ctx.waitUntil(send...)` |
| `src/pages/api/auth/forgot-password.ts` | `await sendPasswordResetEmail(...)` | `ctx.waitUntil(send...)` |
| `src/pages/api/auth/verify-email.ts` | check file — likely await | `ctx.waitUntil(send...)` |
| `src/pages/api/contact.ts` lines 78-86 | `await send...().catch(...)` | already catch, add `ctx.waitUntil()` |
| `src/pages/api/disputes.ts` lines 139-158 | `await sendDisputeConfirmationEmail(...)` | `ctx.waitUntil(send...)` |

**`contact.ts` is already close** — lines 78-86 show `.catch()` error handling. Just wrap in `ctx.waitUntil()`.

**Do NOT use `waitUntil` for:**
- D1 writes (must complete before response — rate limit logging, review insert, audit log)
- Auth session creation (must complete before cookie is set in response)

**30-second time limit:** Resend typically responds in 200-500ms, well within the limit. No concern here.

---

### Pattern 6: Component Splitting for React Islands

**What:** Split three oversized React components without changing behavior. All three follow the same pattern: large monolithic component with state, fetch logic, and multiple render sections. Split into: state/logic hook + smaller sub-components.

**ReviewEditForm.tsx (907 lines) — split target:**

```
src/components/reviews/
  ReviewEditForm.tsx          ← keep as orchestrator (~200 lines)
  form-steps/
    UnitDetailsStep.tsx       ← bedroom/bath/unit-number/sq-footage
    UnitRatingStep.tsx        ← 10 survey rating items
    BuildingRatingStep.tsx    ← 9 survey rating items
    LandlordRatingStep.tsx    ← 8 survey rating items
    AdditionalDetailsStep.tsx ← tenure, amenities, pets, pests
    ReviewTextStep.tsx        ← title, text, would-recommend
    ConfirmStep.tsx           ← summary + consent checkbox
  hooks/
    useReviewEditForm.ts      ← all useState declarations + submit handler
```

The existing `ReviewForm.tsx` (new review) already uses a `form-steps/` subdirectory — mirror that structure for the edit form.

**BuildingsTable.tsx (844 lines) — split target:**

```
src/components/admin/buildings/
  BuildingsTable.tsx          ← keep as orchestrator (~150 lines)
  BuildingRow.tsx             ← single row expand/collapse
  BuildingEditForm.tsx        ← inline edit form (landlord, notes, etc.)
  BuildingEnrichPanel.tsx     ← enrichment result display
  hooks/
    useBuildingsTable.ts      ← useState, fetchBuildings, fetchLandlords
```

**ReviewsTable.tsx (733 lines) — split target:**

```
src/components/admin/reviews/
  ReviewsTable.tsx            ← keep as orchestrator (~150 lines)
  ReviewRow.tsx               ← single row expand/collapse + status badge
  ReviewDetailPanel.tsx       ← expanded view with approve/reject/link
  hooks/
    useReviewsTable.ts        ← useState, fetchReviews, fetchLandlords
```

**Behavioral preservation guarantee:**
- Move state declarations to hook file without renaming them
- Sub-components receive state and handlers as props (no new state)
- No API changes — fetch URLs unchanged
- E2E tests (`admin-actions.spec.ts`) target CSS selectors and text content, not component boundaries — they will continue passing

---

### Pattern 7: Playwright E2E Extensions for v1.5.0

**What:** Two new spec files and an extension to `fixtures.ts` for a DB-access helper.

**New specs:**

```
e2e/
  admin-moderation.spec.ts    ← already exists (admin-actions.spec.ts covers E2E-07–10)
                               ← v1.5.0 needs: audit-log field assertion (old/new values)
  data-consistency.spec.ts    ← NEW: review create → verify score on 3 views
```

**`data-consistency.spec.ts` test flow:**

```typescript
// e2e/data-consistency.spec.ts
test('review score appears consistently across search, building detail, and profile', async ({ authedPage }) => {
  // 1. Create review via POST /api/reviews (or via form)
  // 2. Admin approves it (reuse adminPage fixture)
  // 3. GET /api/search/results?q=[building address] — assert score present
  // 4. Navigate to /building/[slug] — assert same overall_score
  // 5. Navigate to /profile — assert review in dashboard with same score
});
```

**Fixture extension — no new fixtures needed.** The existing `authedPage` and `adminPage` fixtures (loading `playwright/.auth/user.json` and `admin.json`) are sufficient. For DB access in tests, continue the existing pattern: `execSync('npx wrangler d1 execute ratemyplace-db --local --command ...')`.

**Rate limit clearing helper** (already in `security.spec.ts`, extract to fixtures if used in multiple new tests):

```typescript
// e2e/fixtures.ts — ADD helper (not a fixture, just a function)
export function clearRateLimits() {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM rate_limits"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}
```

Currently `clearRateLimits` is duplicated in `security.spec.ts`. If `data-consistency.spec.ts` also needs rate limit clearing, move it to `fixtures.ts` and import from there.

**Global setup (`e2e/global.setup.ts`) — no changes needed.** The two seed users (user@test / admin@test) are sufficient for all new E2E tests. The admin approval step in `data-consistency.spec.ts` uses the existing `adminPage` fixture.

---

## Data Flow

### Hardened Public POST Request Flow (v1.5.0 target)

```
Browser POST /api/disputes
  ↓
middleware.ts
  → Lucia session validate (sets locals.user = null for unauthenticated)
  → [call next()]
  ↓
src/pages/api/disputes.ts POST handler
  → getClientIP(context)                    // CF-Connecting-IP header
  → getDB(context.locals.runtime)           // typed after Pattern 1
  → checkRateLimit(db, ip, 'dispute', 3, 3600)
     ↳ 429 if exceeded (Retry-After header)
  → request.json() body parse
  → validateDisputeInput(body)             // new validator in validation.ts
     ↳ 400 if invalid
  → extractReviewIdFromUrl(reviewUrl)
     ↳ 400 if bad URL
  → db.prepare(...).bind(...).run()        // D1 insert
  → context.locals.runtime.ctx.waitUntil( // fire-and-forget
      sendDisputeConfirmationEmail(...)
    )
  → return Response 201
```

### waitUntil Email Flow

```
Route handler
  → builds response object
  → ctx.waitUntil(emailPromise)    // schedules background work
  → return response                // client receives response immediately

[Background, up to 30 seconds]
  → Resend API call completes (200-500ms typical)
  → error logged if failure (best-effort)
  → Worker lifetime ends
```

---

## Integration Points (New vs. Modified Files)

### New Files (v1.5.0)

| File | Type | Purpose |
|------|------|---------|
| `src/components/ui/EmptyState.tsx` | React component | Shared empty-state with icon, title, message props |
| `src/components/reviews/form-steps/` | Directory | Step sub-components for ReviewEditForm split |
| `src/components/reviews/hooks/useReviewEditForm.ts` | Hook | State + submit logic extracted from ReviewEditForm |
| `src/components/admin/buildings/` | Directory | Sub-components for BuildingsTable split |
| `src/components/admin/buildings/hooks/useBuildingsTable.ts` | Hook | State + fetch logic |
| `src/components/admin/reviews/` | Directory | Sub-components for ReviewsTable split |
| `src/components/admin/reviews/hooks/useReviewsTable.ts` | Hook | State + fetch logic |
| `e2e/data-consistency.spec.ts` | E2E test | Cross-view score consistency checks |

### Modified Files (v1.5.0)

| File | Change | Impact |
|------|--------|--------|
| `src/env.d.ts` | Add `runtime: App.Platform` to `App.Locals` | Enables typed wrapper; no behavior change |
| `src/lib/db.ts` | Change `runtime: any` to `runtime: App.Platform` | Type safety only |
| `src/lib/validation.ts` | Add `validateBugReport`, `validateContact`, `validateSearch` | New exports |
| `src/pages/api/bug-reports.ts` | Add `checkRateLimit` call + use `validateBugReport` | New behavior |
| `src/pages/api/search/results.ts` | Add `checkRateLimit` call + use `validateSearch` | New behavior |
| `src/pages/api/search/autocomplete.ts` | Add `checkRateLimit` call | New behavior |
| `src/pages/api/auth/signup.ts` | `await email` → `ctx.waitUntil(email)` | Response time improvement |
| `src/pages/api/auth/forgot-password.ts` | `await email` → `ctx.waitUntil(email)` | Response time improvement |
| `src/pages/api/contact.ts` | Wrap existing `.catch()` sends in `ctx.waitUntil()` | Response time improvement |
| `src/pages/api/disputes.ts` | Wrap existing email send in `ctx.waitUntil()` | Response time improvement |
| `src/pages/api/**/*.ts` (71 files) | `(context.locals as any).runtime` → `context.locals.runtime` | Type safety; batch in one PR |
| `src/components/reviews/ReviewEditForm.tsx` | Orchestrator reduced to ~200 lines | Behavior unchanged |
| `src/components/admin/BuildingsTable.tsx` | Orchestrator reduced to ~150 lines | Behavior unchanged |
| `src/components/admin/ReviewsTable.tsx` | Orchestrator reduced to ~150 lines | Behavior unchanged |
| `e2e/admin-actions.spec.ts` | Extend E2E-10 audit log test to assert old/new field values | More specific assertions |

---

## Build Order (Dependency-Aware)

Phases should be sequenced to maximize type-safety gains before touching other routes:

```
1. Typed runtime wrapper (env.d.ts + db.ts)
      ↓
2. Validation schema additions (validation.ts)
      ↓ (parallel after step 1)
3a. Rate limit additions (bug-reports.ts, search/results.ts, search/autocomplete.ts)
3b. fire-and-forget email (signup.ts, forgot-password.ts, contact.ts, disputes.ts)
3c. CSRF audit (read-only verification, astro.config.mjs check)
      ↓
4. Retire 71 any-casts (batch find-and-replace across all api routes)
      ↓ (parallel after step 4)
5a. Component splits (ReviewEditForm, BuildingsTable, ReviewsTable)
5b. EmptyState component
5c. New E2E specs (admin-moderation audit assertions, data-consistency)
      ↓
6. D1 index audit (migrations/)
```

**Rationale:**
- Step 1 before Step 4: Typed wrapper is only useful once `App.Locals` declares `runtime`. The 71-cast batch benefits from the type being defined.
- Step 2 before Steps 3a/3c: New validators are imported by the route changes.
- Steps 3a/3b/3c can run in parallel as they touch different files.
- Step 4 (71-cast batch) should be its own isolated PR — large but mechanical, low risk.
- Steps 5a/5b/5c and 6 are independent of each other.

---

## Anti-Patterns

### Anti-Pattern 1: Rate Limiting in Middleware

**What people do:** Add `checkRateLimit()` to `middleware.ts` with URL-based routing.
**Why it's wrong:** Requires URL-to-config mapping that is fragile, applies to admin routes unnecessarily, and cannot access endpoint-specific keys cleanly.
**Do this instead:** Call `checkRateLimit()` as the first operation inside each route handler that needs it.

### Anti-Pattern 2: await on Email Sends

**What people do:** `await sendVerificationEmail(...)` inside an API route handler.
**Why it's wrong:** Adds 200-500ms Resend latency to every user-facing response. Email delivery is best-effort; blocking the user for it is unnecessary.
**Do this instead:** `ctx.waitUntil(sendVerificationEmail(...).catch(logErr))`. Return the response immediately.

### Anti-Pattern 3: Inline Validation Logic in Route Handlers

**What people do:** Validate inputs directly in each API route file (e.g., `if (!name || name.length < 2)`).
**Why it's wrong:** Already happening in `contact.ts` and `bug-reports.ts`. Cannot be unit-tested in isolation. Gets out of sync across routes.
**Do this instead:** Define validators in `src/lib/validation.ts` and import them. Unit-test the validator function separately.

### Anti-Pattern 4: Single Monolithic React Island

**What people do:** Put all state, all fetch calls, and all render branches into one 900-line TSX file.
**Why it's wrong:** Cannot test sub-sections in isolation. Full re-render on any state change. Impossible to reason about props flow.
**Do this instead:** Extract state to a custom hook. Extract each form step or table section into a focused sub-component. Pass state/handlers as explicit props.

### Anti-Pattern 5: `(context.locals as any).runtime` in Library Functions

**What people do:** Pass `runtime: any` all the way into `src/lib/db.ts`, `src/lib/audit.ts`, `src/lib/notifications.ts`.
**Why it's wrong:** TypeScript cannot catch a typo like `runtime.env.RESEND_APY_KEY`. IDE autocomplete is useless.
**Do this instead:** Accept `App.Platform` at the library boundary. The typed declaration in `env.d.ts` carries the full env shape.

---

## Scaling Considerations

| Scale | Architecture Adjustment |
|-------|------------------------|
| Current (< 1K reviews) | Rate limiting in D1 `rate_limits` table — fine; cleanup query runs per-request |
| 10K reviews | Add DB index on `rate_limits(rate_key, created_at)` if not present; check with `EXPLAIN QUERY PLAN` |
| 100K reviews | Consider Cloudflare KV or Durable Objects for rate limiting to avoid D1 write pressure |

The `rate_limits` table currently lacks a composite index on `(rate_key, created_at)`. The `checkRateLimit()` function at `src/lib/rateLimit.ts` line 39 runs `WHERE rate_key = ? AND created_at > ?` — this should be verified in the D1 index audit (v1.5.0 Phase 6).

---

## Sources

- `src/middleware.ts` — confirmed: SameSite=lax, Lucia session validation, security headers (direct read)
- `src/lib/rateLimit.ts` — confirmed: D1-backed, fail-closed, sliding window (direct read)
- `src/lib/validation.ts` — confirmed: only `validateReviewForm` exists, no contact/dispute validators (direct read)
- `src/env.d.ts` — confirmed: `App.Platform` typed with `env`, `cf`, `ctx`; `runtime` NOT in `App.Locals` (direct read)
- `src/pages/api/contact.ts` — confirmed: rate limiting present, email awaited synchronously (direct read)
- `src/pages/api/bug-reports.ts` — confirmed: `getClientIP` imported but `checkRateLimit` never called (direct read)
- `src/pages/api/search/results.ts` — confirmed: no rate limiting (direct read)
- `e2e/fixtures.ts` — confirmed: `authedPage` and `adminPage` fixtures use storageState files (direct read)
- `e2e/global.setup.ts` — confirmed: two seed users signed in for auth fixture files (direct read)
- `playwright.config.ts` — confirmed: `workers: 1`, global setup project dependency (direct read)
- [Cloudflare Workers `ctx.waitUntil` docs](https://developers.cloudflare.com/workers/runtime-apis/context/) — confirms 30-second post-response lifetime, Promise-based API (MEDIUM confidence — current as of 2026)
- [Astro CSRF `security.checkOrigin`](https://github.com/withastro/astro/security/advisories/GHSA-c4pw-33h3-35xw) — CVE-2024-56140 patch confirms Origin check is default-on and patched in Astro 5.x (HIGH confidence)
- `@astrojs/cloudflare` v12 changelog — confirmed: `locals.runtime` still present in v12 (Astro 5); `cfContext` replacement is v13+ (Astro 6) only (MEDIUM confidence)

---

*Architecture research for: RateMyPlace Boston v1.5.0 "Closed Loops" hardening*
*Researched: 2026-04-26*
