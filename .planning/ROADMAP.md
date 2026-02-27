# Roadmap: RateMyPlace Launch Prep

**Created:** 2026-02-26
**Current Milestone:** v1.2.2 "Launch Ready" (Phases 2-3)

## Milestones

- ✅ **v1.2.1 Email Verification** — Phase 1 (shipped 2026-02-26)
- 🚧 **v1.2.2 Launch Ready** — Phases 2-3 (in progress)

## Phases

<details>
<summary>✅ v1.2.1 Email Verification (Phase 1) — SHIPPED 2026-02-26</summary>

- [x] Phase 1: Email Verification (4/4 plans) — completed 2026-02-26

See: `.planning/milestones/v1.2.1-ROADMAP.md`

</details>

### 🚧 v1.2.2 Launch Ready (In Progress)

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

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Email Verification | v1.2.1 | 4/4 | Complete | 2026-02-26 |
| 2. Landlord Disputes | v1.2.2 | 0/0 | Not started | - |
| 3. Security Hardening | v1.2.2 | 0/0 | Not started | - |

## Execution Notes

- Phases 2-3 can run in parallel (no dependencies)
- Estimated: 3-5 plans per phase

---
*Roadmap updated: 2026-02-26 after v1.2.1 milestone*
