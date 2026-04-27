# External Integrations

**Analysis Date:** 2026-04-26

## APIs & External Services

**Google Services:**
- **Google OAuth 2.0** - User authentication via OAuth
  - SDK/Client: Native `fetch` with Google token endpoint
  - Implementation: `src/pages/api/auth/google.ts`, `src/pages/api/auth/google/callback.ts`
  - Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - Token exchange: `https://oauth2.googleapis.com/token`
  - User info: `https://www.googleapis.com/oauth2/v3/userinfo`

- **Google Places API (New)** - Address autocomplete and place details
  - SDK/Client: REST API via `fetch`
  - Implementation: `src/pages/api/places/autocomplete.ts`, `src/pages/api/places/details.ts`
  - Auth: `GOOGLE_PLACES_API_KEY` or fallback to `GOOGLE_MAPS_API_KEY`
  - Endpoint: `https://places.googleapis.com/v1/places:autocomplete`
  - Header requirement: Must include `Referer: https://ratemyplace.org/` for server-side calls
  - Component integration: `src/components/AddressAutocomplete.tsx` (React island)

- **Google Maps Display** - Building location map visualization
  - SDK/Client: Google Maps JavaScript API v=weekly
  - Implementation: `src/components/BuildingMap.tsx` (React island)
  - Auth: `GOOGLE_MAPS_API_KEY` embedded in script tag
  - API Call: `https://maps.googleapis.com/maps/api/js?key={apiKey}&libraries=marker&v=weekly`
  - Features: Advanced Marker Elements, Info Windows

**Email Service:**
- **Resend** - Transactional email delivery
  - SDK/Client: `resend@6.9.2` package
  - Implementation: `src/lib/email.ts` (7 email functions)
  - Auth: `RESEND_API_KEY`
  - From address: `noreply@ratemyplace.org`
  - Email types:
    - Verification email: `sendVerificationEmail()`
    - Password reset: `sendPasswordResetEmail()`
    - Dispute confirmation: `sendDisputeConfirmationEmail()`
    - Dispute upheld notification: `sendDisputeUpheldEmail()`
    - Contact form confirmation: `sendContactConfirmationEmail()`
    - Contact form admin notification: `sendContactNotificationEmail()`
  - Used in: `src/pages/api/auth/signup.ts`, `src/pages/api/auth/forgot-password.ts`, `src/pages/api/auth/resend-verification.ts`, `src/pages/api/contact.ts`, `src/pages/api/disputes/*.ts`

**City/Municipal Data APIs:**
- **Boston Assessing API** - Property enrichment for Boston properties
  - Provider: City of Boston (data.boston.gov)
  - API Type: CKAN DataStore (not Socrata)
  - Resource ID: `ee73430d-96c0-423e-ad21-c4cfb54c8961` (FY2026)
  - Endpoint: `https://data.boston.gov/api/3/action/datastore_search`
  - Implementation: `src/lib/enrichment/adapters/boston.ts`
  - Data returned: Owner, year built, units, building type, condition, values, dimensions
  - Used by: Admin endpoint `/api/admin/buildings/[id]/enrich` (human-in-the-loop, not auto-saved)

- **CT CAMA API** - Property enrichment for New Haven properties
  - Provider: State of Connecticut (data.ct.gov)
  - API Type: Socrata (no API key required)
  - Resource ID: `pqrn-qghw`
  - Endpoint: `https://data.ct.gov/resource/pqrn-qghw.json`
  - Implementation: `src/lib/enrichment/adapters/new-haven.ts`
  - Used by: Admin endpoint `/api/admin/buildings/[id]/enrich`

## Data Storage

**Databases:**
- **Cloudflare D1 (SQLite)**
  - Binding name: `DB`
  - Database ID: `7dd2a722-fdd3-4986-b2f7-6d61d069438e`
  - Database name: `ratemyplace-db`
  - Client: D1 adapter from `@cloudflare/workers-types`
  - Access pattern: `getDB()` helper in `src/lib/db.ts`
  - Connection via Cloudflare runtime: `(context.locals as any).runtime?.env?.DB`
  - Tables: users, sessions, reviews, buildings, disputes, audit_logs, rate_limits, landlords, property_managers, verification_tokens, password_reset_tokens, contact_messages, bug_reports
  - Timestamps: Use `unixepoch()` for SQLite (not `datetime('now')`)

