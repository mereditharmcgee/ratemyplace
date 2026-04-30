# Phase 21: Quality Cleanup — Research

**Researched:** 2026-04-28
**Domain:** HTTP response headers (rate limiting) + React component refactoring (empty states)
**Confidence:** HIGH — all findings sourced from direct code inspection; no external lookups required

---

## Summary

Phase 21 has two completely independent deliverables. The rate-limit header track (SEC-07, SEC-08) is a surgical patch: `contact.ts` is the sole endpoint that omits `Retry-After` on its 429, and **zero endpoints** currently emit `X-RateLimit-Limit` / `X-RateLimit-Remaining` on success (200) responses. The rate-limit helper `checkRateLimit` already returns `remaining`, `retryAfterSeconds`, and the caller-supplied `maxAttempts` is available at every call site — the planner needs to standardize a three-header bundle and propagate it to each of nine rate-limited endpoints. The auth endpoints (signin, signup, forgot-password, resend-verification) already emit `Retry-After` on 429 but lack the X-RateLimit-\* headers; the four public-endpoint-security endpoints (bug-reports, contact, search/results, search/autocomplete) are the same, with contact also missing `Retry-After`.

The EmptyState component track (UX-01) is a pure extraction: four ad-hoc empty states exist across search, building detail, profile (reviews + saved), and notifications; all follow the same structural pattern (SVG icon + heading + description text + optional CTA). A single `EmptyState` React component with `title`, `description`, `icon`, and optional `action` props covers every case. The `search.astro` empty states are SSR-rendered and will need to use a `.astro` wrapper component or inline the JSX-equivalent Astro syntax, while the profile tab (ProfileDashboard.tsx) and NotificationsTab.tsx are React islands — those can import `EmptyState` directly.

**Primary recommendation:** Plan 21-01 adds the three headers to all nine rate-limited endpoints using a single helper function `buildRateLimitHeaders(result, limit)` that constructs the header bundle from existing `RateLimitResult` fields. Plan 21-02 creates `src/components/ui/EmptyState.tsx` and refactors the four target surfaces.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-07 | `Retry-After` header present on every 429 response — fix `contact.ts` consistency gap | contact.ts line 29 confirmed: 429 response has no `Retry-After`. All other rate-limited endpoints already include it. |
| SEC-08 | `X-RateLimit-Limit` and `X-RateLimit-Remaining` on every rate-limited endpoint response | Confirmed zero endpoints emit these on 200 responses today. `checkRateLimit` returns `remaining`; `limit` is the caller-supplied `maxAttempts` arg at each call site. |
| UX-01 | Shared `<EmptyState>` component replacing ad-hoc empty-state messaging on four surfaces | Four distinct ad-hoc implementations found; no existing EmptyState component exists in codebase. |
</phase_requirements>

---

## User Constraints

No CONTEXT.md exists for this phase. The user skipped discuss-phase. All decisions below are discretionary and flagged as such for the planner.

---

## Standard Stack

### Core (existing — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | Component model for EmptyState | Project standard for interactive islands |
| TypeScript | 5.9.3 | Strict types on all new code | Project requirement |
| Tailwind CSS | 4.x | Styling EmptyState | Project standard |
| Vitest | 4.0.18 | Unit tests | Existing test infrastructure |
| Playwright | 1.58.2 | E2E header assertions | Existing E2E infrastructure |

**No new packages required for either deliverable.**

---

## Architecture Patterns

### Rate-Limit Header Track

#### Current `checkRateLimit` return shape

```typescript
// src/lib/rateLimit.ts — interface RateLimitResult
interface RateLimitResult {
  allowed: boolean;
  remaining: number;       // requests left after this one (0 when blocked)
  retryAfterSeconds: number;  // 0 when allowed, >0 when blocked
  error?: boolean;         // true only on DB failure (fail-closed path)
}
```

The `limit` (max requests) is NOT in the return value. It is passed as `maxAttempts` at each call site. The three standard headers map as:

