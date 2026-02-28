# Phase 4: Database Foundation - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Local D1 database can be fully reset, migrated, and verified with a single npm command. Delivers `npm run db:reset`, `npm run db:migrate:local`, and `npm run db:fresh` (reset + migrate). Must be idempotent — running db:fresh twice in a row succeeds without errors.

</domain>

<decisions>
## Implementation Decisions

### Console output
- Step-by-step progress: one line per action ("Dropping users... Dropping reviews... Migrating 0001... Done")
- Color + emoji formatting (green checkmarks, red errors, bold step names)
- Full error context on failure: which step failed, the SQL error, and which migration/table was involved
- Scripts stop on first error (fail fast)

### Script language and structure
- TypeScript scripts, run via `npx tsx` (matches existing smoke-test.ts pattern)
- Separate files per operation: `scripts/db-reset.ts`, `scripts/db-migrate.ts`, `scripts/db-fresh.ts`
- Interact with local D1 via wrangler CLI (`wrangler d1 execute`, `wrangler d1 migrations apply --local`)
- npm scripts in package.json: `db:reset`, `db:migrate:local`, `db:fresh`

### Reset strategy
- Query `sqlite_master` dynamically to discover all tables — never goes stale when tables are added
- Drop everything including `d1_migrations` table — truly clean slate
- Disable foreign key checks (`PRAGMA foreign_keys=OFF`) before drops to avoid constraint errors on drop order
- Re-enable FK checks after drops complete

### Migration approach
- Use `wrangler d1 migrations apply --local` — the official migration system, matches production behavior
- All 15 existing migration files (0001 through 0015) applied in order

### Verification
- Full schema comparison after db:fresh completes
- Expected schema derived from parsing migration SQL files — single source of truth, always in sync
- On success: quiet pass ("Schema verified")
- On failure: detailed diff showing exactly what differs (missing tables, wrong columns, etc.)
- Exit code 1 on verification failure — CI-friendly

### Claude's Discretion
- Fail-fast vs continue behavior per step (user said "you decide")
- Exact wrangler CLI invocation patterns and error parsing
- How to parse migration SQL files for schema derivation
- Shared utility code between scripts (if any)

</decisions>

<specifics>
## Specific Ideas

- Scripts should feel like standard Node.js tooling — `npx tsx scripts/db-fresh.ts` style
- Existing pattern to follow: `scripts/smoke-test.ts` is already a TypeScript script run via `npx tsx`
- 15 migrations exist (0001_initial.sql through 0015_password_reset_tokens.sql)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-database-foundation*
*Context gathered: 2026-02-27*
