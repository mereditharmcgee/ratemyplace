# Roadmap: RateMyPlace Boston

**Created:** 2026-02-26

## Milestones

- ✅ **v1.2.1 Email Verification** — Phase 1 (shipped 2026-02-26)
- ✅ **v1.2.2 Launch Ready** — Phases 2-3 (shipped 2026-02-27)
- ✅ **v1.3.0 Battle Tested** — Phases 4-9 (shipped 2026-03-10)
- ✅ **v1.4.0 Open Doors** — Phases 10-15 (shipped 2026-03-22)
- 🚧 **v1.5.0 Closed Loops** — Phases 16-21 (in progress)

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

<details>
<summary>✅ v1.4.0 Open Doors (Phases 10-15) — SHIPPED 2026-03-22</summary>

- [x] Phase 10: Foundations and Legal Hardening (3/3 plans) — completed 2026-03-20
- [x] Phase 11: Schema, Survey Fields, and Contact Form (2/2 plans) — completed 2026-03-21
- [x] Phase 12: Multi-City Enrichment Adapter (2/2 plans) — completed 2026-03-21
- [x] Phase 13: Tenant Dashboard Core (3/3 plans) — completed 2026-03-22
- [x] Phase 14: Saved Buildings and Verification UX (2/2 plans) — completed 2026-03-20
- [x] Phase 15: Notification Gap Closure (1/1 plan) — completed 2026-03-22

See: `.planning/milestones/v1.4.0-ROADMAP.md`

</details>

### 🚧 v1.5.0 Closed Loops (In Progress)

**Milestone Goal:** Close the security, validation, and quality-debt gaps surfaced by the post-brand codebase audit. Harden public endpoints, fill critical-flow test coverage, and reduce maintenance debt accumulated through v1.4.0.

- [x] **Phase 16: Typed Runtime Foundation** — Declare all Pages secrets in env.d.ts and wire typed runtime to App.Locals, eliminating 71 unsafe casts (completed 2026-04-27)
- [x] **Phase 17: Public Endpoint Security** — Rate limiting and input validation on all unprotected public POST and search endpoints (completed 2026-04-28)
- [x] **Phase 18: CSRF Audit and Async Email** — Document CSRF posture and convert blocking email sends to fire-and-forget (completed 2026-04-28)
- [ ] **Phase 19: D1 Index Migration** — Audit query plans and add missing indexes to eliminate full-table scans on hot paths
- [ ] **Phase 20: Critical-Flow E2E Coverage** — Causal audit-log assertion and cross-view data consistency test coverage
- [ ] **Phase 21: Quality Cleanup** — Response header consistency, shared EmptyState component

## Phase Details