| Header | Value | Source |
|--------|-------|--------|
| `Retry-After` | `rateLimit.retryAfterSeconds` (integer string) | Already present on all 429s except contact.ts |
| `X-RateLimit-Limit` | The `maxAttempts` argument passed to `checkRateLimit` | Available at call site |
| `X-RateLimit-Remaining` | `rateLimit.remaining` | Always present in return value |

#### Recommended helper: `buildRateLimitHeaders`

Place in `src/lib/rateLimit.ts` as a new exported function. This keeps header logic colocated with the rate-limit module and avoids repeating object literals at nine call sites.

```typescript
// Proposed addition to src/lib/rateLimit.ts
export function buildRateLimitHeaders(
  result: RateLimitResult,
  limit: number
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }
  return headers;
}
```

Callers spread this into their existing `headers` objects:

```typescript
// Example usage at a call site (e.g., contact.ts 429):
return new Response(JSON.stringify({ error: '...' }), {
  status: 429,
  headers: {
    'Content-Type': 'application/json',
    ...buildRateLimitHeaders(rateLimitResult, 3),  // limit = maxAttempts
  }
});

// And on the 200 success path:
return new Response(JSON.stringify({ success: true }), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    ...buildRateLimitHeaders(rateLimitResult, 3),
  }
});
```

**Discretionary decision for planner:** Whether to also emit `X-RateLimit-Reset` (Unix timestamp of window reset). The helper `checkRateLimit` does not return a `resetAt` timestamp — it only computes `retryAfterSeconds` from `firstAttempt + windowSeconds`. Adding `X-RateLimit-Reset` would require a `resetAt` field in `RateLimitResult`. This is OPTIONAL; `Retry-After` is sufficient for clients and is what the existing E2E tests assert.

#### Complete endpoint inventory

| File | Route | Method | Rate-limit key | Max | Window | Retry-After on 429? | X-RateLimit-* on 200? |
|------|-------|--------|---------------|-----|--------|---------------------|----------------------|
| `src/pages/api/auth/signin.ts` | POST /api/auth/signin | POST | `signin` | 5 | 900s | YES | NO |
| `src/pages/api/auth/signup.ts` | POST /api/auth/signup | POST | `signup` | 3 | 3600s | YES | NO |
| `src/pages/api/auth/forgot-password.ts` | POST /api/auth/forgot-password | POST | `password_reset` | 3 | 3600s | YES | NO |
| `src/pages/api/auth/resend-verification.ts` | POST /api/auth/resend-verification | POST | `verify_email_resend` | 3 | 3600s | YES | NO |
| `src/pages/api/bug-reports.ts` | POST /api/bug-reports | POST | `bug-report` | 5 | 3600s | YES | NO |
| `src/pages/api/contact.ts` | POST /api/contact | POST | `contact` | 3 | 3600s | **NO (SEC-07 gap)** | NO |
| `src/pages/api/disputes.ts` | POST /api/disputes | POST | `dispute` | 3 | 3600s | YES | NO |
| `src/pages/api/search/results.ts` | GET /api/search/results | GET | `search-results` | 60 | 60s | YES | NO |
| `src/pages/api/search/autocomplete.ts` | GET /api/search/autocomplete | GET | `search-autocomplete` | 120 | 60s | YES | NO |

**Total: 9 endpoints require X-RateLimit-Limit + X-RateLimit-Remaining on 200 responses; 1 endpoint (contact.ts) additionally requires Retry-After on 429.**

#### Exact gap in `contact.ts`

Lines 27–33 of `src/pages/api/contact.ts` — the 429 response as it exists today:

```typescript
// contact.ts lines 27-33 (current code — SEC-07 gap)
const rateLimitResult = await checkRateLimit(db, ip, 'contact', 3, 3600);
if (!rateLimitResult.allowed) {
  return new Response(JSON.stringify({ error: 'Too many submissions. Please wait before trying again.' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json' }
    // ^^^^^ Retry-After is missing here — this is the SEC-07 gap
  });
}
```

The surgical fix is to add `Retry-After` (and the new X-RateLimit-* headers) to this response — matching the pattern from all other endpoints.

