# Requirements: RateMyPlace Boston — v1.5.0 "Closed Loops"

**Defined:** 2026-04-27
**Core Value:** Tenants can submit honest, anonymous reviews and see aggregated scores
**Source:** `.planning/codebase/CONCERNS.md` audit (2026-04-26) + research synthesis (`.planning/research/SUMMARY.md`)

---

## v1 Requirements (v1.5.0)

Hardening pass. No new user-facing features. Closes security, validation, performance, and quality-debt gaps surfaced by the post-brand codebase audit.

### Infrastructure

- [x] **INFRA-01**: All Cloudflare Pages secrets typed in `App.Platform.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`)
- [x] **INFRA-02**: `runtime: App.Platform` declared on `App.Locals`; `getDB` signature updated to consume the typed locals
- [x] **INFRA-03**: All 71 `(context.locals as any).runtime` casts replaced with typed access in a single mechanical PR

### Security

- [x] **SEC-04**: Rate limiting wired on `/api/bug-reports` (5/hr per IP, fail-closed pattern matching `contact.ts`)
- [x] **SEC-05**: Rate limiting wired on `/api/search/results` (60/min per IP) and `/api/search/autocomplete` (120/min per IP)
- [ ] **SEC-06**: CSRF protection audit completed against Astro 5 `security.checkOrigin` defaults, Lucia v3 session cookie attributes, and Cloudflare Turnstile coverage; conclusion documented in `middleware.ts` (inline comment) and `CLAUDE.md`
- [ ] **SEC-07**: `Retry-After` header present on every 429 response (fix `contact.ts` consistency gap; verify all rate-limited endpoints)
- [ ] **SEC-08**: `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers on every rate-limited endpoint response

### Validation

- [x] **VAL-01**: `validateDisputeForm` adds email format check on `landlordEmail` and length limits (`disputeExplanation` 5000 chars, `landlordName` 200, `landlordPhone` 30)
- [x] **VAL-02**: `validateBugReport` adds length limits and content-type guard on `/api/bug-reports`
- [x] **VAL-03**: `validateContactForm` adds email format and length limits on `/api/contact` payload
- [x] **VAL-04**: `validateSearch` adds query-length cap and special-character handling on `/api/search/*` inputs
- [x] **VAL-05**: Shared primitives in `validation.ts`: `isValidEmail()`, `isValidZipCode()`, `enforceMaxLength()` — used by all four validators above

### Performance

- [x] **PERF-01**: `/api/auth/signup` converted to `ctx.waitUntil(emailPromise.catch(logError))` with null guard for local Wrangler dev
- [x] **PERF-02**: `/api/auth/forgot-password` converted to `waitUntil` with null guard
- [x] **PERF-03**: `/api/contact` converted to `waitUntil` (admin notification email)
- [x] **PERF-04**: `/api/disputes` converted to `waitUntil` (landlord confirmation email)
- [ ] **PERF-05**: D1 query plans audited via `EXPLAIN QUERY PLAN` for search joins, rate-limit lookups, and any other hot paths
- [ ] **PERF-06**: Composite index `reviews(building_id, status)` added (verified necessary by audit in PERF-05)
- [ ] **PERF-07**: Additional indexes on `buildings(city)` and `buildings(building_type)` added if `EXPLAIN QUERY PLAN` shows full scans on filter queries

### Testing

- [ ] **TEST-01**: E2E test for admin moderation flow with **causal** audit-log assertion (capture `review_id` before approve action, assert specific entry exists in `audit_logs` after — not ordering-dependent)
- [ ] **TEST-02**: E2E test for cross-view data consistency: submit review → admin approve → assert `overall_score` matches across `/api/search/results`, `/building/[slug]`, and `/profile`
- [ ] **TEST-03**: `clearRateLimits()` helper extracted from `security.spec.ts` into `e2e/fixtures.ts` for cross-spec reuse

### UX Consistency

- [ ] **UX-01**: Shared `<EmptyState>` React component with consistent messaging across search, building detail, profile (no reviews), notifications

---

## v2 Requirements (Deferred to v1.6.0+)

Not in current roadmap. Tracked here so they don't fall off.

### Code Health (deferred to v1.6.0)

- **DEBT-01**: `ReviewEditForm.tsx` (907 lines) split into sub-components inside the same `client:load` island root — extract state to a custom hook, mirror `form-steps/` pattern from `ReviewForm.tsx`
- **DEBT-02**: `BuildingsTable.tsx` (844 lines) split: `TableHeader`, `TableRow`, `TableFilters`, `TablePagination` sub-components with hooks for filtering/sorting
- **DEBT-03**: `ReviewsTable.tsx` (733 lines) split following the same pattern
- **DEBT-04**: Component splits land **one file per PR** with full E2E run between each, ReviewEditForm last (highest risk: multi-step state machine)

### Future hardening

- **STRESS-01–04**: Stress testing for high-review buildings, rate-limit concurrency, score aggregation math, empty-state UI under load (deferred from v1.3.0)
- **OBS-01**: Structured monitoring / alerting beyond Cloudflare's built-in dashboard (Sentry or equivalent — out of scope for v1.5.0)

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Add Zod or Valibot | `src/lib/validation.ts` already has the right return shape; gap is coverage, not capability — adds ~13KB bundle for no capability gain |
| Token-based CSRF (double-submit cookie) | Astro 5 `security.checkOrigin` + `SameSite=Lax` + Cloudflare Turnstile + OAuth state cookie are sufficient for this architecture's request patterns |
| Cloudflare Queues for email | `waitUntil` is the canonical Workers pattern at this scale; queues introduce a separate product dependency |
| Astro 6 / `@astrojs/cloudflare` v13 upgrade | v5.16.11 is patched for CVE-2024-56140; upgrade is its own milestone |
| Per-user rate limiting on public endpoints | Public endpoints are unauthenticated; per-IP is correct |
| Sentry / external observability | Cloudflare's built-in logs sufficient through v1.5.0 |
| Switching session cookie `SameSite` from Lax to Strict | Breaks Google OAuth cross-site callback redirect — explicit anti-feature |
| Per-component `client:load` islands during component splits | Breaks shared state and hydration boundaries — must stay inside same island root |

---

## Traceability

Updated by gsd-roadmapper after roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 16 | Complete |
| INFRA-02 | Phase 16 | Complete |
| INFRA-03 | Phase 16 | Complete |
| SEC-04 | Phase 17 | Complete |
| SEC-05 | Phase 17 | Complete |
| SEC-06 | Phase 18 | Pending |
| SEC-07 | Phase 21 | Pending |
| SEC-08 | Phase 21 | Pending |
| VAL-01 | Phase 17 | Complete |
| VAL-02 | Phase 17 | Complete |
| VAL-03 | Phase 17 | Complete |
| VAL-04 | Phase 17 | Complete |
| VAL-05 | Phase 17 | Complete |
| PERF-01 | Phase 18 | Complete |
| PERF-02 | Phase 18 | Complete |
| PERF-03 | Phase 18 | Complete |
| PERF-04 | Phase 18 | Complete |
| PERF-05 | Phase 19 | Pending |
| PERF-06 | Phase 19 | Pending |
| PERF-07 | Phase 19 | Pending |
| TEST-01 | Phase 20 | Pending |
| TEST-02 | Phase 20 | Pending |
| TEST-03 | Phase 20 | Pending |
| UX-01 | Phase 21 | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0 ✓

---

*Requirements defined: 2026-04-27*
*Last updated: 2026-04-27 after roadmap creation — traceability complete*
