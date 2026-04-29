# RateMyPlace Boston

## What This Is

A public health-focused tenant housing review platform for Boston renters (expanding to additional cities). Tenants rate their apartment unit, building, and landlord using a 29-item structured survey grounded in validated housing quality research (OHQS, PHQS, WHO LARES). Addresses information asymmetry in rental markets by giving tenants a way to research landlords before signing a lease. Includes tenant dashboard with review management, account settings, saved buildings, and in-app notifications.

## Core Value

Tenants can submit honest, anonymous reviews and see aggregated scores for buildings and landlords — enabling informed rental decisions.

## Requirements

### Validated

- ✓ 27-item survey form across three dimensions (unit, building, landlord) — v1.1.0
- ✓ Evidence-based weighted scoring with health/safety factors — v1.1.0
- ✓ Privacy-preserving score aggregation (precise collection, fuzzy display) — v1.1.0
- ✓ Building and landlord profile pages with aggregate scores — v1.1.0
- ✓ Property manager system — v1.0.0
- ✓ Admin moderation dashboard — v1.1.0
- ✓ Rate limiting on auth endpoints — v1.1.0
- ✓ Google OAuth authentication — v0.3.0
- ✓ Google Maps address autocomplete — v0.3.0
- ✓ Public methodology page with citations — v1.1.0
- ✓ Email verification for reviewers — v1.2.1
- ✓ Landlord dispute form with admin review queue — v1.2.2
- ✓ Fail-closed rate limiting with structured logging — v1.2.2
- ✓ Admin action audit trail with viewer — v1.2.2
- ✓ Realistic test data seeding (30 buildings, 10 landlords, 100+ reviews) — v1.3.0
- ✓ Automated E2E tests for all user flows (auth, review, dispute, admin) — v1.3.0
- ✓ Security E2E validation (auth bypass, privilege escalation, rate limiting, injection, XSS) — v1.3.0
- ✓ UGC disclaimers, ToS safe harbor, consent checkbox — v1.4.0
- ✓ Admin inline review expansion with approve/reject — v1.4.0
- ✓ Move-in date season/year bug fix — v1.4.0
- ✓ Section 8 acceptance and safely lit survey fields — v1.4.0
- ✓ Contact form with D1 storage and Resend notifications — v1.4.0
- ✓ Multi-city enrichment adapter (Boston + New Haven) — v1.4.0
- ✓ Tenant dashboard: review status, account settings, notifications — v1.4.0
- ✓ Saved buildings with bookmark button — v1.4.0
- ✓ Verification UX with post-submission prompt and visual distinction — v1.4.0
- ✓ Typed Cloudflare runtime wrapper (89 `as any` casts eliminated) — v1.5.0
- ✓ Rate limiting and input validation on all public POST endpoints — v1.5.0
- ✓ CSRF protection audit (SameSite=Lax + Turnstile + checkOrigin sufficient) — v1.5.0
- ✓ Async email send pattern (fireAndForget with ctx.waitUntil) — v1.5.0
- ✓ D1 hot-path index migration (idx_reviews_building_status) — v1.5.0
- ✓ Admin moderation flow E2E with causal audit-log assertion — v1.5.0
- ✓ Cross-view data consistency E2E (search ↔ detail ↔ profile) — v1.5.0
- ✓ Standardized rate-limit response headers (Retry-After, X-RateLimit-*) — v1.5.0
- ✓ Shared EmptyState component for consistent messaging — v1.5.0

### Active

- [ ] Component refactors (3 files >700 LOC: ReviewEditForm, BuildingsTable, ReviewsTable)
- [ ] Convert admin dispute-upheld email to fireAndForget (`disputes/[id].ts` follow-up from v1.5.0)
- [ ] Apply `isValidEmail` primitive to signup.ts (consistency follow-up)
- [ ] Email unsubscribe management before scaling notification emails

### Out of Scope

- Multi-language support — deferred to v2.0
- Delayed posting — deferred
- Landlord response features (direct rebuttals on reviews) — explicitly excluded from MVP
- Real-time push notifications — Cloudflare Workers stateless; polling sufficient
- Email unsubscribe management — track in v1.5.0 before scaling notification emails
- Stress testing — deferred from v1.3.0, lower priority than user-facing features

