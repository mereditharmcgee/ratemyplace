---
phase: 04-database-foundation
plan: 03
subsystem: database
tags: [d1, sqlite, wrangler, tsx, schema-verification, pragma-table-info]

# Dependency graph
requires:
  - phase: 04-01
    provides: db-reset.ts script for dropping all tables
  - phase: 04-02
    provides: db-migrate.ts script for applying migrations

provides:
  - scripts/db-fresh.ts — combined reset+migrate+verify in single command
  - npm run db:fresh — developer and CI entry point for clean local DB

affects:
  - 05-seed-data
  - 06-playwright-local
  - 07-auth-and-review-e2e

# Tech tracking
tech-stack:
  added: []
  patterns:
    - paren-depth scanning for extracting CREATE TABLE bodies from SQL
    - CRLF normalization before regex operations on Windows-created SQL files
    - sequential subprocess orchestration with stdio inherit for clean output

key-files:
  created:
    - scripts/db-fresh.ts
  modified:
    - package.json

key-decisions:
  - "CRLF line endings in Windows-authored SQL files require explicit normalization before regex comment stripping — removeLineComments normalizes \\r\\n to \\n first"
  - "Use paren-depth scanning (findMatchingParen) not regex to extract CREATE TABLE bodies — SQL CHECK constraints contain nested parens that break greedy/lazy regex"
  - "Remove SQL line comments from CREATE TABLE body BEFORE splitTopLevel to prevent comment parentheses (e.g. fuzzy dates) from corrupting paren-depth comma splitting"
  - "Extra columns and extra tables in actual DB are warnings (not errors) — only missing tables and missing columns cause exit code 1"
  - "d1_migrations excluded from schema verification — it is wrangler internal, not created by our migration files"

patterns-established:
  - "SQL parsing pattern: normalize CRLF, strip comments, then depth-scan parens — in that order"
  - "Schema verification compares name and type only (not constraints, defaults, or nullability)"

requirements-completed: [INFRA-01]

# Metrics
duration: 18min
completed: 2026-02-28
---

# Phase 4 Plan 3: db-fresh.ts Schema Verification Summary

**Combined reset+migrate+verify script with CRLF-aware SQL parsing that derives expected schema from all 15 migration files and validates against live PRAGMA table_info**

## Performance

- **Duration:** 18 min
- **Started:** 2026-02-28T03:27:06Z
- **Completed:** 2026-02-28T03:45:28Z
- **Tasks:** 3 (2 with commits, 1 verification-only)
- **Files modified:** 2

## Accomplishments

- `scripts/db-fresh.ts` runs db-reset.ts + db-migrate.ts + schema verification in sequence via execSync with stdio inherit
- Schema parser correctly handles all 15 migrations including the 0014 audit_logs CREATE+DROP+RENAME pattern
- Running `npm run db:fresh` twice in a row succeeds (full idempotency confirmed)
- Exit code 0 on clean schema, exit code 1 on any missing table or column (CI-friendly)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create db-fresh.ts with schema verification** - `6bdd959` (feat)
2. **Task 2: Add db:fresh npm script to package.json** - `c1eb29f` (feat)
3. **Task 3: End-to-end idempotency verification** - verification only, no file changes

## Files Created/Modified

- `scripts/db-fresh.ts` — Combined reset+migrate+schema-verify script with SQL parser
- `package.json` — Added `db:fresh` script alongside `db:reset` and `db:migrate:local`

## Decisions Made

- **CRLF normalization is mandatory**: Windows-authored SQL files use `\r\n` endings. `$` in JavaScript regex without the `m` flag does not match before `\r`, so `--.*$` fails to strip SQL line comments on Windows-authored files. Fix: normalize `\r\n` → `\n` before splitting.
- **Paren-depth scanning over regex**: Used `findMatchingParen()` to extract CREATE TABLE bodies instead of a regex like `([^]*?)` because SQL CHECK constraints contain `(...)` that break regex-based extraction.
- **Comment stripping before comma splitting**: SQL comments like `-- Tenancy details (fuzzy dates for privacy)` contain parentheses. If not stripped before `splitTopLevel`, those parens increment depth and cause comma splits to be skipped, silently dropping columns.
- **Extra columns are warnings, not errors**: The verification treats unexpected columns and tables as yellow warnings but still exits 0, since migrations can't account for wrangler internals or future manual schema additions. Only missing columns/tables are hard errors (exit 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CRLF line endings prevented SQL comment stripping**
- **Found during:** Task 1 (schema verification implementation)
- **Issue:** Migration files authored on Windows use `\r\n` endings. `removeLineComments` split on `\n` so each line ended with `\r`. JavaScript `$` in regex does not match before `\r`, causing `--.*$` to fail and leaving comment text (including parentheses) in the CREATE TABLE body.
- **Fix:** Added `sql.replace(/\r\n/g, '\n').replace(/\r/g, '\n')` at the start of `removeLineComments` to normalize line endings before regex processing.
- **Files modified:** scripts/db-fresh.ts
- **Verification:** `npx tsx scripts/db-fresh.ts` — schema verified with 0 warnings/errors
- **Committed in:** 6bdd959 (Task 1 commit)

**2. [Rule 1 - Bug] Greedy regex failed to extract CREATE TABLE bodies with nested parens**
- **Found during:** Task 1 (initial schema verification implementation)
- **Issue:** First implementation used `([^]*?)` (non-greedy) in regex, which stopped at the first `)` instead of the matching closing paren. Reviews table body was truncated at first CHECK constraint.
- **Fix:** Replaced regex-based body extraction with `findMatchingParen()` that tracks paren depth to find the true closing `)` of the CREATE TABLE statement.
- **Files modified:** scripts/db-fresh.ts
- **Verification:** All 35 reviews columns parsed correctly after fix
- **Committed in:** 6bdd959 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs found during implementation)
**Impact on plan:** Both fixes were essential for correct schema parsing. No scope creep — both issues were within the schema verification feature itself.

## Issues Encountered

Three-iteration debugging process to fix schema parsing:
1. Initial regex approach (`([^]*?)`) — failed on nested parens in CHECK constraints
2. Paren-depth approach with comment stripping — failed because CRLF made comment regex no-op
3. Final fix: CRLF normalization + paren-depth + removeLineComments — all 15 migrations parsed correctly

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `npm run db:fresh` is the stable entry point for all subsequent phases needing a clean database
- Phase 5 (Seed Data) can use `db:fresh` as a prerequisite before seeding
- Phase 6 (Playwright Local) can invoke `db:fresh` in test setup/teardown
- Schema verification will catch any future migration regressions automatically

## Self-Check: PASSED

- scripts/db-fresh.ts — FOUND
- .planning/phases/04-database-foundation/04-03-SUMMARY.md — FOUND
- commit 6bdd959 (feat: db-fresh.ts) — FOUND
- commit c1eb29f (feat: db:fresh npm script) — FOUND

---
*Phase: 04-database-foundation*
*Completed: 2026-02-28*