### Phase 16: Typed Runtime Foundation
**Goal**: The Cloudflare runtime is fully typed throughout the codebase — all Pages secrets declared, App.Locals wired to App.Platform, and all 71 unsafe casts eliminated in one batch
**Depends on**: Phase 15 (v1.4.0 complete)
**Requirements**: INFRA-01, INFRA-02, INFRA-03
**Success Criteria** (what must be TRUE):
  1. `App.Platform.env` in `env.d.ts` declares all 6 Pages secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`) alongside existing bindings — TypeScript build is clean
  2. `App.Locals` declares `runtime: App.Platform` and `getDB()` accepts the typed parameter — IDE autocomplete works on `context.locals.runtime.env.DB` with no `any` cast
  3. `grep -r '(context.locals as any).runtime' src/` returns zero matches — every call site converted in a single batch PR
  4. Full TypeScript build (`npm run build`) passes with zero errors after the batch replacement
**Plans**: 2 plans

Plans:
- [ ] 16-01-PLAN.md — Type foundation: env.d.ts (App.Platform.env + App.Locals.runtime), src/lib/runtime.ts (getEnv helper), src/lib/db.ts refactor to getDB(context), and verify-typed-runtime.sh script
- [ ] 16-02-PLAN.md — Cast retirement batch: replace all 70 (context.locals as any).runtime casts in API routes + middleware, all 11 (Astro.locals as any).runtime casts in .astro pages, and 6 rawLocals as any patterns in disputes files

### Phase 17: Public Endpoint Security
**Goal**: Every public POST and search endpoint has rate limiting and input validation — no unprotected path remains in the request surface
**Depends on**: Phase 16
**Requirements**: SEC-04, SEC-05, VAL-01, VAL-02, VAL-03, VAL-04, VAL-05
**Success Criteria** (what must be TRUE):
  1. A script that sends 6 bug reports in one hour receives a 429 on the 6th request with a `Retry-After` header present
  2. A script sending more than 60 search requests per minute receives a 429 with `Retry-After` header; autocomplete allows up to 120/min before 429
  3. Submitting a dispute with `landlordEmail` set to `"notanemail"` returns 400 with a field-level error identifying the email field
  4. Submitting a dispute with `disputeExplanation` exceeding 5000 characters returns 400 with a length error
  5. Calling `/api/search/results` with a query string longer than 200 characters returns 400 rather than executing the LIKE query
**Plans**: 3 plans

Plans:
- [ ] 17-00-PLAN.md — Wave 0 RED scaffolding: failing unit tests for primitives/validators in validation.test.ts and failing E2E tests for endpoint hardening in security.spec.ts (no production code touched)
- [ ] 17-01-PLAN.md — Add shared validation primitives + 4 form validators to validation.ts (isValidEmail, isValidZipCode, enforceMaxLength, escapeLikePattern, validateDisputeForm, validateBugReport, validateContactForm, validateSearch); turns Wave 0 unit tests GREEN
- [ ] 17-02-PLAN.md — Wire content-type guards + rate limits + validators into all five endpoints (bug-reports 5/hr, search/results 60/min, search/autocomplete 120/min); turns Wave 0 E2E tests GREEN

### Phase 18: CSRF Audit and Async Email
**Goal**: CSRF posture is documented and ratified; email sends no longer block API response times
**Depends on**: Phase 16 (typed runtime makes ctx.waitUntil access type-safe)
**Requirements**: SEC-06, PERF-01, PERF-02, PERF-03, PERF-04
**Success Criteria** (what must be TRUE):
  1. `middleware.ts` contains an inline comment citing the CSRF audit conclusion — identifying which controls cover which endpoint categories and explicitly confirming no token implementation is required
  2. `CLAUDE.md` contains a brief CSRF note recording the SameSite=Lax + Turnstile + Astro checkOrigin verdict
  3. Submitting a signup request completes and returns a 201 response before any Resend API call resolves — the user is not blocked by email latency
  4. Submitting a forgot-password request, a contact form, or a dispute returns its success response before Resend responds — all five email-sending routes (signup, forgot-password, resend-verification, contact, disputes) use `fireAndForget(context, ...)` with a null guard for local dev
**Plans**: 4 plans

Plans:
- [ ] 18-00-PLAN.md — Wave 0 RED scaffolding: failing unit tests for `fireAndForget` and `recipientHash` in `src/lib/__tests__/runtime.test.ts` (no production code touched)
- [ ] 18-01-PLAN.md — Implement `fireAndForget(context, promise)` and `recipientHash(email)` in `src/lib/runtime.ts` (alongside existing `getEnv`); turns Wave 0 unit tests GREEN
- [ ] 18-02-PLAN.md — Convert all 5 blocking email-send sites to `fireAndForget` (signup, forgot-password, resend-verification, contact x2, disputes); append PERF-01 companion note to REQUIREMENTS.md
- [ ] 18-03-PLAN.md — CSRF audit: write `.planning/audits/csrf-2026-04.md` (per-endpoint-category structure, JSON checkOrigin caveat, no-token verdict), add inline comment to `src/middleware.ts`, append CSRF subsection to CLAUDE.md Security Checklist

### Phase 19: D1 Index Migration
**Goal**: Every hot-path query runs against an index — no full-table scans on search joins, rate-limit lookups, or filter queries
**Depends on**: Phase 16
**Requirements**: PERF-05, PERF-06, PERF-07
**Success Criteria** (what must be TRUE):
  1. `EXPLAIN QUERY PLAN` output for the primary search join (`reviews JOIN buildings WHERE status = 'approved'`) shows an index scan rather than a full scan — confirmed before migration SQL is written
  2. The composite index `reviews(building_id, status)` is present in the production schema (verified via `PRAGMA index_list('reviews')`)
  3. Indexes on `buildings(city)` and `buildings(building_type)` are present if `EXPLAIN QUERY PLAN` on the filter queries showed full scans — or those indexes are explicitly skipped with the `EXPLAIN QUERY PLAN` output attached to the migration file comment
**Plans**: TBD

Plans:
- [ ] 19-01: Run EXPLAIN QUERY PLAN audit on search joins, rate-limit lookups, and filter queries; document findings
- [ ] 19-02: Write and apply migration adding confirmed-necessary indexes; verify with post-migration EXPLAIN QUERY PLAN

### Phase 20: Critical-Flow E2E Coverage
**Goal**: The two highest-priority E2E gaps are closed — admin moderation has a causal audit-log assertion and cross-view data consistency is verified end-to-end
**Depends on**: Phase 17 (endpoints hardened before E2E covers them), Phase 19 (indexes in place for consistency queries)
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. An E2E test captures a `review_id` before triggering admin approval, then asserts that a specific `audit_logs` entry with `action_type = 'review_approved'` and that `entity_id` exists — the assertion is not ordering-dependent
  2. An E2E test submits a review, triggers admin approval, then verifies the `overall_score` matches across `/api/search/results`, `/building/[slug]`, and `/profile` — any divergence fails the test
  3. `clearRateLimits()` is defined once in `e2e/fixtures.ts` and imported by both `security.spec.ts` and any new spec that needs it — no duplication
**Plans**: TBD

Plans:
- [ ] 20-01: Extract clearRateLimits helper to e2e/fixtures.ts; write causal audit-log E2E test for admin moderation flow
- [ ] 20-02: Write cross-view data consistency E2E test (submit → approve → verify score on search, building detail, profile)

### Phase 21: Quality Cleanup
**Goal**: Rate-limit response headers are consistent across all endpoints and a shared EmptyState component replaces ad-hoc empty-state messaging
**Depends on**: Phase 17 (rate limiting must be in place before headers can be standardized)
**Requirements**: SEC-07, SEC-08, UX-01
**Success Criteria** (what must be TRUE):
  1. Every 429 response across all rate-limited endpoints includes a `Retry-After` header — including `contact.ts` which currently omits it
  2. Every rate-limited endpoint response (200 or 429) includes `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers
  3. The search results page, building detail page (zero-review state), user profile (no reviews), and notifications panel all render via the shared `<EmptyState>` component with consistent title/description messaging — no ad-hoc empty-state strings remain on those pages