## Latest Shipped: v1.5.0 "Closed Loops" (2026-04-29)

**Delivered:** Hardening pass with no new user-facing features. 24 requirements across infrastructure, security, validation, performance, testing, and UX consistency — typed Cloudflare runtime, rate-limited and validated public endpoints, CSRF audit ratified, async email sends, indexed search joins, causal E2E coverage, header consistency, and shared EmptyState component.

## Next Milestone

**v1.6.0** — Planning to be initiated via `/gsd:new-milestone`. Carry-over candidates: component refactors (>700 LOC files: ReviewEditForm, BuildingsTable, ReviewsTable); admin `disputes/[id].ts` fireAndForget conversion; signup.ts validation consistency; email unsubscribe management.

## Context

- **Tech stack**: Astro 5 + Cloudflare Pages + D1 (SQLite) + Lucia Auth + Tailwind CSS 4 + Resend
- **Current version**: v1.5.0 "Closed Loops" (shipped 2026-04-29)
- **Production URL**: ratemyplace.org
- **Codebase**: ~28,000 LOC (TypeScript/TSX/Astro), 322+ unit tests, 18 test files
- **Database tables**: 14 (users, sessions, reviews, buildings, landlords, property_managers, email_verification_tokens, rate_limits, disputes, audit_logs, contact_messages, notifications, saved_buildings, bug_reports)
- **Migrations**: 24 (most recent: 0024_perf_indexes.sql for hot-path index)
- **Admin pages**: Dashboard, Users, Reviews, Buildings, Landlords, Managers, Verification, Disputes, Audit Log, Contact
- **Survey items**: 29 (27 original + Section 8 acceptance + safely lit at night)
- **Runtime typing**: All Cloudflare Pages secrets declared in `App.Platform.env`; zero `(context.locals as any).runtime` casts in `src/`

## Constraints

- **Platform**: Cloudflare Workers (no Node.js APIs, React 18 only)
- **Email**: Resend (selected and integrated)
- **Database**: D1 (SQLite) — single-region, no transactions across requests

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Evidence-based scoring | Grounded in peer-reviewed public health research | ✓ Good |
| Fail-closed rate limiting | Security-first: block on DB error, return 503 | ✓ Good (replaced fail-open in v1.2.2) |
| Resend for email | Cloudflare-compatible, developer-friendly API | ✓ Good |
| Web Crypto API for tokens | Cross-environment compatibility (Workers + Node.js) | ✓ Good |
| 64-char alphanumeric tokens | 381 bits entropy, URL-safe | ✓ Good |
| Graceful email failure | Signup succeeds even if email fails | ✓ Good |
| Best-effort audit logging | Audit failures don't break admin actions | ✓ Good |
| UNIQUE constraint on dispute review_id | One dispute per review, enforced at DB level | ✓ Good |
| Structured JSON logging | Machine-parseable logs for Cloudflare dashboard | ✓ Good |
| CityAdapter pattern for enrichment | Extensible multi-city support without modifying dispatcher | ✓ Good (v1.4.0) |
| Best-effort notifications | Notification failures don't break admin actions | ✓ Good (v1.4.0) |
| SSR bell badge for notifications | Server-rendered unread count avoids client flash | ✓ Good (v1.4.0) |
| Atomic typed-runtime cast retirement | All 89 cast sites in one PR avoids partial-migration cascade | ✓ Good (v1.5.0) |
| `fireAndForget` with `ctx.waitUntil` over queues | Canonical Workers pattern at this scale; no extra product dependency | ✓ Good (v1.5.0) |
| CSRF: SameSite=Lax + Turnstile + checkOrigin (no token) | Sufficient for current request patterns; checkOrigin JSON gap covered by Turnstile + rate limit + content-type guard | ✓ Good (v1.5.0) |
| Causal E2E assertion (capture-then-query by entity_id) | Not ordering-dependent; resilient to test parallelism | ✓ Good (v1.5.0) |
| Shared `buildRateLimitHeaders` helper | Pure function; no DB; consistent headers across 9 endpoints | ✓ Good (v1.5.0) |
| EmptyState .astro + .tsx byte-identical twins | Same DOM from SSR and React-island consumers | ✓ Good (v1.5.0) |

---
*Last updated: 2026-04-29 after v1.5.0 "Closed Loops" milestone*
