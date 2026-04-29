# Milestones: RateMyPlace Boston
## v1.5.0 Closed Loops (Shipped: 2026-04-29)

**Phases:** 6 (16-21) | **Plans:** 15 | **Timeline:** 3 days (2026-04-27 → 2026-04-29)

### Delivered

Hardening pass with no new user-facing features — closed the security, validation, performance, and quality-debt gaps surfaced by the post-brand codebase audit. 24 requirements across infrastructure, security, validation, performance, testing, and UX consistency.

### Key Accomplishments

1. Typed Cloudflare runtime — all 6 Pages secrets declared in `App.Platform.env`, 89 unsafe `(context.locals as any).runtime` casts eliminated across 60 files in one batch
2. Public endpoint hardening — rate limiting + content-type guards + length-bounded validators on `/api/bug-reports` (5/hr), `/api/contact`, `/api/disputes`, `/api/search/results` (60/min), `/api/search/autocomplete` (120/min); shared validation primitives (`isValidEmail`, `enforceMaxLength`, `escapeLikePattern`)
3. CSRF audit closed as no-token-required — SameSite=Lax + Turnstile + Astro `checkOrigin` ratified at `.planning/audits/csrf-2026-04.md`, with explicit `application/json` caveat documented across audit, middleware, and CLAUDE.md
4. Async email sends — all 5 blocking `await sendXxxEmail` call sites converted to `fireAndForget(context, ...)` with `ctx.waitUntil`; users no longer wait on Resend latency
5. D1 hot-path indexing — composite `idx_reviews_building_status` added (verified via live production EXPLAIN); 3 unnecessary indexes documented as skipped with grep evidence
6. Critical-flow E2E coverage — causal audit-log assertion (capture review_id before approve, query by entity_id) and exact cross-view score equality (search ↔ detail ↔ profile)
7. Header consistency — `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` standardized across all 9 rate-limited endpoints via shared `buildRateLimitHeaders` helper
8. Shared `<EmptyState>` component — `.astro` + `.tsx` byte-identical twins, 6 ad-hoc empty-state strings replaced across 4 surfaces

### Tech Debt (accepted, not blocking)

- `src/pages/api/disputes/[id].ts` admin update retains blocking `await sendDisputeUpheldEmail` (deferred to v1.6.0)
- `signup.ts` still uses inline `email.includes('@')` rather than VAL-05 `isValidEmail` primitive
- Duplicate `validateDisputeForm` symbol in `src/lib/disputes.ts` (test-only consumer)
- `isValidZipCode` exported but no production consumer (intentional future-proofing)
- 400/500 paths after rate-limit check don't carry rate-limit headers (within SEC-08 acceptance scope)
- SUMMARY frontmatter `requirements-completed` missing INFRA-01..03, SEC-06, SEC-07, SEC-08 (metadata only)

### Stats

- Codebase: ~28,000 LOC (TypeScript/TSX/Astro), 18 unit test files
- Migrations: 24 (added 0024_perf_indexes.sql)
- Requirements completed: 24/24
- Audit status: tech_debt (no blockers)

### Archive

- Roadmap: `.planning/milestones/v1.5.0-ROADMAP.md`
- Requirements: `.planning/milestones/v1.5.0-REQUIREMENTS.md`
- Audit: `.planning/milestones/v1.5.0-MILESTONE-AUDIT.md`

---

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

