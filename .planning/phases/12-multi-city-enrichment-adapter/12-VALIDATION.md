---
phase: 12
slug: multi-city-enrichment-adapter
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | package.json scripts |
| **Quick run command** | `npm test -- enrichment` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- enrichment`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | ENRICH-01 | unit | `npm test -- enrichment` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | ENRICH-02, FIX-02 | unit | `npm test -- enrichment` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | ENRICH-03 | unit | `npm test -- enrichment` | ❌ W0 | ⬜ pending |
| 12-02-02 | 02 | 1 | ENRICH-04 | unit | `npm test -- enrichment` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/__tests__/enrichment.test.ts` — adapter selection, Boston mock, New Haven mock, null adapter
- [ ] Mocked fetch responses for Boston Assessing API and CT CAMA in test fixtures

*Existing 189 tests cover scoring, validation, audit, disputes, rate limiting, and email.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Boston auto-research returns same data as before | ENRICH-02 | Requires live API + admin session | Click Auto-Research on a Boston building in admin |
| New Haven auto-research returns CT CAMA data | ENRICH-03 | Requires live API + admin session | Click Auto-Research on a New Haven building in admin |
| Unsupported city shows message | ENRICH-04 | Requires admin session | Click Auto-Research on a non-Boston/NH building |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
