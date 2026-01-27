# Claude Code Handoff: RateMyPlace v1.1.0-alpha

## Quick Start Prompt

Copy everything below this line and paste into a new Claude Code session:

---

I'm working on RateMyPlace, an evidence-based tenant housing review platform. The project is at `C:\Users\mmcge\ratemyplace-boston`.

**Current version:** v1.1.0-alpha "Evidence-Based Scoring"

## Essential First Reads

1. **CLAUDE_CONTEXT.md** - Complete project context, scoring methodology, all key information
2. **src/lib/scoring.ts** - Weighted scoring system (critical file)
3. **src/lib/surveyItems.ts** - 27 survey questions with help text

## Project Mission

RateMyPlace is a **public health-focused** tenant housing review platform:
- Survey items from validated instruments (OHQS, PHQS, WHO LARES)
- Health/safety weighted scoring (pests 1.5x, mold 1.5x, etc.)
- Transparent methodology with academic citations
- Anonymous reviews to protect tenants

## Tech Stack
- Astro 5 (SSR mode) on Cloudflare Pages
- Cloudflare D1 database (SQLite)
- Lucia Auth (email/password + Google OAuth)
- React 18 islands (not 19 - Cloudflare Workers compatibility)
- Tailwind CSS 4
- TypeScript strict mode

## What's Done (v1.1.0)

### Scoring System (Key Feature)
- Evidence-based weighted scoring from peer-reviewed research
- Health/safety weights: pests (1.5x), mold (1.5x), structural (1.3x), climate (1.3x), plumbing (1.2x), security (1.2x)
- Domain sub-scores: Unit (10 items), Building (9 items), Landlord (8 items)
- Recency weighting: 100% (0-2y) → 85% (5+y) floor
- Public methodology page at `/methodology` with citations

### Core Features
- 27-item survey based on OHQS/PHQS/WHO LARES research
- Building and landlord profile pages with aggregated scores
- Property manager system (buildings can have both owner and PM)
- Admin dashboard (`/admin`) for moderation
- Interactive map with building markers
- Google Maps Places autocomplete for address entry
- HelpTooltip component for survey questions

## Key Files Reference

```
src/
├── lib/
│   ├── scoring.ts        # **CRITICAL** - All scoring calculations & weights
│   ├── surveyItems.ts    # 27 survey questions with help text
│   ├── auth.ts           # Lucia auth config
│   ├── db.ts             # D1 database access
│   └── types.ts          # TypeScript interfaces
├── pages/
│   ├── methodology.astro # Public scoring methodology page
│   ├── admin/            # Admin dashboard pages
│   ├── api/auth/         # Auth endpoints
│   ├── building/[slug].astro
│   └── landlord/[slug].astro
├── components/
│   ├── reviews/
│   │   ├── ReviewForm.tsx    # Multi-step review form
│   │   ├── ReviewCard.astro  # Review display (27 fields)
│   │   └── HelpTooltip.tsx   # Contextual help tooltips
│   └── ratings/
│       └── ScoreCard.astro   # Score breakdown sidebar
└── middleware.ts         # Session validation
```

## Database Info
- D1 database name: `ratemyplace-db`
- Database ID: `7dd2a722-fdd3-4986-b2f7-6d61d069438e`
- Binding name: `DB`

## Academic References (for methodology)
- **OHQS**: Krieger & Higgins (2002) - Unit condition items
- **PHQS**: Jacobs et al. (2009) - Building-level items
- **WHO LARES**: Bonnefoy et al. (2003) - Landlord/management items
- **Recency weighting**: Hu, Pavlou & Zhang (2017)

## Brand Colors
- Primary Teal: #1A9A7D
- Secondary Amber: #F59E0B
- Accent Coral: #D97356
- Good Score (4-5): emerald-500/600
- Mixed Score (3): amber-500/600
- Concerning Score (1-2): red-500/600

## Important Notes
- React 19 doesn't work on Cloudflare Workers (MessageChannel error) - stay on React 18
- Score aggregation tables may be stale - pages calculate from reviews directly
- The site is live at https://ratemyplace.boston

## Potential Next Tasks

### v1.2.0-beta "Community"
- [ ] Landlord response system (owners can reply to reviews)
- [ ] User profile pages
- [ ] Email notifications
- [ ] Automated score recalculation triggers
- [ ] Search improvements

### Technical Debt
- [ ] Add rate limiting to auth endpoints
- [ ] Split large ReviewForm.tsx into smaller components
- [ ] Add email verification

## Getting Started

Please begin by reading CLAUDE_CONTEXT.md for complete project context, then explore the scoring.ts file to understand the evidence-based methodology - it's central to the project's mission.

---

End of handoff prompt.
