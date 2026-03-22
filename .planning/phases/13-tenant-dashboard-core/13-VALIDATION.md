---
phase: 13
slug: tenant-dashboard-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | package.json scripts |
| **Quick run command** | `npm test -- notifications` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | DASH-01 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | DASH-02 | manual | — React UI | N/A | ⬜ pending |
| 13-01-03 | 01 | 1 | DASH-03 | manual | — already functional | N/A | ⬜ pending |
| 13-02-01 | 02 | 2 | DASH-04 | unit | `npm test` | ❌ W0 | ⬜ pending |
| 13-02-02 | 02 | 2 | DASH-06 | unit | `npm test -- notifications` | ❌ W0 | ⬜ pending |
| 13-03-01 | 03 | 3 | DASH-06 | manual | — React UI | N/A | ⬜ pending |
| 13-03-02 | 03 | 3 | DASH-07 | manual | — Header.astro SSR | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/__tests__/notifications.test.ts` — createNotification, mark-read, unread count
- [ ] `src/lib/__tests__/userSettings.test.ts` — profile update validation, password change, email change rules
- [ ] Migration 0021 — replace `SELECT 1` stub with notifications table DDL + user notification_opt_in column

*Existing 215 tests cover scoring, validation, audit, disputes, rate limiting, email, and enrichment.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Review status labels display correctly | DASH-01 | React UI rendering | Visit /profile, check Pending/Approved/Rejected/Disputed labels |
| Rejected review shows reason + edit CTA | DASH-02 | React UI interaction | Find rejected review, verify red banner with reason and edit button |
| Verification banner with resend CTA | DASH-03 | React UI + email | Unverified user sees banner, click resend works |
| Settings tab form works | DASH-04 | React form interaction | Update display name, change password, verify saves |
| Notification bell badge in header | DASH-07 | Astro SSR rendering | Trigger a notification, verify bell shows count |
| Notifications tab shows events | DASH-06 | React UI rendering | View notifications tab, verify events listed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
