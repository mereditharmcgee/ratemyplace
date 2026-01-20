# RateMyPlace Boston - Claude Context Document

> **Purpose:** This document provides complete project context for new Claude instances working on this codebase. It contains everything needed to understand the project architecture, current state, and how to work effectively with the code.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Current Version** | v1.0.0-alpha "Complete Foundation" |
| **Framework** | Astro 5.x with SSR |
| **Hosting** | Cloudflare Pages |
| **Database** | Cloudflare D1 (SQLite) |
| **Auth** | Lucia v3 with D1 adapter |
| **UI** | React islands + Tailwind CSS 4 |
| **Main Repo** | `C:\Users\mmcge\ratemyplace-boston` |
| **GitHub** | github.com/mereditharmcgee/ratemyplace |
| **Production URL** | ratemyplace.pages.dev |

---

## Project Overview

RateMyPlace Boston is a **tenant-focused housing review platform** for the Boston area. It allows renters to share anonymous reviews of their rental experiences, helping future tenants make informed decisions.

### Core Concept
- Tenants submit reviews about their rental units
- Reviews use a **27-item survey instrument** based on housing quality research (OHQS/PHQS)
- Buildings, landlords, and property managers each have profile pages with aggregated scores
- All reviews are anonymous to protect tenants

### Key Entities
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

---

## Technology Stack

### Core
- **Astro 5.16.11** - Meta-framework with SSR
- **Cloudflare Pages** - Hosting with edge functions
- **Cloudflare D1** - SQLite database at the edge
- **TypeScript** - Strict mode enabled

### Authentication
- **Lucia v3.2.2** - Session-based auth
- **@lucia-auth/adapter-sqlite** - D1 adapter
- **@oslojs/crypto** - SHA-256 password hashing
- **Google OAuth** - Social sign-in option

### Frontend
- **React 18.3.1** - Interactive islands only
- **Tailwind CSS 4.1.18** - Utility-first styling
- **Google Maps API** - Address autocomplete & maps

### Key Dependencies
```json
{
  "@astrojs/cloudflare": "^12.6.12",
  "@astrojs/react": "3.6.3",
  "@lucia-auth/adapter-sqlite": "^3.0.2",
  "lucia": "^3.2.2",
  "astro": "^5.16.11",
  "react": "^18.3.1",
  "tailwindcss": "^4.1.18"
}
```

---

## Project Structure

```
ratemyplace-boston/
├── migrations/                    # Database migrations (run manually)
│   ├── 0001_initial.sql          # Core tables
│   ├── 0004_survey_scores.sql    # 27-item survey fields
│   ├── 0005_missing_columns.sql  # Additional fields
│   └── 0006_property_managers.sql # Property manager system
│
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── BaseLayout.astro   # Main page wrapper (meta, header, footer)
│   │   │   ├── Header.astro       # Navigation with auth state
│   │   │   └── Footer.astro       # Site footer
│   │   ├── ratings/
│   │   │   ├── ScoreCard.astro    # Score breakdown sidebar
│   │   │   └── StarRating.astro   # Star display (1-5)
│   │   └── reviews/
│   │       ├── ReviewCard.astro   # Full review display (27 fields)
│   │       ├── ReviewForm.tsx     # React review submission form
│   │       └── UnitTypeSummary.astro # Collapsible unit grouping
│   │
│   ├── lib/
│   │   ├── auth.ts               # Lucia initialization
│   │   ├── db.ts                 # D1 database helper
│   │   ├── password.ts           # SHA-256 hashing
│   │   ├── privacy.ts            # Date formatting ("Spring 2024")
│   │   ├── scoring.ts            # Score calculation logic
│   │   ├── surveyItems.ts        # 27 survey question definitions
│   │   ├── types.ts              # TypeScript interfaces
│   │   └── validation.ts         # Input validation
│   │
│   ├── pages/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── signin.ts     # POST - authenticate
│   │   │   │   ├── signout.ts    # POST - destroy session
│   │   │   │   ├── signup.ts     # POST - create account
│   │   │   │   └── google/       # OAuth callback
│   │   │   ├── buildings.ts      # GET - search buildings
│   │   │   ├── reviews.ts        # POST - submit review
│   │   │   └── places/           # Google Places API proxy
│   │   │
│   │   ├── auth/
│   │   │   ├── signin.astro      # Login page
│   │   │   └── signup.astro      # Registration page
│   │   │
│   │   ├── building/
│   │   │   └── [slug].astro      # Building profile (reviews grouped by unit)
│   │   │
│   │   ├── landlord/
│   │   │   └── [slug].astro      # Landlord profile (all buildings + reviews)
│   │   │
│   │   ├── property-manager/
│   │   │   └── [slug].astro      # Property manager profile
│   │   │
│   │   ├── review/
│   │   │   └── new.astro         # New review submission
│   │   │
│   │   ├── index.astro           # Home page
│   │   ├── search.astro          # Search page
│   │   ├── map.astro             # Interactive map
│   │   ├── about.astro           # About page
│   │   ├── guidelines.astro      # Review guidelines
│   │   ├── privacy.astro         # Privacy policy
│   │   └── terms.astro           # Terms of service
│   │
│   ├── middleware.ts             # Auth session validation
│   └── env.d.ts                  # TypeScript declarations
│
├── wrangler.jsonc                # Cloudflare config
├── astro.config.mjs              # Astro configuration
├── tsconfig.json                 # TypeScript config
├── ARCHITECTURE.md               # Technical documentation
├── VERSION.md                    # Changelog and version history
└── CLAUDE_CONTEXT.md             # This file
```

