# Roadmap: RateMyPlace Launch Prep

**Created:** 2026-02-26
**Current Milestone:** v1.2.2 "Launch Ready" (Phases 2-3)

## Milestones

- v1.2.1 Email Verification - Phase 1 (shipped 2026-02-26)
- v1.2.2 Launch Ready - Phases 2-3 (in progress)

## Phases

<details>
<summary>v1.2.1 Email Verification (Phase 1) - SHIPPED 2026-02-26</summary>

- [x] Phase 1: Email Verification (4/4 plans) - completed 2026-02-26

See: `.planning/milestones/v1.2.1-ROADMAP.md`

</details>

### v1.2.2 Launch Ready (In Progress)

---

## Phase 2: Landlord Disputes

**Goal:** Landlords can submit formal disputes about reviews, and admins can review and resolve them.

**Requirements:** DISP-01, DISP-02, DISP-03, DISP-04, DISP-05

**Plans:** 3 plans

Plans:
- [x] 02-01-PLAN.md - Foundation: database schema, URL utilities, email functions
- [x] 02-02-PLAN.md - Public dispute form at /dispute
- [x] 02-03-PLAN.md - Admin disputes queue at /admin/disputes

**Success Criteria:**
1. Public `/dispute` page with form for landlord submissions
2. Form collects: review URL, landlord info, dispute reasons, explanation
3. Disputes appear in `/admin/disputes` queue
4. Admin can view disputed review side-by-side with dispute
5. Admin can resolve dispute with status and notes

**Dependencies:** Phase 1 not required (independent)

---

## Phase 3: Security Hardening

**Goal:** Rate limiting fails safely and admin actions are audited.

**Requirements:** SEC-01, SEC-02, SEC-03

**Plans:** 3 plans

Plans:
- [ ] 03-01-PLAN.md - Fail-closed rate limiting and structured logging (SEC-01, SEC-02)
- [ ] 03-02-PLAN.md - Audit trail infrastructure and endpoint integration (SEC-03)
- [ ] 03-03-PLAN.md - Admin audit log viewer page (SEC-03)

**Success Criteria:**
1. Rate limiting returns 503 on DB error (not silent pass)
2. Rate limit errors logged with structured data
3. Admin actions (approve/reject review, resolve dispute) logged with user ID and timestamp
4. Audit log viewable in admin dashboard

**Dependencies:** None

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Email Verification | v1.2.1 | 4/4 | Complete | 2026-02-26 |
| 2. Landlord Disputes | v1.2.2 | 3/3 | Complete | 2026-02-27 |
| 3. Security Hardening | v1.2.2 | 0/3 | Planning Complete | - |

## Execution Notes

- Phases 2-3 can run in parallel (no dependencies)
- Phase 2 has 3 plans in 2 waves (Wave 1: plan-01, Wave 2: plan-02 + plan-03 in parallel)
- Phase 3 has 3 plans in 3 waves (sequential: 01 -> 02 -> 03)

---
*Roadmap updated: 2026-02-27 after Phase 3 planning*
