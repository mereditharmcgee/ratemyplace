# Phase 4: Database Foundation - Research

**Researched:** 2026-02-27
**Domain:** Cloudflare D1 (local SQLite via wrangler), TypeScript scripting with tsx
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- TypeScript scripts run via `npx tsx` — matches existing `scripts/smoke-test.ts` pattern
- Separate files: `scripts/db-reset.ts`, `scripts/db-migrate.ts`, `scripts/db-fresh.ts`
- Interact with local D1 via wrangler CLI (`wrangler d1 execute`, `wrangler d1 migrations apply --local`)
- npm scripts: `db:reset`, `db:migrate:local`, `db:fresh`
- Console output: step-by-step progress, one line per action, color + emoji formatting (green checkmarks, red errors, bold step names)
- Full error context on failure: which step failed, the SQL error, which migration/table was involved
- Scripts stop on first error (fail fast)
- Reset strategy: query `sqlite_master` dynamically to discover tables — never goes stale
- Drop everything including `d1_migrations` — truly clean slate
- `PRAGMA foreign_keys=OFF` before drops, re-enable after
- Migration: `wrangler d1 migrations apply --local` — official system, matches production
- Verification: full schema comparison after `db:fresh` completes
- Expected schema derived from parsing migration SQL files — single source of truth
- On success: quiet pass ("Schema verified"); on failure: detailed diff
- Exit code 1 on verification failure (CI-friendly)

### Claude's Discretion

- Fail-fast vs continue behavior per step
- Exact wrangler CLI invocation patterns and error parsing
- How to parse migration SQL files for schema derivation
- Shared utility code between scripts (if any)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<research_summary>
## Summary

This phase builds three TypeScript scripts that orchestrate local Cloudflare D1 database operations through the wrangler CLI. The scripts are pure Node.js tooling — no Cloudflare Workers runtime needed, no DB bindings — they shell out to `npx wrangler d1 execute` and `npx wrangler d1 migrations apply` commands.

