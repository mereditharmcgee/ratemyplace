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

### Active

- [ ] Email verification for reviewers (send verification link, validate token, show verified badge)
- [ ] Landlord dispute form (submission form, admin review queue, notification system)
- [ ] Rate limiting hardening (fail-closed on DB errors, not fail-open)

### Out of Scope

- Multi-language support — deferred to v2.0
- Delayed posting — deferred
- Landlord response features (direct rebuttals on reviews) — explicitly excluded from MVP

## Context

- **Tech stack**: Astro 5 + Cloudflare Pages + D1 (SQLite) + Lucia Auth + Tailwind CSS 4
- **Current version**: v1.1.0-alpha "Evidence-Based Scoring"
- **Production URL**: ratemyplace.boston
- **Test suite**: 122 tests passing
- **Build**: Clean, no TypeScript errors

## Constraints

- **Platform**: Cloudflare Workers (no Node.js APIs, React 18 only)
- **Email**: Need to select email provider (Resend, Mailgun, or Cloudflare Email Workers)
- **Database**: D1 (SQLite) — single-region, no transactions across requests

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Evidence-based scoring | Grounded in peer-reviewed public health research | ✓ Good |
| Fail-open rate limiting | Prevent auth breakage if migration missing | ⚠️ Revisit — security concern |
| No email service yet | Deferred to reduce scope | — Pending |

---
*Last updated: 2026-02-26 after gap analysis*
