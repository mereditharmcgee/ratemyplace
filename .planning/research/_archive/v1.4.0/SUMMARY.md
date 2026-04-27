# Project Research Summary

**Project:** RateMyPlace v1.4.0 "Open Doors"
**Domain:** Tenant housing review platform — feature additions to a live production system
**Researched:** 2026-03-20
**Confidence:** HIGH (all research grounded in direct codebase inspection and live API verification)

## Executive Summary

RateMyPlace is a structured tenant review platform built on Astro 5 SSR + Cloudflare Pages + D1 (SQLite) with React islands for interactivity. v1.4.0 is not a greenfield milestone — it extends a live, audit-clean production system. The recommended approach is entirely additive: no new npm packages are required, all new features compose the existing stack (D1, Resend, Turnstile, React islands, Astro API routes), and four new D1 tables plus one ALTER TABLE migration cover all schema needs. The single most important architectural decision for this milestone is building the city enrichment adapter pattern before adding New Haven support — if the adapter interface is skipped in favor of inline if/else logic, the enrichment endpoint becomes a permanent maintenance burden.

The feature set divides clearly into two tiers. High-urgency work addresses legal exposure (UGC disclaimers with inline consent, CAN-SPAM-compliant notification emails), operational needs (full review content in admin queue, contact form replacing static mailto), and trust gaps that cause real-user abandonment (review status visibility, verification UX). Lower-urgency features — saved buildings, in-app notification tab, New Haven enrichment — extend the platform for engaged users but can be phased after the trust and legal foundations are solid. The dependency graph from ARCHITECTURE.md is the authoritative build order: bug fixes and isolated changes first, schema additions next, the tenant dashboard last because it depends on the notification infrastructure.

The top risk cluster is legal and compliance: missing UGC disclaimers on review pages (not just ToS), notification emails without unsubscribe mechanisms, and contact form submissions without rate limiting represent the three failure modes that cause the most damage per unit of engineering time lost. The good news is all three are well-understood patterns with clear prevention strategies; none require architectural rework if addressed in the right phase order. New Haven API availability was initially flagged as blocked, but STACK.md live-tested the Connecticut state CAMA dataset (`data.ct.gov`) and confirmed it works for New Haven — the blocker is resolved.

## Key Findings

### Recommended Stack

The existing stack is locked and requires no additions. All v1.4.0 features are implementable with: D1 for persistence (4 new migrations), Resend for email (new contact notification template), Turnstile for bot protection (contact form), and React `useState`/`useEffect` for dashboard interactivity (no router library, no state management library, no tab component library).

**Core technologies (all existing):**
- Astro 5 SSR + `@astrojs/cloudflare` — Pages and API routes; runs at Cloudflare edge, handles auth-gated SSR
- React 18 islands (`client:load`) — Interactive dashboard components; Cloudflare Workers constraint locks to React 18
- Cloudflare D1 (SQLite) — All persistence; 4 new tables via migrations 0019–0022
- Lucia v3 — Auth; unchanged; `generateIdFromEntropySize(10)` for ID generation
- Resend — Email; add `sendContactNotificationEmail()` template only
- Cloudflare Turnstile — Bot protection; reuse existing `verifyTurnstile()` for contact form

**Critical version notes:**
- React 19 must not be adopted — Cloudflare Workers runtime does not yet support it
- No new npm packages required for any v1.4.0 feature

**New Haven API (resolved blocker):** STACK.md live-tested `https://data.ct.gov/resource/pqrn-qghw.json` (CT CAMA dataset, Socrata SODA API) and confirmed it works for New Haven with owner name, year built, bedroom/bath count, building type, and condition fields. FEATURES.md marked this blocked based on Vision GIS having no public API — the state CAMA dataset resolves it.

### Expected Features

