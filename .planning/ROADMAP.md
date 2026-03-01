# Roadmap: RateMyPlace Boston

**Created:** 2026-02-26

## Milestones

- ✅ **v1.2.1 Email Verification** — Phase 1 (shipped 2026-02-26)
- ✅ **v1.2.2 Launch Ready** — Phases 2-3 (shipped 2026-02-27)
- 🔄 **v1.3.0 Battle Tested** — Phases 4-10 (in progress)

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

### v1.3.0 "Battle Tested" — Current Milestone

- [x] **Phase 4: Database Foundation** — Reset, migrate, and seed scripts for local D1 (completed 2026-02-28)
- [x] **Phase 5: Seed Data** — Realistic data population (30 buildings, 10 landlords, 100+ reviews) (completed 2026-02-28)
- [x] **Phase 6: Playwright Local Environment** — Config, webServer, auth fixtures for local E2E (2/2 plans done — completed 2026-02-28)
- [x] **Phase 7: Auth and Review E2E** — Signup, signin, signout, password reset, review submission (completed 2026-02-28)
- [ ] **Phase 8: Admin and Disputes E2E** — Moderation queue, dispute resolution, audit log, all 9 admin pages
- [ ] **Phase 9: Security E2E** — Auth bypass, admin access control, rate limiting, injection probes
- [ ] **Phase 10: Stress Testing and UI at Scale** — Concurrent load, volume rendering, score correctness

## Phase Details

### Phase 4: Database Foundation

**Goal**: Local D1 database can be fully reset, migrated, and verified with a single npm command
**Depends on**: Nothing (first phase of milestone)
**Requirements**: INFRA-01
**Success Criteria** (what must be TRUE):
  1. `npm run db:reset` drops all tables including d1_migrations without error
  2. `npm run db:migrate:local` applies all migrations and schema matches production structure
  3. `npm run db:fresh` runs reset + migrate end-to-end without manual intervention
  4. Running `db:fresh` twice in a row succeeds (idempotent — no stale state errors)
**Plans**: TBD

### Phase 5: Seed Data

**Goal**: Local D1 is populated with realistic, volume-appropriate data ready for E2E and stress tests
**Depends on**: Phase 4
**Requirements**: INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. `npm run db:seed` inserts 30 buildings, 10 landlords, 100+ reviews, 3 test users, and 10 disputes without FK errors
  2. At least one building has 20+ reviews; at least one has 0 reviews; scores span the full 1–5 range
  3. `building_scores` and `landlord_scores` tables contain pre-computed aggregate rows matching the seeded review data
  4. Test users exist with `email_verified = 1` (regular user) and `is_admin = 1` (admin user) and correct bcrypt password hashes
**Plans**: TBD

### Phase 6: Playwright Local Environment

**Goal**: Playwright runs entirely against local dev server with reusable authenticated sessions — no production URL contact
**Depends on**: Phase 5
**Requirements**: INFRA-04, INFRA-05
**Success Criteria** (what must be TRUE):
  1. Existing navigation/pages Playwright specs pass against local dev server (not the production URL)
  2. `global.setup.ts` creates `playwright/.auth/user.json` and `playwright/.auth/admin.json` by signing in through the UI form
  3. `fixtures.ts` exposes `authedPage` and `adminPage` typed fixtures that reuse stored sessions without re-authenticating
  4. `playwright.config.ts` sets `workers: 1` and `webServer` pointing at local dev; running tests does not touch `ratemyplace.boston`
**Plans**: TBD

### Phase 7: Auth and Review E2E

**Goal**: Every auth flow and the core review submission flow are covered by passing automated specs
**Depends on**: Phase 6
**Requirements**: E2E-01, E2E-02, E2E-03, E2E-04, E2E-05, E2E-06
**Success Criteria** (what must be TRUE):
  1. A new user can sign up with email/password through the full form and land on a confirmation state
  2. A test user can sign in and sign out; session cookie is cleared on signout
  3. A signed-in user can complete the 27-field multi-step review form and see the submitted review reflected in the UI
  4. The review form rejects submission when required fields are missing or contain invalid input (boundary values, long inputs, special characters)
  5. A user can request a password reset and complete the flow end-to-end using a token read from local D1
  6. Submitting two identical reviews concurrently is handled gracefully — either blocked with an error or one accepted, no 500
