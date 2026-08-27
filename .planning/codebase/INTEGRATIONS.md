# External Integrations

**Analysis Date:** 2026-05-02

## APIs & External Services

**Authentication & Identity:**
- **Google OAuth 2.0** - User signup/signin with Google accounts
  - Endpoints: `https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`, `https://www.googleapis.com/oauth2/v3/userinfo`
  - Implementation: `src/pages/api/auth/google.ts`, `src/pages/api/auth/google/callback.ts`
  - Credentials: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Cloudflare Pages secrets)
  - Scope: `openid email profile`
  - CSRF: State parameter stored in SameSite=Lax cookie (10-minute expiry)

**Maps & Location:**
- **Google Places API (New)** - Address autocomplete and place details
  - Endpoints: `https://places.googleapis.com/v1/places:autocomplete`, `https://places.googleapis.com/v1/places/{placeId}`
  - Implementation: `src/pages/api/places/autocomplete.ts`, `src/pages/api/places/details.ts`
  - Credentials: `GOOGLE_PLACES_API_KEY` (preferred) or fallback `GOOGLE_MAPS_API_KEY`
  - Headers: Requires `Referer: https://ratemyplace.org/` for server-side calls
  - Features: Autocomplete (US addresses, street_address/subpremise/premise types), place details with structured address components

**Security & Bot Prevention:**
- **Cloudflare Turnstile** - CAPTCHA verification
  - Endpoint: `https://challenges.cloudflare.com/turnstile/v0/siteverify` (verification)
  - Implementation: `src/lib/turnstile.ts`
  - Credentials: `TURNSTILE_SECRET_KEY` (Cloudflare Pages secret)
  - Usage: Required on all unauthenticated POST forms (contact, signup, disputes, bug reports, review creation)
  - Sitekey: `0x4AAAAAACo4KpkxsacPhM2r` (hardcoded in frontend components)
  - Client-side: Rendered via Cloudflare's iframe (`cf-turnstile` element)

**Email Delivery:**
- **Resend** - Transactional email service
  - Implementation: `src/lib/email.ts` (7 email templates)
  - Credentials: `RESEND_API_KEY`
  - Sender: `noreply@ratemyplace.org`, `support@ratemyplace.org`
  - Emails:
    - Verification email (signup, resend verification)
    - Password reset email
    - Dispute confirmation (to landlord)
    - Dispute resolution outcomes (uphold/dismiss/partially_valid)
    - Contact form confirmation (to submitter)
    - Contact form notification (to admin at contact@ratemyplace.org)
    - Review rejection notification (to reviewer)

**Property Data Enrichment:**
- **Boston Assessing API** - Property records for Boston buildings
  - Endpoint: `https://data.boston.gov/api/3/action/datastore_search`
  - Resource ID: `ee73430d-96c0-423e-ad21-c4cfb54c8961` (FY2026 data)
  - Implementation: `src/lib/enrichment/adapters/boston.ts`
  - Data: Owner name, year built, residential/commercial units, property type, structure class, overall condition, total value, gross/living area
  - Method: No API key required; CKAN datastore search with JSON filter params
  - Human-in-loop: Data retrieved but never auto-saved (admin review required)

- **CT CAMA API (New Haven)** - Property records for Connecticut buildings
  - Endpoint: `https://data.ct.gov/resource/pqrn-qghw.json`
  - Implementation: `src/lib/enrichment/adapters/new-haven.ts`
  - Data: Owner, year built, property use, gross area, appraised value, condition
  - Method: Socrata API, no API key required
  - Query: Filters by address number and street name
  - Human-in-loop: Data retrieved but never auto-saved (admin review required)

## Data Storage

**Databases:**
- **Cloudflare D1 (SQLite)** - Primary database
  - Binding: `DB` (type `D1Database`)
  - Database name: `ratemyplace-db`
  - Client: D1 adapter for Lucia auth (`@lucia-auth/adapter-sqlite`)
  - Access pattern: `getDB(context)` returns D1Database instance
  - Timestamps: `unixepoch()` for SQLite (not `datetime('now')`)
  - Connection: Via `context.locals.runtime.env.DB` (set up in middleware)

**File Storage:**
- **Cloudflare R2** - Object storage for verification documents
  - Binding: `VERIFICATION_BUCKET` (type `R2Bucket`)
  - Purpose: Store user-submitted verification images and PDFs
  - Key format: `users/{userId}/verifications/{reviewId}/{timestamp}.{ext}`
  - Allowed types: JPEG, PNG, HEIC, HEIF, PDF
  - Max file size: 10 MB
  - Implementation: `src/lib/storage.ts` (upload, get, delete operations)

**Caching:**
- Not detected - No Redis or in-memory cache configured

## Authentication & Identity

**Auth Provider:**
- **Custom + Google OAuth** hybrid approach
  - Primary: Google OAuth 2.0 (signup/signin with Google)
  - Secondary: Custom email/password authentication (signup, signin, password reset)
  - Session management: Lucia v3 with D1 adapter
  - Session storage: `users` and `sessions` tables in D1
  - Session cookie: `auth_session` (HttpOnly, SameSite=Lax, Secure in production)
  - User attributes: Email, email_verified flag, name, avatar_url, google_id, is_admin flag

