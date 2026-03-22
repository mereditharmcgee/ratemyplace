# Milestones: RateMyPlace Boston
## v1.4.0 Open Doors (Shipped: 2026-03-22)

**Phases completed:** 6 phases, 13 plans, 4 tasks

**Key accomplishments:**
- (none recorded)

---

## v1.3.0 "Battle Tested" (Shipped: 2026-03-10)

**Phases:** 6 (4-9) | **Plans:** 15 | **Timeline:** 12 days (2026-02-26 → 2026-03-10)

### Delivered

Comprehensive E2E test suite and security validation ensuring all user flows, admin workflows, and security controls are production-ready.

### Key Accomplishments

1. Local D1 database tooling — single-command reset, migrate, seed with 30 buildings, 10 landlords, 100+ reviews
2. Playwright E2E infrastructure — local dev server, reusable auth fixtures for regular user and admin
3. Full auth flow coverage — signup, signin, signout, password reset, concurrent submission handling
4. Admin E2E suite — moderation queue, dispute resolution, audit log, all 9 admin pages verified
5. Security E2E — auth bypass (401), privilege escalation (403), rate limiting (429), SQL injection, XSS prevention
6. 17 security-specific tests proving injection payloads stored safely and scripts stripped before rendering

### Known Gaps

- STRESS-01: Building profile rendering with 20+ reviews (Phase 10 skipped)
- STRESS-02: Empty state UI testing (Phase 10 skipped)
- STRESS-03: Rate limiting under concurrent load (Phase 10 skipped)
- STRESS-04: Score aggregation math verification (Phase 10 skipped)

### Stats

- Total E2E tests: 170+
- Codebase: ~25,800 LOC (TypeScript, Astro, CSS)
- Requirements completed: 21/25 (4 stress testing deferred)

### Archive

- Roadmap: `.planning/milestones/v1.3-ROADMAP.md`
- Requirements: `.planning/milestones/v1.3-REQUIREMENTS.md`

---


## v1.2.1 — Email Verification

**Shipped:** 2026-02-26
**Phases:** 1 | **Plans:** 4 | **Tasks:** 11

### Delivered

Email verification system enabling users to verify their email address and display trust badges on reviews.

### Key Accomplishments

1. Cryptographically secure token generation with 64-char alphanumeric tokens and 24-hour expiration
2. Green email verification badge on reviews, distinct from existing blue tenant verification badge
3. Resend email service integration with branded HTML emails sent automatically on signup
4. Complete verification flow: click-to-verify endpoint, resend functionality, success page, profile UI
5. Rate limiting on verification email requests (3 per hour)

### Stats

- Files modified: 29
- Lines added: 3,681
- Commits: 15
- Requirements completed: EMAIL-01 through EMAIL-05

### Archive

- Roadmap: `.planning/milestones/v1.2.1-ROADMAP.md`
- Requirements: `.planning/milestones/v1.2.1-REQUIREMENTS.md`

---

## Previous Milestones

- **v1.1.0** — Evidence-Based Scoring (27-item survey, weighted scoring, admin dashboard)
- **v1.0.0** — Initial MVP (basic reviews, property manager system)
- **v0.3.0** — Google OAuth and Maps integration

---

_Last updated: 2026-02-26_

## v1.2.2 — Launch Ready

**Shipped:** 2026-02-27
**Phases:** 2 | **Plans:** 6 | **Tasks:** 17

### Delivered

Security hardening and landlord dispute system for production launch readiness.

### Key Accomplishments

1. Landlord dispute form at /dispute with review URL parsing, contact info collection, and reason selection
2. Admin disputes queue at /admin/disputes with side-by-side review comparison and resolution workflow
3. Fail-closed rate limiting — DB errors now return 503 (not silent pass), with structured JSON logging
4. Comprehensive audit trail — all admin actions logged with who, what, when, old/new values
5. Admin audit log viewer at /admin/audit with filtering by action type, admin user, and pagination
6. Dispute email notifications to landlords on resolution

### Stats

- Requirements completed: DISP-01 through DISP-05, SEC-01 through SEC-03
- New admin pages: /admin/disputes, /admin/audit
- Database tables added: disputes, audit_logs

### Archive

- Roadmap: `.planning/milestones/v1.2.2-ROADMAP.md`
- Requirements: `.planning/milestones/v1.2.2-REQUIREMENTS.md`

---

