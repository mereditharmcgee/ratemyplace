---
phase: 05-seed-data
plan: 01
subsystem: database
tags: [wrangler, d1, sqlite, typescript, seed-data, pbkdf2]

# Dependency graph
requires:
  - phase: 04-database-foundation
    provides: Local D1 database with full schema via 15 migrations (db:fresh, db:reset, db:migrate:local all working)

provides:
  - scripts/db-seed.ts — Deterministic seed script with 8 users, 10 landlords, 30 buildings via wrangler --file batches
  - npm run db:seed — Runs seed script
  - npm run db:setup — Chains db:fresh and db:seed for one-command database setup
  - assertDatabaseEmpty guard — Prevents double-seeding with clear error message

affects:
  - 05-02-PLAN.md (reviews, disputes, scores — extends this script)
  - 06-playwright-local-environment (relies on seed data for E2E fixture state)
  - 07-auth-review-e2e (uses test user credentials from seed)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - executeSqlBatch via wrangler --file for multi-row inserts (avoids shell escaping issues on Windows)
    - Pre-computed PBKDF2-SHA256 hash with fixed salt for deterministic test user passwords
    - Hardcoded IDs (user-test-01, landlord-01, building-01) for E2E test determinism
    - assertDatabaseEmpty guard pattern for idempotent seed scripts

key-files:
  created:
    - scripts/db-seed.ts
  modified:
    - package.json

key-decisions:
  - "Use --file (not --command) for INSERT batches to avoid shell escaping issues with text content on Windows"
  - "Hardcode TEST_PASSWORD_HASH constant (PBKDF2-SHA256, fixed salt seed-data-fixed!) — runtime hashPassword() uses random salt and would be non-deterministic"
  - "5 buildings with null landlord_id to model realistic unknown-landlord scenario"
  - "All IDs deterministic (user-test-01, landlord-01, building-01..30) for stable E2E test assertions"

patterns-established:
  - "Seed scripts use assertDatabaseEmpty guard — fail fast with clear error if data exists, exit 0 if table missing (pre-migration state)"
  - "executeSqlBatch: join statements with semicolons, write to tmpdir(), replace backslashes for Windows path compatibility"
  - "escapeSql helper doubles single quotes for safe SQL string embedding"

requirements-completed: [INFRA-02]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 5 Plan 01: Seed Data (Users, Landlords, Buildings) Summary

**Deterministic D1 seed script inserting 8 users with pre-computed PBKDF2-SHA256 hash, 10 Boston landlords, and 30 buildings across 8 neighborhoods using wrangler --file batches**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-28T03:58:51Z
- **Completed:** 2026-02-28T04:04:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `scripts/db-seed.ts` with full guard check, helper functions, data constants, and insert logic for users, landlords, and buildings
- Pre-computed PBKDF2-SHA256 hash (`c2VlZC1kYXRhLWZpeGVkIQ==$zPq112lY6xQgERHp7qyvo1/GPu4jFFXq6S5DOIiupXg=`) for TestPassword123! with fixed salt — fully deterministic, verified against `verifyPassword()` from `src/lib/password.ts`
- 30 buildings spread across Allston (6), Back Bay (4), Dorchester (4), Jamaica Plain (4), South End (4), Fenway (3), Brighton (3), Roxbury (2) with 5 buildings having null landlord_id
- Added `db:seed` and `db:setup` npm scripts — `db:setup` chains `db:fresh` and `db:seed` for one-command database reset+seed

## Task Commits

Each task was committed atomically:

1. **Task 1: Create db-seed.ts with helpers, data constants, and insert logic for users, landlords, and buildings** - `772d310` (feat)
2. **Task 2: Add db:seed and db:setup npm scripts to package.json** - `65de50a` (feat)

## Files Created/Modified

- `scripts/db-seed.ts` — Seed script with wranglerQuery, executeSqlBatch, run, assertDatabaseEmpty, escapeSql helpers; USERS (8), LANDLORDS (10), BUILDINGS (30) data constants; insertUsers, insertLandlords, insertBuildings functions; synchronous main()
- `package.json` — Added `db:seed` and `db:setup` scripts after existing `db:fresh` entry

## Decisions Made

- Used `--file` (not `--command`) for INSERT batches to avoid shell escaping issues with multi-line text content on Windows
- Hardcoded `TEST_PASSWORD_HASH` constant rather than calling `hashPassword()` at runtime — `hashPassword()` uses `crypto.getRandomValues()` and would produce a different hash on every run, breaking E2E test determinism
- 5 buildings have `null` landlord_id to model a realistic unknown-landlord scenario
- All IDs are deterministic hardcoded strings (user-test-01, landlord-01, building-01 through building-30) so E2E tests can assert on specific values

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (05-02) can now extend db-seed.ts with reviews, disputes, and score computation
- Test user credentials (`user@test.ratemyplace.local`, `admin@test.ratemyplace.local`, `pending@test.ratemyplace.local`) with password `TestPassword123!` are available for E2E tests
- `npm run db:setup` provides one-command database reset for E2E test setup
- Double-seed guard prevents data corruption when tests run `db:seed` twice

---
*Phase: 05-seed-data*
*Completed: 2026-02-28*
