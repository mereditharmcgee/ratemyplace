# RateMyPlace Boston

## What This Is

A public health-focused tenant housing review platform for Boston renters. Tenants rate their apartment unit, building, and landlord using a 27-item structured survey grounded in validated housing quality research (OHQS, PHQS, WHO LARES). Addresses information asymmetry in rental markets by giving tenants a way to research landlords before signing a lease.

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

### Active

(None — next milestone TBD)

## Latest Milestone: v1.3.0 "Battle Tested" (Shipped 2026-03-10)

**Delivered:** Comprehensive E2E test suite (170+ tests) covering auth flows, review submission, admin workflows, dispute handling, and security controls. 21/25 requirements met; 4 stress testing requirements deferred.

### Out of Scope

- Multi-language support — deferred to v2.0
- Delayed posting — deferred
- Landlord response features (direct rebuttals on reviews) — explicitly excluded from MVP

## Context

- **Tech stack**: Astro 5 + Cloudflare Pages + D1 (SQLite) + Lucia Auth + Tailwind CSS 4 + Resend
- **Current version**: v1.3.0 "Battle Tested" (shipped 2026-03-10)
- **Production URL**: ratemyplace.boston
- **Database tables**: 10 (users, sessions, reviews, buildings, landlords, property_managers, email_verification_tokens, rate_limits, disputes, audit_logs)
- **Admin pages**: Dashboard, Users, Reviews, Buildings, Landlords, Managers, Verification, Disputes, Audit Log

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

---
*Last updated: 2026-03-10 after v1.3.0 milestone*