---

## Database Schema

### Core Tables

#### `users`
```sql
id TEXT PRIMARY KEY
email TEXT UNIQUE NOT NULL
password_hash TEXT NOT NULL
created_at INTEGER DEFAULT (unixepoch())
```

#### `buildings`
```sql
id TEXT PRIMARY KEY
landlord_id TEXT REFERENCES landlords(id)
property_manager_id TEXT REFERENCES property_managers(id)
address TEXT NOT NULL
slug TEXT UNIQUE NOT NULL
neighborhood TEXT
city TEXT DEFAULT 'Boston'
state TEXT DEFAULT 'MA'
zip_code TEXT
latitude REAL
longitude REAL
year_built INTEGER
unit_count INTEGER
building_type TEXT
```

#### `reviews` (27-item survey)
```sql
id TEXT PRIMARY KEY
user_id TEXT REFERENCES users(id)
building_id TEXT REFERENCES buildings(id)

-- Tenancy Info
move_in_year INTEGER NOT NULL
move_in_season TEXT NOT NULL  -- 'Spring', 'Summer', 'Fall', 'Winter'
move_out_year INTEGER
move_out_season TEXT
is_current_tenant INTEGER DEFAULT 0

-- Unit Details
unit_type TEXT NOT NULL  -- 'studio', '1br', '2br', '3br', '4br+', 'house'
unit_number TEXT
bedrooms TEXT
bathrooms TEXT
square_footage INTEGER
rent_amount INTEGER

-- UNIT SCORES (1-5 scale, 10 items)
unit_structural INTEGER
unit_plumbing INTEGER
unit_electrical INTEGER
unit_climate INTEGER
unit_ventilation INTEGER
unit_pests INTEGER
unit_mold INTEGER
unit_appliances INTEGER
unit_layout INTEGER
unit_accuracy INTEGER

-- BUILDING SCORES (1-5 scale, 9 items)
building_common_areas INTEGER
building_security INTEGER
building_exterior INTEGER
building_noise_neighbors INTEGER
building_noise_external INTEGER
building_mail INTEGER
building_laundry INTEGER
building_parking INTEGER
building_trash INTEGER

-- LANDLORD SCORES (1-5 scale, 8 items)
landlord_maintenance INTEGER
landlord_communication INTEGER
landlord_professionalism INTEGER
landlord_lease_clarity INTEGER
landlord_privacy INTEGER
landlord_deposit INTEGER
landlord_rent_practices INTEGER
landlord_non_retaliation INTEGER

-- Calculated
overall_score REAL

-- Additional Details
amenities TEXT  -- JSON array
utilities_included TEXT  -- JSON array
pet_types TEXT  -- JSON array
laundry_type TEXT
parking_type TEXT
comments TEXT
would_recommend INTEGER  -- 0 or 1

-- Issue Flags
had_pest_issues INTEGER DEFAULT 0
had_heat_issues INTEGER DEFAULT 0
had_water_issues INTEGER DEFAULT 0
had_security_deposit_issues INTEGER DEFAULT 0

-- Moderation
status TEXT DEFAULT 'pending'  -- 'pending', 'approved', 'rejected'
```

### Aggregation Tables
- `building_scores` - Cached averages for buildings
- `landlord_scores` - Cached averages for landlords
- `property_manager_scores` - Cached averages for property managers

---

## Key Components

### ReviewCard.astro
Displays a single review with all 27 survey items organized into three categories:
- **Unit Scores** (10 items): Structure, plumbing, electrical, climate, etc.
- **Building Scores** (9 items): Common areas, security, noise, etc.
- **Landlord Scores** (8 items): Maintenance, communication, professionalism, etc.

Also displays: utilities included, amenities, pets, laundry/parking, issues reported, would recommend status.

### ReviewForm.tsx (React Island)
Multi-step form for submitting reviews:
1. Building selection (Google Places autocomplete)
2. Unit details (type, number, rent, sqft)
3. Survey questions (27 items with 1-5 scale)
4. Additional details (amenities, utilities, comments)

### ScoreCard.astro
Sidebar component showing aggregated score breakdowns with color-coded bars:
- Green (4-5): Good
- Yellow (3): Mixed
- Orange (2): Concerning
- Red (1): Poor

