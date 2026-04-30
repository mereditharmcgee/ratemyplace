---
phase: 20
slug: critical-flow-e2e-coverage
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Playwright (already installed in package.json) |
| **Config file** | `playwright.config.ts` (no changes needed) |
| **Quick run command** | `npx playwright test e2e/critical-flows.spec.ts` |
| **Full suite command** | `npx playwright test` |
| **Estimated runtime** | ~30 seconds for new spec; ~3 min for full E2E suite |

---

## Sampling Rate

- **After every task commit:** Run `npx playwright test e2e/critical-flows.spec.ts` (or `e2e/security.spec.ts` for the TEST-03 refactor task)
- **After every plan wave:** Run `npx playwright test` (full E2E suite — ensures TEST-03 refactor did not break security.spec.ts)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30s for spec-level run, ~3m for full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 20-01-01 | 01 | 1 | TEST-03 | E2E refactor | `npx playwright test e2e/security.spec.ts` | ❌ W0 (fixtures.ts export) | ⬜ pending |
| 20-01-02 | 01 | 1 | TEST-01 | E2E (causal) | `npx playwright test e2e/critical-flows.spec.ts --grep "audit"` | ❌ W0 (new spec file) | ⬜ pending |
| 20-02-01 | 02 | 2 | TEST-02 | E2E (structural) | `npx playwright test e2e/critical-flows.spec.ts --grep "consistency"` | ❌ W0 (new spec + seed) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Note: Plan 20-01 bundles TEST-03 (helper extraction) + TEST-01 (causal audit-log E2E) since they share `e2e/fixtures.ts` infrastructure. Plan 20-02 is the cross-view consistency E2E (TEST-02). Final task IDs to be set by gsd-planner.*

---

## Wave 0 Requirements

- [ ] `e2e/critical-flows.spec.ts` — new file housing TEST-01 + TEST-02 assertions; does not exist yet
- [ ] `e2e/fixtures.ts` — add `clearRateLimits()` export (and `execSync` import); file exists, export missing
- [ ] `e2e/security.spec.ts` — remove inline `clearRateLimits` definition, add `import { clearRateLimits } from './fixtures'`; file exists, edit required
- [ ] `scripts/db-seed.ts` — add `building-e2e-01` (slug `test-cross-view-consistency`) to `BUILDINGS` array; re-run seed locally before tests

*Playwright is already installed; no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none) | — | All Phase 20 behaviors are automated via Playwright | — |

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (`critical-flows.spec.ts`, `fixtures.ts` export, `security.spec.ts` import, seed entry)
- [ ] No watch-mode flags (Playwright runs single-shot per spec)
- [ ] Feedback latency < 30s per spec, < 3m for full suite
- [ ] `nyquist_compliant: true` set in frontmatter (after planner completes Wave 0 task definitions)

**Approval:** pending
