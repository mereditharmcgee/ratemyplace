# Feature Research

**Domain:** Tenant housing review platform — v1.4.0 "Open Doors" milestone
**Researched:** 2026-03-20
**Confidence:** MEDIUM-HIGH (competitor patterns from live sites; New Haven API availability is LOW confidence — blocked)

## Context

This is a subsequent milestone research doc. The platform already ships:
- 27-item structured review survey with weighted scoring
- Google OAuth + email/password auth with email verification
- Admin moderation dashboard (9 pages)
- Landlord dispute form + admin queue
- Boston-only auto-research via City of Boston Assessing API (CKAN/Socrata)
- Basic profile page at `/profile` with `ProfileDashboard.tsx` (review list + verification modal)
- Contact page at `/contact` with static mailto links — no form, no storage
- Bug report form with D1 storage + Turnstile

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist on any review platform. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| See my submitted reviews with clear status | Every review platform has "My Reviews"; "where did my review go?" is the #1 support question | LOW | Infrastructure exists (ProfileDashboard shows review list) — UX clarity is missing |
| Know what happens after I submit | Review moderation is invisible; creates abandonment and confusion | LOW | Pending/approved/rejected status already in DB; surface with readable labels and explanatory copy |
| Email verification status is visible | If email verification is required to publish, users must be able to see their state | LOW | VerificationModal exists; trigger UX is unclear from current code |
| UGC disclaimer on review submission | Legal standard: users must consent before posting; Section 230 protection depends on this | LOW | Missing from submission flow entirely — highest legal risk per unit of effort |
| UGC disclaimer on review display pages | Readers need to know content is user-submitted and unverified | LOW | Missing from building/landlord profile pages |
| Contact form (not just mailto links) | Modern platforms don't use raw mailto — it leaks email, abandons message tracking, breaks on mobile | MEDIUM | Current `/contact` is static mailto only; needs D1 storage + Resend notification |
| Section 8 acceptance visible | Critical for voucher holders — 1 in 3 Boston-area landlords reportedly refuse; high-value signal | MEDIUM | New survey field; requires migration + survey form update + landlord profile display |

### Differentiators (Competitive Advantage)

