# Codebase Structure

**Analysis Date:** 2026-05-02

## Directory Layout

```
ratemyplace-boston/
├── src/
│   ├── pages/                    # Astro SSR pages + API endpoints
│   │   ├── *.astro              # Public/auth pages (index, search, profile, etc.)
│   │   ├── admin/               # Admin-only pages (reviews, buildings, users, disputes, audit)
│   │   ├── review/              # Review creation/editing (new.astro, edit/[id].astro)
│   │   ├── api/
│   │   │   ├── reviews.ts       # POST new review, rate limiting, Turnstile
│   │   │   ├── auth/            # Lucia-based signin/signup/verify/forgot-password
│   │   │   ├── admin/           # Protected endpoints (reviews, buildings, users, landlords, etc.)
│   │   │   └── disputes.ts      # Dispute submissions (Turnstile + rate limit)
│   │   └── [slug].astro         # Building detail page (dynamic route)
│   ├── components/              # React islands + Astro static components
│   │   ├── layout/              # BaseLayout.astro, Header, Footer
│   │   ├── reviews/             # ReviewForm (multi-step), ReviewEditForm, RatingItem, HelpTooltip
│   │   ├── admin/               # Admin dashboard tables (ReviewsTable, BuildingsTable, etc.)
│   │   ├── search/              # SearchResults component
│   │   ├── profile/             # User profile, notifications, settings, verification modal
│   │   ├── ratings/             # ScoreCard, StarRating components
│   │   ├── contact/             # ContactForm component
│   │   ├── disputes/            # DisputeForm component
│   │   ├── ui/                  # Reusable UI: EmptyState, modals, tooltips
│   │   └── *.tsx                # Top-level islands: HomeSearch, AddressAutocomplete, BuildingMap
│   ├── lib/
│   │   ├── scoring.ts           # Core algorithm: ITEM_WEIGHTS, domain/overall score calculation
│   │   ├── scoring-colors.ts    # Color mapping for 4-band system (Good/Mixed/Concerning/Poor)
│   │   ├── surveyItems.ts       # 27-item survey definition with help text + metadata
│   │   ├── validation.ts        # validateReviewForm(), cross-field checks
│   │   ├── auth.ts              # Lucia initialization, user attribute mapping
│   │   ├── db.ts                # getDB(context) — D1 client accessor
│   │   ├── api.ts               # Response helpers (jsonResponse, ApiErrors)
│   │   ├── types.ts             # Review, Building, User, Landlord interfaces
│   │   ├── api-types.ts         # Request/response types for API handlers
│   │   ├── audit.ts             # createAuditLog() — admin action logging
│   │   ├── email.ts             # Email sending via Resend
│   │   ├── password.ts          # Hash/verify password (PBKDF2)
│   │   ├── tokens.ts            # Generate reset/verification tokens
│   │   ├── turnstile.ts         # Cloudflare Turnstile verification
│   │   ├── rateLimit.ts         # checkRateLimit() — IP-based rate limiting
│   │   ├── privacy.ts           # getSeasonFromMonth(), timestamp privacy helpers
│   │   ├── format.ts            # Format scores, prices, addresses for display
│   │   ├── formOptions.ts       # Dropdown/select option arrays (amenities, parking, etc.)
│   │   ├── notifications.ts     # Notification queuing/sending
│   │   ├── storage.ts           # Cloudflare KV access (if used)
│   │   ├── runtime.ts           # getEnv(context) — access Cloudflare environment variables
│   │   ├── logger.ts            # logError(), logging utilities
│   │   ├── userSettings.ts      # User preferences/notification settings
│   │   ├── enrichment/          # Building data enrichment from external APIs
│   │   │   ├── dispatcher.ts    # selectAdapter(city) — route to Boston/NewHaven/Null
│   │   │   ├── types.ts         # EnrichResult, CityAdapter interface
│   │   │   ├── helpers.ts       # Utility functions for enrichment
│   │   │   └── adapters/
│   │   │       ├── boston.ts    # City of Boston Assessing API (CKAN datastore_search)
│   │   │       ├── new-haven.ts # CT CAMA API (Socrata data.ct.gov)
│   │   │       └── null.ts      # Unsupported cities — returns empty
│   │   └── __tests__/           # Unit tests
│   │       ├── scoring.test.ts  # Test weighted calculations, domain splits, recency
│   │       ├── validation.test.ts
│   │       ├── enrichment.test.ts
│   │       ├── audit.test.ts
│   │       └── *.test.ts        # ~15 test files total
│   ├── middleware.ts            # Auth session injection + security headers (CSP, HSTS, etc.)
│   ├── env.d.ts                 # Astro/Lucia type augmentation
│   └── styles/
│       └── global.css           # Tailwind directives
├── migrations/                  # D1 SQL migrations (0015_*.sql, etc.)
├── public/                      # Static assets (favicon.svg, brand images)
├── brand/                       # Brand guidelines, social OG images
├── e2e/                         # Playwright E2E tests (*.spec.ts)
├── scripts/                     # Utility scripts (db-seed, smoke-test, db-migrate)
├── astro.config.mjs             # Astro + Cloudflare + Tailwind + React
├── tsconfig.json                # TypeScript strict mode
├── vitest.config.ts             # Unit test config (happy-dom environment)
├── playwright.config.ts         # E2E test config
├── wrangler.jsonc               # Cloudflare Workers config (D1 binding: "DB")
└── package.json                 # Scripts: dev, build, test, e2e, db:*
```

