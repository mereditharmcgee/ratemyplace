// scripts/records-seed-boston.ts
/**
 * Seed a page for every whole-building rental parcel in Boston.
 * Spec: docs/superpowers/specs/2026-09-08-boston-coverage-design.md, Section 1.
 *
 * Usage:
 *   npm run records:seed -- --dry-run           # download (cached), compute, print the summary, write nothing
 *   npm run records:seed -- --write             # also write SQL batch files under .cache/seed/
 *   npm run records:seed -- --apply --local     # write and apply to the local D1
 *   npm run records:seed -- --apply --remote    # write and apply to production D1 (needs CLOUDFLARE_API_TOKEN)
 *
 * Idempotent: re-running updates assessor-owned fields and never creates a twin. Downloads
 * are cached in .cache/ for a day; pass --refresh to re-download.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAllRows, textOrNull } from '../src/lib/records/ckan';
import { SEED_LAND_USES, isSeedParcelRow } from '../src/lib/records/seed/filters';
import { ASSESSOR_SEED_FIELDS, collapseAssessorRows } from '../src/lib/records/seed/collapse';
import { seedSlug } from '../src/lib/records/seed/format';
import { matchExistingBuildings } from '../src/lib/records/seed/match';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel } from '../src/lib/records/seed/sam';
import { seedStatements } from '../src/lib/records/seed/sql';
import type { AssessorRow, ExistingBuilding, SamRow, SeedBuilding } from '../src/lib/records/seed/types';
import { FY2026_RESOURCE_ID } from '../src/lib/records/sources/boston/assessor';
import type { FetchLike } from '../src/lib/records/types';

const args = new Set(process.argv.slice(2));
const flag = (name: string): boolean => args.has(`--${name}`);
const CACHE_DIR = join(process.cwd(), '.cache');
const SEED_DIR = join(CACHE_DIR, 'seed');
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Batch size for one `wrangler d1 execute --file`. 2000 statements (about 1.5 MB) hangs the
 * local D1 for five minutes and then fails with `Body Timeout Error`, workerd logging
 * `kj/table.c++:57: HashIndex detected hash table inconsistency` throughout; the whole file
 * rolls back. 1000 statements of the same data applies in under three seconds. Measured
 * against wrangler's local miniflare D1 on 2026-09-09 — the cliff is the batch size, not
 * any one statement, so keep this well under it.
 */
const STATEMENTS_PER_FILE = 1000;
const DB_NAME = 'ratemyplace-db';
/** How many rejected 'A' descriptions the summary names, so a renamed housing code is visible. */
const TOP_SKIPPED_DESCRIPTIONS = 10;
const LONGEST_ADDRESSES = 5;
const fetchImpl: FetchLike = (input, init) => fetch(input, init);

