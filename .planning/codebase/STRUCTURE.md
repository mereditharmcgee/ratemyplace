# Codebase Structure

**Analysis Date:** 2026-02-26

## Directory Layout

```
ratemyplace-boston/
├── src/
│   ├── components/              # Reusable UI components (Astro + React)
│   │   ├── admin/              # Admin-specific components
│   │   ├── layout/             # Page layout wrappers
│   │   ├── profile/            # User profile components
│   │   ├── ratings/            # Score display components
│   │   ├── reviews/            # Review form and display
│   │   ├── search/             # Search components
│   │   └── ui/                 # Generic UI elements
│   │
│   ├── pages/                  # File-based routing (Astro)
│   │   ├── api/                # RESTful API endpoints
│   │   │   ├── admin/         # Admin-only endpoints
│   │   │   ├── auth/          # Authentication endpoints
│   │   │   ├── places/        # Google Places integration
│   │   │   └── [resource]/[id].ts  # Dynamic routes
│   │   ├── admin/             # Admin panel pages
│   │   ├── auth/              # Sign in/sign up pages
│   │   ├── building/          # Building detail page (dynamic)
│   │   ├── review/            # Review creation/editing (dynamic)
│   │   └── [page].astro       # Static pages (home, about, contact)
│   │
│   ├── lib/                    # Business logic and utilities
│   │   ├── __tests__/         # Unit tests for lib functions
│   │   ├── api.ts             # API response builders
│   │   ├── auth.ts            # Lucia authentication setup
│   │   ├── db.ts              # Database initialization
│   │   ├── formOptions.ts     # Form UI configuration
│   │   ├── password.ts        # Password hashing (argon2)
│   │   ├── privacy.ts         # Privacy utility functions
│   │   ├── rateLimit.ts       # Rate limiting logic
│   │   ├── scoring.ts         # Evidence-based scoring calculations
│   │   ├── storage.ts         # File upload handling
│   │   ├── surveyItems.ts     # Survey question definitions (27 items)
│   │   ├── types.ts           # TypeScript interfaces (User, Building, Review, etc.)
│   │   └── validation.ts      # Form validation rules
│   │
│   ├── styles/                # Global CSS
│   │   └── global.css         # Tailwind directives and custom styles
│   │
│   └── env.d.ts               # Astro type definitions
│
├── e2e/                        # Playwright end-to-end tests
├── migrations/                 # SQL migration files for D1 schema
├── public/                     # Static assets (favicon, images)
├── scripts/                    # Utility scripts (smoke tests)
│
├── astro.config.mjs           # Astro configuration (Cloudflare adapter, React integration)
├── tsconfig.json              # TypeScript strict mode with Astro presets
├── vite.config.ts             # Vitest and Vite configuration
├── vitest.config.ts           # Test runner configuration
├── playwright.config.ts       # E2E test configuration
├── wrangler.jsonc             # Cloudflare Workers configuration
├── tailwind.config.js         # Tailwind CSS configuration
├── package.json               # Dependencies and scripts
└── package-lock.json          # Dependency lock file
```

## Directory Purposes

**src/components/:**
- Purpose: Reusable UI building blocks composed into pages
- Contains: .astro files (static markup), .tsx files (interactive React components)
- Key files:
  - `layout/BaseLayout.astro` - Wraps all pages with header/footer
  - `layout/Header.astro` - Navigation and logo
  - `reviews/ReviewEditForm.tsx` - Survey form with 27 questions
  - `admin/ReviewsTable.tsx` - Admin review list with moderation
  - `ratings/ScoreCard.astro` - Display individual scores with colors

**src/pages/:**
- Purpose: Entry points for routing (Astro file-based routing)
- Astro pages: Generate HTML server-side, shipped as static markup or SSR
- API routes: Handle HTTP requests, return JSON responses
- Pattern: `src/pages/building/[slug].astro` → `/building/{slug}` URLs

**src/pages/api/:**
- Purpose: RESTful backend endpoints
- Organization:
  - `auth/` - Sign in/up, logout, OAuth callbacks
  - `reviews/` - Create, update, fetch reviews
  - `buildings/` - Search, create, fetch building metadata
  - `places/` - Google Places integration (autocomplete, details)
  - `admin/` - Protected endpoints for moderation and management
  - `verification/` - Tenant verification image upload

**src/lib/:**
- Purpose: Shared business logic, validation, and utilities
- Key modules:
  - `scoring.ts` - All score calculation logic (domain decomposition, weights, aggregation)
  - `auth.ts` - Lucia setup for session management
  - `validation.ts` - Form validation with specific error messages
  - `rateLimit.ts` - IP and user-based rate limiting
  - `types.ts` - Centralized TypeScript definitions
  - `surveyItems.ts` - 27-item survey question definitions with help text

**src/styles/:**
- Purpose: Global CSS rules
- Contains: Tailwind directives, custom color utilities, score-related color classes
- Pattern: Imported by BaseLayout.astro, applied globally to all pages

