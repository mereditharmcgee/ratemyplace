# RateMyPlace - Claude Context Document

> **Purpose:** This document provides complete project context for new Claude instances working on this codebase. It contains everything needed to understand the project architecture, current state, and how to work effectively with the code.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Current Version** | v1.1.0-alpha "Evidence-Based Scoring" |
| **Framework** | Astro 5.x with SSR |
| **Hosting** | Cloudflare Pages |
| **Database** | Cloudflare D1 (SQLite) |
| **Auth** | Lucia v3 with D1 adapter |
| **UI** | React islands + Tailwind CSS 4 |
| **Main Repo** | `C:\Users\mmcge\ratemyplace-boston` |
| **GitHub** | github.com/mereditharmcgee/ratemyplace |
| **Production URL** | ratemyplace.boston |

---

## Project Mission

RateMyPlace is a **public health-focused tenant housing review platform**. It helps renters make informed decisions by providing evidence-based ratings grounded in housing quality research.

### Core Principles
1. **Evidence-Based**: Survey items drawn from validated instruments (OHQS, PHQS, WHO LARES)
2. **Health-Focused**: Scores weighted by documented health/safety impacts
3. **Transparent**: Methodology publicly documented with academic citations
4. **Tenant-Centered**: Anonymous reviews to protect renters

---

## Worktree History

Worktrees are used for parallel development. This section documents what each worktree accomplished.

| Worktree | Branch | Date | Purpose | Status |
|----------|--------|------|---------|--------|
| `kind-hawking` | kind-hawking | Jan 2026 | v1.0.0-alpha release: Property Manager system, enhanced ReviewCard with 27-field display, unit number grouping, bug fixes, documentation | **Merged to main** |
| `clever-vaughan` | clever-vaughan | Jan 2026 | UI improvements, map geolocation, admin features, security upgrades, **scoring methodology overhaul**, help tooltips, methodology page | **Active** |

### Worktree Locations
- **kind-hawking**: `C:\Users\mmcge\.claude-worktrees\ratemyplace-boston\kind-hawking`
- **clever-vaughan**: `C:\Users\mmcge\.claude-worktrees\ratemyplace-boston\clever-vaughan`

### Creating New Worktrees
```bash
cd C:\Users\mmcge\ratemyplace-boston
git worktree add ../.claude-worktrees/ratemyplace-boston/<name> -b <branch-name>
```

---

## Scoring Methodology (Critical Section)

### Overview
RateMyPlace uses an **evidence-based weighted scoring system** grounded in peer-reviewed public health research. This is a key differentiator from other review platforms.

### Survey Instrument Foundation
The 27-item survey is adapted from validated housing quality assessment instruments:

| Instrument | Source | Domain |
|------------|--------|--------|
| **OHQS** (Observational Housing Quality Scale) | Krieger & Higgins (2002) | Unit condition items |
| **PHQS** (Physical Housing Quality Scale) | Jacobs et al. (2009) | Building-level items |
| **WHO LARES** | Bonnefoy et al. (2003) | Landlord/management items |

### Health/Safety Weighting
Items with documented health impacts receive higher weights:

| Item | Weight | Evidence |
|------|--------|----------|
| Pest Control | 1.5x | Allergens, disease vectors (Krieger 2002) |
| Mold/Moisture | 1.5x | OR 1.5-3.5 respiratory illness (Jacobs 2009) |
| Structural Integrity | 1.3x | Safety hazards (WHO LARES) |
| Climate Control | 1.3x | Cardiovascular risk (WHO LARES) |
| Plumbing | 1.2x | Mold pathway (Jacobs 2009) |
| Security | 1.2x | Personal safety (WHO LARES) |
| All others | 1.0x | Standard weight |

### Domain Scores
Reviews display three sub-scores:
- **Unit** (10 items): structural, plumbing, electrical, climate, ventilation, pests, mold, appliances, layout, accuracy
- **Building** (9 items): common areas, security, exterior, noise (2), mail, laundry, parking, trash
- **Landlord** (8 items): maintenance, communication, professionalism, lease clarity, privacy, deposit, rent practices, non-retaliation

