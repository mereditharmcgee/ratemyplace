# Architecture

**Analysis Date:** 2026-02-26

## Pattern Overview

**Overall:** Full-stack server-side rendered (SSR) web application using Astro with React islands and Cloudflare D1 database backend.

**Key Characteristics:**
- Hybrid rendering: Astro static pages with interactive React components
- Server-side rendering for all routes (Cloudflare adapter)
- API-first architecture with REST endpoints for data operations
- Session-based authentication (Lucia with SQLite)
- Evidence-based scoring system with domain decomposition (unit, building, landlord)
- Role-based access control (user, admin)
- Cloudflare D1 as primary data store
- Tailwind CSS with dynamic styling based on computed scores

## Layers

**Presentation Layer (Frontend):**
- Purpose: Render HTML pages and interactive components for users
- Location: `src/pages/` (Astro pages), `src/components/` (React/Astro components)
- Contains: Page templates, layout components, UI components, forms
- Depends on: API layer, scoring logic, type definitions
- Used by: Browser clients accessing the web application

**API Layer (Backend):**
- Purpose: Handle HTTP requests and business logic, bridge between frontend and data
- Location: `src/pages/api/`
- Contains: RESTful endpoints for authentication, reviews, buildings, admin operations
- Depends on: Database, authentication, validation, scoring
- Used by: Frontend making fetch requests, external systems

**Data Access Layer:**
- Purpose: Manage database connectivity and queries
- Location: `src/lib/db.ts`
- Contains: D1 database initialization and retrieval
- Depends on: Cloudflare runtime bindings
- Used by: All API routes and admin pages

**Authentication Layer:**
- Purpose: Session management and user identity verification
- Location: `src/lib/auth.ts`
- Contains: Lucia initialization, user attribute mapping
- Depends on: Database, session tables
- Used by: All protected routes and API endpoints

**Business Logic Layer:**
- Purpose: Core application logic for scoring, validation, rate limiting
- Location: `src/lib/` (scoring.ts, validation.ts, rateLimit.ts, formOptions.ts)
- Contains: Weighted scoring calculations, form validation, rate limiting, survey item definitions
- Depends on: Type definitions
- Used by: API routes, pages

**Utility Layer:**
- Purpose: Cross-cutting concerns and shared utilities
- Location: `src/lib/` (password.ts, privacy.ts, api.ts, storage.ts)
- Contains: Password hashing/verification, privacy utilities, API response builders, file storage
- Depends on: External libraries (argon2 for password, oslojs for crypto)
- Used by: Authentication, API responses, form handling

## Data Flow

**Review Submission Flow:**

1. User navigates to `/review/new` or `/review/edit/[id]`
2. Frontend renders `ReviewEditForm.tsx` component with survey questions
3. User completes 27-item survey (10 unit items, 9 building items, 8 landlord items)
4. Form submits to `POST /api/reviews` with FormData containing all responses
5. API route `src/pages/api/reviews.ts`:
   - Verifies authentication (context.locals.user)
   - Extracts form data (scores, tenancy info, rent, amenities, etc.)
   - Calculates domain scores via `calculateDomainScores()` with weighted items
   - Inserts review record with all 27 score fields + metadata
   - Returns success response with reviewId and domain scores
6. Frontend redirects to building page or profile showing new review

**Building Lookup and Display Flow:**

1. User searches via address in home page search or creates review
2. Frontend sends building address to `/api/places/autocomplete` (Google Places API)
3. User selects from results, triggering check in `/api/buildings.ts`
4. If building exists: returns ID and slug (no creation)
5. If not exists: creates new building record with Google Place ID
6. User proceeds with review submission for that building_id
7. Building page `src/pages/building/[slug].astro`:
   - Fetches building metadata from database
   - Queries 50 most recent approved reviews
   - Calculates or fetches building_scores (cached aggregated metrics)
   - Groups reviews by unit type or unit number
   - Renders score cards, review list, tenant statistics

**Admin Moderation Flow:**

1. Admin visits `/admin/reviews`
2. Frontend calls `GET /api/admin/reviews/index.ts`
3. API verifies isAdmin flag (context.locals.user.isAdmin)
4. Returns list of all reviews with user, building, and score info
5. Admin clicks review to open detail view
6. Can approve/reject via `PUT /api/admin/reviews/[id].ts`
7. Updates review.status and optionally review.moderation_notes
8. Regenerates building aggregated scores

**Authentication Flow:**

1. User navigates to `/auth/signin` or `/auth/signup`
2. Form submission to `/api/auth/signin.ts` or `/api/auth/signup.ts` with email/password
3. Sign-in: verifies password via argon2, rate limits by IP (5 attempts/15min)
4. Sign-up: validates email format, creates new user with hashed password
5. Creates Lucia session via `initializeLucia(db).createSession()`
6. Sets session cookie in response headers
7. Cookie automatically included in subsequent requests
8. Middleware in Astro context sets context.locals.user from session

**State Management:**

- User state: Server-side sessions stored in database (sessions table), passed via context.locals.user
- Review state: Transient in form, submitted directly to API, then queried from database
- Admin state: Cached in memory during admin dashboard page render, refreshed on each page load
- Score state: Calculated on-demand during review submission, cached in building_scores table

## Key Abstractions

**Review (src/lib/types.ts):**
- Purpose: Represents a single tenant review with all survey responses
- Contains: User/building relationships, 27 survey score fields, move-in/out dates, rent, amenities, optional review text
- Pattern: TypeScript interface enforced at API and component boundaries

**Building (src/lib/types.ts):**
- Purpose: Represents a rental property
- Contains: Address, geographic coordinates, Google Place ID, optional landlord relationship
- Pattern: Created on-first-review-submission, slug-based routing

