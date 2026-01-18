# Claude Code Handoff: RateMyPlace v0.3.0-alpha

## Quick Start Prompt

Copy everything below this line and paste into a new Claude Code session:

---

I'm working on RateMyPlace, a tenant housing review platform. The project is at `C:\Users\mmcge\ratemyplace-boston`.

**Current version:** v0.2.0-alpha (just deployed)
**Next version:** v0.3.0-alpha ("Discovery")

## Tech Stack
- Astro 5 (SSR mode)
- Cloudflare Pages + D1 database
- Lucia Auth (email/password)
- React 18 (downgraded from 19 due to Cloudflare Workers compatibility)
- Tailwind CSS 4
- TypeScript

## What's Done (v0.2.0)
- Authentication working (email/password with Lucia)
- 27-item survey based on OHQS/PHQS research
- Review form with unit details (bed/bath, sqft, amenities, utilities)
- Brand colors (teal primary, amber secondary, coral accent)
- Password visibility toggles
- VERSION.md tracking system

## Your Tasks for v0.3.0-alpha

### 1. Google Maps Places API Integration
**Goal:** Address verification when users enter building addresses in the review form.

Files to modify:
- `src/components/reviews/ReviewForm.tsx` - Add Places Autocomplete to address step
- `src/lib/maps.ts` - Create (new file for Maps utilities)
- `astro.config.mjs` - May need env variable setup

Requirements:
- Use Google Places Autocomplete API
- Extract structured address components (street, city, state, zip)
- Store normalized addresses in D1 database
- Handle cases where address isn't found

### 2. Google Sign-In OAuth
**Goal:** Add "Sign in with Google" option alongside email/password.

Files to modify:
- `src/lib/auth.ts` - Add Google OAuth provider to Lucia
- `src/pages/api/auth/google/callback.ts` - Create OAuth callback handler
- `src/pages/auth/signin.astro` - Add Google sign-in button
- `src/pages/auth/signup.astro` - Add Google sign-up button

Requirements:
- Use Lucia's OAuth helpers
- Link Google accounts to existing email accounts if same email
- Store Google user ID for future logins

### 3. Interactive Map with Building Pins
**Goal:** Map showing reviewed buildings with score indicators.

Files to create:
- `src/components/map/BuildingMap.tsx` - React component for the map
- `src/pages/map.astro` - Map page

Requirements:
- Use Google Maps JavaScript API
- Show pins colored by score (green=good, amber=mixed, coral=concerning)
- Click pin to see building summary
- Filter by score range, neighborhood

## Key Files Reference

```
src/
├── lib/
│   ├── auth.ts          # Lucia auth config
│   ├── db.ts            # D1 database access
│   ├── surveyItems.ts   # 27-item survey specification
│   ├── scoring.ts       # Score calculation
│   └── types.ts         # TypeScript interfaces
├── pages/
│   ├── api/auth/        # Auth endpoints
│   ├── auth/            # Signin/signup pages
│   └── review/new.astro # Review form page
├── components/
│   └── reviews/ReviewForm.tsx  # Multi-step review form
└── middleware.ts        # Session validation
```

## Environment Variables Needed

For Cloudflare Pages, these go in the dashboard under Settings > Environment Variables:

```
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_MAPS_API_KEY=<from Google Cloud Console>
```

## Database Info
- D1 database name: `ratemyplace-db`
- Database ID: `7dd2a722-fdd3-4986-b2f7-6d61d069438e`
- Binding name: `DB`

## Brand Colors (from guidelines)
- Primary Teal: #1A9A7D
- Secondary Amber: #F59E0B
- Accent Coral: #D97356
- Good Score (4-5): #2D9B83
- Mixed Score (3): #E8B44A
- Concerning Score (1-2): #D97356

## Important Notes
- React 19 doesn't work on Cloudflare Workers (MessageChannel error) - stay on React 18
- wrangler.jsonc has `compatibility_date: "2024-12-01"`
- The site is live at https://ratemyplace.org

## Getting Started

1. Read VERSION.md for version history
2. Read the brand guidelines: `C:\Users\mmcge\Downloads\ratemyplace-brand-guidelines.jsx`
3. Read the survey spec: `C:\Users\mmcge\Downloads\ratemyplace-survey-specification.md`
4. Start with Google Maps Places API (most impactful for user experience)

Please begin by reading the current auth.ts and ReviewForm.tsx files to understand the existing implementation, then outline your approach for adding Google Maps integration.

---

End of handoff prompt.