**e2e/:**
- Purpose: Playwright tests for user workflows
- Contains: Test files for review submission, search, moderation flows
- Pattern: Run via `npm run e2e`, generates HTML reports in test-results/

**migrations/:**
- Purpose: D1 database schema definitions
- Contains: SQL files creating tables (users, reviews, buildings, sessions, etc.)
- Pattern: Applied during Cloudflare deployment via wrangler

**public/:**
- Purpose: Static assets served directly
- Contains: favicon.png, possibly maps/imagery
- Pattern: Referenced in HTML as `/favicon.png`

**scripts/:**
- Purpose: Utility scripts for development and testing
- Contains: smoke-test.ts for smoke testing critical flows
- Run via: `npm run smoke`

## Key File Locations

**Entry Points:**
- `src/pages/index.astro` - Homepage with search and CTAs
- `src/pages/building/[slug].astro` - Building detail page (template: dynamic slug routing)
- `src/pages/review/new.astro` - New review form
- `src/pages/admin/index.astro` - Admin dashboard

**Configuration:**
- `astro.config.mjs` - Astro server output mode, Cloudflare adapter, React integration
- `tsconfig.json` - TypeScript strict mode, JSX React
- `wrangler.jsonc` - Cloudflare D1 database binding ("DB")

**Core Logic:**
- `src/lib/scoring.ts` - Evidence-based scoring with weights and recency decay (11KB)
- `src/lib/surveyItems.ts` - 27-item survey definitions with UI labels (25KB)
- `src/lib/auth.ts` - Lucia session initialization
- `src/lib/validation.ts` - Client/server input validation

**Testing:**
- `src/lib/__tests__/*.test.ts` - Unit tests (password, rateLimit, formOptions, scoring)
- `e2e/` - Playwright integration tests
- `vitest.config.ts` - Test runner setup

**Styles:**
- `src/styles/global.css` - Tailwind @apply rules, score color classes
- Component styling: Inline Tailwind classes in .astro and .tsx files

## Naming Conventions

**Files:**

- **API routes**: `[resource]/[method].ts` or `[method]/[resource].ts`
  - Example: `src/pages/api/reviews/[id].ts` - single review operations
  - Example: `src/pages/api/reviews.ts` - list/create reviews
  - Example: `src/pages/api/admin/reviews/[id].ts` - admin review operations

- **Page routes**: Kebab-case for static pages, bracket notation for dynamic segments
  - Example: `src/pages/about.astro` → `/about`
  - Example: `src/pages/building/[slug].astro` → `/building/{slug}`
  - Example: `src/pages/review/edit/[id].astro` → `/review/edit/{id}`

- **Components**: PascalCase, descriptive noun-based names
  - Example: `ReviewEditForm.tsx`, `BuildingsTable.tsx`, `ScoreCard.astro`
  - Convention: Component name matches export name

- **Utilities/functions**: camelCase, verb or noun-based
  - Example: `validateReviewForm()`, `calculateDomainScores()`, `checkRateLimit()`

- **Database tables**: snake_case, plural nouns
  - Example: `users`, `reviews`, `buildings`, `building_scores`, `sessions`

- **Database columns**: snake_case, descriptive names
  - Example: `review_title`, `landlord_responsiveness`, `is_current_tenant`

- **Environment variables**: UPPER_SNAKE_CASE
  - Example: `DB` (Cloudflare D1 binding)

## Where to Add New Code

**New Feature (End-to-End):**
- API endpoint: `src/pages/api/[feature].ts` or `src/pages/api/[feature]/[action].ts`
  - Import from `src/lib/` for business logic
  - Use `getDB()` for database access
  - Return JSON responses via `jsonResponse()` or `errorResponse()`
- Frontend: `src/pages/[feature]/[page].astro` or `src/pages/[feature]/[action].astro`
  - Import components from `src/components/`
  - Fetch data via `getDB()` in frontmatter (server-side)
  - Pass data to components or use direct HTML markup
- React component: `src/components/[category]/NewComponent.tsx`
  - Use client:load directive if interactive
  - Import types from `src/lib/types.ts`
  - Handle events with standard React patterns

**New Component/Module:**
- UI Component: `src/components/[category]/ComponentName.astro` or `.tsx`
  - Directory pattern: Group related components by feature (admin, reviews, ratings, etc.)
  - Export as default
  - Use Astro slots for composition
- Business Logic: `src/lib/[feature].ts`
  - Export functions and types
  - Keep pure (no side effects except database)
  - Add tests in `src/lib/__tests__/[feature].test.ts`

**Utilities:**
- Shared helpers: `src/lib/[name].ts`
  - Example: `src/lib/privacy.ts` for anonymization logic
  - Example: `src/lib/storage.ts` for file operations
  - Example: `src/lib/password.ts` for password utilities
  - Pattern: Single responsibility, reusable across endpoints

**Tests:**
- Unit tests: `src/lib/__tests__/[module].test.ts`
  - Test business logic functions
  - Use Vitest with happy-dom for DOM testing
  - Pattern: describe() → it() with expect()
