---
phase: 19
slug: d1-index-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Playwright (e2e) — neither directly tests this phase's deliverables |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npm test` (regression gate — must stay GREEN, no schema-breaking changes) |
| **Full suite command** | `npm test && npm run build && npm run test:e2e` |
| **Primary verification mechanism** | `EXPLAIN QUERY PLAN` against live D1 + `sqlite_master` index existence checks |
| **Estimated runtime** | ~2s unit, ~30s build, ~2-3min e2e |

---

## Sampling Rate

- **After every task commit:** `npm test` — confirm no test broke. Schema-only changes shouldn't affect tests, but regression gate matters.
- **After every plan wave:** `npm test && npm run build`
- **Before `/gsd:verify-work`:** Full unit suite green + e2e suite green + audit doc reviewed manually + production EXPLAIN confirms expected plan
- **Max feedback latency:** ~2 seconds (unit suite for regression check); minutes for production EXPLAIN runs

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | PERF-05 | manual + grep | `wrangler d1 execute --remote --command 'EXPLAIN QUERY PLAN ...'` (output captured in audit doc) | ❌ this phase creates audit doc | ⬜ pending |
| 19-02-01 | 02 | 2 | PERF-06, PERF-07 | sqlite_master query | `wrangler d1 execute --local --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_reviews_building_status'"` | ✅ migration template exists | ⬜ pending |
| 19-02-02 | 02 | 2 | PERF-05, PERF-06 | manual + EXPLAIN | EXPLAIN QUERY PLAN re-run after migration; verify SEARCH USING new index | N/A | ⬜ pending |
| 19-02-03 | 02 | 2 | PERF-06 | sqlite_master query | Same pattern, --remote | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders — the planner will populate exact IDs after PLAN.md generation.*

---

## Wave 0 Requirements

**No Wave 0 needed.** This phase produces no application code, no new test files, no new functions. Verification is EXPLAIN-output-based and captured in the audit doc.

The standard regression gate (`npm test` shows 322/322 still GREEN) confirms no test broke. There is no failing-test-then-make-it-pass TDD chain because the deliverable is a SQL schema delta, not code.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| EXPLAIN QUERY PLAN output captured for all 5 hot-path queries | PERF-05 | EXPLAIN output is documentation, not assertable in code | Open `.planning/audits/d1-indexes-2026-04-28.md` and confirm each of the 5 queries has: (1) SQL with file:line ref, (2) before-EXPLAIN, (3) decision, (4) after-EXPLAIN if added |
| Composite `reviews(building_id, status)` index present in production | PERF-06 | Schema introspection is the source of truth | Run `npx wrangler d1 execute ratemyplace-db --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_reviews_building_status'"` — should return 1 row |
| `buildings(city)` and `buildings(building_type)` indexes added OR documented as skipped | PERF-07 | Conditional decision recorded in audit + migration | If skipped: confirm audit doc Decisions section + migration block-comment both list the skip with reason. If added: confirm via sqlite_master query (above pattern) |
| EXPLAIN QUERY PLAN post-migration shows SEARCH USING new index | PERF-06 | Planner behavior must be visually inspected | Re-run EXPLAIN against production after migration applied; confirm output mentions `idx_reviews_building_status` (or equivalent) instead of full SCAN |
| Audit doc includes PERF-07 evidence (grep output proving zero filter queries on city/building_type) | PERF-07 | Reasoning chain must be reviewable | Open audit doc; confirm a "PERF-07 evidence" or "Conditional indexes" section quotes the `grep -rn 'city =\|building_type =' src/` output (zero matches in SELECT contexts) |
| `wrangler d1 migrations list ratemyplace-db --remote` shows `0024_perf_indexes` applied | PERF-06 | Migration application is the action | Run the command; confirm 0024 entry in the applied list with a recent timestamp |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or are explicitly manual-only with documented justification
- [ ] Sampling continuity: regression gate (`npm test`) runs after every task that touches the repo
- [ ] Wave 0 not needed — no application code in scope; documented above
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s for regression gate; minutes for production EXPLAIN
- [ ] `nyquist_compliant: true` set in frontmatter (after manual verifications complete)
- [ ] Audit doc reviewed before phase gate
- [ ] Production EXPLAIN re-run confirms expected plan before `/gsd:verify-work`

**Approval:** pending
