/**
 * Fresh Database Script for RateMyPlace Boston
 *
 * Runs reset, migrate, and schema verification in sequence to produce
 * a clean, verified local database in a single command.
 *
 * Phases:
 *   1. Reset  — drops all user tables (via db-reset.ts)
 *   2. Migrate — applies all 15 migrations (via db-migrate.ts)
 *   3. Verify  — parses migration SQL to derive expected schema, queries
 *                PRAGMA table_info for actual schema, and diffs them
 *
 * Run: npm run db:fresh
 * Run directly: npx tsx scripts/db-fresh.ts
 */

import { execSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// ANSI color constants
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ColumnInfo {
  name: string;
  type: string;
}

type SchemaMap = Map<string, ColumnInfo[]>;

// ─── Wrangler helper ───────────────────────────────────────────────────────────

/**
 * Run a wrangler D1 command against the local database and return results.
 * Uses --command flag (not --file) to avoid wrangler path issues.
 */
function wranglerQuery(sql: string): any[] {
  const escaped = sql.replace(/"/g, '\\"');
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${escaped}" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return JSON.parse(raw)[0].results;
}

// ─── Phase 1 & 2: Reset + Migrate ─────────────────────────────────────────────

console.log(`\n  ${BOLD}Fresh local database${RESET}\n`);

try {
  execSync('npx tsx scripts/db-reset.ts', { stdio: 'inherit' });
} catch (err: any) {
  // Child script already printed error and exited 1; re-exit here
  process.exit(1);
}

try {
  execSync('npx tsx scripts/db-migrate.ts', { stdio: 'inherit' });
} catch (err: any) {
  process.exit(1);
}

// ─── Phase 3: Schema Verification ─────────────────────────────────────────────

/**
 * Split a CREATE TABLE body (the content between outermost parentheses) into
 * individual column/constraint tokens, respecting nested parentheses.
 *
 * Example: "id TEXT, CHECK(id > 0), col2 INTEGER" →
 *   ["id TEXT", " CHECK(id > 0)", " col2 INTEGER"]
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') {
      depth++;
    } else if (body[i] === ')') {
      depth--;
    } else if (body[i] === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Find the matching closing parenthesis position in `sql` starting from
 * `openPos` (which must be the index of the opening `(`).
 * Returns the index of the matching `)`, or -1 if not found.
 */
function findMatchingParen(sql: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Remove all SQL line comments (-- to end of line) from a string.
 * This must be done BEFORE splitting on commas so that parentheses
 * inside comments (e.g. "-- Tenancy details (fuzzy dates)") do not
 * corrupt the paren-depth tracking in splitTopLevel.
 *
 * Normalizes CRLF → LF first to ensure consistent line handling
 * regardless of the platform the SQL files were created on.
 */
function removeLineComments(sql: string): string {
  // Normalize CRLF to LF so that `$` in the regex reliably matches line ends
  const normalized = sql.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * Parse column definitions from the body of a CREATE TABLE statement.
 * Skips table-level constraint lines and extracts (name, type) for each column.
 *
 * IMPORTANT: Call removeLineComments on the body BEFORE splitTopLevel to avoid
 * parens inside comments corrupting depth tracking.
 */
function parseColumnsFromBody(body: string): ColumnInfo[] {
  const columns: ColumnInfo[] = [];
  const cleanBody = removeLineComments(body);
  const parts = splitTopLevel(cleanBody);

  for (const part of parts) {
    const line = part.trim();
    if (!line) continue;

    // Skip table-level constraints (no column name — these start with constraint keywords)
    const upperLine = line.toUpperCase();
    if (
      upperLine.startsWith('PRIMARY KEY') ||
      upperLine.startsWith('UNIQUE') ||
      upperLine.startsWith('CHECK') ||
      upperLine.startsWith('FOREIGN KEY') ||
      upperLine.startsWith('CREATE INDEX')
    ) {
      continue;
    }

    // Extract column name (first token) and type (second token, if present)
    const tokens = line.split(/\s+/);
    const colName = tokens[0];
    const colType = tokens[1] ?? '';

    if (!colName || colName.startsWith('--')) continue;

    columns.push({ name: colName, type: colType.toUpperCase() });
  }

  return columns;
}

/**
 * Parse all migration SQL files in migrations/ directory (sorted alphabetically)
 * and return the expected schema as a Map<tableName, ColumnInfo[]>.
 *
 * Handles:
 *   - CREATE TABLE IF NOT EXISTS tableName (...)
 *   - ALTER TABLE tableName ADD COLUMN colName colType
 *   - DROP TABLE [IF EXISTS] tableName
 *   - ALTER TABLE oldName RENAME TO newName
 *
 * Critical: migration 0014 creates audit_logs_new, drops audit_logs,
 * then renames audit_logs_new → audit_logs. This is handled naturally
 * by the sequential processing logic below.
 *
 * Uses a paren-depth scanner (findMatchingParen) rather than a greedy regex
 * to correctly extract CREATE TABLE bodies that contain nested parentheses
 * (e.g. CHECK constraints).
 */
function parseMigrations(): SchemaMap {
  const schema: SchemaMap = new Map();
  const migrationsDir = join(process.cwd(), 'migrations');

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // alphabetical = 0001, 0002, ..., 0015

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    // ── CREATE TABLE IF NOT EXISTS tableName ( ... ) ────────────────────────
    // Use a two-step approach:
    //   1. Find "CREATE TABLE [IF NOT EXISTS] tableName (" via regex (match up to the opening paren)
    //   2. Use findMatchingParen to correctly extract the full body

    const createHeaderRegex =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gim;

    let match: RegExpExecArray | null;
    while ((match = createHeaderRegex.exec(sql)) !== null) {
      const tableName = match[1];
      // The opening paren is the last character of the match
      const openPos = match.index + match[0].length - 1;
      const closePos = findMatchingParen(sql, openPos);

      if (closePos === -1) continue; // Malformed SQL — skip

      const body = sql.slice(openPos + 1, closePos);
      const columns = parseColumnsFromBody(body);
      schema.set(tableName, columns);
    }

    // ── ALTER TABLE tableName ADD COLUMN colName colType ───────────────────
    const addColRegex =
      /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s+(\w+)?/gim;

    while ((match = addColRegex.exec(sql)) !== null) {
      const tableName = match[1];
      const colName = match[2];
      const colType = (match[3] ?? '').toUpperCase();

      if (!schema.has(tableName)) {
        schema.set(tableName, []);
      }
      schema.get(tableName)!.push({ name: colName, type: colType });
    }

    // ── DROP TABLE [IF EXISTS] tableName ────────────────────────────────────
    const dropRegex = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/gim;

    while ((match = dropRegex.exec(sql)) !== null) {
      const tableName = match[1];
      schema.delete(tableName);
    }

    // ── ALTER TABLE oldName RENAME TO newName ───────────────────────────────
    const renameRegex = /ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/gim;

    while ((match = renameRegex.exec(sql)) !== null) {
      const oldName = match[1];
      const newName = match[2];

      if (schema.has(oldName)) {
        schema.set(newName, schema.get(oldName)!);
        schema.delete(oldName);
      }
    }
  }

  return schema;
}

/**
 * Query the live D1 database for all user tables and their columns via
 * PRAGMA table_info.
 *
 * Excludes internal tables: sqlite_sequence, _cf_METADATA, d1_migrations.
 */
function getActualSchema(): SchemaMap {
  const schema: SchemaMap = new Map();

  const EXCLUDED = new Set(['sqlite_sequence', '_cf_METADATA', 'd1_migrations']);

  const tables = wranglerQuery(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );

  for (const row of tables) {
    const tableName = row.name as string;
    if (EXCLUDED.has(tableName)) continue;

    const pragmaRows = wranglerQuery(`PRAGMA table_info(${tableName})`);
    const columns: ColumnInfo[] = pragmaRows.map((r: any) => ({
      name: r.name as string,
      type: (r.type as string).toUpperCase(),
    }));

    schema.set(tableName, columns);
  }

  return schema;
}

/**
 * Compare expected schema (from migration SQL) against actual schema
 * (from PRAGMA table_info). Returns true if they match, false otherwise.
 *
 * Compares: table existence, column names, and column types (case-insensitive).
 * Does NOT compare constraints, defaults, or nullability.
 */
function verifySchema(): boolean {
  const expected = parseMigrations();
  const actual = getActualSchema();

  const diffs: string[] = [];

  // Check for missing tables (in expected but not in actual)
  for (const tableName of expected.keys()) {
    if (!actual.has(tableName)) {
      diffs.push(`  ${RED}✗ Missing table: ${BOLD}${tableName}${RESET}`);
    }
  }

  // Check for extra tables (in actual but not in expected)
  for (const tableName of actual.keys()) {
    if (!expected.has(tableName)) {
      diffs.push(
        `  ${YELLOW}? Extra table (not in migrations): ${BOLD}${tableName}${RESET}`
      );
    }
  }

  // Compare columns for matching tables
  for (const [tableName, expectedCols] of expected) {
    if (!actual.has(tableName)) continue; // Already reported above

    const actualCols = actual.get(tableName)!;
    const expectedColMap = new Map(
      expectedCols.map((c) => [c.name.toLowerCase(), c.type.toUpperCase()])
    );
    const actualColMap = new Map(
      actualCols.map((c) => [c.name.toLowerCase(), c.type.toUpperCase()])
    );

    // Missing columns
    for (const [colName, colType] of expectedColMap) {
      if (!actualColMap.has(colName)) {
        diffs.push(
          `  ${RED}✗ Table ${BOLD}${tableName}${RESET}${RED}: missing column ${BOLD}${colName}${RESET}${RED} (expected ${colType})${RESET}`
        );
      } else {
        // Type mismatch
        const actualType = actualColMap.get(colName)!;
        if (actualType !== colType && colType !== '') {
          diffs.push(
            `  ${YELLOW}~ Table ${BOLD}${tableName}${RESET}${YELLOW}: column ${BOLD}${colName}${RESET}${YELLOW} type mismatch — expected ${colType}, got ${actualType}${RESET}`
          );
        }
      }
    }

    // Extra columns (in DB but not in expected — warn, don't fail)
    for (const colName of actualColMap.keys()) {
      if (!expectedColMap.has(colName)) {
        diffs.push(
          `  ${YELLOW}? Table ${BOLD}${tableName}${RESET}${YELLOW}: extra column ${BOLD}${colName}${RESET}${YELLOW} (not in migrations)${RESET}`
        );
      }
    }
  }

  if (diffs.length === 0) {
    console.log(`  ${GREEN}✓ Schema verified${RESET}`);
    return true;
  }

  // Filter: separate errors (✗) from warnings (?)
  const errors = diffs.filter((d) => d.includes('✗'));
  const warnings = diffs.filter((d) => d.includes('?') || d.includes('~'));

  if (warnings.length > 0) {
    console.log(`\n  Schema warnings:`);
    for (const w of warnings) console.log(w);
  }

  if (errors.length > 0) {
    console.log(`\n  Schema errors:`);
    for (const e of errors) console.log(e);
    console.log(
      `\n  ${RED}Schema verification failed: ${errors.length} error(s), ${warnings.length} warning(s)${RESET}`
    );
    return false;
  }

  // Only warnings — still pass
  console.log(
    `  ${YELLOW}Schema verified with ${warnings.length} warning(s)${RESET}`
  );
  return true;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const ok = verifySchema();

if (ok) {
  console.log(`\n  ${GREEN}✓ Database ready${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n  ${RED}✗ Schema verification failed${RESET}\n`);
  process.exit(1);
}
