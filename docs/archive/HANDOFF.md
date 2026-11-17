# Claude Code Handoff: RateMyPlace

## Quick Start Prompt

Copy everything below this line and paste into a new Claude Code session:

---

I'm working on RateMyPlace, a tenant housing review platform. The project is at `C:\Users\mmcge\ratemyplace-boston`.

## Essential First Reads

1. **CLAUDE_CONTEXT.md** - Complete project context, scoring methodology, all key information
2. **CLAUDE.md** - Coding conventions and patterns

## Project Status

- **Live site**: https://ratemyplace.org (Cloudflare Pages)
- **All 171 unit tests passing** as of 2026-03-09
- Production database cleared of seed data, only real user account remains (admin)
- Cloudflare Email Routing configured (catch-all → personal email)
- Copy audit complete: false landlord feature claims removed from all pages
- Review form UX fixes deployed: rating colors, N/A for deposit, issues checkboxes, unit number privacy, recency labels

## Tech Stack
- Astro 5 (SSR mode) on Cloudflare Pages
- Cloudflare D1 database (SQLite)
- Lucia Auth (email/password + Google OAuth)
- React 18 islands (not 19 - Cloudflare Workers compatibility)
- Tailwind CSS 4, TypeScript strict mode

## Task: Fix 3 Form Parity Gaps Between New Review and Edit Review

We audited `ReviewForm.tsx` (new review, multi-step) vs `ReviewEditForm.tsx` (edit, single page) and found 3 fields present in the edit form but missing from the new review submission flow:

### Gap 1: Review Title
**Edit form has**: `reviewTitle` field with `<input>` — "Summarize your experience" (optional, max 100 chars)
**New form missing**: No review title field anywhere in the step flow
**Fix**: Add a "Review Title" input to `AdditionalStep.tsx` (before comments)
**API**: The POST endpoint (`src/pages/api/reviews.ts`) does NOT include `review_title` in its INSERT — needs to be added

### Gap 2: Estimated Monthly Utilities
**Edit form has**: `estimatedMonthlyUtilities` field — "Estimated Monthly Utility Cost (for utilities not included)"
**New form**: `UnitDetailsStep.tsx` collects `estimatedMonthlyUtilities` in state, BUT `ReviewForm.tsx` never appends it to FormData in `handleSubmit`
**Fix**: Add `formData.append('estimated_monthly_utilities', ...)` in ReviewForm.tsx handleSubmit (around line 164)
**API**: The POST endpoint already has `estimated_monthly_utilities` in its INSERT — just needs the form data

### Gap 3: Laundry Cost Per Load
**Edit form has**: `laundryCostPerLoad` field — "Cost per Load (wash + dry)" shown when laundry type is coin-op
**New form**: `UnitDetailsStep.tsx` collects `laundryCostPerLoad` in state, BUT `ReviewForm.tsx` never appends it to FormData
**Fix**: Add `formData.append('laundry_cost_per_load', ...)` in ReviewForm.tsx handleSubmit
**API**: The POST endpoint already has `laundry_cost_per_load` in its INSERT — just needs the form data

### Execution order
1. Fix Gap 1: Add review_title to AdditionalStep.tsx + ReviewForm.tsx handleSubmit + API POST endpoint
2. Fix Gap 2: Add estimated_monthly_utilities to ReviewForm.tsx handleSubmit
3. Fix Gap 3: Add laundry_cost_per_load to ReviewForm.tsx handleSubmit
4. Also add review_title to the ReviewData type in `form-steps/types.ts`
5. Run `npm run build` and `npm test` to verify
6. Commit and push

## Key Technical Notes
- Env vars accessed via `(context.locals as any).runtime?.env?.VAR_NAME`
- Google Places API (New v1) requires `Referer: https://ratemyplace.org/` header on server-side calls
- Places API uses `GOOGLE_PLACES_API_KEY` (preferred) or `GOOGLE_MAPS_API_KEY` fallback
- React 19 doesn't work on Cloudflare Workers — stay on React 18
- Database: D1 `ratemyplace-db`, ID `7dd2a722-fdd3-4986-b2f7-6d61d069438e`

---

End of handoff prompt.