## Directory Purposes

**`src/pages/`**
- Purpose: Astro SSR pages and REST API endpoints
- Contains: `.astro` files (rendered on server) and `api/**/*.ts` (request handlers)
- Key files: 
  - Public: `index.astro` (home), `search.astro`, `[slug].astro` (building detail), `profile.astro`, `about.astro`, `methodology.astro`
  - Auth: `auth/signin.astro`, `signup.astro`, `forgot-password.astro`
  - Admin: `admin/index.astro`, `admin/reviews.astro`, `admin/buildings.astro`, `admin/landlords.astro`, `admin/users.astro`, `admin/disputes.astro`, `admin/audit.astro`
  - API: Auth, reviews, admin CRUD, disputes, contact, bug reports, and read-only release health

**`src/components/`**
- Purpose: Reusable React islands and Astro static components
- Contains: `.tsx` (React, client interactivity) and `.astro` (static markup)
- Structure: Organized by feature (reviews, admin, profile, search, ratings, contact, disputes)

**`src/lib/`**
- Purpose: Business logic, validation, database access, external integrations
- Contains: ~30 utility/service files + enrichment subsystem + test suite
- Key patterns: Single responsibility (one concern per file), type-safe interfaces, parameterized queries

**`migrations/`**
- Purpose: D1 (SQLite) schema changes
- Contains: Sequential SQL files named `XXXX_description.sql`
- Applied: `npm run db:migrate:local` or `wrangler d1 migrations apply ratemyplace-db --remote`

**`public/`**
- Purpose: Static assets served directly by Cloudflare
- Contains: Favicon, images, static files

**`brand/`**
- Purpose: Brand guidelines and social media images
- Contains: OG images for social sharing, brand voice document

**`e2e/`**
- Purpose: End-to-end integration tests via Playwright
- Contains: `.spec.ts` files testing full user flows (signup, search, review submission, admin moderation)

**`scripts/`**
- Purpose: Development and deployment utilities
- Contains: `db-seed.ts`, `db-reset.ts`, `db-migrate.ts`, `smoke-test.ts`

## Key File Locations

**Entry Points:**
- `src/pages/index.astro`: Home page (hero, search box, how-it-works)
- `src/pages/api/auth/*.ts`: Authentication endpoints (signin, signup, verify, reset)
- `src/middleware.ts`: Auth middleware, security headers
- `astro.config.mjs`: Astro + Cloudflare adapter + Tailwind + React configuration

**Configuration:**
- `wrangler.jsonc`: Cloudflare bindings (D1 database, KV, environment)
- `tsconfig.json`: TypeScript strict mode settings
- `vitest.config.ts`: Unit test runner (happy-dom environment)
- `astro.config.mjs`: Framework and integration setup

**Core Logic:**
- `src/lib/scoring.ts`: Weighted scoring algorithm (27 fields, 4 domains, recency decay)
- `src/lib/surveyItems.ts`: Survey question definitions and metadata
- `src/lib/validation.ts`: Input validation rules for reviews
- `src/lib/audit.ts`: Admin action audit logging
- `src/lib/enrichment/`: Multi-city building enrichment (Boston, New Haven)

**Testing:**
- `src/lib/__tests__/*.test.ts`: Unit tests (scoring, validation, enrichment, audit, format, etc.)
- `e2e/*.spec.ts`: End-to-end tests (Playwright)
- `vitest.config.ts`: Vitest runner configuration

## Naming Conventions