### UnitTypeSummary.astro
Collapsible cards that group reviews by unit number/type on building pages.

---

## Authentication Flow

1. **Sign Up**: User submits email/password → password hashed with SHA-256 → user created → session created → cookie set
2. **Sign In**: User submits credentials → password verified → session created → cookie set
3. **Middleware**: Every request validates session cookie → sets `Astro.locals.user` and `Astro.locals.session`
4. **Sign Out**: Session destroyed → cookie cleared

Google OAuth is also available as alternative sign-in method.

---

## Deployment

### Cloudflare Pages (Production)
```bash
# From main repo
cd C:\Users\mmcge\ratemyplace-boston
npm run build
npx wrangler pages deploy dist
```

Automatic deployment: Push to `main` branch triggers Cloudflare build.

### Database Migrations
```bash
# Run migration on remote D1
npx wrangler d1 execute ratemyplace-db --remote --file=migrations/XXXX_name.sql
```

### Environment
- **D1 Database**: `ratemyplace-db` (ID: `7dd2a722-fdd3-4986-b2f7-6d61d069438e`)
- **Binding**: `DB` in wrangler.jsonc
- **Google API Keys**: Set in Cloudflare Pages environment variables

---

## Git Workflow

### Main Repository
`C:\Users\mmcge\ratemyplace-boston` - Production code, pushes to GitHub

### Worktrees
Used for parallel development:
```bash
# List worktrees
git worktree list

# Create new worktree
git worktree add ../.claude-worktrees/ratemyplace-boston/<name> -b <branch-name>
```

Current worktree: `kind-hawking` at `C:\Users\mmcge\.claude-worktrees\ratemyplace-boston\kind-hawking`

### Merging Worktree Changes
1. Commit changes in worktree
2. Switch to main repo: `cd C:\Users\mmcge\ratemyplace-boston`
3. Merge: `git merge <branch-name>`
4. Resolve conflicts if any
5. Push: `git push origin main`

---

## Common Tasks

### Adding a New Page
1. Create `.astro` file in `src/pages/`
2. Import `BaseLayout` for consistent styling
3. Add to navigation if needed (`Header.astro`)

### Adding a New API Endpoint
1. Create `.ts` file in `src/pages/api/`
2. Export async function for HTTP method (GET, POST, etc.)
3. Access D1 via `context.locals.runtime.env.DB`

### Modifying the Review Form
1. Edit `src/lib/surveyItems.ts` for question definitions
2. Edit `src/components/reviews/ReviewForm.tsx` for form logic
3. Edit `src/pages/api/reviews.ts` for submission handling
4. Run migration if adding new database fields

### Updating Score Calculations
1. Edit `src/lib/scoring.ts`
2. Ensure field names match database schema
3. Update aggregation queries if needed

---

## Known Issues & Technical Debt

1. **ScoreCard.astro** uses some legacy field names (still functional)
2. **Admin routes** not protected by role check (needs implementation)
3. **Score aggregation** is manual (consider database triggers)
4. **No rate limiting** on auth endpoints

---

## Brand Guidelines

### Colors
- **Primary Teal**: `#1A9A7D` - Buttons, links, positive elements
- **Secondary Amber**: `#F59E0B` - Stars, highlights
- **Accent Coral**: `#D97356` - Warnings, low scores

### Score Colors
- **4-5 (Good)**: `#2D9B83` / `bg-green-500`
- **3 (Mixed)**: `#E8B44A` / `bg-yellow-500`
- **2 (Concerning)**: `bg-orange-500`
- **1 (Poor)**: `bg-red-500`

### Rating Scale
- 5 = Strongly Agree (Best)
- 4 = Agree
- 3 = Neutral
- 2 = Disagree
- 1 = Strongly Disagree (Worst)

---

## Testing a Review Display

To verify ReviewCard is working:
1. Navigate to a building page with approved reviews
2. Check that all three score categories display (Unit/Building/Landlord)
3. Verify utilities and amenities show as blue tags
4. Verify issues show as colored tags (red/orange/yellow/blue)
5. Verify "Would recommend" badge appears

If scores don't display, check:
- Review `status` is `'approved'`
- Field names match schema (unit_*, building_*, landlord_*)
- JSON fields parse correctly (amenities, utilities_included)

---

## File Reading Priority

When starting work on this project, read these files first:
1. `CLAUDE_CONTEXT.md` (this file)
2. `ARCHITECTURE.md` - Technical details
3. `VERSION.md` - Current version and changelog
4. `src/lib/types.ts` - TypeScript interfaces
5. `src/lib/surveyItems.ts` - Survey question definitions

---

## Contact & Resources

- **GitHub**: github.com/mereditharmcgee/ratemyplace
- **Production**: ratemyplace.pages.dev
- **Cloudflare Dashboard**: dash.cloudflare.com (Pages & D1)

---

*Last Updated: January 2026 | Version: v1.0.0-alpha*
