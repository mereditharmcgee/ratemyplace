# Codebase Structure

**Analysis Date:** 2026-04-26

## Directory Layout

```
ratemyplace-boston/
├── .astro/                # Astro internal (type definitions, generated files)
├── .claude/               # Claude Code workspace metadata
├── .planning/             # GSD planning and codebase analysis docs
├── migrations/            # Database schema versions (SQL)
├── node_modules/          # Dependencies (gitignored)
├── public/                # Static assets (favicon, brand images)
├── scripts/               # Utility scripts (db setup, seed, migration)
├── src/
│   ├── components/        # Reusable Astro & React components
│   ├── lib/               # Business logic and utilities
│   ├── middleware.ts      # Auth and security middleware
│   ├── pages/             # Astro pages and API routes
│   └── styles/            # Global Tailwind CSS
├── e2e/                   # Playwright E2E tests
├── astro.config.mjs       # Astro configuration
├── tsconfig.json          # TypeScript configuration
├── package.json           # Dependencies and scripts
├── wrangler.toml          # Cloudflare Workers configuration
└── README.md              # Project documentation
```

## Directory Purposes

**`migrations/`:**
- Purpose: Database schema version control
- Contains: SQL files numbered 0001-0017+ (initial through latest)
- Key files: 
  - `0001_initial.sql` - Core tables (users, sessions, buildings, reviews)
  - `0007_verification_and_admin.sql` - Admin and email verification
  - `0017_property_managers.sql` - Property manager model
- Generated: No
- Committed: Yes

**`src/pages/`:**
- Purpose: Astro pages and API endpoints (file-based routing)
- Contains: `.astro` files (pages) and `api/` subdirectory (endpoints)
- Key files:
  - `index.astro` - Home page with search
  - `search.astro` - Search results page
  - `building/[slug].astro` - Property detail page
  - `review/new.astro` - Create review form
  - `review/edit/[id].astro` - Edit review form
  - `admin/*.astro` - Admin-only pages (dashboard, moderation, etc.)
  - `api/auth/**/*.ts` - Authentication endpoints
  - `api/buildings/**/*.ts` - Building CRUD and enrichment (40 total endpoints)
  - `api/reviews/**/*.ts` - Review submission and editing
  - `api/search/**/*.ts` - Search endpoints
  - `api/admin/**/*.ts` - Admin moderation and analytics
- Dynamics: `[slug]`, `[id]` = dynamic route segments

**`src/components/`:**
- Purpose: Reusable page components
- Contains: Astro components (`.astro`) and React islands (`.tsx`)
- Subdirectories:
  - `layout/` - BaseLayout.astro, Header.astro, Footer.astro
  - `reviews/` - ReviewForm.tsx, ReviewEditForm.tsx, ReviewCard.astro
  - `ratings/` - StarRating.astro, ScoreCard.astro (display)
  - `search/` - SearchResults.tsx (client-side filtering)
  - `admin/` - Admin dashboard components
  - `ui/` - Generic UI components (buttons, modals, etc.)
  - `profile/` - User profile pages
  - `disputes/` - Dispute resolution components
  - `contact/` - Contact form
- Pattern: Astro for static/SSR, React (with `client:load`) for interactive

**`src/lib/`:**
- Purpose: Shared business logic and utilities
- Contains: 45+ TypeScript files, single-responsibility functions
- Core files:
  - `scoring.ts` (11KB) - All scoring algorithms and weights
  - `surveyItems.ts` (26KB) - Survey questions and help text
  - `validation.ts` - Input validation rules
  - `auth.ts` - Lucia configuration and user attributes
  - `db.ts` - Database connection helper
  - `api.ts` - Response utilities
  - `audit.ts` - Admin action logging
  - `email.ts` (15KB) - Email templates via Resend
  - `rateLimit.ts` - Rate limiting by IP
  - `privacy.ts` - Data masking for display
  - `disputes.ts` - Dispute workflow logic
  - `notifications.ts` - In-app notification creation
- Subdirectories:
  - `enrichment/` - City data source adapters (Boston, New Haven)
  - `__tests__/` - Unit tests (15 test files)
- Export pattern: Everything exported from files (no default exports)

**`src/styles/`:**
- Purpose: Global and component-level styles
- Contains: Tailwind CSS imports and custom CSS
- Key file: `global.css` - Imported by BaseLayout

**`public/`:**
- Purpose: Static assets served at root
- Contains: favicon.svg, brand images (OG images for social media)
- Committed: Yes

**`e2e/`:**
- Purpose: Playwright end-to-end tests
- Contains: Test specs for critical user flows
- Pattern: One `.spec.ts` per feature area
- Run: `npm run e2e`

**`scripts/`:**
- Purpose: Database and development utilities
- Contains: TypeScript scripts for setup
- Key files:
  - `db-seed.ts` - Populate database with sample data
  - `db-migrate.ts` - Apply migrations locally
  - `db-fresh.ts` - Reset and seed database
  - `db-reset.ts` - Full database reset

## Key File Locations

**Entry Points:**

- `src/pages/index.astro` - Home page (search interface)
- `src/pages/api/auth/google/callback.ts` - OAuth entry point
- `src/middleware.ts` - Request authentication and security headers

**Configuration:**

- `tsconfig.json` - TypeScript strict mode, JSX react-jsx
- `astro.config.mjs` - Output: server, adapter: cloudflare, redirects
- `wrangler.toml` - Cloudflare Workers config (D1 database binding)
- `package.json` - Scripts, dependencies

**Core Logic:**

