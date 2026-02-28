# Requirements: RateMyPlace v1.3.0 "Battle Tested"

**Defined:** 2026-02-27
**Core Value:** Comprehensive QA to ensure every user flow works, edge cases are handled, and the site is production-ready

## v1 Requirements

### Test Infrastructure

- [x] **INFRA-01**: Local D1 database can be reset, migrated, and seeded with a single npm command
- [x] **INFRA-02**: Seed script populates realistic data: 30 buildings, 10 landlords, 100+ reviews, 3 test users, 10 disputes
- [ ] **INFRA-03**: Seeded data includes pre-computed building and landlord aggregate scores
- [ ] **INFRA-04**: Playwright runs against local dev server (not production URL)
- [ ] **INFRA-05**: Playwright auth fixtures create reusable sessions for regular user and admin user

### E2E - Auth & Reviews

- [ ] **E2E-01**: User can sign up with email/password through the full form flow
- [ ] **E2E-02**: User can sign in, and sign out successfully
- [ ] **E2E-03**: User can submit a complete 27-field review through the multi-step form
- [ ] **E2E-04**: Review form validates required fields and rejects invalid input
- [ ] **E2E-05**: User can request and complete password reset flow
- [ ] **E2E-06**: Concurrent duplicate review submissions are handled gracefully

### E2E - Admin & Disputes

- [ ] **E2E-07**: Admin can approve and reject pending reviews from the moderation queue
- [ ] **E2E-08**: Landlord can submit a dispute through the public /dispute form
- [ ] **E2E-09**: Admin can view and resolve disputes with outcome and notes
- [ ] **E2E-10**: Admin actions create verifiable audit log entries
- [ ] **E2E-11**: All 9 admin pages render correctly and are navigable

### Security

- [ ] **SEC-04**: Unauthenticated requests to protected API endpoints return 401
- [ ] **SEC-05**: Non-admin requests to admin API endpoints return 403
- [ ] **SEC-06**: Rate limiting returns 429 after threshold is exceeded
- [ ] **SEC-07**: SQL injection probes in text input fields are safely handled
- [ ] **SEC-08**: Stored user content (review text, dispute explanation) is XSS-safe on render

### Stress & UI Scale

- [ ] **STRESS-01**: Building profile page renders correctly with 20+ reviews
- [ ] **STRESS-02**: Pages handle empty states gracefully (0 reviews, 0 disputes)
- [ ] **STRESS-03**: Load testing confirms rate limiting holds under concurrent requests
- [ ] **STRESS-04**: Score aggregation is mathematically correct against known seeded data

## v2 Requirements

### Deferred Features

- **VIS-01**: Visual regression testing with screenshot comparison
- **CHAOS-01**: Chaos engineering / fault injection testing
- **CI-01**: Automated CI/CD pipeline for test execution
- **PERF-01**: Production performance benchmarking and monitoring

## Out of Scope

| Feature | Reason |
|---------|--------|
| DAST scanning (OWASP ZAP, Burp Suite) | Over-engineered for pre-launch app |
| Load testing against production | Risk of Cloudflare abuse detection |
| Mutation testing | Diminishing returns for current test maturity |
| Google OAuth E2E testing | Google bot detection blocks headless browsers |
| Mobile app testing | Web-only platform |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 4 | Complete |
| INFRA-02 | Phase 5 | Complete |
| INFRA-03 | Phase 5 | Pending |
| INFRA-04 | Phase 6 | Pending |
| INFRA-05 | Phase 6 | Pending |
| E2E-01 | Phase 7 | Pending |
| E2E-02 | Phase 7 | Pending |
| E2E-03 | Phase 7 | Pending |
| E2E-04 | Phase 7 | Pending |
| E2E-05 | Phase 7 | Pending |
| E2E-06 | Phase 7 | Pending |
| E2E-07 | Phase 8 | Pending |
| E2E-08 | Phase 8 | Pending |
| E2E-09 | Phase 8 | Pending |
| E2E-10 | Phase 8 | Pending |
| E2E-11 | Phase 8 | Pending |
| SEC-04 | Phase 9 | Pending |
| SEC-05 | Phase 9 | Pending |
| SEC-06 | Phase 9 | Pending |
| SEC-07 | Phase 9 | Pending |
| SEC-08 | Phase 9 | Pending |
| STRESS-01 | Phase 10 | Pending |
| STRESS-02 | Phase 10 | Pending |
| STRESS-03 | Phase 10 | Pending |
| STRESS-04 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Traceability updated: 2026-02-27 — Phases 4-10 assigned*