**Must have — table stakes (P1, v1.4.0):**
- Move-in date seasonal display bug fix — visible data quality issue, erodes trust immediately
- UGC disclaimers — inline consent checkbox on submission + banner on review pages + ToS clause; highest legal risk per unit of effort
- Contact form with D1 storage + Resend admin notification — replaces static mailto links; enables message tracking and admin-accessible log
- Full review content visible in admin pending view — unblocks faster moderation without additional tooling
- Review verification UX overhaul (audit-first) — current VerificationModal trigger logic is unclear; new users leave reviews unpublished by accident
- Tenant dashboard core — review status labels (Pending / Under Review / Published / Rejected), email verification banner with resend CTA, account settings tab
- Section 8 acceptance survey field — high-value signal for Boston's voucher-holder population; aligns with platform public health mission
- Safely lit survey field — maps to PHQS safety domain; 1.2x weight; LOW implementation cost

**Should have — differentiators (P2, v1.4.x):**
- Tenant dashboard: saved buildings tab — simple bookmark list; builds engagement once core dashboard ships
- Tenant dashboard: email notification on review status change — Resend template triggered from admin moderation action
- Multi-city auto-research: Boston adapter refactor + New Haven adapter — adapter pattern is the right architecture even if only Boston ships first

**Defer (v2+):**
- Email notification digests — requires Cloudflare Cron Triggers infrastructure not currently configured
- Verified resident badge — requires R2 file storage or external identity service
- Multi-language support — explicitly deferred in PROJECT.md
- Landlord response to reviews — explicitly excluded; dispute form covers legitimate corrections

**Anti-features to avoid:** WebSocket/SSE real-time notifications (Workers are stateless), mandatory identity verification via file upload (eliminates reviews), user-to-user messaging (breaks anonymity), automatic property data sync on schedule (no cron infrastructure).

### Architecture Approach

All new features follow the additive composition pattern: new `src/lib/` modules, new `src/components/` directories, new API routes under `src/pages/api/dashboard/`, and modification of existing Astro pages to pass additional props to new React islands. The most significant structural addition is `src/lib/enrichment/` — a city adapter module extracted from the current monolithic enrich endpoint. The tenant dashboard is a single React island (`TenantDashboard.tsx`) served from the existing `/profile` route with hash-based tab routing (no router library). Notification creation is best-effort and inline, mirroring the existing `createAuditLog()` pattern.

**Major components:**
1. `src/lib/enrichment/` (new) — `CityAdapter` interface + `boston.ts` + `new-haven.ts` adapters; `index.ts` dispatcher routes by `building.city`
2. `src/components/dashboard/TenantDashboard.tsx` (new) — tabbed island extending existing ProfileDashboard; hash routing for My Reviews / Saved / Notifications tabs
3. `src/components/ui/UGCDisclaimer.astro` (new) — shared static component with `variant` prop; used on 6+ surfaces
4. `src/lib/notifications.ts` (new) — `createNotification()` best-effort helper; called inline from admin review approval/rejection routes
5. `src/pages/api/contact.ts` (new) — POST handler; D1 insert + Resend notification + Turnstile verify + rate limit
6. D1 migrations 0019–0022 — `contact_messages`, `saved_buildings`, `notifications` tables + `section_8_accepted`/`safely_lit` columns on reviews

### Critical Pitfalls

1. **NOT NULL columns on reviews table without DEFAULT** — D1 rejects `ALTER TABLE ... ADD COLUMN col INTEGER NOT NULL` on tables with existing rows unless a DEFAULT is supplied. Use nullable columns (`INTEGER` with no constraint) for new survey fields and skip NULL values in scoring. Prevention: write `ALTER TABLE reviews ADD COLUMN section_8_accepted INTEGER` (nullable, no constraint).

2. **Migration number collisions** — Multiple v1.4.0 features need new migrations. Assign numbers 0019–0022 before writing any SQL; two migrations with the same number causes one to be silently skipped by wrangler. Assign the full plan in the first phase that touches the schema.