### Recency Weighting
Aggregate scores apply gentle recency weighting (Hu, Pavlou & Zhang 2017):
- 0-2 years: 100%
- 3 years: 95%
- 4 years: 90%
- 5+ years: 85% (floor)

### Key Files
- `src/lib/scoring.ts` - All scoring calculations, weights, domain aggregation
- `src/lib/surveyItems.ts` - Survey question definitions with help text
- `src/pages/methodology.astro` - Public methodology page with citations

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
- **PBKDF2-SHA256** - Password hashing (100k iterations, with salt)
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
ratemyplace/
├── migrations/                    # Database migrations (run manually)
│   ├── 0001_initial.sql          # Core tables
│   ├── 0004_survey_scores.sql    # 27-item survey fields
│   ├── 0005_missing_columns.sql  # Additional fields
│   ├── 0006_property_managers.sql # Property manager system
│   ├── 0008_laundry_fields.sql   # Laundry cost tracking
│   └── 0009_utility_estimate.sql # Utility estimate field
│
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── BaseLayout.astro   # Main page wrapper (meta, header, footer)
│   │   │   ├── Header.astro       # Navigation with auth state
│   │   │   └── Footer.astro       # Site footer with methodology link
│   │   ├── ratings/
│   │   │   ├── ScoreCard.astro    # Score breakdown sidebar (domain scores)
│   │   │   └── StarRating.astro   # Star display (1-5)
│   │   ├── reviews/
│   │   │   ├── ReviewCard.astro   # Full review display (27 fields + domain scores)
│   │   │   ├── ReviewForm.tsx     # React review submission form
│   │   │   ├── HelpTooltip.tsx    # Contextual help for survey questions
│   │   │   └── UnitTypeSummary.astro # Collapsible unit grouping
│   │   └── admin/                 # Admin dashboard components
│   │
│   ├── lib/
│   │   ├── auth.ts               # Lucia initialization
│   │   ├── db.ts                 # D1 database helper
│   │   ├── password.ts           # PBKDF2-SHA256 hashing
│   │   ├── privacy.ts            # Date formatting ("Spring 2024")
│   │   ├── scoring.ts            # **CRITICAL** - Weighted scoring system
│   │   ├── surveyItems.ts        # 27 survey question definitions + help
│   │   ├── types.ts              # TypeScript interfaces
│   │   └── validation.ts         # Input validation
│   │
│   ├── pages/
│   │   ├── api/
│   │   │   ├── auth/              # Authentication endpoints
│   │   │   ├── admin/             # Admin API endpoints
│   │   │   ├── buildings.ts       # Building search
│   │   │   ├── reviews.ts         # Review submission (uses scoring.ts)
│   │   │   └── places/            # Google Places API proxy
│   │   │
│   │   ├── admin/                 # Admin dashboard pages
│   │   │   ├── index.astro        # Dashboard home
│   │   │   ├── buildings.astro    # Building management
│   │   │   ├── reviews.astro      # Review moderation
│   │   │   ├── verify.astro       # Verification queue
│   │   │   └── ...
│   │   │
│   │   ├── building/
│   │   │   └── [slug].astro       # Building profile (calculates scores from reviews)
│   │   │
│   │   ├── landlord/
│   │   │   └── [slug].astro       # Landlord profile (calculates scores from reviews)
│   │   │
│   │   ├── methodology.astro      # **NEW** - Public scoring methodology page
│   │   ├── map.astro              # Interactive building map
│   │   ├── contact.astro          # Contact form
│   │   └── ...
│   │
│   ├── middleware.ts              # Auth session validation
│   └── env.d.ts                   # TypeScript declarations
│
├── wrangler.jsonc                 # Cloudflare config
├── ARCHITECTURE.md                # Technical documentation
├── VERSION.md                     # Changelog and version history
├── SECURITY.md                    # Security documentation
├── HANDOFF.md                     # Session handoff template
└── CLAUDE_CONTEXT.md              # This file
```

---

## Database Schema

### Core Tables

#### `users`
```sql
id TEXT PRIMARY KEY
email TEXT UNIQUE NOT NULL
password_hash TEXT NOT NULL  -- PBKDF2-SHA256 format: base64(salt)$base64(hash)
is_admin INTEGER DEFAULT 0
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
city TEXT
state TEXT
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
move_in_year INTEGER
move_in_season TEXT
move_out_year_new TEXT  -- 'current' or year
is_current_tenant INTEGER DEFAULT 0
tenure_months INTEGER

