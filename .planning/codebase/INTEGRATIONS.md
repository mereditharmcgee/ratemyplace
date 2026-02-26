# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**Google APIs:**
- Google Maps Places API - Address autocomplete and place details
  - Endpoints: `https://maps.googleapis.com/maps/api/place/autocomplete/json`, `https://maps.googleapis.com/maps/api/place/details/json`
  - SDK/Client: Native fetch API (no SDK)
  - Auth: `GOOGLE_MAPS_API_KEY` env var

- Google OAuth 2.0 - User authentication
  - Endpoints: `https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`, `https://www.googleapis.com/oauth2/v3/userinfo`
  - SDK/Client: Native fetch API (no SDK)
  - Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` env vars

## Data Storage

**Databases:**
- Cloudflare D1 (SQLite)
  - Connection: Cloudflare Workers binding "DB" (type D1Database)
  - Client: D1 native API via `context.locals.runtime.env.DB`
  - ORM: None (raw SQL queries via `.prepare()`)
  - Schema: SQLite with migrations in `migrations/` directory
  - Tables: users, sessions, landlords, buildings, reviews, verification_images, property_managers, etc.
  - Adapter: `@lucia-auth/adapter-sqlite` for Lucia auth framework

**File Storage:**
- Cloudflare R2 (object storage)
  - Connection: Cloudflare Workers binding "VERIFICATION_BUCKET" (type R2Bucket)
  - Usage: Document verification image storage
  - Bucket name: "ratemyplace-verification"
  - Key format: `users/{userId}/verifications/{reviewId}/{timestamp}.{ext}`
  - Allowed types: JPG, PNG, HEIC, HEIF, PDF
  - Max file size: 10MB
  - Client: R2 native API via bucket.put(), bucket.get(), bucket.delete()
  - Implementation: `src/lib/storage.ts` (uploadVerificationImage, getVerificationImage, deleteVerificationImage)

**Caching:**
- None (no caching layer detected)

## Authentication & Identity

**Auth Provider:**
- Custom implementation with Lucia
  - Framework: Lucia 3.2.2 with D1Adapter
  - Implementation: `src/lib/auth.ts`
  - Session storage: D1 (users, sessions tables)
  - Password hashing: PBKDF2-SHA256 with random salt via `@oslojs/crypto`
  - OAuth: Google OAuth 2.0 with state-based CSRF protection
  - Session cookies: httpOnly, secure in production
  - User attributes: email, email_verified, name, avatar_url, google_id, is_admin

**Google OAuth Flow:**
- Initiation: `src/pages/api/auth/google.ts` - generates state, redirects to Google
- Callback: `src/pages/api/auth/google/callback.ts` - exchanges code for tokens, fetches user info, creates/links user, establishes session
- CSRF Protection: State cookie validation (10-minute expiry)
- Account Linking: Existing email accounts can be linked to Google ID

## Monitoring & Observability

**Error Tracking:**
- None (no external error tracking service detected)
- Console logging via `console.error()` and `console.log()` for debugging

**Logs:**
- Console-based logging only
- No structured logging, log aggregation, or external logging service

## CI/CD & Deployment

**Hosting:**
- Cloudflare Pages - Static and dynamic content hosting
- Cloudflare Workers - Serverless API execution

**CI Pipeline:**
- None (no CI service detected - no GitHub Actions, GitLab CI, etc.)
- Manual deployment via Wrangler CLI

**Deployment Configuration:**
- Output mode: server (SSR enabled)
- Adapter: @astrojs/cloudflare
- Database migrations applied manually before deployment

## Environment Configuration

**Required env vars:**
- `GOOGLE_MAPS_API_KEY` - Google Maps Places API key
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `DB` - Cloudflare D1 database binding (injected by platform)
- `VERIFICATION_BUCKET` - Cloudflare R2 bucket binding (injected by platform)

**Secrets location:**
- Managed via Cloudflare Pages/Workers environment settings
- Not stored in `.env` files in repository

**Access in code:**
- Via `(context.locals as any).runtime.env.{VAR_NAME}`
- Build-time env: `import.meta.env.PROD` for production detection

## Webhooks & Callbacks

**Incoming:**
- Google OAuth callback: `src/pages/api/auth/google/callback.ts` - receives auth code and state
- No other webhooks detected

**Outgoing:**
- None (no outgoing webhooks detected)

## API Endpoints

**Authentication Endpoints:**
- `GET /api/auth/signin` - Sign in form/page
- `POST /api/auth/signup` - User registration
- `POST /api/auth/signout` - Sign out / session termination
- `GET /api/auth/google` - Initiates Google OAuth flow
- `GET /api/auth/google/callback` - Google OAuth callback handler

**Google Maps Integration:**
- `GET /api/places/autocomplete` - Address autocomplete via Google Places API
- `GET /api/places/details` - Address details via Google Places API

**Verification & Storage:**
- `POST /api/verification/upload` - Upload verification image to R2

**CORS & API Security:**
- Built-in Astro/Cloudflare request handling (no explicit CORS config detected)
- Authentication required for sensitive endpoints (verified via `context.locals.user`)
- Admin access checks via `context.locals.user.isAdmin`

---

*Integration audit: 2026-02-26*