**Plans**: TBD

### Phase 8: Admin and Disputes E2E

**Goal**: Admin moderation, dispute resolution, and audit logging are covered by passing automated specs across all 9 admin pages
**Depends on**: Phase 6
**Requirements**: E2E-07, E2E-08, E2E-09, E2E-10, E2E-11
**Success Criteria** (what must be TRUE):
  1. An admin user can approve a pending review and reject another from the moderation queue; status changes are reflected in the UI
  2. A landlord (unauthenticated) can submit a dispute through the public /dispute form and the submission appears in the admin queue
  3. An admin user can view a dispute side-by-side with its review and resolve it with outcome and notes
  4. Admin actions (approve, reject, resolve) produce verifiable entries in the audit log that appear on /admin/audit
  5. All 9 admin pages (/admin/dashboard, /admin/users, /admin/reviews, /admin/buildings, /admin/landlords, /admin/managers, /admin/verification, /admin/disputes, /admin/audit) render without error when navigated to as admin
**Plans**: TBD

### Phase 9: Security E2E

**Goal**: Auth bypass, privilege escalation, injection, and rate limiting are all validated to fail safely
**Depends on**: Phase 6
**Requirements**: SEC-04, SEC-05, SEC-06, SEC-07, SEC-08
**Success Criteria** (what must be TRUE):
  1. Direct requests to protected API endpoints without a session cookie return HTTP 401
  2. Requests to admin-only API endpoints using a non-admin authenticated session return HTTP 403
  3. Auth endpoints return HTTP 429 after the rate limit threshold is exceeded in rapid succession
  4. Text input fields (review text, dispute explanation) that receive SQL injection probe strings store and display the literal text without error or data corruption
  5. Stored user content (review text, dispute explanation) containing HTML/script payloads renders as escaped text, not executed markup
**Plans**: TBD

### Phase 10: Stress Testing and UI at Scale

**Goal**: The app handles volume data and concurrent load correctly — rate limiting holds, UI renders, scores are accurate
**Depends on**: Phase 5
**Requirements**: STRESS-01, STRESS-02, STRESS-03, STRESS-04
**Success Criteria** (what must be TRUE):
  1. The building profile page for the building with 20+ seeded reviews renders completely without layout breakage or truncation
  2. Pages that have no data (0 reviews, 0 disputes) display appropriate empty state UI rather than errors or blank sections
  3. `npm run stress` (autocannon against local dev server) confirms rate-limited endpoints consistently return 429 under concurrent request load without crashing the server
  4. Calculated building and landlord scores in the UI match the pre-computed values in `building_scores` and `landlord_scores` tables, confirming aggregation math is correct
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Email Verification | v1.2.1 | 4/4 | Complete | 2026-02-26 |
| 2. Landlord Disputes | v1.2.2 | 3/3 | Complete | 2026-02-27 |
| 3. Security Hardening | v1.2.2 | 3/3 | Complete | 2026-02-27 |
| 4. Database Foundation | 3/3 | Complete    | 2026-02-28 | — |
| 5. Seed Data | 2/2 | Complete   | 2026-02-28 | — |
| 6. Playwright Local Environment | v1.3.0 | 2/2 | Complete | 2026-02-28 |
| 7. Auth and Review E2E | 3/3 | Complete   | 2026-02-28 | — |
| 8. Admin and Disputes E2E | 1/2 | In Progress|  | — |
| 9. Security E2E | v1.3.0 | 0/? | Not started | — |
| 10. Stress Testing and UI at Scale | v1.3.0 | 0/? | Not started | — |

---
*Roadmap updated: 2026-02-27 — v1.3.0 "Battle Tested" phases added (Phases 4-10)*