-- Unit Details
unit_type TEXT NOT NULL
unit_number TEXT
bedrooms TEXT
bathrooms TEXT
square_footage INTEGER
rent_amount INTEGER
laundry_type TEXT
laundry_cost_per_load REAL
estimated_monthly_utilities INTEGER

-- UNIT SCORES (1-5 scale, 10 items)
unit_structural INTEGER      -- 1.3x weight
unit_plumbing INTEGER        -- 1.2x weight
unit_electrical INTEGER
unit_climate INTEGER         -- 1.3x weight
unit_ventilation INTEGER
unit_pests INTEGER           -- 1.5x weight
unit_mold INTEGER            -- 1.5x weight
unit_appliances INTEGER
unit_layout INTEGER
unit_accuracy INTEGER

-- BUILDING SCORES (1-5 scale, 9 items)
building_common_areas INTEGER
building_security INTEGER    -- 1.2x weight
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
overall_score REAL  -- Weighted average

-- Additional
amenities TEXT  -- JSON array
utilities_included TEXT  -- JSON array
would_recommend_new TEXT  -- 'yes', 'no', 'maybe'
comments TEXT

-- Moderation
status TEXT DEFAULT 'pending'  -- 'pending', 'approved', 'rejected'
```

### Aggregation Tables
- `building_scores` - Cached averages (may be stale - pages calculate from reviews)
- `landlord_scores` - Cached averages (may be stale - pages calculate from reviews)
- `property_manager_scores` - Cached averages

**Note:** Building and landlord pages now calculate scores directly from reviews using `scoring.ts` functions, ensuring domain scores are always available even if the cache tables don't have them.

---

## Key Components

### ReviewCard.astro
Displays a single review with:
- **Overall score** with star rating
- **Domain sub-scores** (Unit, Building, Landlord) as colored badges
- **Score breakdown grid** showing all 27 items organized by domain
- **Health/safety indicators** - asterisk (*) marks weighted items
- All imported from `scoring.ts` for consistency

### ReviewForm.tsx (React Island)
Multi-step form for submitting reviews:
1. Building selection (Google Places autocomplete)
2. Unit details (type, number, rent, sqft)
3. Survey questions (27 items with 1-5 scale + help tooltips)
4. Additional details (amenities, utilities, comments)

Uses `HelpTooltip.tsx` to show contextual help for each question.

### ScoreCard.astro
Sidebar component showing aggregated score breakdowns:
- **Domain scores** (Unit, Building, Landlord) in colored boxes
- **Would recommend** percentage
- **Issues reported** section
- **Methodology link** to /methodology page

### scoring.ts (Critical File)
Contains all scoring logic:
- `ITEM_WEIGHTS` - Health/safety weights for each field
- `calculateDomainScores()` - Computes Unit/Building/Landlord sub-scores
- `calculateOverallScore()` - Weighted overall score
- `calculateBuildingAverages()` - Aggregate scores with recency weighting
- `calculateLandlordAverages()` - Landlord-specific aggregation
- `getRecencyWeight()` - Time-based weighting function

---

## Authentication Flow

1. **Sign Up**: User submits email/password → password hashed with PBKDF2-SHA256 (100k iterations, random salt) → user created → session created → cookie set
2. **Sign In**: User submits credentials → password verified → session created → cookie set
3. **Middleware**: Every request validates session cookie → sets `Astro.locals.user` and `Astro.locals.session`
4. **Sign Out**: Session destroyed → cookie cleared → redirect to home

Google OAuth is also available as alternative sign-in method.

---

## Admin System

### Access Control
- Requires `is_admin = 1` in users table
- All `/api/admin/*` endpoints check admin status
- 401 if not logged in, 403 if not admin

### Admin Features
- **Dashboard**: Overview stats
- **Buildings**: Create, edit, delete buildings
- **Reviews**: Moderation queue (approve/reject)
- **Verification**: Handle tenant verification requests
- **Landlords/Managers**: Manage entities
- **Users**: View user accounts

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

### Merging Worktree Changes
1. Commit changes in worktree
2. Push worktree branch: `git push origin <branch-name>`
3. Switch to main repo: `cd C:\Users\mmcge\ratemyplace-boston`
4. Merge: `git merge <branch-name>`
5. Push: `git push origin main`

---

## Common Tasks

### Adding a New Survey Question
1. Add field to database migration
2. Add to `src/lib/surveyItems.ts` with help text
3. Add to appropriate domain in `src/lib/scoring.ts` (UNIT_FIELDS, BUILDING_FIELDS, or LANDLORD_FIELDS)
4. Set weight in `ITEM_WEIGHTS` (1.0 for standard, higher for health/safety)
5. Update `src/pages/api/reviews.ts` to accept the field
6. Update ReviewCard.astro to display the field

### Modifying Score Weights
1. Edit `src/lib/scoring.ts` - `ITEM_WEIGHTS` constant
2. Document justification with academic citation
3. Update `src/pages/methodology.astro` with new weight and reference

### Updating the Methodology Page
The page at `/methodology` explains the scoring system to users. When making changes:
1. Update `src/pages/methodology.astro`
2. Ensure all cited references are accurate
3. Keep the "Survey Instrument Sources" and "Health/Safety Weighting Evidence" sections current

---

## Known Issues & Technical Debt

1. **Score aggregation tables** may be stale - pages now calculate from reviews directly
2. **No rate limiting** on auth endpoints (recommended for production)
3. **Large ReviewForm.tsx** (900+ lines) could be split into smaller components
4. **Legacy field support** - some old field names maintained for backward compatibility

---

## Security Considerations

See `SECURITY.md` for detailed security documentation, including:
- Password hashing (PBKDF2-SHA256 with salt)
- Session management
- Input validation
- Admin authorization
- Known limitations and recommendations

---

## Brand Guidelines

### Colors
- **Primary Teal**: `#1A9A7D` - Buttons, links, positive elements
- **Secondary Amber**: `#F59E0B` - Stars, highlights
- **Accent Coral**: `#D97356` - Warnings, low scores

### Score Colors
- **4-5 (Excellent)**: `bg-emerald-500` / `text-emerald-600`
- **3 (Average)**: `bg-amber-500` / `text-amber-600`
- **2 (Below Average)**: `bg-orange-500` / `text-orange-600`
- **1 (Poor)**: `bg-red-500` / `text-red-600`

### Rating Scale
- 5 = Excellent (Best)
- 4 = Good
- 3 = Average
- 2 = Below Average
- 1 = Poor (Worst)

---

## Academic References

These references underpin the scoring methodology. Include in any public documentation:

### Survey Instruments
- Krieger, J., & Higgins, D. L. (2002). Housing and health: Time again for public health action. *American Journal of Public Health, 92*(5), 758-768.
- Jacobs, D. E., et al. (2009). The relationship of housing and population health. *Environmental Health Perspectives, 117*(4), 597-604.
- Bonnefoy, X., et al. (2003). Housing and health in Europe. *American Journal of Public Health, 93*(9), 1559-1563.

### Weighting Evidence
- Fisk, W. J., et al. (2007). Meta-analyses of respiratory health effects with dampness and mold. *Indoor Air, 17*(4), 284-296.
- WHO Regional Office for Europe. (2018). WHO Housing and Health Guidelines.

### Methodology
- Hu, N., Pavlou, P. A., & Zhang, J. (2017). On self-selection biases in online product reviews. *MIS Quarterly, 41*(2), 449-471.

---

## File Reading Priority

When starting work on this project, read these files first:
1. `CLAUDE_CONTEXT.md` (this file)
2. `src/lib/scoring.ts` - Understand the scoring system
3. `src/lib/surveyItems.ts` - Survey question definitions
4. `ARCHITECTURE.md` - Technical details
5. `VERSION.md` - Current version and changelog

---

## Contact & Resources

- **GitHub**: github.com/mereditharmcgee/ratemyplace
- **Production**: ratemyplace.boston
- **Cloudflare Dashboard**: dash.cloudflare.com (Pages & D1)

---

*Last Updated: January 27, 2026 | Version: v1.1.0-alpha*