**File Storage:**
- **Cloudflare R2**
  - Bucket name: `ratemyplace-verification`
  - Binding name: `VERIFICATION_BUCKET`
  - Purpose: Store verification images (rent receipt, lease, ID)
  - Client: R2 API via `@cloudflare/workers-types`
  - Access pattern: `src/lib/storage.ts` functions
  - Key format: `users/{userId}/verifications/{reviewId}/{timestamp}.{ext}`
  - Allowed types: JPEG, PNG, HEIC, HEIF, PDF
  - Max file size: 10MB
  - Implementation: `uploadVerificationImage()`, `getVerificationImage()`, `deleteVerificationImage()`

**Caching:**
- Not explicitly configured (Cloudflare Cache API available via Workers runtime, but not actively used in current codebase)

## Authentication & Identity

**Auth Provider:**
- **Custom implementation with Lucia v3**
  - Session storage: D1 database (`users` and `sessions` tables)
  - Session adapter: `@lucia-auth/adapter-sqlite`
  - User attributes: email, emailVerified, name, avatarUrl, googleId, isAdmin
  - Session cookie: Secure in production, configurable

- **Google OAuth Integration**
  - Implicit flow via redirect to Google auth endpoint
  - Token exchange and user info retrieval via server-side `fetch`
  - User lookup/creation on first login via `google_id` field in users table

- **Email/Password Auth**
  - Password hashing: Via Lucia/oslo crypto
  - Nullable `hashed_password` (users can sign up via Google only)
  - Password reset flow: Token-based via email link

## Bot Protection

**Cloudflare Turnstile:**
- Purpose: CAPTCHA alternative on contact form and review submission
- Sitekey: `0x4AAAAAACo4KpkxsacPhM2r` (public key)
- Secret key: `TURNSTILE_SECRET_KEY` (environment variable)
- Verification endpoint: `https://challenges.cloudflare.com/turnstile/v0/siteverify`
- Implementation: `src/lib/turnstile.ts` function `verifyTurnstile()`
- Frontend: `src/components/contact/ContactForm.tsx`, `src/components/reviews/form-steps/ConfirmStep.tsx`

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, Rollbar, or similar integration)

**Logs:**
- Console logging throughout codebase (`console.error()`, `console.log()`, `console.warn()`)
- Cloudflare Workers runtime logs (available via `wrangler tail`)
- Custom audit logging: `src/lib/audit.ts` for admin action tracking (best-effort, non-blocking)

## CI/CD & Deployment

**Hosting:**
- Cloudflare Pages (production deployment)
- Auto-deploys from `main` branch to https://ratemyplace.org
- Preview URLs: `*.ratemyplace-64y.pages.dev`

**CI Pipeline:**
- Not detected (no GitHub Actions, GitLab CI, or equivalent configured)
- Manual deployment via git push to main branch

## Rate Limiting

**Implementation:**
- Custom rate limiter in `src/lib/rateLimit.ts`
- Stored in D1 database (`rate_limits` table)
- Tracks by client IP address
- Used for: password reset (3 per hour), email verification resend (3 per hour), other endpoints as configured

## Environment Configuration

**Required env vars:**
- `GOOGLE_CLIENT_ID` - OAuth
- `GOOGLE_CLIENT_SECRET` - OAuth
- `GOOGLE_MAPS_API_KEY` - Maps and fallback for Places API
- `GOOGLE_PLACES_API_KEY` - Address autocomplete (preferred over GOOGLE_MAPS_API_KEY)
- `RESEND_API_KEY` - Email delivery
- `SITE_URL` - Canonical site URL (optional, falls back to request origin)
- `TURNSTILE_SECRET_KEY` - Bot verification (optional, skipped if not set)

**Secrets location:**
- Cloudflare Pages environment variables
- Configured in Cloudflare dashboard or via `wrangler secret`
- Never committed to repository

## Webhooks & Callbacks

**Incoming:**
- `/api/auth/google/callback` - Google OAuth callback handler
- `/api/admin/buildings/[id]/enrich` - Admin-triggered property enrichment (no webhook, manual trigger)

**Outgoing:**
- Email notifications via Resend (transactional)
- Google OAuth token exchange (OAuth 2.0 token endpoint)

---

*Integration audit: 2026-04-26*
