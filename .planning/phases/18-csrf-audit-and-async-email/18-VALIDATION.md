---
phase: 18
slug: csrf-audit-and-async-email
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 (unit) + Playwright (e2e) |
| **Config file** | `vitest.config.ts` (environment: happy-dom), `playwright.config.ts` |
| **Quick run command** | `npm test -- runtime` (filter to runtime/fireAndForget tests, ~1s) |
| **Full suite command** | `npm test && npm run build && npm run test:e2e` |
| **Estimated runtime** | ~2s unit, ~30s build, ~2-3min e2e |

---

## Sampling Rate

- **After every task commit:** `npm test` (unit suite, ~2s — fastest signal for `fireAndForget` correctness)
- **After every plan wave:** `npm test && npm run build`
- **Before `/gsd:verify-work`:** Full unit suite green + e2e suite green (no email regression in signup/forgot/contact/disputes flows) + manual: open `.planning/audits/csrf-2026-04.md` and confirm verdict + per-category coverage table reads correctly
- **Max feedback latency:** ~2 seconds (unit suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-00-01 | 00 | 1 | PERF-01..04 | unit | `npm test -- runtime` | ❌ W0 | ⬜ pending |
| 18-01-01 | 01 | 2 | PERF-01..04 | unit | `npm test -- runtime` | ❌ W0 | ⬜ pending |
| 18-02-01..05 | 02 | 3 | PERF-01..04 | unit + e2e | `npm test && npm run test:e2e` | ✅ partial | ⬜ pending |
| 18-03-01 | 03 | 4 | SEC-06 | manual + grep | `grep -q "CSRF audit" src/middleware.ts && test -f .planning/audits/csrf-2026-04.md` | ❌ this phase creates | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders — the planner will populate exact IDs after PLAN.md generation.*

---

## Wave 0 Requirements

- [ ] `src/lib/__tests__/runtime.test.ts` — add test blocks for:
  - `fireAndForget` registers promise with `ctx.waitUntil` when `context.locals.runtime?.ctx` is available (mock ctx with a Vitest spy on `waitUntil`)
  - `fireAndForget` falls back to await-blocking (void wrapped) when `context.locals.runtime` is undefined (no throw, no silent skip)
  - `fireAndForget` calls `logError` when the wrapped promise rejects (assert via spy on logger)
  - `fireAndForget` returns `void` (TypeScript signature check + runtime undefined assertion)
  - `recipientHash(email)` produces a stable 8-char lowercase hex string (golden-test against known input)
  - `recipientHash` uses `@oslojs/crypto/sha2` synchronously (no Promise return)

*(Existing unit tests cover validation, scoring, password, etc. None touch `runtime.ts`. The existing `getEnv` test in `runtime.test.ts` — if it exists — stays untouched. New `fireAndForget` tests are independent.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Audit doc reads correctly and is per-endpoint-category structured | SEC-06 | Doc quality / readability cannot be automated | Open `.planning/audits/csrf-2026-04.md` and confirm: (1) verdict in opening paragraph, (2) per-endpoint-category section, (3) explicit note that `checkOrigin` does NOT cover JSON requests, (4) date stamp, (5) no calendar revisit deadline |
| Inline middleware.ts comment is clear and points to audit doc | SEC-06 | Comment quality cannot be automated | `grep -A 5 "CSRF audit" src/middleware.ts` — verify a 2-8 line comment with verdict + path to audit doc |
| CLAUDE.md Security Checklist now mentions CSRF | SEC-06 | Doc placement cannot be automated | Open CLAUDE.md, find "Security Checklist when adding new endpoints" section, confirm a CSRF subsection / paragraph was appended (not a new top-level section, not a Quick Reference table row) |
| Signup/forgot/resend-verification/contact/disputes return success BEFORE email completes | PERF-01..04 | E2E covers status code; manual check confirms perceived perf | In Wrangler dev, submit signup → response should arrive in <100ms (vs. ~500ms+ before) — observe via DevTools Network tab |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (only `runtime.test.ts` new blocks needed)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s (unit suite gate)
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] Audit doc + middleware.ts comment + CLAUDE.md note all manually reviewed before phase gate

**Approval:** pending