**Plans**: TBD

Plans:
- [ ] 21-01: Standardize Retry-After and add X-RateLimit-Limit / X-RateLimit-Remaining headers across all rate-limited endpoints
- [ ] 21-02: Build shared EmptyState React component and replace ad-hoc empty-state messaging on search, building detail, profile, and notifications

## Progress

**Execution Order:**
Phases 16 → 17 and 18 and 19 (parallel after 16) → 20 → 21

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
| 10. Foundations and Legal Hardening | v1.4.0 | 3/3 | Complete | 2026-03-20 |
| 11. Schema, Survey Fields, and Contact Form | v1.4.0 | 2/2 | Complete | 2026-03-21 |
| 12. Multi-City Enrichment Adapter | v1.4.0 | 2/2 | Complete | 2026-03-21 |
| 13. Tenant Dashboard Core | v1.4.0 | 3/3 | Complete | 2026-03-22 |
| 14. Saved Buildings and Verification UX | v1.4.0 | 2/2 | Complete | 2026-03-20 |
| 15. Notification Gap Closure | v1.4.0 | 1/1 | Complete | 2026-03-22 |
| 16. Typed Runtime Foundation | 2/2 | Complete    | 2026-04-27 | - |
| 17. Public Endpoint Security | 3/3 | Complete    | 2026-04-28 | - |
| 18. CSRF Audit and Async Email | 4/4 | Complete   | 2026-04-28 | - |
| 19. D1 Index Migration | v1.5.0 | 0/2 | Not started | - |
| 20. Critical-Flow E2E Coverage | v1.5.0 | 0/2 | Not started | - |
| 21. Quality Cleanup | v1.5.0 | 0/2 | Not started | - |

---
*Roadmap updated: 2026-04-28 — Phase 18 plans finalized (4 plans: Wave 0 tests, helper impl, route conversions, CSRF audit doc)*
