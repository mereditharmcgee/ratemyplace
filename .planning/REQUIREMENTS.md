# Requirements: RateMyPlace Boston

**Defined:** 2026-03-20
**Core Value:** Tenants can submit honest, anonymous reviews and see aggregated scores for buildings and landlords

## v1.4.0 Requirements

Requirements for milestone v1.4.0 "Open Doors". Each maps to roadmap phases.

### Bug Fixes

- [ ] **FIX-01**: Move-in dates display correct season/year labels including winter month edge cases (Dec 2025 = Winter 2025, not Winter 2026)
- [ ] **FIX-02**: Admin auto-research routes to correct city data source based on building location instead of always querying Boston

### Multi-City Enrichment

- [ ] **ENRICH-01**: Enrichment endpoint uses adapter pattern with a common `CityAdapter` interface for city-specific data sources
- [ ] **ENRICH-02**: Boston adapter extracted from existing monolithic `enrich.ts` endpoint
- [ ] **ENRICH-03**: New Haven adapter queries CT CAMA state dataset (`data.ct.gov`, resource `pqrn-qghw`)
- [ ] **ENRICH-04**: Unsupported cities display "no auto-research data available" instead of failing silently

### Admin Improvements

- [ ] **ADMIN-01**: Admin can read complete review content inline from the pending reviews list without navigating away
- [ ] **ADMIN-02**: All review fields visible in expanded view: ratings, text responses, photos, verification status, user info
- [ ] **ADMIN-03**: Approve/reject actions accessible from the expanded review view

### UGC Disclaimers

- [ ] **UGC-01**: Visible disclaimer on all pages that display review content (building pages, review cards)
- [ ] **UGC-02**: Review submission flow includes acknowledgment checkbox that review is personal experience
- [ ] **UGC-03**: Terms of Service includes standard UGC platform protections (Section 230 safe harbor, content responsibility, removal policy)
- [ ] **UGC-04**: About page clearly frames platform role (hosts tenant experiences, not a rating agency)

### Contact Form

- [ ] **CONTACT-01**: Contact page has a working form with name, email, category dropdown (general, privacy, support, landlord), message body
- [ ] **CONTACT-02**: Submissions stored in D1 (`contact_messages` table) with notification email via Resend to appropriate @ratemyplace.org address
- [ ] **CONTACT-03**: Submitter receives confirmation email acknowledging receipt
- [ ] **CONTACT-04**: Contact submissions visible in admin panel alongside bug reports

### Verification UX

- [ ] **VERIFY-01**: Verification option is clearly visible during or after review submission
- [ ] **VERIFY-02**: Value of verification is communicated to users (why bother verifying?)
- [ ] **VERIFY-03**: Verification flow is completable without confusion
- [ ] **VERIFY-04**: Verified reviews are visually distinguished on public-facing pages

### Tenant Dashboard

- [ ] **DASH-01**: Logged-in user can view all their submitted reviews with status (pending/approved/rejected/disputed)
- [ ] **DASH-02**: Approved reviews link to live review; rejected reviews show reason and option to edit/resubmit
- [ ] **DASH-03**: Dashboard shows verification status with clear path to verify if not yet verified
- [ ] **DASH-04**: Basic account settings accessible from dashboard (display name, email, notification preferences)
- [ ] **DASH-05**: User can save/bookmark buildings and view saved buildings in dashboard
- [ ] **DASH-06**: User receives in-app notifications for review status changes (approved, rejected, disputed)
- [ ] **DASH-07**: Notification indicator visible in nav/header

### Survey Fields

- [ ] **SURVEY-01**: Review form includes Section 8 / Housing Choice Voucher acceptance question (yes/no/unsure)
- [ ] **SURVEY-02**: Review form includes "safely lit at night" question for building and surrounding area
- [ ] **SURVEY-03**: New fields displayed on public review cards (omitted for older reviews without data)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Survey Fields (Deferred)

- **SURVEY-D01**: Renter experience level context field (first-time, new to city, experienced)
- **SURVEY-D02**: Discrimination experience questions (needs careful question design with expert review)
- **SURVEY-D03**: Noise contextualization UX (neighborhood baseline comparison)
- **SURVEY-D04**: Proximity to public transportation (auto-populated from transit API)

### Platform

- **PLAT-D01**: Multi-language support
- **PLAT-D02**: Landlord response/rebuttal features on reviews

## Out of Scope

| Feature | Reason |
|---------|--------|
| Art/asset generation (plant PNGs) | Non-code task, managed separately in Recraft |
| Press/marketing content | Managed in Claude.ai, not Claude Code |
| Stress testing (deferred from v1.3.0) | Lower priority than user-facing features |
| Real-time push notifications | Cloudflare Workers stateless; polling sufficient for v1.4.0 |
| Email unsubscribe management | Track in v1.5.0 before scaling notification emails |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 10 | Pending |
| FIX-02 | Phase 12 | Pending |
| ENRICH-01 | Phase 12 | Pending |
| ENRICH-02 | Phase 12 | Pending |
| ENRICH-03 | Phase 12 | Pending |
| ENRICH-04 | Phase 12 | Pending |
| ADMIN-01 | Phase 10 | Pending |
| ADMIN-02 | Phase 10 | Pending |
| ADMIN-03 | Phase 10 | Pending |
| UGC-01 | Phase 10 | Pending |
| UGC-02 | Phase 10 | Pending |
| UGC-03 | Phase 10 | Pending |
| UGC-04 | Phase 10 | Pending |
| CONTACT-01 | Phase 11 | Pending |
| CONTACT-02 | Phase 11 | Pending |
| CONTACT-03 | Phase 11 | Pending |
| CONTACT-04 | Phase 11 | Pending |
| VERIFY-01 | Phase 14 | Pending |
| VERIFY-02 | Phase 14 | Pending |
| VERIFY-03 | Phase 14 | Pending |
| VERIFY-04 | Phase 14 | Pending |
| DASH-01 | Phase 13 | Pending |
| DASH-02 | Phase 13 | Pending |
| DASH-03 | Phase 13 | Pending |
| DASH-04 | Phase 13 | Pending |
| DASH-05 | Phase 14 | Pending |
| DASH-06 | Phase 13 | Pending |
| DASH-07 | Phase 13 | Pending |
| SURVEY-01 | Phase 11 | Pending |
| SURVEY-02 | Phase 11 | Pending |
| SURVEY-03 | Phase 11 | Pending |

**Coverage:**
- v1.4.0 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 — traceability complete, 31/31 requirements mapped to phases 10-14*
