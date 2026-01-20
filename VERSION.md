# RateMyPlace Version History

## Version Naming Convention

**Format:** `v{major}.{minor}.{patch}-{stage}`

- **Major:** Breaking changes or major feature releases
- **Minor:** New features, significant enhancements
- **Patch:** Bug fixes, small improvements
- **Stage:** `alpha`, `beta`, or `stable`

---

## Current Version: v1.0.0-alpha

**Released:** January 2026
**Codename:** "Complete Foundation"

### Changelog

#### v1.0.0-alpha (January 2026) - Current

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

### v1.1.0-beta - "Community" (Planned)
- [ ] Review moderation queue (admin)
- [ ] Landlord response system
- [ ] User profile pages
- [ ] Email notifications
- [ ] Search functionality improvements

### v2.0.0-stable - "Launch" (Target)
- [ ] Full feature set complete
- [ ] Accessibility audit passed
- [ ] Performance optimized
- [ ] Security review complete

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
| **Property Manager System** | **Done** | **v1.0.0** |
| **Unit Number Grouping** | **Done** | **v1.0.0** |
| **Enhanced Review Display** | **Done** | **v1.0.0** |
| **Landlord Profile Reviews** | **Done** | **v1.0.0** |
| **Score Breakdown Cards** | **Done** | **v1.0.0** |
| Review Moderation | Planned | v1.1.0 |
| Landlord Responses | Planned | v1.1.0 |

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

### Review Score Fields

**Unit Scores (10):**
- unit_structural, unit_plumbing, unit_electrical, unit_climate
- unit_ventilation, unit_pests, unit_mold, unit_appliances
- unit_layout, unit_accuracy

**Building Scores (9):**
- building_common_areas, building_security, building_exterior
- building_noise_neighbors, building_noise_external, building_mail
- building_laundry, building_parking, building_trash

**Landlord Scores (8):**
- landlord_maintenance, landlord_communication, landlord_professionalism
- landlord_lease_clarity, landlord_privacy, landlord_deposit
- landlord_rent_practices, landlord_non_retaliation

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

## Build Information (v1.0.0-alpha)

**Build Status:** Passing
**TypeScript:** No errors (strict mode)
**Client Bundle:** 169.44 KB total
**Platform:** Cloudflare Pages (SSR)
**Database:** Cloudflare D1 (SQLite)