### EmptyState Component Track

#### Inventory of all four target surfaces

**Surface 1: `src/pages/search.astro` — "no results for query" state (SSR)**

```astro
<!-- lines 201-221, rendered when: query && !hasResults -->
<div class="text-center py-12 bg-gray-50 rounded-[6px]">
  <div class="text-gray-400 mb-4">
    <svg class="w-12 h-12 mx-auto" ...>  <!-- magnifying glass icon -->
  </div>
  <h2 class="text-xl font-semibold text-gray-900 mb-2">No properties found for "{query}"</h2>
  <p class="text-gray-600">Try a different address or neighborhood.</p>
  <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
    <a href="/search">Browse all properties</a>
    <a href="/review/new">Add a new review</a>
  </div>
</div>
```

**Surface 2: `src/pages/search.astro` — "no reviewed properties yet" state (SSR, !query && !hasAnyListings)**

```astro
<!-- lines 240-255 -->
<div class="text-center py-12">
  <div class="text-gray-400 mb-4">
    <svg class="w-16 h-16 mx-auto" ...>  <!-- building icon -->
  </div>
  <h2 class="text-xl font-semibold text-gray-900 mb-2">No reviewed properties yet</h2>
  <p class="text-gray-600 mb-4">Be the first to share your experience!</p>
  <a href="/review/new">Write a Review</a>
</div>
```

**Surface 3: `src/pages/building/[slug].astro` — zero reviews for a building (SSR)**

```astro
<!-- lines 399-413, rendered when: reviews.length === 0 -->
<div class="bg-gray-50 rounded-lg p-8 text-center">
  <svg class="mx-auto h-12 w-12 text-gray-400 mb-4" ...>  <!-- chat bubble icon -->
  </svg>
  <p class="text-gray-600 mb-4">No reviews yet for this building.</p>
  <a href="/review/new?building={building.id}">Be the first to write a review</a>
</div>
```

Note: building detail uses `<p>` for the heading (no `<h2>`/`<h3>`) — inconsistency the EmptyState will fix.

**Surface 4: `src/components/profile/ProfileDashboard.tsx` — profile reviews tab, no reviews (React, client-fetched)**

```tsx
// lines 347-361, rendered when: reviews.length === 0 (after fetch)
<div className="bg-gray-50 rounded-[6px] p-8 text-center">
  <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" ...>  <!-- building icon -->
  </svg>
  <h3 className="text-lg font-medium text-gray-900 mb-2">No reviews yet</h3>
  <p className="text-gray-600 mb-4">Share your rental experience...</p>
  <a href="/review/new">Write Your First Review</a>
</div>
```

**Surface 5: `src/components/profile/ProfileDashboard.tsx` — saved buildings tab, no saved (React, client-fetched)**

```tsx
// lines 388-402, rendered when: savedBuildings.length === 0
<div className="bg-gray-50 rounded-[6px] p-8 text-center">
  <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" ...>  <!-- bookmark icon -->
  </svg>
  <h3 className="text-lg font-medium text-gray-900 mb-2">No saved buildings yet</h3>
  <p className="text-gray-600 mb-4">Browse buildings and tap the bookmark icon...</p>
  <a href="/search">Browse Buildings</a>
</div>
```

**Surface 6: `src/components/profile/NotificationsTab.tsx` — no notifications (React island, client-fetched)**

```tsx
// lines 97-108, rendered when: notifications.length === 0
<div className="bg-gray-50 rounded-[6px] p-8 text-center">
  <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" ...>  <!-- bell icon -->
  </svg>
  <h3 className="text-lg font-medium text-gray-900 mb-2">No notifications yet</h3>
  <p className="text-gray-600">You'll be notified when your reviews are acted on.</p>
</div>
```

**Note on scope clarification:** The ROADMAP lists "search results, building detail, profile (no reviews), and notifications." The actual codebase has:
- Search: 2 empty states (no results for query + no reviewed properties yet) — treat both as in-scope
- Building detail: 1 empty state — in scope
- Profile: 2 React tab empty states (reviews + saved buildings) — reviews is the one explicitly required; saved buildings is identical pattern and should also be migrated (low cost, high consistency)
- Notifications: 1 React component empty state — in scope

