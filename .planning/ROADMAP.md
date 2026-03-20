# Roadmap: RateMyPlace Boston

**Created:** 2026-02-26

## Milestones

- ✅ **v1.2.1 Email Verification** — Phase 1 (shipped 2026-02-26)
- ✅ **v1.2.2 Launch Ready** — Phases 2-3 (shipped 2026-02-27)
- ✅ **v1.3.0 Battle Tested** — Phases 4-9 (shipped 2026-03-10)
- 🚧 **v1.4.0 Open Doors** — Phases 10-14 (in progress)

## Phases

<details>
<summary>✅ v1.2.1 Email Verification (Phase 1) — SHIPPED 2026-02-26</summary>

- [x] Phase 1: Email Verification (4/4 plans) — completed 2026-02-26

See: `.planning/milestones/v1.2.1-ROADMAP.md`

</details>

<details>
<summary>✅ v1.2.2 Launch Ready (Phases 2-3) — SHIPPED 2026-02-27</summary>

- [x] Phase 2: Landlord Disputes (3/3 plans) — completed 2026-02-27
- [x] Phase 3: Security Hardening (3/3 plans) — completed 2026-02-27

See: `.planning/milestones/v1.2.2-ROADMAP.md`

</details>

<details>
<summary>✅ v1.3.0 Battle Tested (Phases 4-9) — SHIPPED 2026-03-10</summary>

- [x] Phase 4: Database Foundation (3/3 plans) — completed 2026-02-28
- [x] Phase 5: Seed Data (2/2 plans) — completed 2026-02-28
- [x] Phase 6: Playwright Local Environment (2/2 plans) — completed 2026-02-28
- [x] Phase 7: Auth and Review E2E (3/3 plans) — completed 2026-02-28
- [x] Phase 8: Admin and Disputes E2E (3/3 plans) — completed 2026-03-01
- [x] Phase 9: Security E2E (2/2 plans) — completed 2026-03-10
- [~] Phase 10: Stress Testing — skipped (deferred)

See: `.planning/milestones/v1.3-ROADMAP.md`

</details>

### 🚧 v1.4.0 Open Doors (In Progress)

**Milestone Goal:** Make the platform ready for real users with proper trust infrastructure, self-service tools, and public health survey improvements.

#### Phase Checklist

- [ ] **Phase 10: Foundations and Legal Hardening** - UGC disclaimers, move-in date bug fix, and full review content in admin queue
- [ ] **Phase 11: Schema, Survey Fields, and Contact Form** - Two new survey dimensions, contact form with D1 storage and Resend notifications, migration plan locked for milestone
- [ ] **Phase 12: Multi-City Enrichment Adapter** - CityAdapter interface extracted, Boston adapter refactored, New Haven adapter implemented
- [ ] **Phase 13: Tenant Dashboard Core** - Review status visibility, verification banner, account settings, and in-app notifications infrastructure
- [ ] **Phase 14: Saved Buildings and Verification UX** - Building bookmarks in dashboard, redesigned verification flow with inline prompts

## Phase Details

### Phase 10: Foundations and Legal Hardening
**Goal**: The platform is legally hardened for real users and admins can moderate efficiently without navigating away from the queue
**Depends on**: Nothing (first phase of v1.4.0)
**Requirements**: UGC-01, UGC-02, UGC-03, UGC-04, ADMIN-01, ADMIN-02, ADMIN-03, FIX-01
**Success Criteria** (what must be TRUE):
  1. Every page showing review content displays a UGC disclaimer in close proximity to that content
  2. The review submission form requires users to check an acknowledgment checkbox before submitting
  3. The Terms of Service page includes Section 230 safe harbor language, content responsibility clause, and removal policy
  4. Admin can expand any pending review inline and see all fields (ratings, text, photos, verification status, user info) plus approve/reject without leaving the list
  5. Move-in dates display the correct season label (December 2025 shows "Winter 2025" not "Winter 2026")
**Plans**: 3 plans

Plans:
- [ ] 10-01-PLAN.md — UGC disclaimer component, ToS expansion, and About page reframing
- [ ] 10-02-PLAN.md — Consent checkbox update and admin review inline expansion
- [ ] 10-03-PLAN.md — Move-in date season/year bug fix

### Phase 11: Schema, Survey Fields, and Contact Form
**Goal**: Two new public health survey dimensions are collected from new reviews, a working contact form replaces the static mailto link, and all migration numbers for the milestone are pre-assigned to prevent collisions
**Depends on**: Phase 10
**Requirements**: SURVEY-01, SURVEY-02, SURVEY-03, CONTACT-01, CONTACT-02, CONTACT-03, CONTACT-04
**Success Criteria** (what must be TRUE):
  1. New review form shows Section 8 / Housing Choice Voucher acceptance question (yes/no/unsure) and "safely lit at night" question
  2. New field responses display on public review cards; older reviews without data show no field rather than a blank/null value
  3. Contact page has a working form with category dropdown, submits successfully, and submitter receives a confirmation email
  4. Admin panel shows contact submissions alongside bug reports
  5. Contact form rejects submissions without a valid Turnstile token and enforces rate limiting (3 per hour per IP)