**Email Verification:**
- Token-based verification with 24-hour expiry
- Implementation: `src/pages/api/auth/verify-email`
- Storage: Tokens in D1 `email_verification_codes` table

**Password Reset:**
- Token-based password reset with 1-hour expiry
- Implementation: `src/pages/api/auth/forgot-password`
- Storage: Tokens in D1 `password_reset_codes` table

## Monitoring & Observability

**Error Tracking:**
- Not detected - No Sentry, DataDog, or similar configured

**Logs:**
- Console logging via `console.error()`, `console.warn()`
- Structured logging in `src/lib/logger.ts` (error handler)
- Email recipient hashing: Privacy-preserving log correlation using SHA256 (first 8 hex chars)

## CI/CD & Deployment

**Hosting:**
- **Cloudflare Pages** - Git-based deployment
  - Project name: `ratemyplace`
  - Build output: `dist/` directory
  - Auto-deploy: On push to main branch
  - Preview URLs: `*.ratemyplace-64y.pages.dev`
  - Custom domain: `ratemyplace.org` (DNS CNAME to Cloudflare)

**CI Pipeline:**
- **Workflow 1 — CI** (`.github/workflows/ci.yml`): runs for pull requests and pushes to
  `main`. Its stable check name is **`quality`** and it runs `npm ci`, `npm run check`,
  `npm test`, and `npm run build` with read-only repository permissions.
- **Workflow 2 — Post-deploy smoke** (`.github/workflows/post-deploy-smoke.yml`): for
  every internal `main` CI completion, records a failing sentinel when `quality` did not
  succeed; otherwise it waits for Cloudflare Pages to serve that exact commit SHA and runs
  the read-only production smoke suite.
- The repository workflows do not deploy or roll back Cloudflare Pages. A `main` branch
  ruleset/required-check activation is not asserted here; Task 7 must verify that external
  configuration separately.
- Local checks use `npm ci`, `npm run check`, `npm test`, and `npm run build`.

## Environment Configuration

**Required env vars (Cloudflare Pages Secrets):**
- `GOOGLE_CLIENT_ID` - OAuth client ID from Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `GOOGLE_MAPS_API_KEY` or `GOOGLE_PLACES_API_KEY` - Maps/Places API key
- `RESEND_API_KEY` - Email service API key
- `TURNSTILE_SECRET_KEY` - Cloudflare Turnstile secret
- `SITE_URL` - Base URL for email links (e.g., `https://ratemyplace.org`)

**D1 Binding:**
- `DB` - Automatically bound via `wrangler.jsonc` configuration

**R2 Binding:**
- `VERIFICATION_BUCKET` - Automatically bound via `wrangler.jsonc` configuration

**Secrets Location:**
- Cloudflare Pages project settings → Environment Variables section
- Also available as Wrangler secrets for local development: `wrangler secret put <KEY>`

## Webhooks & Callbacks

**Incoming:**
- `/api/auth/google/callback` - Google OAuth callback endpoint (handles code exchange, user creation/update)
- `/api/contact` - Contact form submission (public POST, requires Turnstile token)
- `/api/disputes` - Dispute submission (public POST, requires Turnstile token)
- `/api/bug-reports` - Bug report submission (public POST, requires Turnstile token)
- `/api/reviews` - Review submission (public POST, requires Turnstile token)
- `/api/verification/upload` - Verification image upload (authenticated)

**Outgoing:**
- **Cloudflare Email Routing** - Catch-all forwarding sends all @ratemyplace.org addresses to personal email
- **Resend** - Outbound transactional emails (verification, password reset, dispute notifications, contact confirmations, review rejections)
- **Google Places API** - Autocomplete/details queries from review form
- **Data enrichment APIs** - Boston Assessing and CT CAMA queries (admin-only, human-in-loop)

## Cross-Domain Security

**CORS:**
- Not explicitly configured (Astro security handled via middleware)

**Content Security Policy:**
Defined in `src/middleware.ts`:
- **default-src:** `'self'`
- **script-src:** `'self' 'unsafe-inline' https://challenges.cloudflare.com https://maps.googleapis.com https://static.cloudflareinsights.com`
- **style-src:** `'self' 'unsafe-inline' https://fonts.googleapis.com`
- **font-src:** `'self' https://fonts.gstatic.com`
- **img-src:** `'self' data: https://*.googleapis.com https://*.gstatic.com`
- **frame-src:** `https://challenges.cloudflare.com` (Turnstile iframes)
- **connect-src:** `'self' https://maps.googleapis.com https://places.googleapis.com https://challenges.cloudflare.com https://static.cloudflareinsights.com`

**CSRF Protection:**
- **SameSite=Lax** on session cookies and OAuth state cookie (cross-site POSTs don't carry cookies)
- **Cloudflare Turnstile** on all unauthenticated POST forms
- **Astro checkOrigin** (default enabled for SSR) for form-content-type requests
- Note: `application/json` endpoints (`/api/disputes`) rely on Turnstile + rate limiting + content-type validation

---

*Integration audit: 2026-05-02*