**Discretionary decision for planner:** Whether to also migrate the saved buildings tab (not explicitly listed in requirements but same pattern). Recommended: yes, include it — it's one additional line change and prevents a visible inconsistency.

#### Recommended EmptyState component API

File: `src/components/ui/EmptyState.tsx`

```tsx
// Recommended component signature
interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;       // Pass an <svg> element; defaults to generic empty box
  action?: {
    label: string;
    href: string;
  };
  className?: string;           // Layout overrides (e.g., 'py-8' vs 'py-12')
}

export default function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={`bg-gray-50 rounded-[6px] p-8 text-center ${className ?? ''}`}>
      {icon && (
        <div className="text-gray-400 mx-auto mb-4 w-12 h-12 flex items-center justify-center">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-600 mb-4">{description}</p>
      {action && (
        <a
          href={action.href}
          className="inline-flex items-center gap-2 px-4 py-2 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 transition-colors"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
```

**Discretionary decisions for planner:**

1. **Variant vs className:** The codebase has one surface (search.astro no-results) that uses `py-12` top padding and includes two CTA buttons (Browse + Add review). The current API supports `className` for padding overrides and a single `action` href. The two-button pattern is unique to that surface — leave the second button as inline Astro markup wrapping the EmptyState, or add an `actions` array prop. Recommended: keep `action` singular (the most common case); the two-button search case can wrap EmptyState in a div with additional buttons below it.

2. **SSR Astro surfaces:** `search.astro` and `building/[slug].astro` are SSR Astro pages. They cannot directly import a React `.tsx` component without `client:load`. Options:
   - **Option A:** Create a companion `EmptyState.astro` component that mirrors the same markup — zero hydration cost, used from `.astro` files.
   - **Option B:** Use `<EmptyState client:load>` — adds a tiny hydration boundary but works.
   - **Option C:** Keep SSR surfaces as inline Astro markup, only migrate React surfaces.
   Recommended for planner: **Option A** — create both `EmptyState.tsx` (for React islands) and `EmptyState.astro` (for SSR pages). They share identical Tailwind markup. No hydration overhead, no duplicate component logic of any complexity.

3. **No variant prop needed:** The five surfaces all use the same `bg-gray-50 rounded-[6px] p-8 text-center` shell with minor padding variation. `className` override is sufficient; a variant enum is over-engineering.

#### Rendering context of each surface

| Surface | File type | Rendered when | State source |
|---------|-----------|---------------|-------------|
| Search no-query-results | `.astro` (SSR) | `query && !hasResults` | Server-side on page load |
| Search no-listings | `.astro` (SSR) | `!query && !hasAnyListings` | Server-side on page load |
| Building detail zero-reviews | `.astro` (SSR) | `reviews.length === 0` | Server-side on page load |
| Profile reviews tab | `.tsx` (React island) | `reviews.length === 0` after `fetchReviews()` | Client fetch on mount |
| Profile saved buildings tab | `.tsx` (React island) | `savedBuildings.length === 0` after `fetchSavedBuildings()` | Client fetch on tab switch |
| Notifications tab | `.tsx` (React component) | `notifications.length === 0` | Parent state passed as prop |

The notification tab case is important: `NotificationsTab` receives `notifications` as a prop — it never fetches. It renders via the `ProfileDashboard` island. This means `EmptyState.tsx` is appropriate directly here (no additional hydration).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate-limit header bundle | Inline header objects at each call site | `buildRateLimitHeaders(result, limit)` in rateLimit.ts | 9 call sites; inline repetition will drift |
| Empty state styling | Per-component inline SVG + heading + text | `EmptyState.tsx` + `EmptyState.astro` | Already 6 inconsistent implementations |

---

## Common Pitfalls

### Pitfall 1: Adding X-RateLimit-* only on 429, not on 200

