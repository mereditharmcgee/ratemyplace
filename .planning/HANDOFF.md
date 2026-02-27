# Handoff: RateMyPlace Boston

**Created:** 2026-02-27
**Context:** Post-refactor, pre-launch UX audit

## What Just Happened

- Created CLAUDE.md with coding conventions
- Added centralized API types (`src/lib/api-types.ts`)
- Refactored ReviewForm.tsx from 916 → 287 lines (extracted into `form-steps/`)
- All changes pushed to main

## Current Concern

**User-facing experience needs audit before launch:**
1. UI consistency - are styles/components consistent across pages?
2. Bug check - are there broken flows or edge cases?
3. Language/copy - is text updated to match current features?

## Recommended Audit Plan

### Phase 1: Page-by-Page UX Audit

Review each user-facing page for:
- [ ] Consistent styling (buttons, forms, colors)
- [ ] Clear language (no placeholder text, outdated copy)
- [ ] Working links and navigation
- [ ] Mobile responsiveness

**Pages to audit:**
```
Public:
- / (home)
- /search
- /map
- /building/[slug]
- /landlord/[slug]
- /methodology
- /guidelines
- /privacy
- /terms
- /contact
- /about
- /dispute

Auth:
- /auth/signin
- /auth/signup

Authenticated:
- /review/new (ReviewForm - just refactored)
- /profile

Admin:
- /admin/* (lower priority for launch)
```

### Phase 2: Flow Testing

Test complete user journeys:
1. **New user signup → submit review → view on building page**
2. **Search for building → view details → see reviews**
3. **Landlord dispute submission flow**
4. **Email verification flow**

### Phase 3: Copy Review

Check for:
- "Coming Soon" placeholders
- Lorem ipsum or test text
- Outdated feature descriptions
- Consistent terminology (landlord vs property owner, etc.)

## Quick Start After Clear

```bash
# Resume this work
/gsd:quick "Audit user-facing pages for consistency, bugs, and outdated copy"

# Or explore manually
# Read pages in src/pages/ and check for issues
```

## Key Files for UI Audit

| Area | Files |
|------|-------|
| Layout | `src/components/layout/` (Header, Footer, BaseLayout) |
| Home | `src/pages/index.astro` |
| Review Form | `src/components/reviews/ReviewForm.tsx`, `form-steps/` |
| Building Page | `src/pages/building/[slug].astro` |
| Profile | `src/components/profile/ProfileDashboard.tsx` |
| Public Pages | `src/pages/*.astro` |

## Known Issues from Previous Handoff

- "Coming Soon" text on /about and /contact for landlord responses
- Rate limiting only on signin (not signup, disputes, verification)
- Google Maps API key needs HTTP referrer restrictions

---
*Handoff created: 2026-02-27 after completing documentation improvements*
