---
phase: 04-database-foundation
plan: 01
subsystem: database
tags: [sqlite, d1, wrangler, typescript, tsx, database-tooling]

# Dependency graph
requires: []
provides:
  - "scripts/db-reset.ts: dynamically discovers and drops all user tables from local D1"
  - "npm run db:reset: CLI entry point for local database clean-slate reset"
affects: [05-seed-data, 06-playwright-local-environment, 07-auth-and-review-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Topological sort of tables via PRAGMA foreign_key_list before drop to satisfy D1 local FK validation"
    - "Individual --command calls per DROP TABLE (not --file) to avoid wrangler local path/validation bugs"
    - "ANSI color output following smoke-test.ts pattern (GREEN/RED/BOLD/RESET constants)"
    - "Fail-fast run() helper with process.exit(1) on any error"

key-files:
  created:
    - scripts/db-reset.ts
  modified:
    - package.json

key-decisions:
  - "Used --command per table instead of --file: wrangler 4.50 --file validates FK-referenced table existence even with PRAGMA foreign_keys=OFF, causing failures when any referenced table is missing"
  - "Topological sort of tables: D1 local validates FK chains during DROP even with foreign_keys=OFF, so referencing tables must be dropped before the tables they reference"
  - "Excluded sqlite_sequence and _cf_METADATA from drops (SQLite/Cloudflare internals)"
  - "d1_migrations is dropped as part of clean slate (so migrations can be re-applied from scratch)"

patterns-established:
  - "Topological-sort-before-drop: any script dropping multiple tables with FK relationships must sort by dependency order"
  - "wrangler --command over --file for local D1: avoids Windows path issues and FK validation bugs in wrangler 4.x"

requirements-completed: [INFRA-01]

# Metrics
duration: 35min
completed: 2026-02-28
---

# Phase 4 Plan 01: DB Reset Script Summary

**Dynamic local D1 database reset via sqlite_master discovery with topological drop ordering to handle wrangler FK validation constraints**

## Performance

- **Duration:** 35 min
- **Started:** 2026-02-28T03:12:50Z
- **Completed:** 2026-02-28T03:47:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `scripts/db-reset.ts` that dynamically discovers all user tables via `sqlite_master`
- Implemented topological sort of FK dependencies to satisfy wrangler D1 local's FK validation
- Script drops all 17 user tables (including `d1_migrations`) in correct order, preserving SQLite/CF internals
- Added `npm run db:reset` entry point to package.json
- Script handles empty database gracefully (idempotent)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create db-reset.ts script** - `734996f` (feat)
2. **Task 2: Add db:reset npm script to package.json** - `0102633` (feat)

**Plan metadata:** (final docs commit - see below)

## Files Created/Modified
- `scripts/db-reset.ts` - Dynamically discovers tables, computes topological drop order, drops all user tables with ANSI color progress output
- `package.json` - Added `db:reset` script entry pointing to `npx tsx scripts/db-reset.ts`

## Decisions Made
- Used individual `--command` calls per `DROP TABLE` instead of `--file`: wrangler 4.50 `--file` validates FK-referenced table existence even with `PRAGMA foreign_keys=OFF`, causing failures when any referenced table is missing from the database.
- Implemented topological sort using PRAGMA `foreign_key_list()`: D1 local validates FK chains during DROP regardless of `foreign_keys` setting, so tables that reference others must be dropped before their FK targets.
- Excluded `sqlite_sequence` and `_cf_METADATA` from the drop list per plan requirements.
- Included `d1_migrations` in the drop list to enable clean re-migration from scratch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced --file approach with --command per table**
- **Found during:** Task 1 (Create db-reset.ts script)
- **Issue:** Plan specified writing SQL to a temp file and executing via `wrangler d1 execute --file`. Wrangler 4.50 local mode validates that FK-referenced tables exist even with `PRAGMA foreign_keys=OFF`, causing "no such table: main.users: SQLITE_ERROR" when executing multi-table DROP files.
- **Fix:** Switched to issuing individual `execSync` calls with `--command` per table. The `--command` path does not trigger the same FK validation behavior.
- **Files modified:** scripts/db-reset.ts
- **Verification:** `npx tsx scripts/db-reset.ts` runs successfully dropping all 17 tables from a fully migrated local D1 database.
- **Committed in:** `734996f` (Task 1 commit)

**2. [Rule 1 - Bug] Added topological sort of tables before dropping**
- **Found during:** Task 1 (Create db-reset.ts script)
- **Issue:** Even with individual `--command` drops, wrangler D1 local throws "no such table: main.X" when dropping a table that is FK-referenced by another table still in the database (e.g. cannot drop `buildings` while `reviews` still exists and has FK to `buildings`). `PRAGMA foreign_keys=OFF` does not disable this check in D1 local.
- **Fix:** Added `topoSort()` function using Kahn's algorithm on `PRAGMA foreign_key_list()` results. Referencing tables (leaves) are dropped first; FK-target tables (roots) are dropped last.
- **Files modified:** scripts/db-reset.ts
- **Verification:** Full 17-table drop succeeds in correct order: leaf tables (audit_logs, sessions, review_votes, etc.) drop before root tables (users, buildings, landlords).
- **Committed in:** `734996f` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug)
**Impact on plan:** Both fixes required for correctness on this wrangler version. The dynamic discovery and clean-slate reset goal is fully achieved. No scope creep.

## Issues Encountered
- wrangler 4.50.0 local D1 `--file` execution validates FK-referenced table existence even with `PRAGMA foreign_keys=OFF` — this is a wrangler-specific behavior not documented in D1 docs. Resolved by using individual `--command` calls and topological sort.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `db:reset` is ready for use in Phase 5 (seed data) and Phase 6 (Playwright local environment)
- Reset + re-migrate pattern: `npm run db:reset && npx wrangler d1 migrations apply ratemyplace-db --local`
- Script is idempotent (runs cleanly on empty database)
- No blockers for subsequent phases

---
*Phase: 04-database-foundation*
*Completed: 2026-02-28*