**What goes wrong:** SEC-08 requires headers on EVERY rate-limited response, including the success path. The 200 path already returns `new Response(...)` after the rate-limit check; that response also needs the headers.

**Why it happens:** The natural instinct is to put headers only in the `if (!rateLimit.allowed)` block.

**How to avoid:** Use `buildRateLimitHeaders` at both the 429 response AND the final 200 success response in each endpoint.

**Warning sign:** E2E test that only checks headers on 429 responses — SEC-08 compliance requires a 200-path assertion too.

### Pitfall 2: The `limit` value is not in `RateLimitResult`

**What goes wrong:** Trying to read `rateLimit.limit` at the call site — this field does not exist on `RateLimitResult`.

**Why it happens:** The limit was passed into `checkRateLimit` as `maxAttempts` but not reflected back.

**How to avoid:** At each call site, the caller already has the literal number (e.g., `3`, `5`, `60`, `120`). Pass it directly to `buildRateLimitHeaders(rateLimit, 3)`. Alternatively, add `limit: number` to `RateLimitResult` — but this requires changing the helper's return statement too. Planner should pick one approach and lock it.

**Discretionary decision for planner:** Whether to add `limit` to `RateLimitResult` (cleaner callers) or pass it explicitly to the header builder (no helper change). Recommended: pass explicitly — the `limit` value at each call site is a literal constant, so it's not error-prone.

### Pitfall 3: DB error path (503) still needs Retry-After

**What goes wrong:** The `rateLimit.error === true` path returns 503, not 429. Some implementations only add `Retry-After` for 429.

**Why it happens:** RFC 7231 specifies `Retry-After` on 503 (service unavailable) as well as 429.

**How to avoid:** `buildRateLimitHeaders` should include `Retry-After` whenever `!result.allowed` (which covers both the 429 and 503 paths — the status code is determined by `rateLimit.error` at the call site, not in the header builder).

The current bug-reports.ts already does this correctly:
```typescript
const status = rateLimit.error ? 503 : 429;
// ... Retry-After: String(rateLimit.retryAfterSeconds) — present on both paths
```

### Pitfall 4: `search.astro` empty state includes two CTA buttons

**What goes wrong:** The "no results for query" state on search.astro has two action buttons (Browse all properties + Add a new review). A single-action `EmptyState` component won't accommodate this without changes.

**Why it happens:** The search no-results state is the most elaborate empty state in the codebase.

**How to avoid:** Either (a) allow `actions` array prop, (b) use `className` + render a slot/children, or (c) keep search.astro's second button as inline markup outside the `<EmptyState>` component. Option (c) is simplest.

### Pitfall 5: E2E tests currently assert `retry-after` (lowercase) header names

**What goes wrong:** HTTP headers are case-insensitive but Playwright's `headers()` method returns them as-lowercase. The existing Phase 17 E2E tests use `sixth.headers()['retry-after']` (lowercase). This is correct and will still work — no change needed. However, any new tests for `X-RateLimit-Limit` must use `x-ratelimit-limit` (all-lowercase) when asserting via Playwright's `headers()` map.

**Why it happens:** Playwright normalizes header names to lowercase in its `headers()` object.

**How to avoid:** New E2E header assertions must use lowercase: `'x-ratelimit-limit'`, `'x-ratelimit-remaining'`.

### Pitfall 6: The `contact.ts` rate-limit check is inside a `try/catch`

