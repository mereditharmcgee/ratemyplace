# Architecture

**Analysis Date:** 2026-05-02

## Pattern Overview

**Overall:** Astro 5.x SSR with React islands for interactive components, server-backed by Cloudflare D1 (SQLite) and Lucia v3 authentication.

**Key Characteristics:**
- Server-side rendering by default, minimal JavaScript on client
- React islands (`client:load`) only where immediate interactivity required
- Middleware-based auth flow with session management
- Database-driven with parameterized queries throughout
- Multi-tier access control (public, authenticated, admin)
- Observable/audit-driven for compliance

## Layers

**Presentation (Astro Pages):**
- Purpose: Render server-side HTML, hydrate React islands
- Location: `src/pages/`
- Contains: Astro page components (`.astro`), dynamic routes with `Astro.params`
- Depends on: Components, lib utilities, database for SSR data fetching
- Used by: Browser requests via Cloudflare Pages

**Interactive Components (React Islands):**
- Purpose: Client-side interactivity—forms, maps, tables, real-time UI updates
- Location: `src/components/**/*.tsx`
- Contains: React functional components, hooks, form state management
- Depends on: API routes, types, validation utilities
- Used by: Astro pages with `client:load` directive

**Static Components (Astro):**
- Purpose: Layout, content display, markup composition
- Location: `src/components/**/*.astro`
- Contains: Reusable layouts, card components, headers/footers
- Depends on: Types, formatting utilities
- Used by: Astro pages and other Astro components

**API Layer:**
- Purpose: RESTful endpoints for data mutations and admin operations
- Location: `src/pages/api/**/*.ts`
- Contains: POST/GET handlers, auth/validation checks, database operations
- Depends on: Database, auth, validation, audit logging
- Used by: React components via fetch, admin React tables

**Business Logic & Data (Library):**
- Purpose: Core algorithms, validation, formatting, database access
- Location: `src/lib/`
- Contains: Scoring system, survey configuration, auth, enrichment, validation
- Depends on: Database, types, external APIs (Google Maps, Cloudflare Turnstile)
- Used by: API routes, pages, components

**Middleware & Auth:**
- Purpose: Session management, auth state injection, security headers
- Location: `src/middleware.ts`, `src/lib/auth.ts`
- Contains: Lucia session validation, cookie management, CSP/security headers
- Depends on: Database, Lucia v3
- Used by: All routes (runs before every request)

**Database & Storage:**
- Purpose: Data persistence via Cloudflare D1 (SQLite)
- Location: `src/lib/db.ts`, migrations in `migrations/`
- Contains: D1 client initialization, query builders (prepared statements)
- Depends on: Cloudflare Workers runtime
- Used by: All business logic layers

## Data Flow

**Public Review Submission:**

1. User navigates to `/review/new`
2. `ReviewForm.tsx` (React island) collects multi-step form data
3. User submits → POST to `/api/reviews`
4. `/api/reviews.ts` validates input via `validation.ts`
5. Scores calculated via `calculateDomainScores()` from `scoring.ts`
6. Review inserted into database with status='pending'
7. Audit log created via `createAuditLog()` in `audit.ts`
8. Cloudflare Turnstile verification on submit (CSRF protection)
9. Success response redirects to profile page
10. Admin sees pending review in `/admin/reviews` table

**Search & Display:**

1. User searches on `/` via `HomeSearch` component
2. Query sent to `/search?q=...` (SSR page)
3. `search.astro` queries database for buildings and landlords
4. Results grouped by type, paginated (PAGE_SIZE=10)
5. Building detail page (`[slug].astro`) shows:
   - Review count and average scores
   - Individual approved reviews via `ReviewCard.astro`
   - Map via `BuildingMap.tsx` React island
6. All displayed scores derived from database `overall_score` column

**Admin Operations:**

1. Admin user logs in, sees `/admin` dashboard
2. Navigates to `/admin/reviews` → React table loads
3. Table fetches data via `/api/admin/reviews?status=pending`
4. Admin approves/rejects review in UI
5. POST to `/api/admin/reviews/[id]` with action
6. Endpoint validates `context.locals.user?.isAdmin`
7. Update executed, audit log created with old/new values
8. Table refreshes (client-side pagination)

**Scoring Recalculation:**

1. Building has N approved reviews
2. Each review has 27 scored fields (10 unit, 9 building, 8 landlord)
3. `calculateDomainScores()` weights scores and handles nulls
4. `calculateOverallScore()` combines domain scores with recency decay
5. Result stored in review `overall_score` column at creation
6. Search page aggregates via SQL: `AVG(r.overall_score)`
7. Methodology page (`methodology.astro`) documents weight justification

## Key Abstractions