**Plans**: TBD

Plans:
- [ ] 11-01: Migration plan lock (pre-assign 0019-0022) and survey field migrations + form wiring
- [ ] 11-02: Contact form page, API route, D1 storage, Resend notifications, and admin panel integration

### Phase 12: Multi-City Enrichment Adapter
**Goal**: The auto-research feature routes to the correct city data source based on building location, Boston behavior is unchanged, New Haven enrichment works, and the architecture supports future cities without code duplication
**Depends on**: Phase 10
**Requirements**: FIX-02, ENRICH-01, ENRICH-02, ENRICH-03, ENRICH-04
**Success Criteria** (what must be TRUE):
  1. Admin clicking "Auto-Research" on a Boston building returns Boston Assessing API data (same behavior as before)
  2. Admin clicking "Auto-Research" on a New Haven building returns CT CAMA dataset fields (owner name, year built, building type)
  3. Admin clicking "Auto-Research" on an unsupported city sees "no auto-research data available" message instead of an error or empty result
  4. The enrichment code uses a CityAdapter interface that future cities can implement without modifying the dispatcher
**Plans**: TBD

Plans:
- [ ] 12-01: CityAdapter interface, Boston adapter extraction, and enrichment dispatcher
- [ ] 12-02: New Haven adapter implementation and unsupported-city fallback

### Phase 13: Tenant Dashboard Core
**Goal**: Logged-in tenants can see the status of all their reviews, verify their email from the dashboard, manage account settings, and receive in-app notifications when review status changes
**Depends on**: Phase 11
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-06, DASH-07
**Success Criteria** (what must be TRUE):
  1. Logged-in user sees all submitted reviews with status labels (Pending / Approved / Rejected / Disputed) on their profile page
  2. Approved reviews link to the live review; rejected reviews show the rejection reason and an option to edit and resubmit
  3. Dashboard shows email verification status with a banner and resend CTA if not yet verified
  4. User can update their display name and notification preferences from the dashboard settings tab
  5. Notification indicator appears in the site header when unread notifications exist; notification tab shows review status change events
**Plans**: TBD

Plans:
- [ ] 13-01: Dashboard API endpoint (single JOIN query), TenantDashboard React island scaffold, review status tab
- [ ] 13-02: Verification banner, account settings tab, notification schema (migration 0021), createNotification() helper wired into admin review routes
- [ ] 13-03: Notifications tab, header indicator, and CAN-SPAM-compliant notification email template

### Phase 14: Saved Buildings and Verification UX
**Goal**: Users can bookmark buildings and see them in a saved list, and the verification flow is clear enough that users complete it without confusion
**Depends on**: Phase 13
**Requirements**: DASH-05, VERIFY-01, VERIFY-02, VERIFY-03, VERIFY-04
**Success Criteria** (what must be TRUE):
  1. Building pages show a bookmark button; logged-in users can save and unsave buildings, and saved buildings appear in a dashboard tab
  2. The value of verification is explained inline (e.g., "Verified reviews are weighted more heavily and display a trust badge")
  3. After submitting a review, users see a clear prompt to verify if they have not already done so
  4. Verified reviews are visually distinguished from unverified reviews on building pages (badge or indicator)
  5. The verification flow completes without navigating to a confusing intermediate state (audit of current VerificationModal must gate implementation)
**Plans**: TBD

Plans:
- [ ] 14-01: Saved buildings migration (0022), API routes, bookmark button on building pages, and saved tab in dashboard
- [ ] 14-02: Verification UX audit, redesigned inline verification prompt, and verified review visual distinction

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Email Verification | v1.2.1 | 4/4 | Complete | 2026-02-26 |
| 2. Landlord Disputes | v1.2.2 | 3/3 | Complete | 2026-02-27 |
| 3. Security Hardening | v1.2.2 | 3/3 | Complete | 2026-02-27 |
| 4. Database Foundation | v1.3.0 | 3/3 | Complete | 2026-02-28 |
| 5. Seed Data | v1.3.0 | 2/2 | Complete | 2026-02-28 |
| 6. Playwright Local Environment | v1.3.0 | 2/2 | Complete | 2026-02-28 |
| 7. Auth and Review E2E | v1.3.0 | 3/3 | Complete | 2026-02-28 |
| 8. Admin and Disputes E2E | v1.3.0 | 3/3 | Complete | 2026-03-01 |
| 9. Security E2E | v1.3.0 | 2/2 | Complete | 2026-03-10 |
| 10. Stress Testing | 2/3 | In Progress|  | -- |
| 10. Foundations and Legal Hardening | v1.4.0 | 0/3 | Not started | - |
| 11. Schema, Survey Fields, and Contact Form | v1.4.0 | 0/2 | Not started | - |
| 12. Multi-City Enrichment Adapter | v1.4.0 | 0/2 | Not started | - |
| 13. Tenant Dashboard Core | v1.4.0 | 0/3 | Not started | - |
| 14. Saved Buildings and Verification UX | v1.4.0 | 0/2 | Not started | - |

---
*Roadmap updated: 2026-03-20 — Phase 10 plans finalized (3 plans, 1 wave)*