- `src/lib/scoring.ts` - Review score calculations (27 scored rating items; 5 ancillary survey items not scored)
- `src/lib/surveyItems.ts` - Survey question definitions
- `src/lib/validation.ts` - Input validation rules
- `src/lib/api.ts` - Response utilities

**Database:**

- `migrations/` - All schema versions
- `src/lib/db.ts` - Database connection getter

**Testing:**

- `src/lib/__tests__/` - Unit tests (171 tests, all passing)
- `e2e/` - End-to-end tests

**Audit & Compliance:**

- `src/lib/audit.ts` - Admin action logging
- `src/lib/email.ts` - Verification and notification emails

## Naming Conventions

**Files:**

- Components: PascalCase (e.g., `ReviewForm.tsx`, `BaseLayout.astro`)
- Pages: kebab-case or camelCase (e.g., `search.astro`, `bug-report.astro`)
- API routes: kebab-case with `[brackets]` for params (e.g., `[id].ts`)
- Utilities: camelCase (e.g., `scoring.ts`, `rateLimit.ts`)
- Tests: Match source file with `.test.ts` suffix (e.g., `scoring.test.ts`)

**Directories:**

- Feature areas: kebab-case plural (e.g., `components/`, `pages/`)
- Feature subdirectories: kebab-case (e.g., `form-steps/`, `common-areas/`)
- Admin features: `admin/` prefix

**Database Columns:**

- Pattern: snake_case (e.g., `building_id`, `landlord_name`, `overall_score`)
- Boolean prefix: `had_*` or `is_*` (e.g., `had_pests`, `is_admin`)
- Timestamps: Suffix `_at` with Unix epoch INT (e.g., `created_at`, `updated_at`)

**Constants & Enums:**

- Scores: All-caps with underscore (e.g., `UNIT_FIELDS`, `ITEM_WEIGHTS`)
- Status values: lowercase strings (e.g., `'pending'`, `'approved'`, `'rejected'`)

## Where to Add New Code

**New User-Facing Feature:**

1. **Page route:** `src/pages/[feature-name].astro` or `src/pages/[feature-name]/[slug].astro`
2. **API endpoint:** `src/pages/api/[feature-name]/index.ts` (GET/POST) and/or `src/pages/api/[feature-name]/[id].ts` (PATCH/DELETE)
3. **React component:** `src/components/[feature-name]/[ComponentName].tsx` if interactive
4. **Library logic:** `src/lib/[feature-name].ts` for business logic
5. **Tests:** `src/lib/__tests__/[feature-name].test.ts` for unit tests
6. **E2E test:** `e2e/[feature-name].spec.ts` for critical flows

**Example: Adding "Photos" feature**
- `src/pages/photos.astro` - Photos gallery page
- `src/pages/api/photos/index.ts` - Upload photos (POST)
- `src/pages/api/photos/[id].ts` - Delete photo (DELETE)
- `src/components/reviews/PhotoUpload.tsx` - React form component
- `src/lib/photo-storage.ts` - Upload/delete logic
- `src/lib/__tests__/photo-storage.test.ts` - Unit tests
- `migrations/XXXX_add_photos.sql` - Add photos table

**New Admin Feature:**

1. **Admin page:** `src/pages/admin/[feature-name].astro`
2. **API endpoint:** `src/pages/api/admin/[feature-name]/index.ts` (always check `context.locals.user?.isAdmin`)
3. **Library logic:** `src/lib/[feature-name].ts`
4. **Tests:** Unit tests in `src/lib/__tests__/`

**New Utility/Shared Function:**

1. **Library file:** `src/lib/[purpose].ts`
2. **Tests:** `src/lib/__tests__/[purpose].test.ts`
3. **Import everywhere:** No special registration, just import

**Database Schema Change:**

1. **Migration:** Create `migrations/XXXX_description.sql` with SQL DDL
2. **Type definition:** Add to `src/lib/types.ts` if new entity
3. **API endpoints:** Create CRUD endpoints in `src/pages/api/[resource]/`
4. **Components:** Create display and form components

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents
- Generated: Yes (by `/gsd:map-codebase`)
- Committed: Yes
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, etc.

**`migrations/`:**
- Purpose: Database schema version control
- Generated: No (manually created)
- Committed: Yes
- Pattern: Numbered sequentially (0001, 0002, ..., 0017)
- Applied: Automatically on deploy via `wrangler d1 migrations apply`

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes (by npm install)
- Committed: No (.gitignore)

**`.astro/`:**
- Purpose: Astro build artifacts (type defs, cache)
- Generated: Yes (by `astro build`)
- Committed: No (.gitignore)

**`.env` files:**
- Purpose: Local environment variables (not committed)
- Note: See `CLAUDE.md` for secrets via Cloudflare Pages config
- Contains: Database URLs, API keys (locally only)

**`dist/`:**
- Purpose: Built SSR application
- Generated: Yes (by `astro build`)
- Committed: No
- Deployed: To Cloudflare Pages

## Building and Deployment

**Development:**
```bash
npm run dev                      # Start dev server with HMR
npm test                         # Run all 171 unit tests
npm test:watch                   # Watch mode for tests
npm run db:fresh                 # Reset and seed database locally
```

**Production:**
```bash
npm run build                    # Build for Cloudflare Pages
npm run e2e                      # Run E2E tests (requires build)
```

**Database Operations:**
```bash
npm run db:migrate:local         # Apply migrations locally
npm run db:seed                  # Seed with sample data
npm run db:reset                 # Full reset
```

The build output is automatically deployed to Cloudflare Pages on push to main branch.

---

*Structure analysis: 2026-04-26*
