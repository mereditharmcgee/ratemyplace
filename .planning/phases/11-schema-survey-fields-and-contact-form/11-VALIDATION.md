---
phase: 11
slug: schema-survey-fields-and-contact-form
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | package.json scripts |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | SURVEY-01 | manual | — React form, E2E | N/A | ⬜ pending |
| 11-01-02 | 01 | 1 | SURVEY-02 | manual | — React form, E2E | N/A | ⬜ pending |
| 11-01-03 | 01 | 1 | SURVEY-03 | unit | `npm test -- --run` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | CONTACT-01 | manual | — React island | N/A | ⬜ pending |
| 11-02-02 | 02 | 1 | CONTACT-02 | unit | `npm test -- --run contact` | ❌ W0 | ⬜ pending |
| 11-02-03 | 02 | 1 | CONTACT-03 | unit | `npm test -- --run email` | ❌ W0 | ⬜ pending |
| 11-02-04 | 02 | 1 | CONTACT-04 | manual | — SSR auth gate | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/__tests__/email.test.ts` — add `sendContactConfirmationEmail` test with mocked Resend
- [ ] Contact API rate limiting behavior — mirror `rateLimit.test.ts` patterns for 3/hour rule
- [ ] ReviewCard null-guard behavior for new fields — verify `accepts_housing_vouchers: null` renders nothing

*Existing 171 tests cover scoring, validation, audit, disputes, and rate limiting. New tests needed only for new email function and utility logic.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Section 8 field in review form | SURVEY-01 | React form interaction | Submit review, verify field appears and saves |
| Safely lit field in review form | SURVEY-02 | React form interaction | Submit review, verify field appears and saves |
| Contact form renders with all fields | CONTACT-01 | React island rendering | Visit /contact, verify form fields and dropdown |
| Admin contact page auth-gated | CONTACT-04 | SSR auth check | Visit /admin/contact as non-admin, verify redirect |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