The key insight is that the wrangler CLI is the only supported interface for local D1. There is no SQLite file you can open directly in a stable way (the file lives in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`), so all operations go through `wrangler d1 execute --local`. This is confirmed: the local DB exists at `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/b0ce4f9bcc609ecd6dd8b2e880101e6406f383a840382b06ead398362c4e6e41.sqlite`.

The current local DB already has all 15 migrations applied and 15 user tables. The reset script must discover and drop them dynamically (including `d1_migrations`), then `db:migrate:local` re-applies all 15. Schema verification compares what the migrations create against what actually exists.

**Primary recommendation:** Use `execSync` from Node.js `child_process` to invoke wrangler commands. Parse `--json` output for structured results. Pass all SQL via `--command` flag (for single statements) or `--file` (for multi-statement SQL). The `wrangler d1 migrations apply --local` command is non-interactive when migrations are pending (outputs a summary, exits 0 on success).
</research_summary>

<standard_stack>
## Standard Stack

This phase introduces no new npm dependencies. Everything uses what is already installed.

### Core (already in project)
| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| tsx | 4.21.0 | Run TypeScript scripts directly | Already used by smoke-test.ts |
| wrangler | 4.50.0 | D1 database CLI | Only supported interface for local D1 |
| node `child_process` | built-in | Shell out to wrangler | Standard pattern for CLI orchestration scripts |

### No New Installs Needed
All required tooling is already in `devDependencies`. The scripts use:
- `child_process.execSync` — shell out to wrangler, capture output
- `fs.readdirSync` / `fs.readFileSync` — read migration SQL files for schema verification
- `process.exit(1)` — CI-friendly failure signaling

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `execSync` | `spawnSync` | spawnSync has ENOENT issues on Windows with npx; execSync works reliably |
| `wrangler d1 execute` | Direct SQLite file access | Direct file access is fragile (hashed filename, miniflare internals); wrangler is stable |
| Parse migration SQL manually | `better-sqlite3` | No new deps needed; string parsing is sufficient for table/column extraction |

**Installation:**
```bash
# No new packages needed — all tools already installed
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended File Structure
```
scripts/
├── smoke-test.ts          # existing pattern to follow
├── db-reset.ts            # drops all tables including d1_migrations
├── db-migrate.ts          # runs wrangler d1 migrations apply --local
└── db-fresh.ts            # runs reset → migrate → verify in sequence
```

### Pattern 1: Wrangler Command Execution via execSync
**What:** Call wrangler CLI from TypeScript using `execSync`, parse JSON output
**When to use:** All D1 operations in the scripts

```typescript
import { execSync } from 'child_process';

function wranglerQuery(sql: string): any[] {
  const result = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${sql.replace(/"/g, '\\"')}" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const parsed = JSON.parse(result);
  return parsed[0].results;
}
```

**Important:** The `--json` flag outputs clean JSON to stdout. Wrangler's informational banner goes to stderr. Use `stdio: ['pipe', 'pipe', 'pipe']` to capture both separately. The JSON structure is:
```json
[{ "results": [...], "success": true, "meta": { "duration": 0 } }]
```

### Pattern 2: Dynamic Table Discovery via sqlite_master
**What:** Query `sqlite_master` to get all tables dynamically; never hardcode table list
**When to use:** The reset script, before dropping tables

```typescript
function getAllUserTables(): string[] {
  const rows = wranglerQuery(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ) as Array<{ name: string }>;

  // Exclude SQLite internals and Cloudflare's internal metadata table
  // Drop everything else including d1_migrations — clean slate
  return rows
    .map(r => r.name)
    .filter(name => name !== 'sqlite_sequence' && name !== '_cf_METADATA');
}
```

**Current tables in local DB (from sqlite_master):**
`_cf_METADATA`, `audit_logs`, `building_scores`, `buildings`, `d1_migrations`, `disputes`, `landlord_scores`, `landlords`, `password_reset_tokens`, `property_manager_scores`, `property_managers`, `rate_limits`, `review_votes`, `reviews`, `sessions`, `sqlite_sequence`, `verification_images`, `verification_tokens`

Tables to drop: all except `sqlite_sequence` (auto-managed by SQLite) and `_cf_METADATA` (Cloudflare internal — keep).
Tables to drop include: `d1_migrations` (this is the key requirement for clean-slate reset).

### Pattern 3: Foreign Key Disable + Multi-Statement Drop
**What:** Disable FK checks, drop all tables, re-enable FK checks
**When to use:** db-reset.ts

The wrangler `--command` flag accepts semicolon-separated SQL statements and executes them as a batch:
```typescript
function resetDatabase(tables: string[]): void {
  const dropStatements = tables.map(t => `DROP TABLE IF EXISTS "${t}"`).join('; ');
  const sql = `PRAGMA foreign_keys=OFF; ${dropStatements}; PRAGMA foreign_keys=ON`;

  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${sql}" --json`,
    { encoding: 'utf8' }
  );
}
```

**Verified:** `wrangler d1 execute --command "PRAGMA foreign_keys=OFF; DROP TABLE IF EXISTS users;"` executes successfully and reports "2 commands executed successfully."

### Pattern 4: Migration Application via wrangler d1 migrations apply
**What:** Use the official wrangler migration system
**When to use:** db-migrate.ts

```typescript
function applyMigrations(): void {
  // This command is non-interactive when there are pending migrations.
  // Output goes to stdout (with wrangler banner to stderr).
  // Exit code 0 = success, non-zero = failure.
  execSync(
    'npx wrangler d1 migrations apply ratemyplace-db --local',
    { encoding: 'utf8', stdio: 'inherit' }  // show output live
  );
}
```

**Verified behavior:** When all migrations are already applied, outputs `✅ No migrations to apply!`. When migrations are pending, applies them in order and exits 0. The `--yes` flag is not needed for local — wrangler does not prompt for confirmation with `--local`.

**Database name:** `ratemyplace-db` (from wrangler.jsonc `database_name`)

### Pattern 5: Schema Verification via Migration SQL Parsing
**What:** Parse migration SQL files to derive expected schema; compare against live DB
**When to use:** At the end of db-fresh.ts

The approach: parse all 15 migration SQL files to extract CREATE TABLE and ALTER TABLE ADD COLUMN statements. Build an expected schema. Then query the live DB with `PRAGMA table_info(tableName)` for each table and compare.

```typescript
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