**What goes wrong:** In `contact.ts`, the rate-limit check is at line 27, which is INSIDE the outer `try` block (unlike the pattern in search endpoints where it's before the try). This means the 200 success path where we add X-RateLimit-* headers is also inside the try block — which is correct. No structural change needed, just add headers to both the 429 response and the success response.

**How to avoid:** Read contact.ts carefully — the `rateLimitResult` variable is in scope all the way to the 200 return on line 84.

---

## Code Examples

### Example: Standardized endpoint pattern after Phase 21

```typescript
// Pattern for a POST endpoint after SEC-07/SEC-08 applied (e.g., contact.ts)
// Source: direct code reading

const rateLimitResult = await checkRateLimit(db, ip, 'contact', 3, 3600);
if (!rateLimitResult.allowed) {
  const status = rateLimitResult.error ? 503 : 429;
  return new Response(JSON.stringify({ error: '...' }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...buildRateLimitHeaders(rateLimitResult, 3),  // Retry-After + X-RateLimit-*
    }
  });
}

// ... later, on the 200 path:
return new Response(JSON.stringify({ success: true }), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    ...buildRateLimitHeaders(rateLimitResult, 3),  // X-RateLimit-Limit + X-RateLimit-Remaining
  }
});
```

### Example: EmptyState component usage (React)

```tsx
// In ProfileDashboard.tsx reviews tab
import EmptyState from '../ui/EmptyState';

// Replace inline div with:
<EmptyState
  title="No reviews yet"
  description="Share your rental experience to help other tenants find great places to live."
  icon={<svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7..." />
  </svg>}
  action={{ label: 'Write Your First Review', href: '/review/new' }}
/>
```

### Example: EmptyState component usage (Astro SSR)

```astro
<!-- In building/[slug].astro (SSR — uses EmptyState.astro, not the React component) -->
<EmptyState
  title="No reviews yet for this building."
  description="Be the first to share your experience with this property."
  action={{ label: 'Be the first to write a review', href: `/review/new?building=${building.id}` }}
/>
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|-----------------|-------|
| No X-RateLimit-* headers on success | Add to all rate-limited 200 responses | SEC-08 standard practice |
| Ad-hoc empty state markup × 6 | Single EmptyState component | UX-01 |
| contact.ts 429 missing Retry-After | Will match all other endpoints | SEC-07 clean-up |

**Header conventions (HTTP standards):**
- `Retry-After`: integer seconds or HTTP-date. Integer seconds is the simpler, universally supported form. RFC 6585 section 4. Current codebase already uses integer seconds — maintain this.
- `X-RateLimit-Limit`: non-standard but universal convention. Integer: max requests in window.
- `X-RateLimit-Remaining`: integer: requests remaining in current window (already in `RateLimitResult.remaining`).
- `X-RateLimit-Reset`: optional Unix epoch timestamp. Not currently supported by the helper; would require adding `resetAt` to `RateLimitResult`. Flag as discretion — omit unless the planner decides to extend the helper.

---

## Open Questions

1. **Should `X-RateLimit-Reset` be added?**
   - What we know: `checkRateLimit` computes `retryAfterSeconds` but does not expose `resetAt` (Unix timestamp).
   - What's unclear: Whether the project wants to expose the absolute reset time vs the relative retry-after seconds.
   - Recommendation: Omit for Phase 21. `Retry-After` is sufficient; `X-RateLimit-Reset` is an optional nice-to-have. If desired later, add `resetAt: number` to `RateLimitResult` and populate it.

2. **Should the saved buildings tab empty state be migrated?**
   - What we know: It is not explicitly listed in ROADMAP criterion 3, but it is the same pattern as the profile reviews tab, located in the same file.
   - What's unclear: Whether the user considers it part of "profile (no reviews)" scope.
   - Recommendation: Include it. Zero additional risk, prevents visible inconsistency.

3. **SSR surfaces: EmptyState.astro vs client:load?**
   - What we know: search.astro and building/[slug].astro are Astro SSR files with no existing React islands for empty states.
   - Recommendation: Create `EmptyState.astro` that mirrors `EmptyState.tsx` markup — no hydration cost, clean Astro-native approach.

---

## Validation Architecture

`workflow.nyquist_validation` key is absent from `.planning/config.json` — treat as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 (unit), Playwright 1.58.2 (E2E) |
| Config file | `vitest.config.ts` (happy-dom environment), `playwright.config.ts` |
| Quick run command | `npm test -- rateLimit` (unit), `npx playwright test e2e/security.spec.ts --no-deps --project=chromium` (E2E) |
| Full suite command | `npm test` (all 311+ unit tests) + `npx playwright test e2e/security.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-07 | contact.ts 429 includes `Retry-After` header | E2E integration | `npx playwright test e2e/security.spec.ts -g "Phase 21" --no-deps --project=chromium` | Wave 0 needed |
| SEC-08 | All 9 rate-limited endpoints return `X-RateLimit-Limit` + `X-RateLimit-Remaining` on 200 | E2E integration | `npx playwright test e2e/security.spec.ts -g "Phase 21" --no-deps --project=chromium` | Wave 0 needed |
| SEC-08 | `buildRateLimitHeaders` unit test — returns correct headers for both allowed and blocked results | Unit | `npm test -- rateLimit` | Wave 0 needed |
| UX-01 | `<EmptyState>` renders title, description, icon, action | Unit (component) | `npm test -- EmptyState` (if component test added) or snapshot test | Wave 0 needed |
| UX-01 | Search page renders EmptyState with expected text for no-results query | E2E | `npx playwright test e2e/pages.spec.ts` or new test | Partial |

### Sampling Rate

- **Per task commit:** `npm test` (unit suite, ~10 seconds)
- **Per wave merge:** `npm test` + `npx playwright test e2e/security.spec.ts --no-deps --project=chromium`
- **Phase gate:** Full unit suite green + Phase 21 E2E block green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/__tests__/rateLimit.test.ts` — add describe block for `buildRateLimitHeaders`: test that allowed result produces X-RateLimit-Limit + X-RateLimit-Remaining but no Retry-After; blocked result produces all three; error result produces all three with Retry-After=60
- [ ] `e2e/security.spec.ts` — add `test.describe('Phase 21: Rate Limit Headers')` block with: (a) POST /api/contact → 429 asserts `retry-after` header; (b) GET /api/search/results → 200 asserts `x-ratelimit-limit` and `x-ratelimit-remaining`; (c) POST /api/bug-reports (under limit) → 200 asserts `x-ratelimit-limit` and `x-ratelimit-remaining`
- [ ] No component test infrastructure needed for EmptyState unless `@testing-library/react` tests are desired — the package is already in devDependencies; if added, create `src/lib/__tests__/EmptyState.test.tsx` asserting title/description/action render. **Discretionary for planner.**

*(Existing test infrastructure covers rate-limit unit logic and all endpoint E2E patterns — gaps are specifically the new header assertions.)*

---

## Sources

### Primary (HIGH confidence)

- Direct code reading: `src/lib/rateLimit.ts` — `RateLimitResult` interface and `checkRateLimit` return shape
- Direct code reading: `src/pages/api/contact.ts` — confirmed missing Retry-After on 429 (lines 28-33)
- Direct code reading: all 9 rate-limited endpoint files — confirmed no X-RateLimit-* headers present anywhere
- Direct code reading: `src/components/profile/NotificationsTab.tsx`, `ProfileDashboard.tsx`, `src/pages/search.astro`, `src/pages/building/[slug].astro` — confirmed all 6 ad-hoc empty state implementations
- Direct code reading: `e2e/security.spec.ts` — confirmed existing tests use lowercase `retry-after`, no X-RateLimit assertions exist
- Direct code reading: `src/lib/__tests__/rateLimit.test.ts` — confirmed no `buildRateLimitHeaders` tests exist
- `.planning/phases/17-public-endpoint-security/17-02-SUMMARY.md` — confirmed contact.ts intentionally deferred Retry-After to Phase 21

### Secondary (MEDIUM confidence)

- RFC 6585 section 4: `Retry-After` on 429 responses — standard, well-established
- Community convention: `X-RateLimit-Limit` / `X-RateLimit-Remaining` header naming (GitHub API, Twitter API, etc.) — not formally standardized but universal

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all existing tools
- Rate-limit header patterns: HIGH — direct code reading; all gaps confirmed by inspection
- EmptyState surfaces: HIGH — all 6 ad-hoc implementations read and documented
- Architecture recommendations: HIGH — consistent with project patterns (lib helper pattern, component extraction pattern)

**Research date:** 2026-04-28
**Valid until:** 2026-06-28 (stable codebase; no fast-moving dependencies)