- E2E tests: `e2e/[feature].spec.ts`
  - Test user workflows across pages
  - Use Playwright page object model
  - Pattern: test() → page.goto() → interactions → assertions

## Special Directories

**src/.astro/:**
- Purpose: Astro type definitions and internal files
- Generated: Yes (by Astro during build)
- Committed: No (gitignored)

**node_modules/:**
- Purpose: Installed npm dependencies
- Generated: Yes (by npm install)
- Committed: No (gitignored)

**dist/:**
- Purpose: Built output (SSR code + static assets)
- Generated: Yes (by astro build)
- Committed: No (gitignored)

**test-results/:**
- Purpose: Playwright test reports (HTML)
- Generated: Yes (by playwright test)
- Committed: No (gitignored)

**.wrangler/:**
- Purpose: Cloudflare local development cache
- Generated: Yes (by wrangler)
- Committed: No (gitignored)

**migrations/:**
- Purpose: D1 database schema (SQL)
- Generated: Manually created
- Committed: Yes - source of truth for schema
- Pattern: Numbered sequentially (001-create-users.sql, 002-create-reviews.sql)

## Page Route Map

| URL | File | Purpose |
|-----|------|---------|
| `/` | `src/pages/index.astro` | Marketing homepage |
| `/about` | `src/pages/about.astro` | About page |
| `/contact` | `src/pages/contact.astro` | Contact page |
| `/guidelines` | `src/pages/guidelines.astro` | Review guidelines |
| `/auth/signin` | `src/pages/auth/signin.astro` | Login page |
| `/auth/signup` | `src/pages/auth/signup.astro` | Registration page |
| `/building/[slug]` | `src/pages/building/[slug].astro` | Building detail + reviews |
| `/landlord/[slug]` | `src/pages/landlord/[slug].astro` | Landlord detail page |
| `/review/new` | `src/pages/review/new.astro` | Create review form |
| `/review/edit/[id]` | `src/pages/review/edit/[id].astro` | Edit existing review |
| `/admin` | `src/pages/admin/index.astro` | Admin dashboard |
| `/admin/reviews` | `src/pages/admin/reviews.astro` | Review moderation queue |
| `/admin/users` | `src/pages/admin/users.astro` | User management |
| `/admin/buildings` | `src/pages/admin/buildings.astro` | Building management |
| `/admin/verify` | `src/pages/admin/verify.astro` | Verification queue |

## API Route Map

| Method | URL | File | Purpose |
|--------|-----|------|---------|
| `GET` | `/api/buildings?q=...` | `src/pages/api/buildings.ts` | Search buildings |
| `POST` | `/api/buildings` | `src/pages/api/buildings.ts` | Create building |
| `GET` | `/api/places/autocomplete` | `src/pages/api/places/autocomplete.ts` | Google Places search |
| `GET` | `/api/places/details` | `src/pages/api/places/details.ts` | Google Places details |
| `POST` | `/api/reviews` | `src/pages/api/reviews.ts` | Create review |
| `GET` | `/api/reviews/[id]` | `src/pages/api/reviews/[id].ts` | Fetch review |
| `PUT` | `/api/reviews/[id]` | `src/pages/api/reviews/[id].ts` | Update review |
| `GET` | `/api/reviews/user` | `src/pages/api/reviews/user.ts` | User's reviews (auth required) |
| `POST` | `/api/auth/signin` | `src/pages/api/auth/signin.ts` | Authenticate user |
| `POST` | `/api/auth/signup` | `src/pages/api/auth/signup.ts` | Create new user |
| `POST` | `/api/auth/signout` | `src/pages/api/auth/signout.ts` | Logout |
| `GET` | `/api/auth/google` | `src/pages/api/auth/google.ts` | Google OAuth initiate |
| `GET` | `/api/auth/google/callback` | `src/pages/api/auth/google/callback.ts` | Google OAuth callback |
| `GET` | `/api/admin/reviews` | `src/pages/api/admin/reviews/index.ts` | List reviews (admin) |
| `GET` | `/api/admin/reviews/[id]` | `src/pages/api/admin/reviews/[id].ts` | Review details (admin) |
| `PUT` | `/api/admin/reviews/[id]` | `src/pages/api/admin/reviews/[id].ts` | Approve/reject review |
| `GET` | `/api/admin/users` | `src/pages/api/admin/users/index.ts` | List users (admin) |
| `POST` | `/api/verification/upload` | `src/pages/api/verification/upload.ts` | Upload verification image |

## Import Aliases and Patterns

**No path aliases configured** - all imports use relative paths:
- From pages: `import { getDB } from '../../lib/db'`
- From components: `import { calculateScores } from '../lib/scoring'`

**Import grouping order observed:**
1. Astro/framework imports (`import type { APIContext } from 'astro'`)
2. Local lib imports (`import { getDB } from '../../lib/db'`)
3. Local component imports (`import Header from './Header.astro'`)
4. External library imports (implicit from package.json)

**No barrel files** (index.ts re-exports) - direct imports from module files.