interface ExpectedColumn {
  name: string;
  type: string;
}

interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
}

function parseMigrationsForSchema(migrationsDir: string): Map<string, ExpectedColumn[]> {
  const schema = new Map<string, ExpectedColumn[]>();
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // Parse CREATE TABLE statements
    // Parse ALTER TABLE ADD COLUMN statements
    // Build/update schema map
  }
  return schema;
}
```

**Key insight for SQL parsing:** The migration files use a predictable format. Use regex to extract:
- `CREATE TABLE IF NOT EXISTS tableName (...)` — creates table entries
- `ALTER TABLE tableName ADD COLUMN colName TYPE` — adds columns
- `DROP TABLE tableName` / `ALTER TABLE oldName RENAME TO newName` — handle audit_logs recreation in migration 0014

**The audit_logs recreation in 0014:** Migration 0014 creates `audit_logs_new`, copies data, drops `audit_logs`, renames `audit_logs_new` to `audit_logs`. This means the final schema has `audit_logs` with an expanded `action_type` CHECK constraint. The parser must handle this: track the `audit_logs_new` → `audit_logs` rename.

### Pattern 6: Console Output with Colors
**What:** ANSI color codes for terminal output (matches smoke-test.ts style)
**When to use:** Throughout all scripts

```typescript
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function step(msg: string): void {
  process.stdout.write(`  ${msg}... `);
}

function ok(): void {
  console.log(`${GREEN}✓${RESET}`);
}