3. **Notification emails without unsubscribe** — CAN-SPAM requires one-click unsubscribe for non-purely-transactional emails. "Your review was approved" is borderline. Add `notification_opt_in` column to users + a signed unsubscribe token endpoint before the first notification email ships. Resend account suspension is the failure mode if this is ignored.

4. **UGC disclaimers only in Terms of Service** — Courts require disclaimers in close proximity to the content. ToS-only disclaimers provide weak defamation protection. Disclaimers must appear on `/building/[slug]` review lists and on the review submission form itself.

5. **Dashboard N+1 queries** — A React island calling 4 separate API endpoints on mount (reviews, saved buildings, notifications, verification status) creates N+1 D1 latency. Design a single `/api/dashboard` endpoint returning all needed data with server-side JOINs before building the component.

6. **Contact form without rate limiting** — Without `checkRateLimit()` (already in `src/lib/rateLimit.ts`), spam floods D1 and exhausts Resend free tier (100 emails/day). Apply 3 submissions/hour/IP before the first contact submission reaches real users.

7. **Multi-city adapter as a God Function** — Adding New Haven as an `if (city === 'New Haven')` block in the existing enrich endpoint creates untestable routing logic. Define the `CityAdapter` interface before writing the second adapter, not after.

## Implications for Roadmap

Based on the dependency graph from ARCHITECTURE.md and priority tiers from FEATURES.md, the natural phase structure groups work by what it depends on, not just by feature.

### Phase 1: Foundations and Legal Hardening
**Rationale:** These changes are fully isolated — no new schema, no new APIs, no dependencies on any other v1.4.0 work. Legal exposure (UGC disclaimers) and operational efficiency (admin review view) ship before anything else. This eliminates the most visible trust issues before real users arrive and unblocks faster moderation at launch.
**Delivers:** UGCDisclaimer component deployed on all review surfaces; move-in date bug fixed; admin can see full review content without navigating away from the queue.
**Addresses:** UGC disclaimers (P1 legal), move-in date bug (P1), full review in admin pending view (P1 ops)
**Avoids:** Pitfall 4 (disclaimers only in ToS); no migration risk in this phase
**Research flag:** Standard patterns — no research-phase needed.

### Phase 2: Schema and Survey Fields
**Rationale:** New survey fields (Section 8, safely lit) affect the review submission form and scoring. Stabilizing these before building the tenant dashboard ensures new field data displays correctly when the dashboard renders review details. Migration numbers 0019–0022 get assigned here to prevent collisions in all subsequent phases. Contact form also ships here because its migration (0019) is part of the locked plan.
**Delivers:** Two new survey dimensions collected from new reviews; contact form operational with D1 storage, Resend notification, Turnstile, and rate limiting; migration plan locked for all remaining phases.
**Addresses:** Section 8 P1 feature, safely lit P1 feature, contact form P1 feature
**Avoids:** Pitfall 1 (nullable columns, not NOT NULL), Pitfall 2 (migration number plan locked), Pitfall 7 (rate limit on contact form), Pitfall 3 (unsubscribe on any contact reply emails)
**Research flag:** Standard patterns for survey field additions (5-step checklist in CLAUDE.md). Contact form mirrors bug_reports exactly. No research-phase needed.

### Phase 3: Multi-City Enrichment Adapter Refactor
**Rationale:** The adapter refactor is independent of the dashboard and schema changes. Doing it before the dashboard avoids modifying the enrich endpoint twice. The CT CAMA API is confirmed working — New Haven is unblocked. This phase also establishes the `CityAdapter` interface that future cities will implement.
**Delivers:** `src/lib/enrichment/` module with `CityAdapter` interface; Boston adapter extracted (behavior unchanged, existing Boston enrich still works); New Haven adapter implemented and tested against live CT CAMA API.
**Addresses:** Multi-city auto-research P2 feature
**Avoids:** Pitfall 5 (God Function anti-pattern); integration gotcha of missing AbortController timeout on external calls
**Research flag:** Boston adapter behavior is thoroughly documented — no research needed. New Haven field mapping is confirmed in STACK.md. Skip research-phase.

