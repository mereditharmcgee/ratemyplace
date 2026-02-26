# Roadmap: RateMyPlace Launch Prep

**Created:** 2026-02-26
**Milestone:** v1.2.0-beta "Launch Ready"

## Overview

| Phases | Requirements | Focus |
|--------|--------------|-------|
| 3 | 13 | Fix critical gaps for launch |

## Phase Summary

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | Email Verification | Users can verify email and display verified badge | EMAIL-01 through EMAIL-05 | 5 |
| 2 | Landlord Disputes | Landlords can submit disputes, admins can review | DISP-01 through DISP-05 | 5 |
| 3 | Security Hardening | Rate limiting fails safely, admin audit trail | SEC-01 through SEC-03 | 3 |

---

## Phase 1: Email Verification

**Goal:** Users receive verification emails after signup and verified users display a badge on their reviews.

**Requirements:** EMAIL-01, EMAIL-02, EMAIL-03, EMAIL-04, EMAIL-05

**Plans:** 4 plans

Plans:
- [x] 01-01-PLAN.md — Database schema and token management library (completed 2026-02-26)
- [x] 01-02-PLAN.md — Email verified badge on reviews (completed 2026-02-26)
- [ ] 01-03-PLAN.md — Resend integration and signup email
- [ ] 01-04-PLAN.md — Verification endpoints and profile UI

**Success Criteria:**
1. User receives email with verification link within 60 seconds of signup
2. Clicking verification link marks `email_verified = true` in database
3. Reviews from verified users show "Verified" badge
4. Unverified users can still submit reviews (no blocking)
5. User can request new verification email from profile

**Dependencies:** Email service provider (Resend recommended for Cloudflare)

---

## Phase 2: Landlord Disputes

**Goal:** Landlords can submit formal disputes about reviews, and admins can review and resolve them.

**Requirements:** DISP-01, DISP-02, DISP-03, DISP-04, DISP-05

**Success Criteria:**
1. Public `/dispute` page with form for landlord submissions
2. Form collects: building, review (optional), landlord info, explanation
3. Disputes appear in `/admin/disputes` queue
4. Admin can view disputed review side-by-side with dispute
5. Admin can resolve dispute with status and notes

**Dependencies:** Phase 1 not required (independent)

---

## Phase 3: Security Hardening

**Goal:** Rate limiting fails safely and admin actions are audited.

**Requirements:** SEC-01, SEC-02, SEC-03

**Success Criteria:**
1. Rate limiting returns 503 on DB error (not silent pass)
2. Rate limit errors logged with structured data
3. Admin actions (approve/reject review, resolve dispute) logged with user ID and timestamp
4. Audit log viewable in admin dashboard

**Dependencies:** None

---

## Execution Notes

- Phases can run in parallel (no dependencies between them)
- Estimated: 3-5 plans per phase
- Email provider decision needed before Phase 1 planning

---
*Roadmap created: 2026-02-26*
