# RateMyPlace Version History

## Version Naming Convention

**Format:** `v{major}.{minor}.{patch}-{stage}`

- **Major:** Breaking changes or major feature releases
- **Minor:** New features, significant enhancements
- **Patch:** Bug fixes, small improvements
- **Stage:** `alpha`, `beta`, or `stable`

---

## Current Version: v1.1.0-alpha

**Released:** January 27, 2026
**Codename:** "Evidence-Based Scoring"

### Changelog

#### v1.1.0-alpha (January 27, 2026) - Current

**Major Features:**
- **Evidence-Based Scoring Methodology**: Implemented weighted scoring system grounded in peer-reviewed public health research
  - Health/safety items receive higher weights (pests 1.5x, mold 1.5x, structural 1.3x, climate 1.3x, plumbing 1.2x, security 1.2x)
  - Domain sub-scores (Unit, Building, Landlord) calculated and displayed
  - Recency weighting for aggregate scores (100% for 0-2y, declining to 85% floor for 5+y)
- **Public Methodology Page** (`/methodology`): Full transparency on scoring with academic citations
  - Survey instrument sources (OHQS, PHQS, WHO LARES)
  - All 27 survey items listed with research origins
  - Health/safety weighting evidence explained
  - Complete reference list with DOIs
- **Admin Dashboard**: Comprehensive admin interface at `/admin`
  - Building management (create, edit, delete)
  - Review moderation queue (approve/reject)
  - Verification handling
  - User management
- **HelpTooltip Component**: Contextual help for each survey question
- **Interactive Map**: Building map with geolocation support

**UI Improvements:**
- ScoreCard now shows domain sub-scores (Unit/Building/Landlord)
- "Learn more" link to methodology page in ScoreCard
- Footer now includes Scoring Methodology link
- New RateMyPlace logo with transparent background

**Bug Fixes:**
- Fixed favicon transparency

**Documentation:**
- Complete overhaul of CLAUDE_CONTEXT.md with scoring methodology
- Updated ARCHITECTURE.md with methodology section
- Added academic references throughout documentation

#### v1.0.0-alpha (January 2026)

**New Features:**
- Property Manager System: Buildings can have both landlord AND property manager
- Property Manager profile pages with aggregated scores
- Enhanced Review Display: Full 27-item survey breakdown in ReviewCard
- Unit Number Grouping: Reviews grouped by unit number with collapsible cards
- Landlord Profile Enhancement: Recent reviews from all buildings displayed
- Score breakdown by category (Unit, Building, Landlord) in review cards
- Amenities, utilities, and lease details display in reviews
- Common issues tracking with visual tags

**Bug Fixes:**
- Fixed "0" appearing in review cards (truthy check vs explicit equality)
- Fixed ReviewCard using old schema field names
- Fixed session persistence in middleware for login state

**Technical:**
- Complete database schema with 27 review fields
- Property manager tables and foreign key relationships
- Build passing with no TypeScript errors
- Client bundle: 169.44 KB total

#### v0.3.0-alpha (January 2026)
- Google Maps address verification (Places Autocomplete API)
- Google Sign-In OAuth
- Interactive map with building pins

#### v0.2.0-alpha (January 2026)
- Added 27-item survey instrument based on OHQS/PHQS research
- Updated language: apartment/rental-focused (removed "Boston home" language)
- Added password visibility toggle on signup
- Added rating scale labels (1=bad, 5=good)
- Aligned color palette with brand guidelines (teal primary, amber secondary)
- Enhanced review form with unit details (bed/bath, sqft, amenities, utilities)
- Fixed session persistence in middleware

#### v0.1.0-alpha (January 2026)
- Initial project setup with Astro + Cloudflare Pages
- Basic authentication with Lucia (email/password)
- Database schema with D1
- Basic layout and navigation
- Placeholder pages for buildings, landlords, reviews
- Legal pages (privacy, terms, guidelines)

---

## Upcoming Milestones

### v1.2.0-beta - "Community" (Planned)
- [ ] Landlord response system
- [ ] User profile pages
- [ ] Email notifications
- [ ] Search functionality improvements
- [ ] Automated score recalculation triggers

### v2.0.0-stable - "Launch" (Target)
- [ ] Full feature set complete
- [ ] Accessibility audit passed
- [ ] Performance optimized
- [ ] Security review complete
- [ ] Rate limiting on API endpoints

---

## Feature Status

