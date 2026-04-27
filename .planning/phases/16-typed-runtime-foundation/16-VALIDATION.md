---
phase: 16
slug: typed-runtime-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Playwright (e2e) + TypeScript build (type-check) |
| **Config file** | `vitest.config.*` (auto-detected by Astro), `playwright.config.ts`, `tsconfig.json` |
| **Quick run command** | `npm run build` (TypeScript compile = primary gate) |
| **Full suite command** | `npm run build && npm test && npm run test:e2e` |
| **Estimated runtime** | ~30s build, ~10s unit, ~120s e2e |

---

## Sampling Rate

- **After every task commit:** Run `npm run build` (TypeScript must compile cleanly)
- **After every plan wave:** Run `npm run build && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green AND grep verification script returns zero matches across all three cast variants
- **Max feedback latency:** ~30 seconds (build) for fastest signal

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | INFRA-01 | type-check | `npm run build` | ✅ | ⬜ pending |
| 16-01-02 | 01 | 1 | INFRA-02 | type-check | `npm run build` | ✅ | ⬜ pending |
| 16-02-01 | 02 | 2 | INFRA-02 | type-check | `npm run build` | ✅ | ⬜ pending |
| 16-02-02 | 02 | 2 | INFRA-03 | grep + build | `bash scripts/verify-typed-runtime.sh` | ❌ W0 | ⬜ pending |
| 16-02-03 | 02 | 2 | INFRA-03 | e2e regression | `npm run test:e2e` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders pending planner output — planner will populate exact IDs after PLAN.md generation.*

---

## Wave 0 Requirements

- [ ] `scripts/verify-typed-runtime.sh` — grep verification script that exits non-zero if ANY of these patterns appear in `src/`:
  - `(context.locals as any).runtime`
  - `(Astro.locals as any).runtime`
  - `rawLocals as any`
  - `locals as any` (catch-all for missed variants)

*(No new framework install needed: Vitest, Playwright, and TypeScript are already configured. No test fixtures needed: existing unit tests are pure-function; e2e tests run against local Wrangler dev which provides the runtime naturally.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| IDE autocomplete works on `context.locals.runtime.env.DB` | INFRA-02 | Cannot automate IDE behavior — relies on TypeScript Language Server | Open any API route in VS Code; type `context.locals.runtime.env.` and confirm autocomplete shows `DB`, `RESEND_API_KEY`, `GOOGLE_*`, `SITE_URL`, etc., with no `any` cast |
| Cloudflare Pages secrets configured for production | INFRA-01 (deploy gate) | Out-of-band Cloudflare dashboard config | Run `wrangler pages secret list ratemyplace` — confirm all 6 secrets present in production env |

*(All other phase behaviors have automated verification via TypeScript compilation, grep, and existing e2e suite.)*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (build gate covers every task)
- [ ] Wave 0 covers all MISSING references (only `verify-typed-runtime.sh` script needed)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (build) for primary gate
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
