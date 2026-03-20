---
phase: 10
slug: foundations-and-legal-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit), Playwright (E2E) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npx playwright test` |
| **Estimated runtime** | ~30 seconds (unit), ~120 seconds (E2E) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && npx playwright test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | UGC-01 | manual | Visual check on building pages | N/A | pending |
| 10-02-01 | 02 | 1 | UGC-02 | E2E | `npx playwright test review.spec.ts` | yes | pending |
| 10-02-02 | 02 | 1 | UGC-03 | manual | Visual check on terms.astro | N/A | pending |
| 10-02-03 | 02 | 1 | UGC-04 | manual | Visual check on about.astro | N/A | pending |
| 10-03-01 | 03 | 2 | ADMIN-01 | E2E | `npx playwright test admin.spec.ts` | yes | pending |
| 10-03-02 | 03 | 2 | ADMIN-02 | E2E | `npx playwright test admin.spec.ts` | yes | pending |
| 10-03-03 | 03 | 2 | ADMIN-03 | E2E | `npx playwright test admin.spec.ts` | yes | pending |
| 10-04-01 | 04 | 1 | FIX-01 | unit | `npm test -- privacy` | yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Unit tests via vitest, E2E tests via Playwright already configured and passing (171 unit, 170+ E2E).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UGC disclaimer visible on building pages | UGC-01 | Visual placement/styling check | Navigate to a building page with reviews, verify disclaimer text appears at footer of review section |
| ToS Section 230 language adequate | UGC-03 | Legal content review | Read /terms page, confirm Section 230 safe harbor, content responsibility, removal policy sections present |
| About page framing correct | UGC-04 | Tone/framing review | Read /about page, confirm platform is positioned as hosting tenant experiences |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