### Phase 4: Tenant Dashboard Core
**Rationale:** Dashboard depends on the notifications schema (migration 0021) and `createNotification()` being called from admin review routes. Must come after schema phases are stable. This is the highest-complexity user-facing phase.
**Delivers:** `/profile` extended with tabbed `TenantDashboard.tsx`; review status chips with explanatory copy; email verification banner with resend CTA; account settings tab; notifications infrastructure (`createNotification()` helper + admin route integration + `/api/dashboard/notifications` endpoint).
**Addresses:** Tenant dashboard core (P1), in-app notifications infrastructure
**Avoids:** Pitfall 6 (N+1 queries — single `/api/dashboard` endpoint with JOINs), Pitfall 3 (unsubscribe on review status notification emails)
**Research flag:** Verification UX subfeature requires a 30-minute audit of the current `VerificationModal.tsx` and `ProfileDashboard.tsx` trigger logic before any redesign work begins. Flag this as a mandatory audit step before implementation of the verification portion of this phase.

### Phase 5: Tenant Dashboard Extended (Saved Buildings + Verification UX)
**Rationale:** Saved buildings tab requires the dashboard shell from Phase 4. Review verification UX overhaul benefits from the dashboard being stable — the redesigned verification prompt surfaces inline in the dashboard. Both features depend on Phase 4 being settled.
**Delivers:** Saved buildings list in dashboard with bookmark buttons on building pages; verification UX redesigned with inline prompts and "verify to publish" framing replacing the current unclear modal trigger.
**Addresses:** Saved buildings (P2), review verification UX overhaul (P1, deferred to this phase by audit dependency)
**Avoids:** Missing UNIQUE constraint on saved_buildings (`UNIQUE(user_id, building_id)` at DB level); UX pitfall of no undo/confirmation on unsave action
**Research flag:** Verification UX audit must gate implementation — this is not optional. The audit itself is quick but must happen before writing any verification UX spec.

### Phase Ordering Rationale

- Isolated changes first removes noise before feature work begins and ships legal protections before real users arrive.
- Schema plan locked in Phase 2 prevents migration number collisions across all five phases — two different phases trying to claim 0019 is a real risk with four migrations needed.
- Enrichment refactor before dashboard keeps the admin enrichment feature independent and establishes the adapter pattern cleanly without dashboard complexity in parallel.
- Dashboard last because it is the most complex user-facing feature and depends on: notifications schema, `createNotification()` calls wired into admin routes, and (for Phase 5) the saved buildings schema — all prior phases.
- Verification UX at the end because it requires an audit-first approach; the dashboard foundation in Phase 4 makes the redesigned UX surface cleaner and avoids redesigning something that is still in flux.

### Research Flags

Phases needing deeper research or mandatory audit during planning:
- **Phase 4 (Tenant Dashboard Core):** Verification UX subfeature requires auditing current `VerificationModal.tsx` trigger logic before the redesign is specced. Read `src/components/profile/ProfileDashboard.tsx` and `src/components/profile/VerificationModal.tsx` before writing Phase 4 tasks for that feature.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 1:** Astro static components and UI bug fixes — fully covered by project conventions in CLAUDE.md
- **Phase 2:** Survey field additions follow the 5-step checklist in CLAUDE.md; contact form mirrors bug_reports table pattern exactly
- **Phase 3:** Adapter pattern fully specified in ARCHITECTURE.md and STACK.md with working code examples and confirmed live API
- **Phase 5:** Saved buildings is a standard join table; verification UX patterns are known once the audit runs

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technology decisions verified against live codebase and Cloudflare Workers runtime constraints; CT CAMA API live-tested against real New Haven address |
| Features | HIGH | Based on direct codebase inspection + competitor analysis; New Haven API blocker resolved by STACK.md live API test |
| Architecture | HIGH | Based on direct codebase inspection of all relevant files; adapter pattern and dashboard structure fully specified with working code examples |
| Pitfalls | HIGH | Based on direct inspection of migrations 0001–0018, all API routes, scoring.ts, email.ts, rateLimit.ts; legal pitfalls sourced from FTC and Resend official docs |