| Feature | Status | Version |
|---------|--------|---------|
| Email/Password Auth | Done | v0.1.0 |
| Session Persistence | Done | v0.1.0 |
| Basic Layout | Done | v0.1.0 |
| Legal Pages | Done | v0.1.0 |
| 27-Item Survey | Done | v0.2.0 |
| Password Visibility | Done | v0.2.0 |
| Rating Labels | Done | v0.2.0 |
| Unit Details Form | Done | v0.2.0 |
| Brand Colors | Done | v0.2.0 |
| Google Maps API | Done | v0.3.0 |
| Google OAuth | Done | v0.3.0 |
| Interactive Map | Done | v0.3.0 |
| Property Manager System | Done | v1.0.0 |
| Unit Number Grouping | Done | v1.0.0 |
| Enhanced Review Display | Done | v1.0.0 |
| Landlord Profile Reviews | Done | v1.0.0 |
| Score Breakdown Cards | Done | v1.0.0 |
| **Evidence-Based Scoring** | **Done** | **v1.1.0** |
| **Health/Safety Weighting** | **Done** | **v1.1.0** |
| **Domain Sub-Scores** | **Done** | **v1.1.0** |
| **Recency Weighting** | **Done** | **v1.1.0** |
| **Public Methodology Page** | **Done** | **v1.1.0** |
| **Admin Dashboard** | **Done** | **v1.1.0** |
| **HelpTooltip Component** | **Done** | **v1.1.0** |
| Landlord Responses | Planned | v1.2.0 |
| User Profile Pages | Planned | v1.2.0 |

---

## Database Schema (v1.0.0)

### Tables
| Table | Purpose |
|-------|---------|
| `users` | User accounts (Lucia auth) |
| `sessions` | Auth sessions |
| `landlords` | Landlord/owner profiles |
| `property_managers` | Property management companies |
| `buildings` | Building/address records |
| `reviews` | Tenant reviews (27 fields) |
| `review_votes` | Helpful/not helpful votes |
| `building_scores` | Aggregated building stats |
| `landlord_scores` | Aggregated landlord stats |
| `property_manager_scores` | Aggregated PM stats |

### Review Score Fields (with Health/Safety Weights)

**Unit Scores (10):**
- unit_structural (1.3x), unit_plumbing (1.2x), unit_electrical (1.0x), unit_climate (1.3x)
- unit_ventilation (1.0x), unit_pests (1.5x), unit_mold (1.5x), unit_appliances (1.0x)
- unit_layout (1.0x), unit_accuracy (1.0x)

**Building Scores (9):**
- building_common_areas (1.0x), building_security (1.2x), building_exterior (1.0x)
- building_noise_neighbors (1.0x), building_noise_external (1.0x), building_mail (1.0x)
- building_laundry (1.0x), building_parking (1.0x), building_trash (1.0x)

**Landlord Scores (8):**
- landlord_maintenance (1.0x), landlord_communication (1.0x), landlord_professionalism (1.0x)
- landlord_lease_clarity (1.0x), landlord_privacy (1.0x), landlord_deposit (1.0x)
- landlord_rent_practices (1.0x), landlord_non_retaliation (1.0x)

### Scoring Methodology

The scoring system is grounded in public health research:

| Survey Instrument | Source | Domain |
|-------------------|--------|--------|
| OHQS (Observational Housing Quality Scale) | Krieger & Higgins (2002) | Unit condition |
| PHQS (Physical Housing Quality Scale) | Jacobs et al. (2009) | Building-level |
| WHO LARES | Bonnefoy et al. (2003) | Landlord/management |

See `/methodology` page and `src/lib/scoring.ts` for full implementation details.

---

## Notes for Development

### Naming Conventions
- **Pages:** kebab-case (`review-new.astro`)
- **Components:** PascalCase (`ReviewForm.tsx`)
- **Lib files:** camelCase (`surveyItems.ts`)
- **CSS classes:** Tailwind utilities

### Color Reference (Brand Guidelines v1.0)
- **Primary Teal:** #1A9A7D (buttons, links)
- **Secondary Amber:** #F59E0B (stars, highlights)
- **Accent Coral:** #D97356 (warnings, low scores)
- **Good Score:** #2D9B83 (4-5 stars)
- **Mixed Score:** #E8B44A (3 stars)
- **Concerning Score:** #D97356 (1-2 stars)

### Rating Scale
- 5 = Strongly Agree (Best)
- 4 = Agree
- 3 = Neutral
- 2 = Disagree
- 1 = Strongly Disagree (Worst)

---

## Build Information (v1.1.0-alpha)

**Build Status:** Passing
**TypeScript:** No errors (strict mode)
**Platform:** Cloudflare Pages (SSR)
**Database:** Cloudflare D1 (SQLite)
**Production URL:** ratemyplace.boston