function log(line: string): void {
  console.log(line);
}

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${name}.json`);
  if (!flag('refresh') && existsSync(path) && Date.now() - statSync(path).mtimeMs < CACHE_MAX_AGE_MS) {
    log(`  using cached ${name}`);
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }
  const started = Date.now();
  const value = await load();
  writeFileSync(path, JSON.stringify(value));
  log(`  downloaded ${name} in ${Math.round((Date.now() - started) / 1000)}s`);
  return value;
}

/**
 * `execFileSync` with `shell: true` joins argv with single spaces and quotes nothing, on
 * every platform. Windows also cannot spawn `npx.cmd` without a shell (Node refuses to
 * exec a .cmd directly since the 2024 argument-injection fix), so the shell is not
 * optional here and each argument carries its own quotes. No value below contains a
 * double quote; the SQL's single quotes survive `cmd /s /c "..."` unchanged.
 */
function shellArg(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/**
 * Wrangler prints its banner and any config warnings before the `--json` payload, and a
 * warning line contains a `[` of its own (`▲ [WARNING] ...`). The payload is the first
 * line that *starts* with `[`.
 */
function parseWranglerJson<T>(out: string): Array<{ results: T[] }> {
  const start = /^\[/m.exec(out);
  if (!start) throw new Error(`wrangler --json produced no JSON array:\n${out}`);
  return JSON.parse(out.slice(start.index)) as Array<{ results: T[] }>;
}

/**
 * `wrangler d1 execute --json` renders a SQL NULL as the JSON *string* `"null"` (verified
 * against the local D1 on 2026-09-09: `SELECT NULL AS a` comes back as `{"a":"null"}`).
 * Left alone it makes every existing row's empty `parcel_id` read as a real, disagreeing
 * parcel, so `matchExistingBuildings` files a clean match as a conflict and the seed then
 * creates a duplicate row for that parcel. None of the columns this script selects — id,
 * address, slug, parcel_id, latitude, longitude — can legitimately hold the text "null",
 * so the string folds back to null here. A wrangler release that emits real JSON nulls
 * makes this a no-op.
 */
function foldNullStrings<T>(row: T): T {
  const folded = Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value === 'null' ? null : value] as const);
  return Object.fromEntries(folded) as T;
}

function wranglerJson<T>(commandArgs: string[]): T[] {
  const argv = ['wrangler', 'd1', 'execute', DB_NAME, '--json', ...commandArgs].map(shellArg);
  const out = execFileSync('npx', argv, { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  return parseWranglerJson<T>(out)
    .flatMap((r) => r.results)
    .map(foldNullStrings);
}

function target(): '--local' | '--remote' {
  if (flag('remote')) return '--remote';
  return '--local';
}

function norm(value: unknown): string {
  return (textOrNull(value) ?? '').trim().toUpperCase();
}

/**
 * The land-use filter's rejections, by description. The download is already narrowed to
 * the five seed codes, so everything here is an 'A' parcel whose description is not on the
 * housing list — the one place a renamed assessor description would silently cost rows.
 */
function rejectedDescriptions(rows: readonly AssessorRow[]): Array<{ description: string; landUse: string; count: number }> {
  const counts = new Map<string, { description: string; landUse: string; count: number }>();
  for (const row of rows) {
    if (isSeedParcelRow({ LU: row.LU, LU_DESC: row.LU_DESC })) continue;
    const landUse = norm(row.LU);
    const description = norm(row.LU_DESC) || '(blank)';
    const key = `${landUse}|${description}`;
    const entry = counts.get(key) ?? { description, landUse, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

function longestAddresses(buildings: readonly SeedBuilding[]): SeedBuilding[] {
  return [...buildings].sort((a, b) => b.address.length - a.address.length).slice(0, LONGEST_ADDRESSES);
}

/**
 * A seed slug is `<address>-boston`, so only a collision appends `-<n>`. An address never
 * ends in the literal word "boston" followed by a number, which is what makes the shape
 * unambiguous.
 */
function tookCollisionSuffix(slug: string): boolean {
  return /-boston-\d+$/.test(slug);
}

async function main(): Promise<void> {
  const dryRun = !flag('write') && !flag('apply');
  log(`\nSeed Boston buildings (${dryRun ? 'dry run' : flag('apply') ? `apply ${target()}` : 'write files'})\n`);

  const assessor = await cached('assessor-fy2026', () =>
    fetchAllRows<AssessorRow>(FY2026_RESOURCE_ID, { fields: [...ASSESSOR_SEED_FIELDS], filters: { LU: [...SEED_LAND_USES] }, onPage: (n) => log(`  assessor rows: ${n}`) }, fetchImpl),
  );
  const sam = await cached('sam-addresses', () =>
    fetchAllRows<SamRow>(SAM_RESOURCE_ID, { fields: [...SAM_FIELDS], onPage: (n) => log(`  SAM rows: ${n}`) }, fetchImpl),
  );
  log(`  downloaded ${assessor.length} assessor rows and ${sam.length} SAM rows`);

  const samIndex = indexSamByParcel(sam);
  const { buildings, skipped } = collapseAssessorRows(assessor, samIndex);
  const skippedByReason = skipped.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {});
  log(`  ${buildings.length} seed buildings; skipped ${JSON.stringify(skippedByReason)}`);
  log(`  ${buildings.filter((b) => b.latitude === null).length} without a SAM coordinate`);

  const rejected = rejectedDescriptions(assessor);
  log(`  top ${TOP_SKIPPED_DESCRIPTIONS} descriptions rejected by the land-use filter:`);
  for (const entry of rejected.slice(0, TOP_SKIPPED_DESCRIPTIONS)) {
    log(`    ${String(entry.count).padStart(6)}  ${entry.landUse}  ${entry.description}`);
  }
  const nonA = rejected.filter((entry) => entry.landUse !== 'A');
  if (nonA.length > 0) {
    log(`    NOTE: ${nonA.reduce((n, e) => n + e.count, 0)} rejected rows are not land use A: ${nonA.map((e) => e.landUse).join(', ')}`);
  }

  log(`  ${LONGEST_ADDRESSES} longest addresses:`);
  for (const b of longestAddresses(buildings)) log(`    ${String(b.address.length).padStart(3)}  ${b.parcelId}  ${b.address}`);

  const existing = wranglerJson<ExistingBuilding>([target(), '--command', "SELECT id, address, slug, parcel_id, latitude, longitude FROM buildings WHERE city = 'Boston'"]);
  const takenSlugs = new Set(wranglerJson<{ slug: string }>([target(), '--command', 'SELECT slug FROM buildings']).map((r) => r.slug));
  const match = matchExistingBuildings(existing, buildings);
  log(`  existing Boston rows: ${existing.length}; matched ${match.matched.length}, conflicts ${match.conflicts.length}, unmatched ${match.unmatched.length}`);
  for (const c of match.conflicts) log(`    CONFLICT ${c.building.id} ${c.building.address} has parcel ${c.building.parcel_id}, seed says ${c.parcel.parcelId}`);
  for (const u of match.unmatched) log(`    UNMATCHED ${u.building.id} ${u.building.address}: ${u.reason}`);

  // A parcel that an existing row now owns is not created a second time.
  const ownedParcels = new Set(match.matched.map((m) => m.parcel.parcelId));
  const created = buildings
    .filter((b) => !ownedParcels.has(b.parcelId))
    .map((parcel) => ({ parcel, slug: seedSlug(parcel.address, takenSlugs) }));
  log(`  to create: ${created.length}; to update in place: ${match.matched.length}`);
  log(`  slugs that needed a collision suffix: ${created.filter((c) => tookCollisionSuffix(c.slug)).length}`);

  if (dryRun) {
    log('\nDry run complete. Nothing written.');
    return;
  }

  const statements = seedStatements({ created, matched: match.matched });
  mkdirSync(SEED_DIR, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_FILE) {
    const path = join(SEED_DIR, `seed-boston-${String(files.length + 1).padStart(3, '0')}.sql`);
    writeFileSync(path, statements.slice(i, i + STATEMENTS_PER_FILE).join('\n') + '\n');
    files.push(path);
  }
  log(`  wrote ${statements.length} statements to ${files.length} files under .cache/seed/`);

  if (!flag('apply')) return;
  for (const [index, path] of files.entries()) {
    log(`  applying ${index + 1}/${files.length} ${target()}`);
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, target(), '--file', path].map(shellArg), { stdio: 'inherit', shell: true });
  }
  const after = wranglerJson<{ n: number }>([target(), '--command', "SELECT COUNT(*) AS n FROM buildings WHERE source = 'seed'"]);
  log(`\nDone. Seeded buildings in ${target()} database: ${after[0]?.n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