**Overall confidence:** HIGH

### Gaps to Address

- **New Haven data freshness (MEDIUM concern):** CT CAMA dataset uses 2021 valuation year for assessed values (last statewide revaluation). Owner name data is current per assessor records. Acceptable for human-in-the-loop auto-research, but should be noted in the admin UI alongside New Haven enrichment results. No implementation blocker.

- **Review verification UX current state (must audit before Phase 5):** FEATURES.md notes the current VerificationModal trigger logic is unclear. No implementation should proceed on verification UX redesign until someone reads `ProfileDashboard.tsx` and `VerificationModal.tsx` to document the current state. This gap is intentional — audit gates design.

- **Resend email digest for contact form (design decision needed):** PITFALLS.md recommends batching Resend notifications when more than 5 contact messages arrive in an hour rather than sending one email per submission. The implementation pattern is clear but the batch threshold requires a product decision before Phase 2 implementation.

- **`notification_opt_in` column placement:** Should this be a column on the `users` table (migration required) or a separate `user_preferences` table? PITFALLS.md recommends a users table column for simplicity. Lock this decision before Phase 4 to avoid schema rework.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `migrations/0001–0018`, `src/pages/api/**`, `src/lib/email.ts`, `src/lib/rateLimit.ts`, `src/lib/scoring.ts`, `src/pages/terms.astro`, `src/pages/contact.astro`, `src/components/profile/ProfileDashboard.tsx`, `src/lib/audit.ts`
- Live API test: `https://data.ct.gov/resource/pqrn-qghw.json` — CT CAMA Socrata endpoint confirmed for New Haven with full field schema
- [Cloudflare D1 SQL API docs](https://developers.cloudflare.com/d1/sql-api/d1-sql-api/) — NOT NULL ALTER TABLE constraint behavior
- [Cloudflare Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/) — stateless runtime, AbortController necessity
- [CAN-SPAM Act FTC compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) — unsubscribe requirements
- [Resend anti-spam policy](https://resend.com/legal/anti-spam-policy) — account suspension triggers
- [Astro Islands Architecture docs](https://docs.astro.build/en/concepts/islands/) — cross-island context sharing constraints
- [HUD pilot study on landlord Section 8 acceptance](https://www.huduser.gov/portal/pilot-study-landlord-acceptance-hcv.html) — voucher acceptance rates and policy context
- [2024 CT Parcel and CAMA Data catalog](https://catalog.data.gov/dataset/2024-connecticut-parcel-and-cama-data) — dataset scope and confirmed New Haven coverage

### Secondary (MEDIUM confidence)
- [ApartmentRatings FAQ](https://www.apartmentratings.com/faq/) — competitor "My Reviews" dashboard patterns
- [UGC legal checklist — cobrief.app](https://www.cobrief.app/resources/business-checklist-library/legal-issues-with-user-generated-content-free-checklist/) — inline disclaimer proximity guidance
- [TermsFeed — UGC social media legal requirements](https://www.termsfeed.com/blog/user-generated-content-social-media/) — consent at submission patterns
- [Real estate adapter pattern — batchdata.io](https://batchdata.io/blog/apis-real-estate-data-enrichment) — multi-source enrichment adapter structure
- [Contact form storage best practices](https://www.zoho.com/forms/contact-forms/best-practices.html) — D1 as primary, email as secondary delivery
- [WBEZ Section 8 refusal investigation 2025](https://www.wbez.org/data/2025/05/14/section-8-renters-say-landlords-routinely-reject-their-housing-choice-vouchers) — voucher refusal prevalence

### Tertiary (LOW confidence)
- [New Haven Vision GIS portal](https://gis.vgsi.com/newhavenct/) — no public API found; CT CAMA state dataset resolved the blocker; Vision GIS endpoint remains undocumented

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*