**BuildingScores (src/lib/types.ts):**
- Purpose: Aggregated metrics for a building across all reviews
- Contains: Average scores per domain (unit, building, landlord), percentage statistics (would recommend, issue prevalence), review count
- Pattern: Cached and updated during review approval/moderation

**User (src/lib/types.ts):**
- Purpose: Represents an authenticated person
- Contains: Email, verification status, Google OAuth linking, admin flag
- Pattern: Created during sign-up or Google OAuth callback, linked to reviews for attribution

**DomainScores (src/lib/scoring.ts):**
- Purpose: Weighted scores across three domains (unit, building, landlord)
- Calculation: Individual items have health/safety weights (1.0-1.5x), scores calculated as weighted average per domain, then domains averaged for overall
- Pattern: Calculated synchronously during review submission, stored in database

**Survey Items (src/lib/surveyItems.ts):**
- Purpose: UI labels, help text, scale descriptions for each of 27 survey questions
- Pattern: Shared between frontend form rendering and backend documentation

**Rate Limit (src/lib/rateLimit.ts):**
- Purpose: Prevent abuse by tracking request frequency per IP + action
- Implementation: Stores attempts in database with expiration timestamps
- Used by: Sign-in (5 attempts/15 min), review submission (10 per hour per user), other sensitive endpoints

## Entry Points

**Web Application Entry:**
- Location: `src/pages/index.astro`
- Triggers: Browser request to root URL
- Responsibilities: Render marketing homepage with search form, call-to-action buttons, feature overview

**Review Creation Entry:**
- Location: `src/pages/review/new.astro` (or `/review/[id]` for edit)
- Triggers: User clicks "Write a Review" CTA or navigates directly
- Responsibilities: Require authentication, render ReviewEditForm, display progress/instructions

**Building View Entry:**
- Location: `src/pages/building/[slug].astro`
- Triggers: User clicks on search result or direct URL navigation
- Responsibilities: Fetch building data, aggregate scores, display reviews grouped by unit type

**Authentication Entry:**
- Location: `src/pages/auth/signin.astro` and `src/pages/auth/signup.astro`
- Triggers: User clicks sign-in/sign-up button
- Responsibilities: Render form, validate input locally, submit to auth API

**Admin Entry:**
- Location: `src/pages/admin/index.astro` (dashboard)
- Triggers: Authenticated admin user navigates to `/admin`
- Responsibilities: Fetch aggregate statistics, display review queue, provide quick actions

**API Entry Points:**
- Location: `src/pages/api/[action]/[...routes].ts`
- Pattern: RESTful endpoints following Astro file-based routing
- Common routes:
  - `GET /api/buildings?q=...` - Search buildings
  - `POST /api/buildings` - Create new building
  - `POST /api/reviews` - Submit new review
  - `GET /api/reviews/[id]` - Fetch specific review
  - `POST /api/auth/signin` - Authenticate user
  - `GET /api/admin/reviews` - List all reviews (admin only)

## Error Handling

**Strategy:** Consistent HTTP status codes with JSON error responses, client-side validation before submission, server-side validation with detailed error messages.

**Patterns:**

- **400 Bad Request**: Missing/invalid input (validated via validateReviewForm, email format checks)
- **401 Unauthorized**: Missing authentication context (checked via !context.locals.user)
- **403 Forbidden**: Non-admin attempting admin operation (checked via !context.locals.user.isAdmin)
- **404 Not Found**: Resource does not exist (building lookup failure)
- **429 Too Many Requests**: Rate limit exceeded (checkRateLimit returns allowed: false)
- **500 Internal Server Error**: Database errors or unexpected exceptions (wrapped in try-catch)

All API errors follow pattern:
```json
{ "error": "Human-readable message" }
```

Redirect responses (sign-in success) use 302 with Set-Cookie headers.

## Cross-Cutting Concerns

**Logging:**
- Pattern: console.error for unexpected failures, console.log suppressed in production
- Used in: API error handlers, database failures, auth errors
- Example: `console.error('Review submission error:', error)`

**Validation:**
- Client-side: React form components validate before submit (ReviewEditForm checks required fields)
- Server-side: `validateReviewForm()` returns ValidationError[] array with field-level messages
- Pattern: Explicit validation before database operations, detailed error messages returned to client

**Authentication:**
- Mechanism: Lucia session library + SQLite session table
- Pattern: Context.locals.user populated from session cookie during request handling
- Protection: All review/building/admin endpoints require !context.locals.user check before proceeding
- Session attributes: email, emailVerified, name, avatarUrl, googleId, isAdmin

**Authorization:**
- Role-based: Admin operations protected by isAdmin flag
- Resource-based: Users can only edit their own reviews (implicit - not yet enforced)

**Privacy:**
- Tenant anonymity: Move dates shown as season + year only (not exact dates)
- Email obfuscation: Only shown to admins or review author
- Pattern: privacy.ts utilities mask sensitive data in API responses

**Rate Limiting:**
- IP-based for authentication (prevents credential stuffing)
- User-based for review submission (prevents spam)
- Pattern: checkRateLimit(db, identifier, action, limit, windowSeconds) returns {allowed, retryAfterSeconds}

**Database Access:**
- Pattern: All queries via D1 prepared statements with parameterized binding
- Error handling: Database errors caught and 500 responses returned
- No raw SQL concatenation (injection-safe)

**API Response Consistency:**
- Pattern: jsonResponse(data, status) and errorResponse(message, status) utilities from api.ts
- Headers: Always 'Content-Type': 'application/json'
- Structure: Either {data: ...} for success or {error: ...} for failure
