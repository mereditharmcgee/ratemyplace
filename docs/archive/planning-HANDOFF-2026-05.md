# Handoff: RateMyPlace Boston

**Updated:** 2026-05-31
**Status:** Live at ratemyplace.org. Last formal milestone v1.5.0 "Closed Loops" shipped 2026-04-29; ad-hoc work has continued since (see below).

## Current State

- Live at ratemyplace.org (Cloudflare Pages, auto-deploys from `main`).
- Last GSD milestone: **v1.5.0 "Closed Loops"** — shipped 2026-04-29 (24/24 requirements, 6 phases, 15 plans). A hardening pass: security, validation, performance, and quality-debt gaps.
- **No active milestone.** Next GSD step: `/gsd:new-milestone` to scope v1.6.0.
- Production DB now holds ~43 approved reviews across real Boston + New Haven addresses. (The old "DB cleared of seed data" note is obsolete.)

## Shipped since v1.5.0 (ad-hoc, not milestone-tracked)

From `git log` (2026-04 → 2026-05):
- Places API resilience: reduced burn rate + manual address fallback
- Homepage "new address" rows hand off to /review/new with one click (PRs #5, #6)
- Email senders route human-facing mail to meredith@ratemyplace.org (Workspace inbox)
- Admin tables: server-side pagination + stats (PERF-01)
- Email helper unit tests with Resend mock (TEST-01)
- **Methodology worked example** (commit 6db2a7e, 2026-05-31, live): /methodology now shows the health-weighting formula on a made-up unit + two anonymized real reviews scored flat vs weighted, displayed like the site's review cards. Built to back an Instagram "We show our work" highlight.

## What's Next

No active milestone. To scope v1.6.0: `/gsd:new-milestone` (or `/gsd:progress` to re-sync first).

Carry-over deferred to v1.6.0 (from STATE.md — verify which the May work already closed):
- **DEBT-01..04** — split components >700 LOC
- **STRESS-01..04** — stress testing / UI at scale (deferred since v1.3.0, still not done)
- **Email unsubscribe management** — before scaling notification emails
- `disputes/[id].ts` — convert blocking `await sendDisputeUpheldEmail` to fireAndForget
- `signup.ts` — adopt `isValidEmail` (VAL-05 consistency follow-up)

Product question surfaced 2026-05-31: the health-weighting moves real review scores very little (theoretical max ~0.2; usually <0.1, rounds away at the overall level). If the weighting should visibly matter more, that's a scoring change (more weighted items / stronger multipliers / different overall formula) and it retroactively shifts every score in the DB — needs explicit sign-off. Detail in Claude memory `project_weighting_real_world_effect.md`.

## Known Issues (verify before relying on)

- **Google OAuth on production** — historically failed (Cloudflare Workers bot detection blocked logins; worked locally). Status unverified as of 2026-05-31; see `GOOGLE_OAUTH_TROUBLESHOOTING.md`. Confirm before assuming fixed.
- Dual `had_pests`/`had_pest_issues` columns (cosmetic; works via fallback)
- 12 legacy v1 score columns (dead for new reviews, safe to keep)

## Quick Start

```
# Scope the next milestone
/gsd:new-milestone

# Or check progress / re-sync state
/gsd:progress
```

## Key Architecture Reference

| Area | Files |
|------|------|
| Layout | `src/components/layout/` |
| Review forms | `src/components/reviews/ReviewForm.tsx`, `form-steps/` |
| Admin panel | `src/pages/admin/`, `src/components/admin/` |
| Scoring | `src/lib/scoring.ts` (weighted arithmetic mean; weights in `ITEM_WEIGHTS`) |
| Methodology page | `src/pages/methodology.astro` |
| API routes | `src/pages/api/` |
| Migrations | `migrations/` |
| Tests | `src/lib/__tests__/` (unit), `e2e/` (Playwright) |

---
*Hand-refreshed 2026-05-31 to reflect post-v1.5.0 state. STATE.md is the GSD source of truth; run `/gsd:progress` or `/gsd:new-milestone` to regenerate these docs properly.*