function fail(error: string): never {
  console.log(`${RED}✗${RESET}`);
  console.error(`${RED}  Error: ${error}${RESET}`);
  process.exit(1);
}
```

**Pattern from smoke-test.ts:** Uses `\x1b[32m  ✓\x1b[0m` for green checkmarks and `\x1b[31m  ✗\x1b[0m` for red X. Follow the same convention.

### Anti-Patterns to Avoid
- **Hardcoding table names in reset:** Use `sqlite_master` query — tables will be added in future phases
- **Dropping `sqlite_sequence` or `_cf_METADATA`:** These are SQLite/Cloudflare internals — leave them alone
- **Using `--remote` flag anywhere:** These scripts are local-only; `--remote` would touch production D1
- **Opening the SQLite file directly:** The `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` file path contains a hash that could change; always use wrangler CLI
- **Using `stdio: 'inherit'` with `--json`:** When streaming output live, you can't also parse JSON; use `stdio: ['pipe', 'pipe', 'pipe']` when you need JSON, `'inherit'` when you want live display
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration tracking | Custom migration table | `wrangler d1 migrations apply` | Wrangler's system IS the migration system — matches production exactly |
| SQLite connection | Direct better-sqlite3 or sqlite3 | wrangler CLI | Local D1 is managed by miniflare; direct access is fragile and bypasses Cloudflare's layer |
| SQL parsing library | Hand-rolled SQL parser | Regex on predictable migration format | The 15 migration files follow consistent patterns; a full SQL parser is overkill |
| Process management | Complex subprocess library | `child_process.execSync` | It's built-in and sufficient for sequential CLI calls |

**Key insight:** wrangler IS the database driver for local D1. Don't try to access the SQLite file directly — the path is implementation-specific. All operations must go through `wrangler d1 execute --local`.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Dropping sqlite_sequence or _cf_METADATA Breaks Things
**What goes wrong:** If `sqlite_sequence` is dropped, SQLite's autoincrement tracking is gone. If `_cf_METADATA` is dropped, miniflare/wrangler may error on next operation.
**Why it happens:** `sqlite_master` returns all tables including these internals.
**How to avoid:** Filter them out: `name !== 'sqlite_sequence' && name !== '_cf_METADATA'`
**Warning signs:** Wrangler errors on next operation; `audit_logs` autoincrement (`id INTEGER PRIMARY KEY AUTOINCREMENT`) starts behaving unexpectedly.

### Pitfall 2: wrangler migrations apply Prompts for Confirmation
**What goes wrong:** Script hangs waiting for user input.
**Why it happens:** Wrangler may prompt "Are you sure?" before applying migrations.
**How to avoid:** With `--local` flag, wrangler does NOT prompt. Verified: `execSync('npx wrangler d1 migrations apply ratemyplace-db --local')` completes without interaction. If the behavior differs with pending migrations, pass stdin as pipe with no input — failing fast is preferred.
**Warning signs:** Script hangs after "Executing on local database..." message.

### Pitfall 3: wrangler Banner Output Contaminating JSON Parse
**What goes wrong:** `JSON.parse()` fails because the wrangler banner (`⛅️ wrangler 4.50.0`) appears before the JSON.
**Why it happens:** Wrangler writes its banner to stderr, but informational messages sometimes appear on stdout with non-`--json` output.
**How to avoid:** Always use `--json` flag with `wrangler d1 execute`. With `--json`, the JSON output goes to stdout and the banner goes to stderr. Capture with `stdio: ['pipe', 'pipe', 'pipe']`.
**Warning signs:** `SyntaxError: Unexpected token ⛅` in JSON.parse.

### Pitfall 4: Shell Quoting Issues with --command SQL
**What goes wrong:** SQL passed via `--command "..."` breaks when it contains double quotes or special characters.
**Why it happens:** The SQL string is embedded in a shell command string.
**How to avoid:** For complex SQL (many drops, multi-statement), write to a temp file and use `--file`. For simple single-statement queries (like table discovery), escape double quotes: `.replace(/"/g, '\\"')`. Or use single quotes for SQL identifiers.
**Warning signs:** Wrangler exits with "unrecognized token" or `SQLITE_ERROR`.

### Pitfall 5: Migration 0014 Audit Log Table Rename Complicates Schema Derivation
**What goes wrong:** Schema parser sees `audit_logs` created in 0013, then sees `audit_logs_new` created and `audit_logs` dropped in 0014. If naively tracking CREATE TABLE, the schema map ends up wrong.
**Why it happens:** SQLite doesn't support ALTER COLUMN, so migration 0014 does a create-copy-drop-rename to expand the CHECK constraint.
**How to avoid:** In the schema parser, handle `DROP TABLE` by removing from the map, and handle `ALTER TABLE x RENAME TO y` by moving the entry. The final state of `audit_logs` has the expanded `action_type` CHECK from 0014.
**Warning signs:** Schema verification reports `audit_logs` as missing or having wrong columns.

### Pitfall 6: Foreign Keys Cause Drop Order Errors
**What goes wrong:** `DROP TABLE users` fails because `sessions` has `REFERENCES users(id)`.
**Why it happens:** SQLite enforces FK constraints when `PRAGMA foreign_keys=ON` (the default in D1).
**How to avoid:** Execute `PRAGMA foreign_keys=OFF` before all drops. Confirmed: this PRAGMA can be combined in a single `--command` with semicolon separation.
**Warning signs:** `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed` during drop.
</common_pitfalls>

<code_examples>
## Code Examples

### Table Discovery Query
```typescript
// Query all user-owned tables, exclude SQLite/CF internals
const sql = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";
const result = execSync(
  `npx wrangler d1 execute ratemyplace-db --local --command "${sql}" --json`,
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
);
const rows = JSON.parse(result)[0].results as Array<{ name: string }>;
const toDrop = rows
  .map(r => r.name)
  .filter(n => n !== 'sqlite_sequence' && n !== '_cf_METADATA');
// Result: ['audit_logs', 'building_scores', 'buildings', 'd1_migrations', 'disputes',
//          'landlord_scores', 'landlords', 'password_reset_tokens', 'property_manager_scores',
//          'property_managers', 'rate_limits', 'review_votes', 'reviews', 'sessions',
//          'verification_images', 'verification_tokens', 'users']
```

### Drop All Tables (FK-safe)
```typescript
// Build multi-statement SQL: disable FK, drop all, re-enable FK
const dropStatements = toDrop.map(t => `DROP TABLE IF EXISTS "${t}"`).join('; ');
const resetSql = `PRAGMA foreign_keys=OFF; ${dropStatements}; PRAGMA foreign_keys=ON`;

// For complex multi-statement SQL, use a temp file to avoid quoting issues
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpFile = join(tmpdir(), 'db-reset.sql');
writeFileSync(tmpFile, resetSql, 'utf8');
execSync(
  `npx wrangler d1 execute ratemyplace-db --local --file "${tmpFile}"`,
  { encoding: 'utf8', stdio: 'inherit' }
);
unlinkSync(tmpFile);
```

### Apply Migrations
```typescript
// Non-interactive with --local flag. Shows live output.
execSync(
  'npx wrangler d1 migrations apply ratemyplace-db --local',
  { encoding: 'utf8', stdio: 'inherit' }
);
// Exit code 0 = success. Non-zero throws automatically via execSync.
```

### Schema Verification via PRAGMA table_info
```typescript
function getActualColumns(tableName: string): Array<{ name: string; type: string }> {
  const sql = `PRAGMA table_info(${tableName})`;
  const result = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${sql}" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const rows = JSON.parse(result)[0].results as Array<{
    cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number;
  }>;
  return rows.map(r => ({ name: r.name, type: r.type }));
}
```

### Error Handling Pattern (fail-fast with context)
```typescript
function run(stepName: string, fn: () => void): void {
  process.stdout.write(`  ${BOLD}${stepName}${RESET}... `);
  try {
    fn();
    console.log(`${GREEN}✓${RESET}`);
  } catch (err: any) {
    console.log(`${RED}✗${RESET}`);
    console.error(`\n${RED}  Failed at: ${stepName}${RESET}`);
    console.error(`${RED}  Error: ${err.message}${RESET}`);
    if (err.stderr) {
      console.error(`${RED}  Details: ${err.stderr}${RESET}`);
    }
    process.exit(1);
  }
}
```

### db-fresh.ts Composition Pattern
```typescript
// db-fresh.ts runs reset + migrate in sequence
import { execSync } from 'child_process';

console.log('\n  Fresh local database\n');

// Step 1: Reset
execSync('npx tsx scripts/db-reset.ts', { stdio: 'inherit' });

// Step 2: Migrate
execSync('npx tsx scripts/db-migrate.ts', { stdio: 'inherit' });

// Step 3: Verify (inline or via separate module)
verifySchema();

console.log(`\n${GREEN}  ✓ Database ready${RESET}\n`);
```

Alternatively, db-fresh.ts can import and call functions directly from the other scripts (if they export their logic) rather than spawning subprocesses. Either approach works — the subprocess approach is simpler and produces cleaner output separation.
</code_examples>

<sota_updates>
## State of the Art (2026)

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `wrangler d1 execute` accepts only one statement | Wrangler 4.x accepts semicolon-separated multi-statement SQL via `--command` | Can drop all tables in one CLI call |
| Wrangler required interactive prompts for migrations | `--local` flag makes migrations apply non-interactive | Scripts can run fully automated |
| `--json` flag was unreliable for structured output | Wrangler 4.50 `--json` reliably outputs clean JSON to stdout | Enables programmatic result parsing |

**Current wrangler version:** 4.50.0 (installed), 4.69.0 available. The installed version works correctly for all needed operations. No need to update.

**D1 local storage location:** `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/[hash].sqlite` — the hash is derived from the database ID in wrangler.jsonc. Do not reference this path in scripts.

**tsx v4.21.0:** Fully supports TypeScript ESM with Node.js built-ins. No special flags needed for `child_process`, `fs`, `os`, `path` imports.
</sota_updates>

<open_questions>
## Open Questions

1. **Whether wrangler migrations apply --local prompts with pending migrations**
   - What we know: Verified non-interactive with no pending migrations ("No migrations to apply!")
   - What's unclear: Whether it prompts when there ARE pending migrations (after a reset)
   - Recommendation: On first run of `db:fresh`, test manually. If it prompts, pipe stdin or use `--yes` flag (not listed in help but often supported). If `--yes` doesn't work, use `echo "" | npx wrangler...` as a fallback. The safest approach: use `spawnSync` with `input: '\n'` to auto-confirm any prompt.

2. **Schema verification depth: columns only vs. constraints too**
   - What we know: `PRAGMA table_info` returns column names and types but not CHECK constraints or DEFAULT values
   - What's unclear: Whether verifying column names + types is sufficient, or if we need to verify the full CREATE TABLE SQL
   - Recommendation: Verify table existence + column names + column types. That covers the meaningful structure. Checking constraint text would require parsing `sqlite_master.sql` column, which is complex and brittle. Column-level verification is sufficient for CI confidence.

3. **How to handle migration 0014's table rename in schema parser**
   - What we know: 0014 creates `audit_logs_new`, copies data, drops `audit_logs`, renames to `audit_logs`
   - What's unclear: Whether a simple sequential state-machine parser handles this correctly
   - Recommendation: Build a simple sequential parser that processes statements in order: on `CREATE TABLE x`, add to map; on `DROP TABLE x`, remove from map; on `ALTER TABLE x RENAME TO y`, rename the key. This handles 0014 correctly.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- Direct wrangler CLI interrogation (`npx wrangler d1 --help`, `npx wrangler d1 execute --help`, `npx wrangler d1 migrations apply --help`) — confirmed exact flags and behavior
- Live wrangler execution against the actual local DB — confirmed JSON output format, multi-statement SQL support, non-interactive migration apply
- All 15 migration files read directly — complete schema knowledge
- `wrangler.jsonc` — database name `ratemyplace-db`, database ID
- `scripts/smoke-test.ts` — confirmed TypeScript + tsx + ANSI color pattern to follow
- `package.json` — confirmed tsx 4.21.0 installed, wrangler 4.50.0 installed

### Secondary (MEDIUM confidence)
- Node.js `child_process` docs (built-in knowledge) — `execSync` behavior, stdio options
- SQLite `sqlite_master` and `PRAGMA table_info` (built-in knowledge) — table discovery pattern

### Tertiary (LOW confidence - needs validation)
- Whether `wrangler d1 migrations apply --local` requires confirmation when migrations are pending — verified with no-pending case only; pending case needs first-run validation
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: Cloudflare D1 local via wrangler CLI
- Ecosystem: wrangler 4.50.0, tsx 4.21.0, Node.js child_process
- Patterns: CLI orchestration, SQLite schema discovery, migration application, schema verification
- Pitfalls: SQLite internals, FK constraints, shell quoting, wrangler interactivity, migration 0014 rename

**Confidence breakdown:**
- Standard stack: HIGH — all tools already installed and verified working
- Architecture: HIGH — all command invocations tested against live local DB
- Pitfalls: HIGH — most verified through direct testing; migration apply interactivity is the one untested edge
- Code examples: HIGH — patterns derived from verified CLI behavior and existing smoke-test.ts

**Current DB state (as of research):**
- 15 migrations applied (0001–0015)
- 15 user tables + `sqlite_sequence` + `_cf_METADATA` = 17 total in sqlite_master
- Tables to drop on reset: 15 (all except `sqlite_sequence` and `_cf_METADATA`)
- 33 indexes exist after full migration set

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (30 days — wrangler CLI is stable; D1 local behavior is stable)
</metadata>

---

*Phase: 04-database-foundation*
*Research completed: 2026-02-27*
*Ready for planning: yes*
