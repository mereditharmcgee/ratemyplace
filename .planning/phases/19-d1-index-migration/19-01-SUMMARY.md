---
phase: 19-d1-index-migration
plan: 01
subsystem: database
tags: [sqlite, d1, cloudflare, wrangler, explain-query-plan, indexes, performance]

requires:
  - phase: 17-public-endpoint-security
    provides: rate-limiting infrastructure (rateLimit.ts query being audited)
  - phase: 18-csrf-audit-and-async-email
    provides: .planning/audits/ directory convention established by csrf-2026-04.md

provides:
  - .planning/audits/d1-indexes-2026-04-28.md with per-query EXPLAIN QUERY PLAN evidence for all 5 hot-path queries
  - Decisions Summary specifying exactly which CREATE INDEX statements Plan 19-02 must write
  - PERF-07 skip verdict with grep evidence (zero SELECT WHERE on city/building_type in src/)
  - Rate-limits composite skip verdict (idx_rate_limits_key already covers equality predicate)

affects: [19-d1-index-migration plan 02, PERF-05, PERF-06, PERF-07]

tech-stack:
  added: []
  patterns:
    - "EXPLAIN QUERY PLAN captured via npx wrangler d1 execute --remote --command using temp-file cat pattern (not heredoc — Windows bash heredoc collapses multi-line SQL)"
    - "Audit doc filename uses full date (YYYY-MM-DD) for runtime-state snapshots vs yearmonth for posture docs"

key-files:
  created:
    - .planning/audits/d1-indexes-2026-04-28.md
  modified: []

key-decisions:
  - "idx_reviews_building_status (building_id, status) composite added — PERF-06 unconditional; planner uses idx_reviews_status alone on all 3 search join queries today"
  - "idx_rate_limits_key_created skipped — SEARCH USING INDEX idx_rate_limits_key confirms equality predicate already covered; in-memory created_at filter is at most ~60 rows per window"
  - "idx_buildings_city and idx_buildings_building_type skipped — grep confirms zero SELECT WHERE on these columns anywhere in src/"
  - "Wrangler heredoc pattern fails on Windows bash (multi-line SQL collapses); workaround: write single-line SQL to /tmp/*.sql then use --command $(cat /tmp/file.sql)"

patterns-established:
  - "D1 audit docs: date-stamped snapshot files in .planning/audits/, never edited in place, future re-audits create new files"
  - "EXPLAIN evidence rule: SEARCH ... USING INDEX = skip; SCAN TABLE (no USING INDEX) = add; ambiguous = add"
  - "PERF-07 pattern: grep src/ for SELECT WHERE usage before writing conditional indexes; document grep output verbatim in audit doc"

requirements-completed:
  - PERF-05
  - PERF-07

duration: 8min
completed: 2026-04-29
---

# Phase 19 Plan 01: D1 Index Audit Summary

**EXPLAIN QUERY PLAN run against production D1 for all 5 hot-path queries; composite idx_reviews_building_status confirmed necessary, PERF-07 and rate-limits composite confirmed skippable with documented evidence**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-29T00:32:44Z
- **Completed:** 2026-04-29T00:40:00Z
- **Tasks:** 2
- **Files modified:** 1 (audit doc created)

## Accomplishments

- Ran EXPLAIN QUERY PLAN against production D1 for Queries 1-4 using `npx wrangler d1 execute ratemyplace-db --remote --command "$(cat /tmp/q.sql)"` pattern
- Ran grep for PERF-07 filter query discovery — confirmed zero SELECT WHERE on city/building_type in src/
- Created complete audit doc at `.planning/audits/d1-indexes-2026-04-28.md` with raw EXPLAIN output, per-query decisions, and Decisions Summary
- Locked exact migration spec for Plan 19-02: one index to add (composite), three to skip (rate-limits composite, both PERF-07)
- 322/322 unit tests GREEN (regression gate — no app code touched)

## Task Commits

1. **Task 1: Run EXPLAIN QUERY PLAN audit (all 5 hot-path queries)** — no file output, results buffered in memory for Task 2
2. **Task 2: Write audit document** — `0761cd5` (docs)

**Plan metadata:** (this commit, see below)

## Files Created/Modified

- `.planning/audits/d1-indexes-2026-04-28.md` — Complete EXPLAIN audit with 5 query sections, raw wrangler JSON output verbatim, per-query decisions, and Decisions Summary for Plan 19-02 to consume

## Decisions Made

**idx_reviews_building_status — Add (PERF-06 unconditional):**
Queries 1, 2, and 3 all show `SEARCH r USING INDEX idx_reviews_status (status=?)` for the LEFT JOIN ON-clause filter `r.building_id = b.id AND r.status = 'approved'`. The planner picks the status-only index (one predicate) and then filters on building_id afterward. The composite (building_id, status) satisfies both predicates in a single lookup — more selective than the status-only index for any individual building.

**idx_rate_limits_key_created — Skip:**
Query 4 shows `SEARCH rate_limits USING INDEX idx_rate_limits_key (rate_key=?)`. The equality predicate is already covered. The `created_at > ?` range filter runs against the small in-memory set of rows for that rate_key (max ~60 per window; a DELETE cleanup runs before every check). No composite needed.

**idx_buildings_city, idx_buildings_building_type — Skip (PERF-07):**
grep confirms both columns appear only as UPDATE SET assignments in the admin PATCH endpoint (`src/pages/api/admin/buildings/[id].ts:72,92`). There are zero SELECT WHERE filter queries on these columns anywhere in src/. Indexes without queries to satisfy are pure write overhead.

**Wrangler heredoc workaround:**
The heredoc-to-command pattern from 19-RESEARCH.md (`--command "$(cat <<'SQL' ... SQL)"`) fails on Windows bash — multi-line content gets collapsed causing SQLite "incomplete input" errors. Workaround: write single-line SQL to `/tmp/q.sql` then use `--command "$(cat /tmp/q.sql)"`. This pattern works reliably and avoids all shell-quoting issues with embedded single quotes.

## Deviations from Plan

None — plan executed exactly as written. The heredoc issue was an execution-environment adaptation (Windows bash), not a plan deviation. The `/tmp/q.sql` workaround achieves the same outcome as the heredoc pattern.

## Issues Encountered

- **Wrangler heredoc pattern fails on Windows bash**: The `--command "$(cat <<'SQL' ... SQL)"` pattern produces "incomplete input: SQLITE_ERROR" because Windows bash collapses multi-line heredoc content before the shell expansion is evaluated. Workaround: write SQL to a temp file (`/tmp/q.sql`) and use `--command "$(cat /tmp/q.sql)"`. This should be documented as a Windows-specific pitfall if Phase 19 research is ever updated.

## User Setup Required

None — no external service configuration required. This plan is read-only EXPLAIN + documentation only.

## Next Phase Readiness

Plan 19-02 has a complete, unambiguous spec:
- **Always add:** `CREATE INDEX IF NOT EXISTS idx_reviews_building_status ON reviews(building_id, status)`
- **Always skip:** `idx_rate_limits_key_created`, `idx_buildings_city`, `idx_buildings_building_type`
- The audit doc's Decisions Summary section is the authoritative source for the migration block-comment header

Before Plan 19-02 runs, no blockers. The audit doc is the only Plan 19-01 deliverable and it is complete.

---
*Phase: 19-d1-index-migration*
*Completed: 2026-04-29*
