# RateMyPlace - Architecture Documentation

## Version: v1.0.0-alpha
**Last Updated:** January 2026
**Codename:** "Complete Foundation"

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Database Schema](#database-schema)
5. [Authentication System](#authentication-system)
6. [API Endpoints](#api-endpoints)
7. [Page Components](#page-components)
8. [Shared Components](#shared-components)
9. [Library/Utility Files](#libraryutility-files)
10. [Deployment](#deployment)

---

## Project Overview

RateMyPlace is a tenant-focused housing review platform. It allows renters to share anonymous reviews of their rental experiences, helping future tenants make informed decisions about housing.

### Key Features (v1.0.0-alpha)
- User authentication (email/password with Lucia)
- Building profile pages with aggregated scores
- Landlord profile pages with recent reviews
- Property Manager profile pages (buildings can have both)
- Unit-level review grouping with collapsible cards
- Comprehensive 27-item survey instrument
- Review moderation system (admin)
- Score breakdowns by category (Unit, Building, Landlord)
- Amenities, utilities, and lease details display

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | Astro | 5.16.11 |
| **Runtime** | Cloudflare Pages (SSR) | - |
| **Database** | Cloudflare D1 (SQLite) | - |
| **Auth** | Lucia + D1 Adapter | 3.2.2 |
| **UI Framework** | React (islands) | 18.3.1 |
| **Styling** | Tailwind CSS | 4.1.18 |
| **Password Hashing** | @oslojs/crypto | 1.0.1 |
| **TypeScript** | Strict mode | - |

### Dependencies
```json
{
  "dependencies": {
    "@astrojs/cloudflare": "^12.6.12",
    "@astrojs/react": "3.6.3",
    "@lucia-auth/adapter-sqlite": "^3.0.2",
    "@oslojs/crypto": "^1.0.1",
    "@oslojs/encoding": "^1.1.0",
    "@tailwindcss/vite": "^4.1.18",
    "astro": "^5.16.11",
    "lucia": "^3.2.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwindcss": "^4.1.18"
  }
}
```

---

## Project Structure

```
ratemyplace/
├── migrations/                    # Database migrations
│   ├── 0001_initial.sql          # Core tables
│   └── 0006_property_managers.sql # Property manager system
│
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── BaseLayout.astro   # Main page wrapper
│   │   │   ├── Header.astro       # Navigation header
│   │   │   └── Footer.astro       # Site footer
│   │   ├── ratings/
│   │   │   ├── ScoreCard.astro    # Score breakdown sidebar
│   │   │   └── StarRating.astro   # Star display component
│   │   └── reviews/
│   │       ├── ReviewCard.astro   # Individual review display
│   │       ├── ReviewForm.tsx     # React review form (island)
│   │       └── UnitTypeSummary.astro
│   │
│   ├── lib/
│   │   ├── auth.ts               # Lucia initialization
│   │   ├── db.ts                 # D1 database helper
│   │   ├── password.ts           # Password hashing
│   │   ├── privacy.ts            # Date formatting utilities
│   │   ├── scoring.ts            # Score calculation logic
│   │   ├── surveyItems.ts        # Survey question definitions
│   │   ├── types.ts              # TypeScript type definitions
│   │   └── validation.ts         # Input validation
│   │
│   ├── pages/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── signin.ts     # Sign in endpoint
│   │   │   │   ├── signout.ts    # Sign out endpoint
│   │   │   │   └── signup.ts     # Sign up endpoint
│   │   │   ├── buildings.ts      # Building search
│   │   │   └── reviews.ts        # Review submission
│   │   │
│   │   ├── auth/
│   │   │   ├── signin.astro      # Sign in page
│   │   │   └── signup.astro      # Sign up page
│   │   │
│   │   ├── building/
│   │   │   └── [slug].astro      # Building profile page
│   │   │
│   │   ├── landlord/
│   │   │   └── [slug].astro      # Landlord profile page
│   │   │
│   │   ├── property-manager/
│   │   │   └── [slug].astro      # Property manager profile
│   │   │
│   │   ├── review/
│   │   │   └── new.astro         # New review page
│   │   │
│   │   ├── index.astro           # Home page
│   │   ├── search.astro          # Search page
│   │   ├── about.astro           # About page
│   │   ├── guidelines.astro      # Review guidelines
│   │   ├── privacy.astro         # Privacy policy
│   │   └── terms.astro           # Terms of service
│   │
│   ├── styles/
│   │   └── global.css            # Global styles + Tailwind
│   │
│   ├── middleware.ts             # Auth session validation
│   └── env.d.ts                  # TypeScript env declarations
│
├── wrangler.jsonc                # Cloudflare config
├── astro.config.mjs              # Astro configuration
├── tsconfig.json                 # TypeScript config
└── package.json                  # Dependencies
```

---

## Database Schema

### Tables Overview

| Table | Purpose |
|-------|---------|
| `users` | User accounts (Lucia auth) |
| `sessions` | Auth sessions |
| `landlords` | Landlord/owner profiles |
| `property_managers` | Property management companies |
| `buildings` | Building/address records |
| `reviews` | Tenant reviews |
| `review_votes` | Helpful/not helpful votes |
| `building_scores` | Aggregated building stats |
| `landlord_scores` | Aggregated landlord stats |
| `property_manager_scores` | Aggregated PM stats |

### Entity Relationships

```
landlords ─────────┐
                   │
                   ▼
             buildings ◄───── property_managers
                   │
                   ▼
              reviews ◄───── users
                   │
                   ▼
            review_votes
```

### Key Tables

#### `buildings`
```sql
CREATE TABLE buildings (
    id TEXT PRIMARY KEY,
    landlord_id TEXT REFERENCES landlords(id),
    property_manager_id TEXT REFERENCES property_managers(id),
    address TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    neighborhood TEXT,
    city TEXT,
    state TEXT NOT NULL DEFAULT 'MA',
    zip_code TEXT,
    latitude REAL,
    longitude REAL,
    year_built INTEGER,
    unit_count INTEGER,
    building_type TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);
```

#### `reviews`
```sql
CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    building_id TEXT NOT NULL REFERENCES buildings(id),

    -- Tenancy
    move_in_year INTEGER NOT NULL,
    move_in_season TEXT NOT NULL,
    move_out_year INTEGER,
    move_out_season TEXT,
    is_current_tenant INTEGER DEFAULT 0,

    -- Unit details
    unit_type TEXT NOT NULL,
    unit_number TEXT,
    bedrooms TEXT,
    bathrooms TEXT,
    square_footage INTEGER,
    rent_amount INTEGER,

    -- Unit scores (1-5)
    unit_structural INTEGER,
    unit_plumbing INTEGER,
    unit_electrical INTEGER,
    unit_climate INTEGER,
    unit_ventilation INTEGER,
    unit_pests INTEGER,
    unit_mold INTEGER,
    unit_appliances INTEGER,
    unit_layout INTEGER,
    unit_accuracy INTEGER,

    -- Building scores (1-5)
    building_common_areas INTEGER,
    building_security INTEGER,
    building_exterior INTEGER,
    building_noise_neighbors INTEGER,
    building_noise_external INTEGER,
    building_mail INTEGER,
    building_laundry INTEGER,
    building_parking INTEGER,
    building_trash INTEGER,

    -- Landlord scores (1-5)
    landlord_maintenance INTEGER,
    landlord_communication INTEGER,
    landlord_professionalism INTEGER,
    landlord_lease_clarity INTEGER,
    landlord_privacy INTEGER,
    landlord_deposit INTEGER,
    landlord_rent_practices INTEGER,
    landlord_non_retaliation INTEGER,

    -- Calculated
    overall_score REAL,

    -- Details
    amenities TEXT,  -- JSON array
    utilities_included TEXT,  -- JSON array
    pet_types TEXT,  -- JSON array
    laundry_type TEXT,
    parking_type TEXT,
    comments TEXT,
    would_recommend INTEGER,

    -- Issues
    had_pest_issues INTEGER DEFAULT 0,
    had_heat_issues INTEGER DEFAULT 0,
    had_water_issues INTEGER DEFAULT 0,
    had_security_deposit_issues INTEGER DEFAULT 0,

    -- Moderation
    status TEXT DEFAULT 'pending',
    moderated_at TEXT,
    moderated_by TEXT,

    -- Timestamps
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
);
```

---

## Authentication System

### Implementation
- **Library:** Lucia v3 with D1 adapter
- **Storage:** Sessions in `sessions` table
- **Password:** SHA-256 hashing via @oslojs/crypto
- **Cookies:** Secure, HttpOnly, SameSite=Lax

### Middleware (`src/middleware.ts`)
```typescript
// Validates session on every request
// Sets context.locals.user and context.locals.session
// Auto-refreshes expiring sessions
// Clears invalid session cookies
```

### Flow
1. User submits credentials → `/api/auth/signin`
2. Password verified against hash
3. Session created in database
4. Session cookie set on response
5. Middleware validates on subsequent requests

---

## API Endpoints

### Authentication

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/signup` | POST | Create new user |
| `/api/auth/signin` | POST | Authenticate user |
| `/api/auth/signout` | POST | Destroy session |

### Data

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/buildings` | GET | Search buildings by query |
| `/api/reviews` | POST | Submit new review |

---

## Page Components

### Building Page (`/building/[slug]`)
- Fetches building with landlord/property manager joins
- Groups reviews by unit number (collapsible)
- Shows aggregated scores in sidebar
- Displays common issues percentages

### Landlord Page (`/landlord/[slug]`)
- Shows landlord info with icon
- Lists all owned buildings
- Shows recent reviews across all buildings
- Aggregated scores in sidebar

### Property Manager Page (`/property-manager/[slug]`)
- Purple accent color (vs teal for landlord)
- Shows buildings managed with owner info
- Recent reviews section
- Aggregated scores

---

## Shared Components

### ReviewCard (`ReviewCard.astro`)
Displays a single review with:
- Overall score + stars
- Unit info (number, type, rent)
- Score breakdown grid (Unit/Building/Landlord)
- Utilities included (blue tags)
- Amenities (blue tags)
- Laundry/Parking info
- Pets allowed
- Issues reported (colored tags)
- Would recommend badge

### ScoreCard (`ScoreCard.astro`)
Sidebar component showing:
- Grouped score bars by category
- Color-coded by rating (green/yellow/orange/red)
- Supports `type="building"` or `type="landlord"`

### StarRating (`StarRating.astro`)
- Visual star display
- Supports size="sm" prop
- Amber/yellow color scheme

---

## Library/Utility Files

### `scoring.ts`
- `calculateOverallScore()` - Weighted average of scores
- `calculateBuildingAverages()` - Aggregate stats from reviews
- `calculateLandlordAverages()` - Landlord-specific aggregates

### `privacy.ts`
- `formatFuzzyDate()` - "Spring 2024" format
- `getCurrentSeason()` - Current season string
- `getCurrentYear()` - Current year number

### `auth.ts`
- `initializeLucia()` - Creates Lucia instance with D1 adapter

### `db.ts`
- `getDB()` - Extracts D1 from Cloudflare runtime

---

## Deployment

### Cloudflare Pages

```bash
# Build
npm run build

# Deploy
npx wrangler pages deploy dist
```

### Environment
- **D1 Database:** `ratemyplace-db`
- **Binding:** `DB` in wrangler.jsonc
- **Preview URL:** https://kind-hawking.ratemyplace-64y.pages.dev

### Migrations
```bash
# Run migration
npx wrangler d1 execute ratemyplace-db --remote --file=migrations/XXXX_name.sql
```

---

## Build Status

✅ **Build: Passing**
✅ **Type Check: No errors**
✅ **All pages compile successfully**
✅ **Client bundle: 169.44 KB total**

---

## Audit Summary

### Code Quality
- ✅ TypeScript strict mode
- ✅ Consistent naming conventions
- ✅ Proper error handling
- ✅ No unused imports
- ✅ Database queries parameterized (SQL injection safe)

### Security
- ✅ Password hashing with SHA-256
- ✅ Secure session cookies
- ✅ CSRF protection via SameSite cookies
- ✅ Auth middleware on all requests

### Known Issues
- ⚠️ Old score field names in `scoring.ts` (legacy compatibility)
- ⚠️ Admin routes not protected (needs role check)

### Recommendations
1. Add rate limiting to auth endpoints
2. Implement email verification
3. Add automated score aggregation triggers
4. Consider adding search indexing for performance

---

## Version History

See [VERSION.md](./VERSION.md) for full changelog.
