# RateMyPlace - Architecture Documentation

Last reviewed: 2026-11-17

Root [`AGENTS.md`](AGENTS.md) is the canonical instruction file for agents. Where this doc and the code disagree, the code wins.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Database Schema](#database-schema)
5. [Authentication System](#authentication-system)
6. [Scoring Methodology](#scoring-methodology)
7. [API Endpoints](#api-endpoints)
8. [Page Components](#page-components)
9. [Shared Components](#shared-components)
10. [Library/Utility Files](#libraryutility-files)
11. [City records](#city-records)
12. [Deployment](#deployment)
13. [Academic References](#academic-references)
14. [Version History](#version-history)

---

## Project Overview

RateMyPlace is a public record of rental housing. It has two parts:

- **Tenant reviews.** Renters rate their unit, building and landlord on a 32-item survey: 27 scored items plus 5 ancillary questions. The items are adapted from published housing quality instruments, and the scores are weighted by documented health and safety effects.
- **City records.** Boston building pages carry a Public records panel of City of Boston open data. Every whole-building rental parcel in Boston has a page before anyone reviews it. See [City records](#city-records).

The repo holds three deployables:

1. **The site.** Astro SSR on Cloudflare Pages, deployed on every push to `main`.
2. **The records Cron Worker** in `workers/records-scheduler/`. It is bound to the same D1 database and deployed by hand.
3. **The data dashboard** in `dashboard/`. It is a static site of city housing records: a Python pipeline (`dashboard/pipeline/`) feeds a Vite, Preact and Leaflet site (`dashboard/web/`), which `.github/workflows/dashboard-nightly.yml` deploys each night as a static-assets Worker. Nothing in `src/` imports it, and the site's TypeScript and Tailwind builds exclude it. See [`dashboard/README.md`](dashboard/README.md).

The product commitments (tenant anonymity, sign-off for scoring changes, a true methodology page, due process for landlords, audited admin actions) are the "Non-negotiables" in root [`AGENTS.md`](AGENTS.md). Read them before changing anything they touch.

### Mission & Core Principles
1. **Evidence-Based**: Survey items drawn from validated instruments (OHQS, PHQS, WHO LARES)
2. **Health-Focused**: Scores weighted by documented health/safety impacts
3. **Transparent**: Methodology publicly documented with academic citations
4. **Tenant-Centered**: Anonymous reviews to protect renters

### Key Features

A short map of what ships today. [`MASTER.md`](MASTER.md) is the product spec and describes the full feature set. Where it and the code differ, the code wins.

- **Reviews.** A multi-step review form, review editing, moderation, landlord disputes, and tenancy verification uploads (stored in R2). Writing or editing a review needs a verified email. Each account gets one review per building, with a daily limit and a pause between submissions.
- **Scores.** Evidence-based weighted scoring, plus recency weighting. A building score shows from the first approved review and is an "Early rating" below 3 reviews. Landlord and property-manager scores stay hidden until 3 approved reviews. See [Scoring Methodology](#scoring-methodology).
- **Profile pages.** Building, landlord and property-manager pages. A building page groups its reviews by unit type (bedroom count), never by unit number.
- **City records.** The Public records panel, the reader request button, record corrections, and the owner-of-record list.
- **Search and map.** Site search includes seeded Boston pages. Browse mode and the interactive map show only buildings with at least one approved review. Map markers are clustered.
- **Accounts.** Email and password or Google sign-in, email verification, password reset, a profile page, saved buildings, and in-app notifications.
- **Site.** The public `/methodology` page with citations, contact and bug-report forms, a D1-backed sitemap, a `robots.txt` route, and a `/api/health` endpoint.
- **Admin.** Pages for the dashboard, reviews, buildings, landlords, property managers, users, disputes, tenancy verification, bug reports, contact messages, the audit log, and public records (`/admin/records`).

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | Astro, SSR (`output: 'server'`) | 5 |
| **Adapter** | `@astrojs/cloudflare` | 12 |
| **Runtime** | Cloudflare Pages (SSR) | - |
| **Database** | Cloudflare D1 (SQLite), binding `DB` | - |
| **File storage** | Cloudflare R2, binding `VERIFICATION_BUCKET` | - |
| **Auth** | Lucia + D1 Adapter | 3 |
| **UI Framework** | React (islands) | 18 |
| **Styling** | Tailwind CSS, as a Vite plugin (`@tailwindcss/vite`) | 4 |
| **Password Hashing** | WebCrypto PBKDF2 (`src/lib/password.ts`) | - |
| **Email** | Resend | - |
| **Bot defense** | Cloudflare Turnstile | - |
| **Maps** | Google Maps JS API and Places API (New), with `@googlemaps/markerclusterer` | - |
| **Tests** | Vitest (unit), Playwright with axe (E2E) | - |
| **Scheduled jobs** | Cron Worker in `workers/records-scheduler/` | - |
| **TypeScript** | Strict mode | - |

Astro is held on version 5. Astro 6 and later need `@astrojs/cloudflare` 13 or later, which dropped Cloudflare Pages, so upgrading means moving the site to a Worker with static assets. Root `AGENTS.md` explains why under "Traps".

### Dependencies

Exact versions are in `package.json` and locked in `package-lock.json`. Dependabot proposes updates (`.github/dependabot.yml`), and it skips the major upgrades held for the move off Pages.

---

## Project Structure

This is a directory-level map. `git ls-files` gives the full list, and the nested guides describe their directories module by module.

| Path | What is there |
|------|---------------|
| `src/pages/` | File-based routes: pages (`.astro`) and text routes (`sitemap.xml.ts`, `sitemaps/`, `robots.txt.ts`) |
| `src/pages/api/` | API routes. See [API Endpoints](#api-endpoints) |
| `src/components/` | Astro and React components, grouped by area (`reviews/`, `ratings/`, `records/`, `admin/`, `profile/`, `ui/` and others). A few top-level components, such as `BuildingRecords.astro` and `BuildingMap.tsx`, sit directly in `src/components/`. Guide: [`src/components/AGENTS.md`](src/components/AGENTS.md) |
| `src/lib/` | Business logic. `records/` is the city records code, `enrichment/` the admin auto-research adapters, `admin/` the admin helpers, and `__tests__/` the unit suite. Guide: [`src/lib/AGENTS.md`](src/lib/AGENTS.md) |
| `src/middleware.ts` | Session lookup and security headers. See [Authentication System](#authentication-system) |
| `src/env.d.ts` | Types for the runtime bindings, secrets and vars |
| `src/styles/global.css` | Tailwind entry and brand tokens |
| `migrations/` | The D1 schema, applied in order. Guide: [`migrations/AGENTS.md`](migrations/AGENTS.md) |
| `workers/records-scheduler/` | The records Cron Worker, with its own `wrangler.jsonc` |
| `dashboard/` | The separate data dashboard: `pipeline/` (Python) and `web/` (Vite, Preact, Leaflet). See [`dashboard/README.md`](dashboard/README.md) |
| `scripts/` | Local D1 setup and seed, the records seed and backfills, the records fixture check, the release smoke test, ops metrics, and the CI audit gate |
| `e2e/` | Playwright specs, including axe accessibility checks |
| `public/` | Static files, including `_headers` |
| `.github/` | Workflows (CI, dashboard CI, the dashboard nightly job, post-deploy smoke) and the Dependabot config |
| `docs/` | `runbooks/` (current), `archive/` (retired, not current), and design specs and plans |
| `brand/` | Brand assets. The handbook is `brand.md` at the root |
| `ops/` | Non-code work. Guide: [`ops/AGENTS.md`](ops/AGENTS.md) |
| `.planning/` | The milestone system: roadmap, requirements and audits |

Root files: `wrangler.jsonc` (the Pages config; it binds D1 `DB` and R2 `VERIFICATION_BUCKET`), `astro.config.mjs`, `tsconfig.json` (it excludes `e2e/` and `dashboard/`), `vitest.config.ts`, `playwright.config.ts`, `package.json`, and `audit-allowlist.json` (the CI audit gate's allowlist). The root docs are `AGENTS.md` (with `CLAUDE.md` pointing to it), [`MASTER.md`](MASTER.md), [`SECURITY.md`](SECURITY.md), [`brand.md`](brand.md), [`README.md`](README.md) and [`GOOGLE_OAUTH_TROUBLESHOOTING.md`](GOOGLE_OAUTH_TROUBLESHOOTING.md).

---

## Database Schema

The schema is `migrations/*.sql`, read in order. Later migrations alter, rebuild or drop earlier tables and columns, so no single file shows a table as it is now. [`migrations/AGENTS.md`](migrations/AGENTS.md) has the rules for writing and applying migrations, including the production trap.

Migration history worth knowing:
- `0005`, `0017` and `0022` are no-ops (`SELECT 1`). `0021_reserved.sql` is not a no-op despite its name: it creates `notifications` and adds `users.notification_opt_in`.
- `0016` rebuilds `users`, so `hashed_password` can be null for Google-only accounts. `0014`, `0028` and `0030` rebuild `audit_logs`.
- `0025` dropped the three score cache tables. `0026` backfilled the `*_new` review columns, and `0027` dropped 15 legacy review columns.

### Tables Overview

| Table | Purpose |
|-------|---------|
| `users` | User accounts (Lucia auth). `hashed_password` is null for Google-only accounts. `notification_opt_in` set to 0 turns off the review rejection email |
| `sessions` | Auth sessions |
| `verification_tokens` | Email verification links |
| `password_reset_tokens` | Password reset links |
| `landlords` | Landlord profiles that an admin creates and links to buildings |
| `property_managers` | Property-manager profiles that an admin creates and links to buildings |
| `buildings` | One row per building page, added by a user or by the records seed |
| `reviews` | Tenant reviews: answers, details, the stored `overall_score`, and moderation state |
| `review_votes` | Unused. Created by `0001`; no code reads or writes it |
| `verification_images` | Tenancy verification uploads. The files are in R2 until the decision or until their review is deleted. See [`verification_images`](#verification_images) below |
| `disputes` | Landlord disputes, at most one per review |
| `notifications` | In-app notifications (created by `0021_reserved.sql`) |
| `saved_buildings` | Buildings a user has saved |
| `rate_limits` | D1-backed rate-limit entries, keyed `<endpoint>:<digest>`, never a raw IP or id |
| `audit_logs` | The admin action log |
| `bug_reports` | Bug-report form submissions |
| `contact_messages` | Contact form submissions |
| `record_pulls` | One row per source per city records pull: the query, status, row count and reason |
| `building_records` | The stored city records |
| `record_corrections` | Reader reports of record errors, and how they were resolved |
| `records_queue` | Records pulls waiting for, or done by, the Worker |
| `app_settings` | Key-value operational state, such as the records fill pause and email failure counters |
| `building_owners` | The assessor's owner of record, one row per building |

The `building_scores`, `landlord_scores` and `property_manager_scores` cache tables are gone (`0025`). Scores are computed on read from approved reviews; see [Scoring Methodology](#scoring-methodology). Do not bring back a score cache table or triggers.

**Landlords, managers and owners are different things.** `landlords` and `property_managers` are admin-created profiles, linked through `buildings.landlord_id` and `buildings.property_manager_id`. The names a reviewer types are free text in `reviews.landlord_name` and `reviews.property_manager_name`. Neither table is the owner of record. The assessor's owner of record is in `building_owners`, written by each site or Worker records pull (`src/lib/records/owners.ts`) and by the SQL files that the one-time `npm run records:owners-backfill` writes for a person to apply. The records seed writes no owner rows. `buildings.owner_name`, `owner_entity` and `owner_website` are separate fields that an admin enters.

**IP addresses** are stored raw in one place only: `audit_logs.admin_ip`, the acting admin's IP. `rate_limits.rate_key` holds `<endpoint>:<digest>`, never the raw identifier. The digest is an HMAC-SHA256 of the endpoint and the identifier, keyed by `RATE_LIMIT_KEY` or, when that is unset, `TURNSTILE_SECRET_KEY`, and cut to 32 hex characters. The identifier is the client IP for public limiters. Some limiters use a user id instead (signed-in limits such as review submit, building create, save and verification upload), a building id (the admin records pull) or a notice kind (the owner-notice caps), hashed the same way. No log line carries the client IP. Root AGENTS.md has the rule under "Non-negotiables".

### Entity Relationships

```
landlords ─────────┐
                   │
                   ▼
             buildings ◄───── property_managers
                   │
                   ▼
              reviews ◄───── users
```

The diagram shows the core. The other foreign keys:
- **To `users`:** `sessions`, `verification_tokens`, `password_reset_tokens`, `notifications`, `saved_buildings`, `verification_images` and `bug_reports`. Actor columns also point at `users`: `reviews.verified_by`, `verification_images.reviewed_by`, `disputes.resolved_by`, `record_pulls.triggered_by` and `record_corrections.resolved_by`.
- **To `buildings`:** `saved_buildings`, `record_pulls`, `building_records`, `record_corrections`, `records_queue` and `building_owners`.
- **To `reviews`:** `disputes` (one per review, UNIQUE), `verification_images` and `notifications`.
- **To `record_pulls`:** `building_records` (`pull_id`).
- `review_votes` points at `reviews` and `users` but is unused.

### Key Tables

Read the migrations for full column lists. These notes cover what a column list does not tell you.

#### `buildings`
- The core columns come from `0001`: address, `slug`, neighborhood, city, state, ZIP, coordinates, year built, unit count and building type. `slug` is the public URL; never regenerate it. `state` is nullable with no default. `created_at` and `updated_at` are `INTEGER NOT NULL DEFAULT (unixepoch())`, and `updated_at` feeds the sitemap's `lastmod` (see [Other Pages](#other-pages)).
- `landlord_id` and `property_manager_id` link the admin-created profiles.
- `google_place_id` (`0002`) is unique when not null.
- `0009` added `admin_notes`, plus `public_info`, `owner_name`, `owner_entity` and `owner_website`.
- `0029` added `parcel_id` (10 digits, with the leading zero) and `sam_id`.
- `0031` added `source` (`'user'` or `'seed'`, NOT NULL DEFAULT `'user'`), `street_key`, `st_num_lo` and `st_num_hi`. Seeded rows have ids `seed-<parcel>`.

#### `reviews`
- `user_id` and `building_id` are NOT NULL, with `ON DELETE CASCADE`.
- The 27 scored answers are INTEGER columns with a 1 to 5 CHECK, named as in `ALL_SCORE_FIELDS` in `src/lib/scoring.ts`. `overall_score` is stored when a review is written or edited.
- `status` is NOT NULL and one of `pending`, `approved`, `rejected` or `flagged`. Moderation also uses `moderation_notes`, `rejection_reason`, `moderated_at` and `moderated_by`. Verification uses `is_verified`, `verified_at` and `verified_by` (`0007`).
- `move_out_year_new` (TEXT: `'current'`, a year, or `'2020_or_earlier'`) and `would_recommend_new` (TEXT: `'yes'`, `'no'` or `'maybe'`) are the canonical columns. The integer `move_out_year` and `would_recommend` columns were dropped in `0027`.
- Move-in is optional, but `move_in_year` and `move_in_season` are NOT NULL, so a skipped part holds a placeholder (winter, or the current year). `move_in_given` (`0035`) records which parts are real: `'season_and_year'`, `'year_only'`, `'none'`, or NULL for rows written before `0035`, which are shown as stored. Read move-in only through `givenMoveIn` in `src/lib/privacy.ts`, never from the raw columns.
- `unit_type` and the season columns have CHECK lists. The issue flags and `is_current_tenant` are NOT NULL.
- The rest hold the written review (`review_title`, `review_text`, `comments`), unit details, rent, laundry, parking, pets, utilities, amenities, pest types, the issue flags, housing-voucher acceptance and night lighting. Most were added by `0004`, `0008` and `0019`.

**Privacy columns.** `unit_number` is collected for moderation only. It is never shown on a public page or used for grouping. `tenure_months` and exact timestamps are collected but never displayed: public pages show fuzzy season and year buckets only. Every `admin_notes` column (on buildings, landlords, property managers, bug reports and contact messages) is internal and must never reach a public SELECT.

#### `verification_images`
- One row per proof-of-address upload. The file is in R2 (`VERIFICATION_BUCKET`) under a key that names the user and the review, so no log line carries a key or a filename.
- Approving or rejecting deletes the file and blanks `filename` to `''` (the column is NOT NULL). The row keeps the content type, size, status, moderator and any rejection reason.
- Deleting a review, or a building with reviews, deletes their files from R2 before the rows go (`src/lib/verificationFiles.ts`). A failed file delete is logged by count, recorded on the audit entry as `verificationFiles` (`removed`, `failed`), and never stops the delete. Orphan cleanup deletes only buildings with no reviews, so it has no files to remove. No route deletes a user, so an account deleted by hand needs its files removed by hand.
- `GET /api/admin/verification/[id]` serves the file with `Cache-Control: private, no-store`.
- The checklist on `/admin/verify` names the same documents as the upload modal (`src/components/profile/VerificationModal.tsx`), and `adminVerifyChecklist.test.ts` fails when the two drift apart.

---

## Authentication System

### Implementation
- **Library:** Lucia v3 with the D1 adapter. Sessions are in the `sessions` table.
- **Password:** PBKDF2-SHA256 through WebCrypto (`crypto.subtle`, in `src/lib/password.ts`): 100,000 iterations, a 16-byte random salt and a 32-byte key. The result is stored as `salt$hash` in base64 and compared in constant time. Legacy unsalted 64-hex SHA-256 hashes still verify, through `@oslojs/crypto`'s `sha256`. Sign-in does not re-hash them. Only sign-up, password reset and the password settings route call `hashPassword`, so a legacy hash stays until the password changes. `@oslojs/crypto` has one other use: `recipientHash` in `src/lib/runtime.ts` hashes email addresses for log correlation.
- **Password length:** sign-up requires 8 characters (`PASSWORD_MIN_LENGTH` in `src/lib/passwordPolicy.ts`). Sign-in still accepts 6 (`LEGACY_SIGNIN_MIN_LENGTH`) for passwords created before March 2026.
- **Cookies:** HttpOnly and SameSite=Lax come from Lucia's defaults. Secure is set only in production builds (`secure: import.meta.env.PROD`), so cookies in local dev are not Secure. The OAuth `oauth_state` cookie follows the same rule.
- **User fields:** `locals.user` carries `email`, `emailVerified`, `name`, `avatarUrl`, `googleId` and `isAdmin`. Lucia re-reads these on every validated request, so a change applies on the next request.

### Middleware (`src/middleware.ts`)
- Skips auth entirely when there is no `DB` binding. That early return also skips the security headers below.
- Validates a session only when a session cookie is present. It re-sets the cookie when Lucia marks the session fresh, clears it when the session is invalid, and logs and swallows auth errors.
- Sets `context.locals.user` and `context.locals.session`.
- Blocks nothing. It never refuses or redirects a request; every API route and page checks auth itself.
- After the auth step, sets security headers on the SSR response: a Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that allows geolocation for the site's own origin only. Static files get their headers from `public/_headers` instead: nosniff, `X-Frame-Options: DENY`, `X-XSS-Protection` and the same Referrer-Policy, with no CSP or Permissions-Policy.

Route-level checks (auth, admin, verified email) are the checklist in root AGENTS.md under "API routes".

### Flow
`POST /api/auth/signin` takes form data and runs these steps in order:
1. Validates the email and the password length (6 to 255).
2. Checks Turnstile.
3. Applies the per-IP rate limit: 5 per 15 minutes. It fails closed, with a 503, if the limiter's database call fails.
4. Refuses Google-only accounts (null `hashed_password`).
5. Verifies the PBKDF2 or legacy hash.
6. Creates the Lucia session and sets the cookie.

### Other flows
- **Google OAuth:** `/api/auth/google` sends the user to Google, and `/api/auth/google/callback` finishes. It uses the `oauth_state` cookie, plus an `oauth_return_to` cookie checked by `safeRedirectPath`. It refuses unverified Google emails. It links to an existing account by email and sets `email_verified=1`, but refuses an account already linked to a different Google id. New users get `email_verified=1` and a null password.
- **Sign-up:** Turnstile, 3 per hour per IP, and the 8-character minimum. It creates a session and emails a verification link that expires in 24 hours.
- **Email verification:** `verify-email` verifies the account and deletes all of its verification links. `resend-verification` allows 3 per hour.
- **Password reset:** `forgot-password` (3 per hour) and `reset-password` (5 per hour) work through `password_reset_tokens`. Reset links expire in 1 hour, and a reset invalidates all of the user's sessions.
- **Sign-out:** POST only. It invalidates the session and redirects to `/`.
- **Verified-email gate:** `hasVerifiedEmail` (`src/lib/emailVerification.ts`) guards `/review/new`, `/review/edit/[id]`, `POST /api/reviews`, `PATCH /api/reviews/[id]` and `POST /api/buildings`. The routes answer 403 with `details.reason` `email_verification_required`.
- **Return paths:** every post-sign-in redirect goes through `safeRedirectPath` (`src/lib/authRedirect.ts`).

### Security
- **CSRF:** three layers, audited 2026-04-28 (`.planning/audits/csrf-2026-04.md`). SameSite=Lax on the session cookie and the OAuth-state cookie, Turnstile on the public POSTs listed below (reset-password, though unauthenticated, has none and relies on its single-use token and a rate limit instead), and Astro's `checkOrigin`. `checkOrigin` does not cover `application/json`, so an unauthenticated JSON endpoint must add a content-type guard, a rate limit and Turnstile. `src/pages/api/disputes.ts` is the reference implementation. Root AGENTS.md has the details under "CSRF".
- **Rate limits:** D1-backed and fail-closed (`checkRateLimit` in `src/lib/rateLimit.ts`). Each row's key is a keyed hash, never the raw IP (see [Database Schema](#database-schema)). The auth limits are all per IP and listed above. Not every public route has one. `GET /api/buildings/map`, `GET /api/auth/verify-email` and the two Google OAuth GETs have no application limiter, and neither do the D1-backed pages (building, landlord and property manager pages, `/search`, `/owner-of-record`) or the sitemap routes (`/sitemap.xml`, `/sitemaps/*.xml`). `/api/health` is exempt by design.
- **Turnstile:** on sign-up, sign-in, forgot-password, contact, disputes, bug reports, reviews, record corrections and the records request.
- **Admin:** every admin API route checks `context.locals.user.isAdmin` in each handler and answers 403. Every `/admin/*` page, and `AdminLayout.astro`, redirects non-admins.
- **SQL:** request-time D1 queries are parameterized. Two places in `src/lib/records/` build SQL text instead. CKAN SQL for `data.boston.gov` is built by interpolation, guarded by `sqlLiteral`, `addressLikeClauses` and digits-only checks. The offline seed, suffix backfill and owners backfill write D1 SQL files whose values are quoted through `lit()`; `wrangler d1 execute --file` binds nothing. Nothing applies them at request time: the seed applies its own files when a person runs it with `--apply`, and the suffix and owners backfills only write files for a person to apply.
- **Types:** TypeScript runs in strict mode (`astro/tsconfigs/strict`), but `any` is still common in pages and older modules. "No new `any`" is a direction, not a finished state.

Past audits are in `.planning/audits/`.

---

## Scoring Methodology

RateMyPlace uses an **evidence-based weighted scoring system** grounded in peer-reviewed public health research. This is documented publicly at `/methodology`.

### Survey Instrument Foundation

The 27-item rating instrument is adapted from validated housing quality assessment instruments. The full review form also asks 5 ancillary questions (recommendation, tenure, move-out year, voucher acceptance, street-lighting) for context — these are not scored.

| Instrument | Source | Domain |
|------------|--------|--------|
| **OHQS** (Observational Housing Quality Scale) | Krieger & Higgins (2002) | Unit condition items |
| **PHQS** (Physical Housing Quality Scale) | Jacobs et al. (2009) | Building-level items |
| **WHO LARES** | Bonnefoy et al. (2003) | Landlord/management items |

### Health/Safety Weighting

Items with documented health impacts receive higher weights in score calculations:

| Item | Weight | Evidence |
|------|--------|----------|
| Pest Control | 1.5x | Allergens, disease vectors |
| Mold/Moisture | 1.5x | OR 1.5-3.5 respiratory illness |
| Structural Integrity | 1.3x | Safety hazards |
| Climate Control | 1.3x | Cardiovascular risk |
| Plumbing | 1.2x | Mold pathway |
| Security | 1.2x | Personal safety |
| All others | 1.0x | Standard weight |

### Domain Sub-Scores

Reviews display three aggregated scores:
- **Unit** (10 items): structural, plumbing, electrical, climate, ventilation, pests, mold, appliances, layout, accuracy
- **Building** (9 items): common areas, security, exterior, noise (2), mail, laundry, parking, trash
- **Landlord** (8 items): maintenance, communication, professionalism, lease clarity, privacy, deposit, rent practices, non-retaliation

### Recency Weighting

Aggregate scores apply gentle recency weighting (Hu, Pavlou & Zhang 2017):
- 0-2 years: 100%
- 3 years: 95%
- 4 years: 90%
- 5+ years: 85% (floor)

Age is the current UTC year minus the review's basis year. The basis is `move_out_year_new` when it holds exactly a 4-digit year. Otherwise it is the UTC year of `created_at` (`getReviewYear`). So a current tenant's review ages from submission. So does a past tenant who chose "2020 or earlier", which is stored as `2020_or_earlier`, not as a year. The SQL path generates the same rule (`reviewYearSql` and `recencyWeightSql` in `scoring-sql.ts`), so a change to `RECENCY_BANDS` changes both paths.

### How Scores Roll Up

The aggregate overall score is a recency-weighted mean of each review's stored `reviews.overall_score`, which is written at submission and on edit. Domain sub-scores and review cards are recomputed from the individual answers. A card's own overall is `calculateDomainScores(review).overall`, falling back to the stored value. So a weight change makes cards and aggregates disagree until `overall_score` is backfilled. Any change to `ITEM_WEIGHTS`, `RECENCY_BANDS` or the formula is retroactive and needs owner sign-off (root AGENTS.md, "Non-negotiables").

### Publication Thresholds

`NAMED_PARTY_MIN_REVIEWS` is 3. Landlord and property-manager aggregate scores are withheld (null) below 3 approved reviews (`calculateLandlordAverages` in JS, `namedPartyOverallSql` in SQL). A building score shows from its first approved review. Below 3 reviews it is an "Early rating": a muted number with its review count, and issue and recommend rates shown as counts, not percentages. A "Maybe / It depends" answer is never counted as a no. `/methodology#early-ratings` publishes this.

### Key Scoring Files

| File | Purpose |
|------|---------|
| `src/lib/scoring.ts` | Score fields, `ITEM_WEIGHTS`, `RECENCY_BANDS`, `NAMED_PARTY_MIN_REVIEWS`, and the JS aggregation |
| `src/lib/scoring-sql.ts` | The SQL twin: the recency CASE, `recencyWeightedOverallSql` and `namedPartyOverallSql`, all generated from `RECENCY_BANDS`. List views (search, map, saved, autocomplete, admin lists) and the building lists on landlord and property-manager pages use it. `src/lib/__tests__/scoring-sql-parity.test.ts` holds the SQL and JS paths equal |
| `src/lib/scoring-colors.ts` | The only home of the four score bands |
| `src/lib/earlyRating.ts` | How a score from fewer than 3 reviews is displayed |
| `src/lib/surveyItems.ts` | The 27 scored items and the 5 ancillary questions |
| `src/pages/methodology.astro` | Public methodology page with citations |

The rules for changing any of these are in [`src/lib/AGENTS.md`](src/lib/AGENTS.md), under "Scoring is load-bearing".

---

## API Endpoints

Routes are the files under `src/pages/api/`, and that tree is the full list. A file whose name starts with `_` is a helper, not a route (for example `admin/records/queue/_json.ts`). Nothing is protected implicitly. The checklist each route follows (auth, admin, verified email, content-type guard, rate limit, Turnstile, validation, audit log) is in root [`AGENTS.md`](AGENTS.md) under "API routes".

### Authentication

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/signup` | POST | Create a user. Turnstile, 3/h per IP |
| `/api/auth/signin` | POST | Authenticate a user. Turnstile, 5 per 15 min per IP |
| `/api/auth/signout` | POST | Destroy the session |
| `/api/auth/google` | GET | Start Google OAuth |
| `/api/auth/google/callback` | GET | Finish Google OAuth |
| `/api/auth/verify-email` | GET | Verify an email from its link |
| `/api/auth/resend-verification` | POST | Send a new link. Signed in, 3/h per IP |
| `/api/auth/forgot-password` | POST | Send a reset link. Turnstile, 3/h per IP |
| `/api/auth/reset-password` | POST | Set a new password from a reset link. 5/h per IP |

### Data

- **Buildings.** `GET /api/buildings` is an address lookup, not site search. It has two modes. `?placeId=` matches an exact Google place id, and the review form calls this mode. `?q=` (2 or more characters) runs a LIKE over address and neighborhood with LIMIT 10; no UI calls it today, only the release smoke's `buildings-search` probe. Both modes share a limit of 120 a minute per IP. `POST /api/buildings` creates or matches a building. It needs a signed-in user with a verified email and is limited to 20 an hour per user. `GET /api/buildings/map` feeds the map. `POST` and `DELETE /api/buildings/[id]/save` and `GET /api/buildings/saved` handle saved buildings.
- **Search.** Site search is the `/search` page (the first page, server-rendered) and `GET /api/search/results` (Load more, 60 a minute per IP). Both build the query from `buildingSearchWhere`, `buildingSearchSelect` and `buildingSearchOrder` in `src/lib/searchSql.ts`. `GET /api/search/autocomplete` (the homepage search box and the review form's address step, 120 a minute per IP) has its own SQL and does not use `searchSql.ts`.
- **Reviews.** `POST /api/reviews` answers 401 when signed out and 403 `email_verification_required` when the account's email is not verified. It requires Turnstile and is limited to 10 an hour per user. `REVIEW_GUARD_SQL` (`src/lib/reviewLimits.ts`) guards the insert: one review per account per building, at most `REVIEW_DAILY_LIMIT` (5) in a rolling 24 hours, and at least `REVIEW_SUBMIT_PAUSE_SECONDS` (60) between submissions. A refused insert gets 409 or 429 in the reason envelope. `GET` and `PATCH /api/reviews/[id]` read and edit a review, and `GET /api/reviews/user` lists the signed-in user's reviews.
- **City records.** `POST /api/records/request` (the reader request button) and `POST /api/records/corrections` (report a record error).
- **Places.** `/api/places/autocomplete` and `/api/places/details` proxy the Google Places API (New).
- **Other public routes.** Disputes (`POST /api/disputes`), contact, bug reports, user settings (`/api/user/email`, `/api/user/password`, `/api/user/profile`), notifications, `POST /api/verification/upload`, and `GET` and `HEAD /api/health`.
- **Admin.** Everything under `/api/admin/*`, including the records queue and corrections. `GET /api/disputes` and `PATCH /api/disputes/[id]` are admin-only too.

---

## Page Components

One entry per key page. The source files are the reference.

### Building Page (`/building/[slug]`)
- Reviews are grouped by unit type, resolved by `resolveUnitType` (`src/lib/reviewDisplay.ts`): a stored 'house' first, then the bedrooms answer, then the stored `unit_type`. The groups run from Studio through 4+ bedrooms, then House. Each group is collapsible, and the first is open. Each shows its own recency-weighted score (from the stored `overall_score`), rent range and recommend line.
- Unit numbers are never used for grouping or shown, because they identify tenants.
- The sidebar `ScoreCard` becomes an early rating below 3 reviews, and the "Common issues reported" rates become counts (`issueRateText`).
- A Building details block shows type, year built and units. Units reads "Units (estimated from land use)" when the count is the seed's land-use estimate.
- Signed-in viewers get a Save button. Everyone gets "Write a review".
- The Public records panel (`src/components/BuildingRecords.astro`) comes first when there is no approved review, and below the reviews otherwise.
- A building whose city resolves to Boston, with a parcel and no approved review, seeded or not, gets a records-flavored title and description (`buildingPageMeta`).

### Landlord Page (`/landlord/[slug]`)
- Lists every building linked by `landlord_id`, reviewed or not, each with a recency-weighted SQL score (`BuildingScoreSummary`).
- Shows the 5 most recent approved reviews.
- The aggregate score appears only once the portfolio has 3 approved reviews (`NAMED_PARTY_MIN_REVIEWS`). Below that, the header says "Aggregate score appears after 3 approved reviews" and no `ScoreCard` renders.

### Property Manager Page (`/property-manager/[slug]`)
- Works like the landlord page, keyed on `property_manager_id`, with the same threshold.
- Reuses `calculateLandlordAverages` and `ScoreCard type="landlord"`.

### Other Pages
- `/search`: query mode (built from `searchSql.ts`, includes seeded pages) and browse mode (reviewed buildings only).
- `/map`: `src/components/BuildingMap.tsx`, reviewed buildings only.
- `/owner-of-record?name=`: an owner's list of buildings, read from `building_owners`.
- `/review/new` and `/review/edit/[id]`: behind the verified-email gate.
- `/profile`, `/methodology`, `/dispute`, the auth pages, the content pages, and `/admin/*`, including `/admin/records`.
- `/sitemap.xml` and `/sitemaps/*.xml` read D1. A building's `lastmod` is the later of its `updated_at` and its newest records pull. No sitemap date is read from a review, and landlord entries and the static pages carry none. Root AGENTS.md lists the ways the date can still land near a review, under "Traps". `/robots.txt` does not read D1: it compares the request host with `SITE_URL` and serves `Disallow: /` on any other host.

---

## Shared Components

Component rules (Astro or React, islands, brand tokens) are in [`src/components/AGENTS.md`](src/components/AGENTS.md). Two rules apply to every score display: score colors come only from `src/lib/scoring-colors.ts`, and early-rating display comes from `src/lib/earlyRating.ts`.

### ReviewCard (`src/components/reviews/ReviewCard.astro`)
Displays one review. It never shows a unit number. It shows:
- The overall score and stars, the review title, and a Verified badge for verified reviews (which also get a blue left border).
- The unit type label (resolved the same way), a tenancy season chip, a fuzzy recency label (`formatRecency`: "Current tenant", "Past tenant", "Within the last year" through "10+ years ago"), and rent per month.
- The review text and bedroom, bath and square-footage chips.
- All 27 items in the score breakdown. Skipped items read "Not rated", and health-weighted items are starred.
- A Security Deposit highlight, utilities included, amenities, laundry (type and cost per load), parking, pets allowed, pest types and the issue flags.
- Section 8 voucher and night-lighting tags.
- A recommend badge only for the three answers the form offers (`recommendAnswer` in `src/lib/reviewDisplay.ts`): Would recommend, "Maybe / It depends", and Would not recommend. A skipped or unknown answer shows no badge and no empty footer row. The aggregate rates classify answers on their own: they skip a NULL, count a legacy `1` or `true` as yes, and count any other unknown value as no.

### ScoreCard (`src/components/ratings/ScoreCard.astro`)
The score sidebar.
- With `type="building"`, it shows the Unit, Building and Landlord domain boxes and the pest, heat, water and deposit issue rates.
- With `type="landlord"`, used by both the landlord and property-manager pages, it shows the Landlord box, the would-recommend percentage and the deposit issue rate, because those are the only card fields `calculateLandlordAverages` returns. Those pages render it only at 3 or more approved reviews.
- Boxes are tinted by `getScoreBgTint` in four bands: Good (4.0 and up), Mixed (3.0 to 3.9), Concerning (2.0 to 2.9) and Poor (below 2.0). Numbers use `getScoreTextColor`.
- For a building below 3 reviews, it adds an early-rating note, shows gray numbers (`scoreNumberClass`), shows counts ("1 of 1 review") instead of percentages, and never highlights an issue as high. Landlord and property-manager cards keep percentages.
- On a building card, "Maybe / It depends" gets its own row. No card counts a maybe as a no: the landlord card's percentage leaves maybes out (`calculateAggregatedScores`).
- It links to `/methodology`.

### StarRating (`src/components/ratings/StarRating.astro`)
- Visual star display
- Props: `rating`, `size` (`'sm'`, `'md'` or `'lg'`, default `'md'`) and `maxRating` (default 5)

---

## Library/Utility Files

Business logic lives in `src/lib/`, never in components. [`src/lib/AGENTS.md`](src/lib/AGENTS.md) documents it module by module and holds the rules for changing it. The notes below cover the modules a newcomer meets first.

### `scoring.ts` (Critical File)
The JS side of scoring. Its exports include `ALL_SCORE_FIELDS` and the `UNIT_FIELDS`, `BUILDING_FIELDS` and `LANDLORD_FIELDS` groups, `ITEM_WEIGHTS`, `RECENCY_BANDS`, `NAMED_PARTY_MIN_REVIEWS`, `getNamedPartyScoreState`, `getRecencyWeight`, `getReviewYear`, `calculateDomainScores`, `calculateOverallScore` and `calculateAggregatedScores`.
- `calculateBuildingAverages()` also returns pest, heat, water and deposit issue percentages.
- `calculateLandlordAverages()` returns nulls below 3 reviews and also serves property managers.
- Both carry a "Legacy function" comment but are the live paths. Other leftovers from the old field names, which `0027` dropped: a stale "fall back to old" comment in `calculateAggregatedScores`, and legacy-category branches in `ScoreCard.astro` (`avg_building_quality` and similar) that nothing populates.
- SQL aggregation lives in `scoring-sql.ts`. See [Key Scoring Files](#key-scoring-files).

### `surveyItems.ts`
Defines the 27 scored items (`unitItems`, `buildingItems` and `landlordItems`: 10, 9 and 8, combined as `surveyItems`) and the 5 ancillary `supplementaryItems` (would recommend, tenure, move-out timing, housing vouchers, night lighting): 32 in all.
- Only the scored items carry `help` (a description plus what a 5, a 3 and a 1 look like), `category`, `code`, `dimension`, `required` and `allowNA`.
- The ancillary items carry only a key, the question text and answer options, with no help text or domain.
- The file also exports `RESPONSE_OPTIONS`, the 1 to 5 scale from Strongly Disagree to Strongly Agree.

### `privacy.ts`
Keeps exact dates off public surfaces.
- `formatRecency()` gives the public label ("Current tenant", "Past tenant", "Within the last year" through "10+ years ago").
- `givenMoveIn()`, `formatMoveIn()`, `formatMoveOut()`, `formatTenancyRange()`, `reviewSeasonChipProps()` and `reviewTenancyLabel()` cover move-in and tenancy. Anything that shows a move-in goes through `givenMoveIn`, never the raw `move_in_*` columns. Public review cards use `reviewSeasonChipProps`. The dispute flow matches a review by `reviewTenancyLabel`, which reads the same props. The reviewer's edit page and the admin queue use `formatMoveIn`.
- `moveOutEditValue()` and `moveOutEditChoices()` serve the edit form.
- `formatFuzzyDate()`, `getCurrentSeason()` and `getCurrentYear()` are older helpers that remain.

### `auth.ts`
- `initializeLucia()` - Creates Lucia instance with D1 adapter

### `db.ts`
- `getDB(context: APIContext)` reads `getEnv(context).DB` (`src/lib/runtime.ts`) and throws if the binding is missing. Never call `getDB((context.locals as any).runtime)`.
- Most `.astro` pages and components read `Astro.locals.runtime.env.DB` directly. `review/edit/[id].astro` calls `getDB(Astro)`.

### Other load-bearing modules

| Module | What it does |
|--------|--------------|
| `runtime.ts` | `getEnv(context)`, the sanctioned way for routes to reach bindings and env; `maybeEnv` for render paths that must not throw; `fireAndForget`; `recipientHash` |
| `validation.ts` | Shared validators, including `isSafeHttpUrl` |
| `rateLimit.ts`, `turnstile.ts` | The fail-closed `checkRateLimit`, and Turnstile verification |
| `audit.ts` | `createAuditLog` for destructive admin actions |
| `password.ts`, `passwordPolicy.ts` | PBKDF2 hashing and the password length rules |
| `tokens.ts`, `emailVerification.ts`, `authRedirect.ts` | Verification and reset tokens, the verified-email gate, and safe return paths |
| `email.ts`, `trackSend.ts`, `emailHealth.ts`, `ownerNotify.ts` | Email templates, tracked sends, delivery health and owner notices |
| `reviewLimits.ts` | `REVIEW_GUARD_SQL` and the review limits |
| `searchSql.ts`, `searchQuery.ts` | The query-mode building search, and query parsing |
| `records/` | City records: sources, pulls, the queue, the scheduler, the fixture and the seed. See [City records](#city-records) |
| `enrichment/`, `admin/` | The admin auto-research adapters, and admin helpers |

---

## City records

Boston building pages carry a **Public records** panel: what City of Boston open data says
about the building. Records are reference, not judgment, and they are never part of a score.
The code is in `src/lib/records/`. Read [`src/lib/AGENTS.md`](src/lib/AGENTS.md) before
changing it.

### Sources

One module per dataset in `src/lib/records/sources/boston/`, all on Analyze Boston
(`data.boston.gov`, a CKAN portal): property assessment (the current fiscal year and the five
before it), approved building permits, building and property violations, Public Works code
enforcement, 311 service requests (one legacy file per year from 2011, plus the new system), and
RentSmart. `sourcesForCity` in `jurisdictions.ts` returns that list for Boston and an empty
list for every other city.

Boston's CKAN SQL endpoint has no parameter binding, so `src/lib/records/` (these adapters,
plus `ckan.ts` and `fixture.ts`) is the repo's one documented exception to parameterized
queries, and only for queries sent to `data.boston.gov`. The rules that keep it safe are in
root [`AGENTS.md`](AGENTS.md), under "API routes". The offline seed and backfills in
`src/lib/records/seed/` reuse the same quoting to write D1 SQL files that a person applies by
hand; see [Security](#security).

### From the city into D1

`pullBuildingRecords` (`pull.ts`) pulls one building. It builds every address and parcel
form worth querying (`identity.ts`), resolves the parcel through the current assessor year
when the building has none, then runs each source. Each source gets one `record_pulls` row
(the query sent, the status, the row count and why the pull ran), and its rows replace that
source's earlier rows in `building_records` in one batch. A source that fails keeps its last
good rows. Each assessor year's batch also writes the building's owner of record to
`building_owners`.

Pages exist before any queue pull. `npm run records:seed`, applied by hand, reads the assessor
and the city's SAM address data. It covers every whole-building rental parcel in Boston: land
use R2, R3, R4 and RC, plus the listed apartment-class `A` housing descriptions. Single-family
(R1), condo (CD, CM) and land parcels are left out. It writes three statements per parcel:

1. The building row. A new parcel gets an insert (`source = 'seed'`, id `seed-<parcel>`). An
   existing row matched to the parcel gets an update that fills in `parcel_id`, `sam_id`, the
   street key and the assessor facts, so no duplicate is created.
2. An FY2026 assessor `record_pulls` row (`trigger_reason = 'seed'`).
3. That assessment record, in `building_records`.

So a seeded page shows assessor data from the start. The deeper sources (permits, violations,
Public Works, 311, RentSmart) and the older assessor years wait for a queue pull. The seed
writes no `building_owners` rows. After a re-seed, run `npm run records:owners-backfill`,
which writes SQL and applies nothing.

### Onto the page

`src/components/BuildingRecords.astro` renders the panel from what is stored
(`getBuildingRecords` in `query.ts`). Nothing is fetched from a city API on a page view. On a building with no
approved review the records come first; otherwise they sit below the reviews.

The panel renders only when the building has at least one `record_pulls` row. Otherwise
`getBuildingRecords` returns null and nothing renders, the request button included. Every
seeded building has its seed pull. A user-added building shows no panel until something pulls
it. A failed attempt counts, because a failed pull still writes error rows.

### What starts a pull

Two admin actions pull inside the request: the pull button on a building, and the re-pull
that checks a record correction. Everything else is a row in `records_queue`, pulled later by
the Worker:

| Reason | Comes from |
|--------|------------|
| `button` | A reader pressing "Get this building's city records" or "Ask for newer records" (`POST /api/records/request`, with Turnstile and per-IP and site-wide caps) |
| `follower` | Saving a building or approving a review, when the building has never had a deeper pull and nothing is queued for it (see below); also a one-time admin backfill |
| `refresh` | The daily planner, for saved, reviewed or requested buildings whose records are more than 30 days old |
| `fill` | The daily planner, keeping the city-wide pass topped up |

A save or an approval queues a `follower` row only when `recordsRequestState` (`coverage.ts`)
returns `never_pulled`. That needs three things:

- The city resolves to a jurisdiction (`jurisdictionForCity`, Boston only) and the building
  has a `parcel_id`. A building with no parcel reads `ineligible` and is skipped.
- No pull of a deeper, non-assessor source exists. A seeded page's assessor records do not
  count.
- No queue row of any reason is pending, a parked one included. A pending `fill` row reads
  `fill_queued` and is deliberately not promoted.

Reviewed Boston buildings with no parcel get a `follower` row only from the one-time
`POST /api/admin/records/queue/backfill-reviewed`. Once that attempt has written deeper pull
rows, even error rows, the daily planner re-queues them every 30 days like any reviewed
building.

Readers can also file "Report a record error" (`POST /api/records/corrections`). An admin
resolves it on `/admin/records` as `repulled_unchanged`, `repulled_updated` or
`source_mismatch_noted`. Every resolution needs an `ok` or `empty` pull row from that
correction's latest re-pull. Only `source_mismatch_noted`, used when the re-pulled source
still disagrees with the report, puts a public note on the panel, and it needs an admin note
of at least 10 characters. The note reads
`A correction was filed on this record on <date>. The source has not updated.`, followed by
the admin's note. The date is the resolution date (`resolved_at`), not the filing date. A
report filed against the whole panel shows its note under every section. The panel does not
judge whether the city or the reader is right.

### The records-scheduler Worker

Cloudflare Pages has no cron triggers, so `workers/records-scheduler/` is a second
deployable: a Cron Worker bound to the same D1 database. Its entry file only wires bindings
and calls `drain` and `plan` in `src/lib/records/scheduler.ts`. Pushing `main` does not
deploy it; `npm run records:worker:deploy` does.

The Worker bundles everything `scheduler.ts`, `fixture.ts` and `schedulerAlert.ts` import,
directly or through other modules. That covers most of `records/` (the queue, pulls, sources,
owner rows and the fixture) and shared modules outside it, such as `email.ts`,
`emailHealth.ts`, `runtime.ts`, `logger.ts` and `enrichment/helpers.ts`. A change to any of
them is live in the site's admin routes once `main` deploys, but reaches the cron only after
a Worker deploy. The Worker has its own secrets, `RESEND_API_KEY` and `RECORDS_ALERT_EMAIL`,
separate from the site's, and a `SITE_URL` var. When `RECORDS_ALERT_EMAIL` is unset or blank,
alerts go to `OWNER_NOTIFY_EMAIL`.

- **Every minute, `drain`.** Claims up to three people-facing rows (button, follower,
  refresh), then one `fill` row unless the fill is paused. Each row is claimed just before
  its pull, and a drain stops claiming after 45 seconds. `attempts` counts claims, and a row
  parks for a person after three.
- **06:00 UTC daily, `plan`.** Purges finished `refresh` and `fill` rows older than 90 days,
  enqueues refreshes, tops up the fill queue, runs the daily fixture check, and works out each
  source's error rate. Finished `button` and `follower` rows are never purged: the 300-a-day
  cap counts button rows, and the refresh planner reads finished button rows as reader
  interest.
- **Daily fixture check.** `runRecordsFixture` (`fixture.ts`) queries every source for one
  known building, a public-agency building. Most checks compare its answers with recorded
  values. The RentSmart checks do not, because a RentSmart reload can drop any parcel's rows.
  They ask that the source answers the parcel query, and that the resource has a row from the
  last 60 days with a ten-digit parcel anywhere in the city (`RENTSMART_RECENT_DAYS`). The
  fixture also queries the city's SAM address points directly, though SAM is not a panel
  source. It catches a query that broke or a city dataset that moved. Its report-only
  notices, such as a 311 file the city left empty, never pause anything.
- **Circuit breaker.** At the end of `plan`, a failed fixture (a failed check or a source
  that threw), or a source with at least 20 attempts in 24 hours and more than half of them
  errors, trips the breaker. If the fill is not already paused, the breaker sets
  `app_settings.records_fill_paused` and, in the same batch, stores the cause in
  `records_breaker_pause_cause`: `fixture` or `errors`, with `fixture` winning when both
  trip. It sends one email and stamps `records_breaker_last_alert`. If the fill is already
  paused, for example by hand, it sends no email and records no cause. Button, follower and
  refresh pulls keep running.
- **Resuming.** Only a `fixture` pause lifts itself. The planner resumes the fill on the first
  morning with no source over the error threshold and a fixture run that had at least one
  check, no failed checks and no source that threw (`fixtureProvesHealth`). It clears the flag
  and the cause in one batch and emails "fill resumed". An `errors` pause, a hand pause, and
  any pause with no recorded cause (every pause from before October 2026) wait for a person.
  The Pause and Resume buttons on `/admin/records` clear the cause in the same write. Only a
  resume done in SQL has to delete the cause row separately.

How to operate it (first deploy, the admin panel, unpausing, expected numbers) is in
[`docs/runbooks/records-scheduler.md`](docs/runbooks/records-scheduler.md). The module rules
(queue leases, address matching, the fixture, the panel's privacy gates) are in
[`src/lib/AGENTS.md`](src/lib/AGENTS.md), under `records/`.

---

## Deployment

### Cloudflare Pages

The site deploys automatically through Cloudflare Pages' Git integration on every push to `main`. Pages also builds an immutable preview deployment for each PR branch.

CI does not gate the deploy. `.github/workflows/ci.yml` (check `quality`: `npm ci`, `scripts/audit-critical.mjs`, `npm run check`, `npm test`, `npm run build`) runs alongside it. A failed CI run on `main` turns the post-deploy sentinel red, but Pages may already have deployed. Build and type-check health is whatever the latest `quality` run on `main` reports.

After a successful CI run on `main`, `.github/workflows/post-deploy-smoke.yml` finds that commit's immutable `<8-hex>.ratemyplace-64y.pages.dev` deployment and runs the read-only smoke test against it, not against ratemyplace.org. See [`docs/runbooks/release-smoke.md`](docs/runbooks/release-smoke.md).

The records Worker deploys separately, with `npm run records:worker:deploy` (see [`docs/runbooks/records-scheduler.md`](docs/runbooks/records-scheduler.md)). The dashboard deploys from its own nightly workflow.

### Environment
- **Production:** https://ratemyplace.org
- **Bindings** (`wrangler.jsonc`): D1 database `ratemyplace-db` as `DB`, and R2 bucket `ratemyplace-verification` as `VERIFICATION_BUCKET`.
- **Secrets and vars:** set in the Pages project, not in `wrangler.jsonc`. They are typed in `src/env.d.ts` and read through `getEnv` or `Astro.locals.runtime.env`: `TURNSTILE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY` and `SITE_URL`. `RATE_LIMIT_KEY` is optional: it keys the rate limit digest, and `TURNSTILE_SECRET_KEY` does that job when it is unset.
- **Previews:** each deployment has its own immutable `https://<8-hex>.ratemyplace-64y.pages.dev` origin, shown in Cloudflare Pages. Pages also serves a mutable branch alias on the same `ratemyplace-64y.pages.dev` domain, which the release smoke refuses. Previews share the production D1 binding, so their writes reach production data. Previews cannot exercise Turnstile or the map.
- **Records Worker:** its own `workers/records-scheduler/wrangler.jsonc`, with the same D1 database, a `SITE_URL` var and its own secrets.

### Migrations

Read [`migrations/AGENTS.md`](migrations/AGENTS.md) before touching production. The short version:
- From `0025` on, migrations were applied to production outside wrangler's tracking. Never run `migrations apply --remote`.
- Several files are not idempotent and must never be re-run: `0027` (DROP COLUMN), `0028` and `0030` (table rebuilds), and `0029`, `0031` and `0035` (ADD COLUMN). Check the live schema first.
- A production migration is applied by hand, one file at a time:

```bash
npx wrangler d1 execute ratemyplace-db --remote --file=migrations/XXXX_name.sql
```

- Remote CLI needs `CLOUDFLARE_API_TOKEN` in the environment, or it fails with error 7403.
- Locally, use `npx wrangler d1 migrations apply ratemyplace-db --local` or `npm run db:setup`.

---

## Academic References

The scoring methodology is grounded in peer-reviewed public health research. The published reference list is on `/methodology` (`src/pages/methodology.astro`), which must stay true to the code. This list mirrors it; where the two differ, cite from `/methodology`.

### Survey Instruments
- Krieger, J., & Higgins, D. L. (2002). Housing and health: Time again for public health action. *American Journal of Public Health, 92*(5), 758-768. DOI: 10.2105/AJPH.92.5.758
- Jacobs, D. E., et al. (2009). The relationship of housing and population health. *Environmental Health Perspectives, 117*(4), 597-604. DOI: 10.1289/ehp.0800086
- Bonnefoy, X., et al. (2003). Housing and health in Europe. *American Journal of Public Health, 93*(9), 1559-1563. DOI: 10.2105/AJPH.93.9.1559

### Health/Safety Evidence
- Krieger, J. (2010). Home is where the triggers are: Increasing asthma control by improving the home environment. *Pediatric Allergy, Immunology, and Pulmonology, 23*(2), 139-145. DOI: 10.1089/ped.2010.0022
- Fisk, W. J., Lei-Gomez, Q., & Mendell, M. J. (2007). Meta-analyses of the associations of respiratory health effects with dampness and mold in homes. *Indoor Air, 17*(4), 284-296. DOI: 10.1111/j.1600-0668.2007.00475.x
- WHO Regional Office for Europe. (2018). WHO Housing and Health Guidelines.

### Methodology
- Hu, N., Pavlou, P. A., & Zhang, J. (2017). On self-selection biases in online product reviews. *MIS Quarterly, 41*(2), 449-471. DOI: 10.25300/MISQ/2017/41.2.06

---

## Version History

The app has no version number; the `0.0.1` in `package.json` is a placeholder. A release is identified by its commit SHA: `RELEASE_ID` in `src/lib/release.ts`, injected at build as `__RMP_BUILD_RELEASE_ID__` and reported by `/api/health`.

[`.planning/ROADMAP.md`](.planning/ROADMAP.md) lists milestones through early October 2026. Its status labels can lag the code. For example, the verified-email gate (#86) and one review per account and building (#88) are v1.6.0 work that has already shipped. Git history is the complete record. Designs and plans for later work are in `docs/superpowers/specs/` and `docs/superpowers/plans/`. The old changelog, which stops at v1.1.0-alpha ("Evidence-Based Scoring", January 2026), is archived at [`docs/archive/VERSION.md`](docs/archive/VERSION.md).
