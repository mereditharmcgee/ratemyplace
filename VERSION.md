# RateMyPlace Version History

## Version Naming Convention

**Format:** `v{major}.{minor}.{patch}-{stage}`

- **Major:** Breaking changes or major feature releases
- **Minor:** New features, significant enhancements
- **Patch:** Bug fixes, small improvements
- **Stage:** `alpha`, `beta`, or `stable`

---

## Current Version: v0.2.0-alpha

**Released:** January 2026
**Codename:** "Foundation"

### Changelog

#### v0.2.0-alpha (January 2026) - Current
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

### v0.3.0-alpha - "Discovery" (Planned)
- [ ] Google Maps address verification
- [ ] Google Sign-In OAuth
- [ ] Interactive map with building pins
- [ ] Search functionality improvements

### v0.4.0-beta - "Community" (Planned)
- [ ] Review moderation queue
- [ ] Landlord response system
- [ ] User profile pages
- [ ] Email notifications

### v1.0.0-stable - "Launch" (Target)
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
| Google Maps API | Planned | v0.3.0 |
| Google OAuth | Planned | v0.3.0 |
| Interactive Map | Planned | v0.3.0 |
| Review Moderation | Planned | v0.4.0 |
| Landlord Responses | Planned | v0.4.0 |

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
