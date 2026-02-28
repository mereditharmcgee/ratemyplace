/**
 * Database Reset Script for RateMyPlace Boston
 *
 * Dynamically discovers and drops all user tables from the local D1 database.
 * Tables are discovered via sqlite_master — no hardcoded table names.
 *
 * Drop order is computed via topological sort to satisfy D1 local's FK
 * validation behaviour: the local D1 runtime validates that FK-referenced
 * tables exist even when PRAGMA foreign_keys=OFF, so referencing tables
 * (leaves) must be dropped before the tables they reference.
 *
 * Run: npm run db:reset
 * Run directly: npx tsx scripts/db-reset.ts
 */

import { execSync } from 'child_process';

// ANSI color constants — following smoke-test.ts pattern
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** SQLite internals and Cloudflare metadata to never drop */
const EXCLUDED = new Set(['sqlite_sequence', '_cf_METADATA']);

/**
 * Run a wrangler D1 command against the local database and return results.
 * Passes SQL via --command flag (not --file) to avoid wrangler path issues.
 */
function wranglerQuery(sql: string): any[] {
  const escaped = sql.replace(/"/g, '\\"');
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${escaped}" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return JSON.parse(raw)[0].results;
}

/**
 * Drop a single table via wrangler --command.
 * Uses backtick quoting for table name to avoid nested quote escaping issues.
 */
function dropTable(tableName: string): void {
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "DROP TABLE IF EXISTS \`${tableName}\`" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const parsed = JSON.parse(raw);
  if (!parsed[0]?.success) {
    throw new Error(`Failed to drop table ${tableName}`);
  }
}

/**
 * Run a named step with fail-fast error handling.
 * Exits with code 1 on any error.
 */
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
      console.error(`${RED}  Details: ${err.stderr.toString()}${RESET}`);
    }
    process.exit(1);
  }
}

/**
 * Topological sort: returns drop order where referencing tables come before
 * the tables they reference.
 *
 * Edge A → B means "A has a FK referencing B" (A should be dropped before B).
 * We use Kahn's algorithm on the in-degree of the "is referenced by" direction:
 * tables with in-degree 0 (nothing references them) are dropped first.
 *
 * Tables whose FK targets don't exist in our drop set (e.g. 'users' was
 * already dropped) are treated as having no outgoing edges to those targets.
 */
function topoSort(tables: string[], refs: Map<string, string[]>): string[] {
  const tableSet = new Set(tables);

  // Build adjacency: for each table, list the tables in our set that it references
  // Edge: source → target means source must be dropped BEFORE target
  const edges = new Map<string, Set<string>>();
  for (const t of tables) {
    edges.set(t, new Set());
  }
  for (const [source, targets] of refs) {
    for (const target of targets) {
      if (tableSet.has(target) && target !== source) {
        edges.get(source)!.add(target);
      }
    }
  }

  // Build reverse adjacency: target → [sources that reference it]
  const reverseEdges = new Map<string, Set<string>>();
  for (const t of tables) reverseEdges.set(t, new Set());
  for (const [source, targets] of edges) {
    for (const target of targets) {
      reverseEdges.get(target)!.add(source);
    }
  }

  // in-degree = number of tables IN OUR SET that reference this table
  // (i.e. how many things point to it as FK target)
  const inDegree = new Map<string, number>();
  for (const t of tables) {
    inDegree.set(t, reverseEdges.get(t)!.size);
  }

  // Kahn's algorithm: process nodes with in-degree 0 first
  // These are tables that nothing else references — safe to drop last.
  // Wait — we want to drop referencing tables FIRST.
  //
  // Actually: we want to drop tables that NOTHING REFERENCES first.
  // In-degree counts "how many tables reference me".
  // Tables with in-degree 0: nobody references them → DROP FIRST.
  // Tables with in-degree > 0: somebody references them → DROP LAST.
  //
  // This is exactly what Kahn's algorithm gives us: process 0-degree nodes
  // first = drop tables that are not FK targets of remaining tables first.

  const queue: string[] = [];
  for (const [t, deg] of inDegree) {
    if (deg === 0) queue.push(t);
  }
  queue.sort(); // deterministic order within same level

  const sorted: string[] = [];
  while (queue.length > 0) {
    const t = queue.shift()!;
    sorted.push(t);

    // This table is now dropped; reduce in-degree of tables it references
    for (const target of edges.get(t) || []) {
      const newDeg = (inDegree.get(target) ?? 1) - 1;
      inDegree.set(target, newDeg);
      if (newDeg === 0) {
        queue.push(target);
        queue.sort(); // keep deterministic
      }
    }
  }

  // Append any tables not sorted (cycles or missing-ref situations)
  const unsorted = tables.filter(t => !sorted.includes(t));
  return [...sorted, ...unsorted];
}

// ─── Main reset logic ─────────────────────────────────────────────────────────

console.log(`\n  ${BOLD}Reset local database${RESET}\n`);

// Step 1: Discover all user tables
let tablesToDrop: string[] = [];

run('Discovering tables', () => {
  const rows = wranglerQuery(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  tablesToDrop = rows
    .map((r: any) => r.name as string)
    .filter((name: string) => !EXCLUDED.has(name));
});

if (tablesToDrop.length === 0) {
  console.log(`  ${GREEN}No tables found — database is already empty${RESET}\n`);
  process.exit(0);
}

// Step 2: Discover FK dependencies for topological sort
const refs = new Map<string, string[]>();

run('Analysing FK dependencies', () => {
  for (const table of tablesToDrop) {
    const fkRows = wranglerQuery(`PRAGMA foreign_key_list('${table}')`);
    const targets = fkRows.map((r: any) => r.table as string);
    refs.set(table, targets);
  }
});

// Step 3: Build drop order — referencing tables (leaves) first
const dropOrder = topoSort(tablesToDrop, refs);

// Print which tables will be dropped (in order)
console.log(`\n  Tables to drop (${dropOrder.length} total, referencing tables first):`);
for (const table of dropOrder) {
  console.log(`    ${table}`);
}
console.log('');

// Step 4: Disable foreign keys, then drop all tables in topological order
run(`Dropping ${dropOrder.length} tables`, () => {
  wranglerQuery('PRAGMA foreign_keys=OFF');

  for (const table of dropOrder) {
    dropTable(table);
  }

  wranglerQuery('PRAGMA foreign_keys=ON');
});

console.log(`\n  ${GREEN}✓ Reset complete — ${dropOrder.length} tables dropped${RESET}\n`);