Features that set RateMyPlace apart. These map to the platform's public-health research mission.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Section 8 acceptance as crowdsourced data | Competitors list apartments but don't crowdsource voucher acceptance; high value for Boston's subsidized housing population | MEDIUM | Tenant-reported (not verified) — needs inline disclosure on landlord profile |
| Safely lit survey field | Lighting safety is a validated housing quality dimension (PHQS); no competitor captures it at the survey level | LOW | New survey field + migration; clear weight assignment (1.2x, safety-adjacent) |
| Multi-city auto-research via adapter pattern | Boston-only enrichment limits geographic expansion; abstracted adapters unlock future cities without rewriting the feature | HIGH | Boston adapter works today; New Haven BLOCKED (no public API found — see notes) |
| Tenant dashboard with verification status | Most apartment review sites have no real logged-in experience; surfacing "your review is pending" reduces admin load | MEDIUM | Extends existing `/profile` — add clear status states, resend email CTA, verification banner |
| Full review content in admin pending view | Operational: admins currently can't moderate without navigating away from the queue — slows review throughput at launch | LOW | Admin-side only; no user-facing change; high value for a platform with manual moderation |
| Review verification UX overhaul | Current flow: modal appears with no context about why verification matters. Better: inline prompts, "verify to publish" framing | MEDIUM | Audit current flow first (understand what's broken), then redesign prompt sequence |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time review status notifications (WebSockets/SSE) | "Notify me when my review is approved" feels modern | Cloudflare Workers has no persistent connections; polling is unnecessary complexity at this scale | Email notification via Resend when review transitions to approved/rejected — simpler, more reliable, already has Resend wired |
| Saved buildings with complex alert rules | "Watch this building for new reviews" | Requires background job scheduler — not available on Cloudflare Workers without Cron Triggers + significant schema work | Simple saved/bookmarked buildings list with manual re-check first; email digests deferred to v2 |
| Landlord response to reviews | Landlords want to rebut negative reviews | Explicitly excluded in PROJECT.md; creates adversarial UX and chilling effect on tenant honesty | Dispute form already exists for legitimate factual corrections |
| Verified resident badge via file upload | "Prove you lived there" via lease or utility bill | File storage requires R2 setup (not in current stack); high privacy risk; systems like this are gameable | Email-domain verification (e.g., `.edu` for student housing) as a lightweight proxy signal; keep existing lease-date range self-report |
| User-to-user messaging | "Contact the reviewer" | Completely breaks anonymity — the platform's core trust mechanism | All contact routes through the RateMyPlace contact form; reviewer identity stays protected |
| Automatic property data sync on a schedule | Keep city assessor data fresh automatically | No cron job infrastructure currently; data freshness is secondary to data existence at this stage | Human-in-the-loop auto-research (already built for Boston) is the right pattern; keep it |
| Mandatory identity verification before review | "Require proof of residency" | Would eliminate most reviews; creates barrier that competitors don't have; enforcement is impossible without file upload | Keep email verification as the gate; add strong UGC disclaimers to manage expectations |

---

## Feature Dependencies

```
[Contact Form with D1 Storage]
    └──requires──> [Resend email integration] (already exists)
    └──requires──> [D1 contact_submissions table] (new migration needed)
    └──enhances──> [Admin dashboard] (new "Contact" tab or section)

[Tenant Dashboard — Core]
    └──requires──> [ProfileDashboard.tsx exists] (already exists)
    └──extends with──> [clear status chips + verification banner + resend CTA]
    └──enhances──> [Review Verification UX] (dashboard surface for verification prompt)

[Tenant Dashboard — Extended: Saved Buildings]
    └──requires──> [Tenant Dashboard Core] (build core first)
    └──requires──> [saved_buildings table] (new migration)
    └──enhances──> [Building Profile Pages] (save/bookmark button)

[Review Verification UX Overhaul]
    └──requires──> [audit of current VerificationModal flow] (understand state before changing)
    └──enhances──> [Tenant Dashboard Core] (dashboard surfaces verification prompt inline)

[Multi-city Auto-Research]
    └──requires──> [Boston adapter refactor] (extract current Boston logic to CityAdapter interface)
    └──requires──> [New Haven API feasibility spike] (BLOCKED — no public API found; Vision GIS has no documented endpoint)

[Section 8 Survey Field]
    └──requires──> [new migration] (add section_8_accepted column to reviews)
    └──requires──> [surveyItems.ts update]
    └──requires──> [ReviewForm.tsx update]
    └──enhances──> [Landlord profile page] (display aggregated acceptance percentage)

[Safely Lit Survey Field]
    └──requires──> [new migration] (add safely_lit column to reviews)
    └──requires──> [surveyItems.ts update]
    └──enhances──> [scoring.ts] (building dimension, 1.2x weight)

[UGC Disclaimers]
    └──no hard dependencies──> standalone additions
    └──enhances──> [Review submission form] (consent checkbox before submit button)
    └──enhances──> [Building/landlord profile pages] (disclaimer banner)
    └──enhances──> [Terms of Service page] (add UGC clause)

[Move-in Date Seasonal Display Bug]
    └──no dependencies──> isolated bug fix in date formatting logic
```

### Dependency Notes

- **Tenant dashboard extended requires core first:** Do not build the saved buildings tab before the core dashboard (status + verification + settings) is stabilized. Adding scope to a broken UX creates compounding rework.
- **Multi-city auto-research is partially blocked:** New Haven does not appear to have a public CKAN/Socrata API. Vision Government Solutions at `gis.vgsi.com/newhavenct/` is a web UI with no documented public API endpoint. The Boston adapter refactor (extracting the interface) is unblocked and should ship in v1.4.0. New Haven implementation requires a separate feasibility spike.
- **Review verification UX requires audit first:** The current `VerificationModal` is triggered from `ProfileDashboard.tsx` but the trigger logic and copy framing are unclear. An audit must precede redesign to avoid breaking the flow for already-verified users.
- **UGC disclaimers are fully independent:** No runtime dependencies on any other v1.4.0 feature. Highest legal risk mitigation per unit of effort — do these early.
- **Survey fields share a migration pattern:** Section 8 and safely lit can be added in the same migration file (`0019_new_survey_fields.sql`) to minimize migration count.

---

## MVP Definition (v1.4.0 scope)

### Launch With (v1.4.0)

These unblock real-user launch or carry legal/trust risk if absent.

- [ ] Fix move-in date seasonal display bug — visible data quality issue; erodes trust on first impression
- [ ] UGC disclaimers (submission flow consent + review display pages + ToS update) — legal requirement; Section 230 protection; no other feature matters if this is missing
- [ ] Contact form with D1 storage + Resend notification — replaces static mailto; creates admin-accessible message log; enables real user support
- [ ] Full review content in admin pending view — unblocks faster moderation at launch without additional tooling
- [ ] Review verification UX improvements (audit first, then implement) — current flow has unclear trigger; new users will be confused and leave reviews unpublished
- [ ] Tenant dashboard core (review status labels, email verification status, resend CTA, account settings) — users need self-service; eliminates support requests on "where is my review"
- [ ] Section 8 acceptance survey field — high-value for Boston's subsidized housing population; public health mission alignment
- [ ] Safely lit survey field — maps to PHQS safety domain; low effort, meaningful signal
- [ ] Multi-city auto-research: Boston adapter refactor only — New Haven deferred

### Add After Validation (v1.x)

- [ ] Tenant dashboard extended: saved buildings list — add once core dashboard has real usage data
- [ ] Tenant dashboard: email notification on review status change — Resend template + trigger in admin moderation action; low complexity but non-essential for launch
- [ ] New Haven auto-research — blocked on API availability; requires feasibility spike first

### Future Consideration (v2+)

- [ ] Email notification digests (weekly saved-building activity) — requires Cloudflare Cron Triggers infrastructure
- [ ] Verified resident badge — requires R2 file storage or external identity service
- [ ] Multi-language support — in PROJECT.md as v2.0 deferred
- [ ] Landlord response features — explicitly excluded in PROJECT.md

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Move-in date bug fix | MEDIUM | LOW | P1 |
| UGC disclaimers | HIGH (legal) | LOW | P1 |
| Contact form + D1 storage | MEDIUM | MEDIUM | P1 |
| Full review content in admin pending view | HIGH (ops) | LOW | P1 |
| Review verification UX audit + fix | HIGH | MEDIUM | P1 |
| Tenant dashboard — core | HIGH | MEDIUM | P1 |
| Section 8 survey field | HIGH | LOW | P1 |
| Safely lit survey field | MEDIUM | LOW | P1 |
| Multi-city auto-research (Boston refactor only) | MEDIUM | MEDIUM | P2 |
| Tenant dashboard — saved buildings | MEDIUM | MEDIUM | P2 |
| Tenant dashboard — email notifications | LOW | LOW | P2 |
| New Haven auto-research | LOW | HIGH (blocked) | P3 |

**Priority key:**
- P1: Must have for v1.4.0 launch
- P2: Add once P1 features are shipping and stable
- P3: Defer until infrastructure or API is available

---

## Competitor Feature Analysis

Platforms in the tenant-review or housing-review space, patterns observed from public UIs.

| Feature | ApartmentRatings.com | Zillow/Apartments.com | Our Approach |
|---------|---------------------|----------------------|--------------|
| Tenant dashboard | "My Reviews" control panel with edit/delete | "Saved homes" list; no review management | Full dashboard: review status + verification state + settings + (later) saved buildings |
| Review status visibility | Not visible after submission | N/A (no moderation queue) | Explicit status chips: Pending / Under Review / Published / Rejected with copy explaining each state |
| Review verification | Account creation only; no tenancy proof | None | Email-domain verification + lease date self-report (existing); UX overhaul in v1.4.0 |
| UGC disclaimers | Inline text on review pages ("reviews reflect individual opinions") | ToS-gated consent on submission | Both: consent checkbox on submit + banner on display pages |
| Contact mechanism | Standard web form | Help center + web form | Web form with D1 storage + Resend admin notification + Turnstile protection |
| Section 8 info | Not captured | Listing field (landlord-controlled, biased) | Crowdsourced tenant-reported — more honest signal than landlord-reported |
| Property data enrichment | None | Zillow proprietary data | City open-data APIs with human-in-the-loop review |
| Saved/bookmarked properties | Not present | Core feature | Simple save list in v1.4.x; no complex alerts |

---

## Implementation Notes by Feature

### UGC Disclaimers
Three additions, no new pages:
1. Consent checkbox on review submission form: "I certify this reflects my genuine experience and I agree to the [Community Guidelines]" — must be checked to enable submit button.
2. Disclaimer banner on building/landlord profile pages: "Reviews are submitted by community members and reflect individual experiences. RateMyPlace does not verify tenancy."
3. UGC clause added to existing `/terms` page (not a new page).

### Contact Form
Pattern: POST to `/api/contact` → insert into `contact_submissions` D1 table → trigger Resend email to admin with subject + message preview. Fields: subject (dropdown: General / Privacy / Press / Bug / Other), message (textarea), optional name, email (pre-filled if logged in). Add Turnstile (already used on bug report form — reuse that pattern). Add submissions list to admin dashboard (new tab or existing admin section).

### Tenant Dashboard — Core
Existing `/profile` + `ProfileDashboard.tsx` already shows review list. Additions:
1. Status chips on each review: Pending / Under Review / Published / Rejected with 1-line explanation per state.
2. Prominent email verification banner at top when `emailVerified === false` with inline resend button.
3. Account settings tab: change display name, delete account request.
No new page — extend existing component with tabs.

### Tenant Dashboard — Extended (Saved Buildings)
New `saved_buildings` table: `(id, user_id, building_id, created_at)`. Save/unsave button on building profile pages. Dashboard "Saved" tab lists buildings with current score and address. No notifications in this iteration.

### Review Verification UX
Audit required first. Current state: `VerificationModal` appears when user clicks a "Verify" button on a review list item in ProfileDashboard. Questions to answer before redesigning: Is the modal triggered automatically for unverified reviews? What copy does it show? Is there any prompt for users who haven't submitted verification? After audit: add inline banner at top of review list when any review is unverified, with copy explaining verification increases credibility and prevents removal during moderation.

### Multi-City Auto-Research (Adapter Pattern)
Boston implementation lives inline in `/api/admin/buildings/[id]/enrich`. Refactor: extract a `CityAdapter` interface with `enrich(address: string): Promise<EnrichmentResult>`. Boston adapter wraps existing CKAN logic unchanged. New Haven adapter: **blocked** — Vision Government Solutions at `gis.vgsi.com/newhavenct/` has no documented public API. Options: (a) contact New Haven city plan dept for data access, (b) defer and ship Boston refactor only. Recommendation: ship adapter abstraction + Boston adapter in v1.4.0; New Haven as a post-launch spike.

### New Survey Fields
Both follow the established pattern: migration → `surveyItems.ts` → `scoring.ts` domain array + weight → `ReviewForm.tsx` → `ReviewCard.astro`.
- **Section 8 acceptance**: Boolean on landlord dimension (does this landlord accept housing vouchers?). Display on landlord profile as "X% of reviewers reported this landlord accepts Section 8." Weight: 1.0x (policy factor, not health/safety). Inline disclosure: "Based on tenant reports — not officially verified."
- **Safely lit**: Boolean on building dimension (are exterior and common areas adequately lit at night?). Weight: 1.2x (safety-adjacent; aligns with PHQS safety domain). Can go in same migration as Section 8.

### Move-in Date Seasonal Display Bug
Isolated fix. Bug is in date formatting/display logic — likely a timezone offset issue causing dates to show as the prior month when `move_in_month` is rendered. Fix in the component that formats month/year display; no schema change needed.

---

## Sources

- [ApartmentRatings FAQ — "My Reviews" control panel](https://www.apartmentratings.com/faq/) — MEDIUM confidence
- [ApartmentRatings platform overview 2026](https://rentalrealestate.com/tools/apartmentratings/) — MEDIUM confidence
- [UGC legal checklist — key disclaimer components](https://www.cobrief.app/resources/business-checklist-library/legal-issues-with-user-generated-content-free-checklist/) — MEDIUM confidence
- [TermsFeed — UGC social media legal requirements](https://www.termsfeed.com/blog/user-generated-content-social-media/) — MEDIUM confidence
- [New Haven Vision GIS portal — no public API found](https://gis.vgsi.com/newhavenct/) — LOW confidence (absence of evidence)
- [New Haven Assessor's Office](https://www.newhavenct.gov/government/departments-divisions/assessor-s-office) — MEDIUM confidence
- [HUD pilot study on landlord Section 8 acceptance](https://www.huduser.gov/portal/pilot-study-landlord-acceptance-hcv.html) — HIGH confidence (official HUD research)
- [Section 8 landlord refusal patterns — WBEZ Chicago investigation 2025](https://www.wbez.org/data/2025/05/14/section-8-renters-say-landlords-routinely-reject-their-housing-choice-vouchers) — MEDIUM confidence
- [Real estate adapter pattern for multi-source data enrichment](https://batchdata.io/blog/apis-real-estate-data-enrichment) — MEDIUM confidence
- [Contact form storage best practices 2026](https://www.zoho.com/forms/contact-forms/best-practices.html) — MEDIUM confidence
- [Identity verification async UX pattern](https://lumitech.co/insights/design-secure-id-systems) — MEDIUM confidence
- Existing codebase inspection: `src/pages/contact.astro`, `src/components/profile/ProfileDashboard.tsx`, `src/pages/profile.astro`, `migrations/` — HIGH confidence (direct observation)

---

*Feature research for: RateMyPlace — v1.4.0 "Open Doors" milestone*
*Researched: 2026-03-20*