**SurveyItems (27-field system):**
- Purpose: Define all ratable dimensions with help text, required flags, display order
- Examples: `src/lib/surveyItems.ts` contains 27 items (unit_structural, landlord_maintenance, etc.)
- Pattern: Each item has `code`, `dimension`, `text`, `help`, `required`, `allowNA`, maps to database column

**Scoring System:**
- Purpose: Weighted average calculation with health/safety emphasis
- Examples: `src/lib/scoring.ts` defines ITEM_WEIGHTS (1.3x for structural, 1.5x for pests)
- Pattern: Separate domain calculations (unit, building, landlord) → overall with recency decay

**Enrichment Adapters:**
- Purpose: Multi-city building data enrichment (Boston Assessing API, CT CAMA)
- Examples: `src/lib/enrichment/adapters/boston.ts`, `new-haven.ts`, `null.ts`
- Pattern: City-specific adapter implements CityAdapter interface, dispatcher routes based on city

**Validation:**
- Purpose: Input sanitization and error reporting
- Examples: `validateReviewForm()` in `src/lib/validation.ts` returns ValidationError[]
- Pattern: Field-level checks, cross-field validation (move-out > move-in), range bounds

**Rate Limiting:**
- Purpose: Abuse prevention without external service
- Examples: `checkRateLimit()` in `src/lib/rateLimit.ts`
- Pattern: Tracks IP + action + time window in database, returns allowed/reset headers

**Audit Logging:**
- Purpose: Track admin actions for compliance and debugging
- Examples: `createAuditLog()` in `src/lib/audit.ts` inserts to audit_logs table
- Pattern: Best-effort (failures don't block action), stores admin ID, entity type/ID, old/new values

## Entry Points

**Web (Astro SSR):**
- Location: `src/pages/`
- Triggers: HTTP GET/POST to domain
- Responsibilities: Render HTML, validate auth before serving protected pages, fetch data for SSR

**API (REST endpoints):**
- Location: `src/pages/api/**/*.ts`
- Triggers: Fetch from React components or forms
- Responsibilities: Auth/validation, database mutations, response serialization

**Middleware:**
- Location: `src/middleware.ts`
- Triggers: Every request (before pages/API handlers)
- Responsibilities: Session validation, user injection to context, security headers

**Database Migrations:**
- Location: `migrations/XXXX_description.sql`
- Triggers: Manual `npm run db:migrate:local` or `wrangler d1 migrations apply`
- Responsibilities: Schema changes, data transformations

## Error Handling

**Strategy:** Validation-first (prevent invalid data upstream), graceful degradation (optional fields), audit-logged failures (admin actions).

**Patterns:**

- **Form Validation:** Errors collected in array, returned to client with field names via `ValidationError[]`
- **API Error Responses:** JSON with `{ error: string }` and appropriate HTTP status (400, 401, 403, 500)
- **Database Errors:** Caught, logged, generic message returned to client (security—no SQL leaks)
- **Auth Failures:** Turnstile verification failures → 400; missing auth → 401; non-admin → 403
- **Rate Limiting:** 429 on exceed, custom retry headers (X-RateLimit-Reset-After)
- **Optional Data:** Null checks throughout, survey items with `allowNA` flag, fall through to legacy columns

**Example from `src/pages/api/reviews.ts`:**
- Turnstile token verified before processing
- Building ID required, returns 400 if missing
- Rent amount must be 0–50,000, validates before insert
- Missing auth check: `if (!context.locals.user)` returns 401

## Cross-Cutting Concerns

**Logging:** 
- Console logs in try/catch blocks
- Error logger `logError()` in `src/lib/logger.ts` for system issues
- Best-effort (errors logged but don't break flow)

**Validation:** 
- Front-end: React component state validation (values 1–5 for ratings)
- Back-end: `validateReviewForm()` for all required fields before insert
- Database constraints: NOT NULL on id, status; UNIQUE on certain fields

**Authentication:** 
- Lucia v3 with D1 adapter
- Session cookie set by middleware on fresh session
- `context.locals.user` available in all routes
- OAuth (Google) + password-based signin, email verification required

**Privacy:**
- Unit numbers collected (moderation only) but never displayed publicly
- Timestamps rounded to season (not exact month) in public reviews
- Email addresses obscured unless user is logged in
- DELETE review cascades through related audit logs

**CSRF Protection:**
- SameSite=Lax session cookies (middleware sets this)
- Cloudflare Turnstile on all public forms (signup, forgot-password, contact, disputes, reviews)
- Astro `checkOrigin` default (true for SSR) — rejects cross-origin form submissions
- **Note:** `application/json` endpoints (disputes API) use Turnstile + rate limit, not checkOrigin

---

*Architecture analysis: 2026-05-02*
