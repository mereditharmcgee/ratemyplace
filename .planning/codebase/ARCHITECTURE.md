# Architecture

**Analysis Date:** 2026-04-26

## Pattern Overview

**Overall:** Astro 5 Server-Side Rendering (SSR) with React islands and D1 (SQLite) database.

**Key Characteristics:**
- Full-stack TypeScript with strict mode enabled
- Server-rendered Astro pages for SEO and static content
- React components as client-side islands for interactive features
- Cloudflare Workers runtime for middleware and API routes
- SQLite D1 database with Lucia v3 for authentication
- Middleware-based auth context injection for all requests

## Layers

**Presentation (Pages & Components):**
- Purpose: User-facing pages and interactive components
- Location: `src/pages/` (Astro pages) and `src/components/` (React + Astro)
- Contains: Page routes, form components, display components
- Depends on: Library functions, API routes, layout components
- Used by: Browser clients

**API Routes:**
- Purpose: HTTP endpoints for data operations (CRUD, auth, search)
- Location: `src/pages/api/`
- Contains: RESTful endpoints organized by resource
- Depends on: Database functions, library utilities, auth checks
- Used by: Frontend pages, external services

**Business Logic & Utilities:**
- Purpose: Shared, single-responsibility functions
- Location: `src/lib/`
- Contains: Scoring algorithms, validation, formatting, audit logging, email
- Depends on: Database and types only
- Used by: API routes and components

**Database Layer:**
- Purpose: SQLite D1 data persistence
- Location: `migrations/` (schema) and accessed via `getDB()` function
- Contains: 27 survey questions, buildings, reviews, users, landlords, property managers
- Depends on: None
- Used by: API routes and some Astro pages

**Authentication:**
- Purpose: Session management and user context
- Location: `src/middleware.ts`, `src/lib/auth.ts`
- Contains: Lucia v3 session validation, user attribute mapping
- Depends on: Database
- Used by: All routes via `context.locals.user`

## Data Flow

**Public Page View (e.g., Search Results):**

1. User navigates to `search.astro`
2. Astro middleware validates session (runs `middleware.ts`)
3. Page component queries database directly via `getDB()`
4. Database returns buildings and landlords matching search query
5. Astro renders HTML server-side with search results
6. SearchResults React component mounts client-side for interactivity
7. User sees fully-rendered page with no Flash of Unstyled Content

**Review Submission Flow:**

1. User fills out ReviewForm (React island) on `/review/new`
2. Form validates address via AddressAutocomplete → Google Places API
3. User completes multi-step form and clicks "Submit"
4. Form POSTs JSON to `/api/reviews/[id]` endpoint
5. API route validates auth, input, and checks rate limits
6. API inserts review into database with `status: 'pending'`
7. API logs to audit table and creates notification
8. Page redirects to building detail page with `?submitted=true`
9. Building page displays "Review submitted" message
10. Admin receives notification and can approve/reject from admin panel

**Admin Action (Approve Review):**

1. Admin navigates to `/admin/reviews`
2. Page queries database for pending reviews
3. Admin clicks "Approve" button
4. Button POSTs to `/api/admin/reviews/[id]` with status change
5. API validates admin role via `context.locals.user?.isAdmin`
6. API updates review status and moderation_notes
7. API calls `createAuditLog()` with admin ID and IP
8. API calls `createNotification()` to notify review author
9. Response includes new review data for optimistic UI update
10. Building's aggregate scores recalculate on next request

**Search & Filtering:**

1. User submits search query on home page
2. HomeSearch component POSTs to `/api/search/buildings`
3. API queries database with LIKE filters on address/neighborhood/landlord name
4. API returns buildings with review counts and avg scores
5. Client-side SearchResults component renders results
6. User can filter by type (buildings/landlords) or sort
7. Pagination handled server-side (PAGE_SIZE = 10 per query)

**State Management:**

- Authentication state: Session cookies + middleware context (`context.locals.user`)
- Form state: React component local state (ReviewForm, ReviewEditForm)
- Page state: URL query parameters (`?submitted=true`, `?page=2`)
- Database state: D1 SQLite tables with timestamps (unixepoch)
- Admin state: No client-side state — all loaded from database per request

## Key Abstractions

**Review Scoring:**
- Purpose: Calculate weighted scores from the 27-item rating instrument (5 ancillary survey items are not scored)
- Location: `src/lib/scoring.ts`
- Pattern: Pure functions that aggregate review scores by domain
  - `calculateOverallScore(review)` - Weighted average of all 27 scored rating items
  - `calculateBuildingAverages(reviews)` - Compute avg scores across 3 domains (unit, building, landlord)
  - `calculateDomainScores(reviews)` - Per-category analysis
  - Domain weights: Health/safety items (pests, mold, structural) weighted 1.3-1.5x, others 1.0x
  - Recency factor: 5% reduction per year after 2 years (floor at 85%)

**Survey Definitions:**
- Purpose: Single source of truth for survey questions and help text
- Location: `src/lib/surveyItems.ts`
- Pattern: Arrays of question objects with text, help text, and field names
  - `unitItems` (10 questions), `buildingItems` (9), `landlordItems` (8)
  - Each item maps to database column via `field` property
  - Help text displayed in tooltips during form submission