**Files:**
- Pages: lowercase with hyphens, e.g., `bug-report.astro`, `reset-password.astro`
- Components: PascalCase, e.g., `ReviewForm.tsx`, `ScoreCard.astro`, `AdminLayout.astro`
- API endpoints: lowercase with hyphens, nested by resource, e.g., `/api/admin/reviews/[id].ts`
- Migrations: `XXXX_snake_case_description.sql`, e.g., `0017_add_property_manager_name.sql`
- Tests: same name as source + `.test.ts`, e.g., `scoring.ts` → `scoring.test.ts`

**Directories:**
- Feature-based (not layer-based), e.g., `components/reviews/`, `components/admin/`, `components/profile/`
- Lowercase with hyphens, e.g., `form-steps/`, `scoring-colors.ts`

**Variables & Functions:**
- camelCase for variables: `moveInYear`, `rentAmount`, `landlordsTable`
- camelCase for functions: `calculateOverallScore()`, `validateReviewForm()`, `getSeasonFromMonth()`
- SCREAMING_SNAKE_CASE for constants: `ITEM_WEIGHTS`, `ALL_SCORE_FIELDS`, `PAGE_SIZE`
- PascalCase for types/interfaces: `Review`, `Building`, `User`, `ValidationError`

**Database Columns:**
- snake_case: `move_in_year`, `overall_score`, `had_pest_issues`, `landlord_responsiveness`
- Status enums: `pending`, `approved`, `rejected`, `flagged`
- Boolean flags: `is_current_tenant`, `email_verified`, `is_admin` (stored as 0/1)

## Where to Add New Code

**New Feature (e.g., tenant rights database):**
- Primary code: `src/lib/tenantRights.ts` (core logic)
- API endpoint: `src/pages/api/tenant-rights/[id].ts` (GET endpoint)
- Page: `src/pages/tenant-rights/[slug].astro` (display)
- Component: `src/components/TenantRightsCard.astro` (reusable display)
- Tests: `src/lib/__tests__/tenantRights.test.ts`
- Validation: Add rules to `src/lib/validation.ts` if form submission involved
- Audit: Call `createAuditLog()` if admin action involved

**New Component/Module:**
- Astro static component: `src/components/{Feature}Name.astro`
- React interactive component: `src/components/{Feature}Name.tsx`
- Library service: `src/lib/serviceName.ts` (logic), type exports in `src/lib/types.ts` or dedicated `src/lib/serviceName-types.ts`
- Ensure all types exported and documented

**Utilities:**
- Shared helpers: `src/lib/` (one file per concern, e.g., `format.ts`, `privacy.ts`, `logger.ts`)
- Export clear interfaces/types from each file
- Document parameter and return types

**Admin Features:**
- Page: `src/pages/admin/featureName.astro`
- API: `src/pages/api/admin/featureName/[id].ts` (CRUD endpoints)
- Component: `src/components/admin/FeatureNameTable.tsx` (data table)
- Check `context.locals.user?.isAdmin` in page and all API endpoints

**Database Changes:**
- Migration: Create `migrations/XXXX_description.sql`
- Run locally: `npm run db:migrate:local`
- Test: Verify schema changes do not break existing queries
- Update types: Add new columns to `Review`, `Building`, etc. in `src/lib/types.ts`
- Update form: Add new field to survey in `src/lib/surveyItems.ts` if user-facing

## Special Directories

**`src/lib/__tests__/`**
- Purpose: Unit tests for all lib modules
- Generated: No (hand-written)
- Committed: Yes
- Run: `npm test` or `npm test:watch`
- Coverage: ~15 test files covering scoring, validation, enrichment, audit, format, notifications, password hashing

**`migrations/`**
- Purpose: D1 schema versioning
- Generated: No (hand-written SQL)
- Committed: Yes
- Applied: `npx wrangler d1 migrations apply ratemyplace-db --local` (dev) or `--remote` (prod)
- Important: Never edit old migrations—create new ones for changes

**`e2e/`**
- Purpose: Full integration tests via Playwright
- Generated: No (hand-written Playwright specs)
- Committed: Yes
- Run: `npm run e2e` or `npm run e2e:headed`
- Pre-requisite: `npm run db:setup` to seed test database

**`.astro/`**
- Purpose: Astro build cache
- Generated: Yes (by Astro during dev)
- Committed: No (.gitignore'd)

**`dist/`**
- Purpose: Production build output
- Generated: Yes (by `npm run build`)
- Committed: No (.gitignore'd)

**`node_modules/`**
- Purpose: npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No (lockfile committed as `package-lock.json`)

---

*Structure analysis: 2026-05-02*