**API Response Utilities:**
- Purpose: Consistent response format across all endpoints
- Location: `src/lib/api.ts`
- Pattern: Functions that wrap data or errors in standard JSON format
  - `jsonResponse(data, status)` - Success responses
  - `errorResponse(message, status)` - Error responses
  - `ApiErrors` object with predefined error types (UNAUTHORIZED, FORBIDDEN, NOT_FOUND)

**Audit Logging:**
- Purpose: Track all admin actions for compliance
- Location: `src/lib/audit.ts`
- Pattern: Best-effort logging that doesn't block main request
  - `createAuditLog(db, { adminUserId, actionType, entityType, entityId, oldValue, newValue })`
  - Captures before/after values for all status changes
  - Includes admin IP address and timestamp

**Email Notifications:**
- Purpose: Notify users of review moderation decisions
- Location: `src/lib/email.ts`
- Pattern: Resend API integration for transactional emails
  - Templates for verification, review approved, review rejected, password reset
  - Sent asynchronously without blocking request

**Data Enrichment:**
- Purpose: Auto-populate building data from government APIs
- Location: `src/lib/enrichment/`
- Pattern: Adapter pattern for different city data sources
  - `boston.ts` - Boston Assessing API (FY2026 dataset)
  - `new-haven.ts` - Connecticut CAMA API (Socrata)
  - `dispatcher.ts` - Routes enrichment requests to correct adapter
  - Used by `/api/admin/buildings/[id]/enrich` endpoint

**Privacy Handling:**
- Purpose: Mask personally identifiable information
- Location: `src/lib/privacy.ts`
- Pattern: Functions that transform sensitive data before display
  - Move dates displayed as season+year, not exact dates
  - User email not exposed in public views
  - Review text doesn't expose unit number or lease terms

**Rate Limiting:**
- Purpose: Prevent abuse of review submission and auth endpoints
- Location: `src/lib/rateLimit.ts`
- Pattern: In-memory tracking by client IP with sliding window
  - Review submission: 5 per hour per IP
  - Auth attempts: 10 per hour per IP
  - Tracked via Redis-equivalent Cloudflare KV (when available)

## Entry Points

**Web Pages:**
- Location: `src/pages/*.astro` (public), `src/pages/admin/*.astro` (admin-only)
- Triggers: User navigation or direct URL access
- Responsibilities: Query database, check auth, render HTML server-side

**API Routes:**
- Location: `src/pages/api/**/*.ts` (188 total endpoints)
- Triggers: Fetch requests from frontend or external services
- Responsibilities: Validate request, check auth/admin, modify data, audit log, return JSON

**OAuth Callback:**
- Location: `src/pages/api/auth/google/callback.ts`
- Triggers: Redirect from Google after user approval
- Responsibilities: Exchange auth code for token, create or update user, set session cookie

**Middleware:**
- Location: `src/middleware.ts`
- Triggers: Every request before pages/API routes
- Responsibilities: Validate session cookie, set `context.locals.user`, add security headers

## Error Handling

**Strategy:** Consistent HTTP status codes with descriptive JSON error messages.

**Patterns:**

- **Auth Errors:** Return 401 (Unauthorized) when `context.locals.user` is null
  ```typescript
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  ```

- **Permission Errors:** Return 403 (Forbidden) when user is not admin
  ```typescript
  if (!context.locals.user?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  ```

- **Validation Errors:** Return 400 (Bad Request) with `details` field listing invalid fields
  ```typescript
  return new Response(JSON.stringify({ 
    error: 'Validation failed', 
    details: { email: 'Invalid format', password: 'Too short' } 
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
  ```

- **Not Found:** Return 404 with resource name
  ```typescript
  return new Response(JSON.stringify({ error: 'Review not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  });
  ```

- **Server Errors:** Return 500 without exposing stack traces
  ```typescript
  return new Response(JSON.stringify({ error: 'An error occurred' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
  ```

## Cross-Cutting Concerns

**Logging:**
- Approach: Console logs in development, silent in production
- Used in: Middleware, auth, database errors
- Example: `console.error('Auth middleware error:', error)` in `middleware.ts`

**Validation:**
- Approach: Input validation before database operations
- Location: `src/lib/validation.ts`
- Pattern: Reusable validation functions for email, password, address, score ranges
- Applied in: All POST/PATCH API routes

**Authentication:**
- Approach: Lucia v3 with D1 SQLite adapter
- Location: `src/lib/auth.ts` and `src/middleware.ts`
- Pattern: Session cookie validated on every request
- User attributes: email, emailVerified, name, avatarUrl, googleId, isAdmin

**Database Access:**
- Approach: Parameterized queries only (no string interpolation)
- Pattern: `db.prepare(sql).bind(params).first()` or `.all()`
- Never: `db.prepare(\`WHERE id = ${id}\`)`

**Timestamps:**
- Approach: Unix epoch (seconds since 1970-01-01 UTC)
- Pattern: `unixepoch()` function in SQL, stored as INTEGER
- Never: `datetime('now')` or JavaScript timestamps (milliseconds)

---

*Architecture analysis: 2026-04-26*
