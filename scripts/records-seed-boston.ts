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
 *   npm run records:seed -- --apply --local --from 12   # resume applying at batch file 12
 *
 * Idempotent: re-running updates assessor-owned fields and never creates a twin. Downloads
 * are cached in .cache/ for a day; pass --refresh to re-download.
 *
 * `--from N` (N > 1) applies the batch files already under .cache/seed/ and regenerates
 * nothing. See `existingBatchFiles` for why that is the whole point of the flag.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAllRows } from '../src/lib/records/ckan';
import { SEED_LAND_USES, isSeedParcelRow, normalizeLandUse } from '../src/lib/records/seed/filters';
import { ASSESSOR_SEED_FIELDS, collapseAssessorRows } from '../src/lib/records/seed/collapse';
import { seedSlug } from '../src/lib/records/seed/format';
import { matchExistingBuildings } from '../src/lib/records/seed/match';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel } from '../src/lib/records/seed/sam';
import { seedStatements } from '../src/lib/records/seed/sql';
import type { AssessorRow, ExistingBuilding, SamRow, SeedBuilding } from '../src/lib/records/seed/types';
import { FY2026_RESOURCE_ID } from '../src/lib/records/sources/boston/assessor';
import type { FetchLike } from '../src/lib/records/types';

const argv = process.argv.slice(2);
const args = new Set(argv);
const flag = (name: string): boolean => args.has(`--${name}`);

/** `--name value` or `--name=value`; null when absent. */
function option(name: string): string | null {
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : null;
}

/**
 * 1-based batch file to resume applying at, for a run that died partway through; null when
 * the flag is absent.
 *
 * A bare `--from` throws rather than meaning 1. The flag exists to skip work, so reading a
 * missing value as "start at the beginning" turns a typo into a silent full re-apply — and
 * with the resume path below, into regenerating nothing and applying every file again.
 */
function fromFile(): number | null {
  if (!args.has('--from') && !argv.some((a) => a.startsWith('--from='))) return null;
  const raw = option('from');
  if (raw === null || raw.startsWith('--')) throw new Error(`--from needs a batch file number starting at 1, got ${raw === null ? 'nothing' : JSON.stringify(raw)}`);
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== raw.trim()) throw new Error(`--from takes a batch file number starting at 1, got ${JSON.stringify(raw)}`);
  return n;
}
const CACHE_DIR = join(process.cwd(), '.cache');
const SEED_DIR = join(CACHE_DIR, 'seed');
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * Batch size for one `wrangler d1 execute --file`. 2000 statements (about 1.5 MB) hangs the
 * local D1 for five minutes and then fails with `Body Timeout Error`, workerd logging
 * `kj/table.c++:57: HashIndex detected hash table inconsistency` throughout; the whole file
 * rolls back. 1000 statements of the same data applies in under three seconds. Measured
 * against wrangler's local miniflare D1 on 2026-09-09 — the cliff is the batch size, not
 * any one statement, so keep this under it. A multiple of three, so a batch file holds
 * whole buildings (UPDATE/INSERT, pull, record) and a resume with `--from` never starts in
 * the middle of one.
 */
const STATEMENTS_PER_FILE = 999;
const DB_NAME = 'ratemyplace-db';
/** How many rejected 'A' descriptions the summary names, so a renamed housing code is visible. */
const TOP_SKIPPED_DESCRIPTIONS = 10;
const LONGEST_ADDRESSES = 5;
/** How many held-back parcel ids the summary names inline; the unmatched list has the rest. */
const HELD_BACK_LISTED = 20;
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
 * address, slug, parcel_id, latitude, longitude, zip_code — can legitimately hold "null",
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

/**
 * The land-use filter's rejections, by description. The download is already narrowed to
 * the five seed codes, so everything here is an 'A' parcel whose description is not on the
 * housing list — the one place a renamed assessor description would silently cost rows.
 */
function rejectedDescriptions(rows: readonly AssessorRow[]): Array<{ description: string; landUse: string; count: number }> {
  const counts = new Map<string, { description: string; landUse: string; count: number }>();
  for (const row of rows) {
    if (isSeedParcelRow({ LU: row.LU, LU_DESC: row.LU_DESC })) continue;
    const landUse = normalizeLandUse(row.LU);
    const description = normalizeLandUse(row.LU_DESC) || '(blank)';
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

function batchFilePath(n: number): string {
  return join(SEED_DIR, `seed-boston-${String(n).padStart(3, '0')}.sql`);
}

/**
 * Write the plan out as numbered batch files, and delete any higher-numbered file a
 * previous, larger run left behind — otherwise a later `--from` resume would apply stale
 * statements from a plan nobody is running any more.
 */
function writeBatchFiles(statements: readonly string[]): string[] {
  mkdirSync(SEED_DIR, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_FILE) {
    const path = batchFilePath(files.length + 1);
    writeFileSync(path, statements.slice(i, i + STATEMENTS_PER_FILE).join('\n') + '\n');
    files.push(path);
  }
  for (let n = files.length + 1; existsSync(batchFilePath(n)); n += 1) rmSync(batchFilePath(n));
  log(`  wrote ${statements.length} statements to ${files.length} files under .cache/seed/`);
  return files;
}

/**
 * The batch files already on disk, for a `--from` resume. Nothing is regenerated: the
 * downloads are cached for a day, so a run resumed the next morning re-downloads a fresher
 * assessor extract, and one added or removed parcel shifts every later building across the
 * 999-statement boundaries. The files the earlier run was applying are the only ones whose
 * numbering the `--from` cursor still describes, so a resume applies exactly those.
 */
function existingBatchFiles(from: number): string[] {
  const files: string[] = [];
  for (let n = 1; existsSync(batchFilePath(n)); n += 1) files.push(batchFilePath(n));
  if (files.length === 0) {
    throw new Error(`--from ${from} resumes batch files already written, but ${SEED_DIR} holds none. Re-run without --from to generate them.`);
  }
  if (files.length < from) {
    throw new Error(`--from ${from} is past the last batch file in ${SEED_DIR} (${files.length}). Re-run without --from to regenerate them.`);
  }
  log(`  reusing ${files.length} batch files already under .cache/seed/ (not regenerated)`);
  return files;
}

async function main(): Promise<void> {
  const dryRun = !flag('write') && !flag('apply');
  // Parsed up front so a bad --from fails before the download, not after it.
  const from = fromFile();
  if (from !== null && !flag('apply')) throw new Error('--from resumes an apply; pass --apply --local or --apply --remote with it.');
  log(`\nSeed Boston buildings (${dryRun ? 'dry run' : flag('apply') ? `apply ${target()}` : 'write files'})\n`);

  // `sort: '_id'` on both downloads: CKAN promises no order without it, so two pages of one
  // download can repeat or drop a row, and the batch files stop being reproducible.
  const assessor = await cached('assessor-fy2026', () =>
    fetchAllRows<AssessorRow>(FY2026_RESOURCE_ID, { fields: [...ASSESSOR_SEED_FIELDS], filters: { LU: [...SEED_LAND_USES] }, sort: '_id', onPage: (n) => log(`  assessor rows: ${n}`) }, fetchImpl),
  );
  const sam = await cached('sam-addresses', () =>
    fetchAllRows<SamRow>(SAM_RESOURCE_ID, { fields: [...SAM_FIELDS], sort: '_id', onPage: (n) => log(`  SAM rows: ${n}`) }, fetchImpl),
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

  // Only rows a person created. A seeded row is matched by its own id through the create
  // upsert, and feeding it back through address matching would only invent conflicts.
  const existing = wranglerJson<ExistingBuilding>([target(), '--command', "SELECT id, address, slug, parcel_id, latitude, longitude, zip_code FROM buildings WHERE city = 'Boston' AND source = 'user'"]);
  // A parcel's own seed row from a previous run does not block its slug — its id is what
  // the create upsert conflicts on, and the upsert leaves the published slug alone. Without
  // this, every re-seed reports 38k collisions and computes a `-2` slug it then discards.
  const seedIds = new Set(buildings.map((b) => `seed-${b.parcelId}`));
  const takenSlugs = new Set(
    wranglerJson<{ id: string; slug: string }>([target(), '--command', 'SELECT id, slug FROM buildings'])
      .filter((r) => !seedIds.has(r.id))
      .map((r) => r.slug),
  );
  const match = matchExistingBuildings(existing, buildings);
  log(`  existing user-created Boston rows: ${existing.length}; matched ${match.matched.length}, conflicts ${match.conflicts.length}, unmatched ${match.unmatched.length}`);
  for (const c of match.conflicts) log(`    CONFLICT ${c.building.id} ${c.building.address} has parcel ${c.building.parcel_id}, seed says ${c.parcel.parcelId}`);
  for (const u of match.unmatched) {
    log(`    UNMATCHED ${u.building.id} ${u.building.address}: ${u.reason}`);
    for (const c of u.candidates) log(`      candidate parcel ${c.parcelId}  ${c.address}`);
  }

  // A parcel an existing row has any claim on is not created a second time: matched ones
  // are updated in place, and the rest are waiting on a human, who cannot resolve a
  // conflict that the seed has meanwhile duplicated.
  const matchedParcels = new Set(match.matched.map((m) => m.parcel.parcelId));
  const heldBack = [...match.claimedParcels].filter((p) => !matchedParcels.has(p));
  const created = buildings
    .filter((b) => !match.claimedParcels.has(b.parcelId))
    .map((parcel) => ({ parcel, slug: seedSlug(parcel.address, takenSlugs) }));
  log(`  to create: ${created.length}; to update in place: ${match.matched.length}`);
  const listed = heldBack.slice(0, HELD_BACK_LISTED);
  log(`  parcels held back for hand review: ${heldBack.length}${listed.length > 0 ? ` (${listed.join(', ')}${heldBack.length > listed.length ? ', …' : ''})` : ''}`);
  log(`  slugs that needed a collision suffix: ${created.filter((c) => tookCollisionSuffix(c.slug)).length}`);
  // What a complete apply of this plan leaves behind, so the count reported at the end is
  // checkable rather than merely large.
  const expected = created.length + match.matched.length;
  log(`  expected ${expected} buildings written by the seed (${created.length} created + ${match.matched.length} matched)`);

  if (dryRun) {
    log('\nDry run complete. Nothing written.');
    return;
  }

  // A resume applies the files the earlier run wrote; only a fresh run regenerates them.
  const files = from !== null && from > 1 ? existingBatchFiles(from) : writeBatchFiles(seedStatements({ created, matched: match.matched }));

  if (!flag('apply')) return;
  const start = from ?? 1;
  if (start > files.length) throw new Error(`--from ${start} is past the last batch file (${files.length})`);
  if (start > 1) log(`  resuming at batch file ${start} of ${files.length}`);
  for (const [index, path] of files.entries()) {
    if (index + 1 < start) continue;
    log(`  applying ${index + 1}/${files.length} ${target()}`);
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, target(), '--file', path].map(shellArg), { stdio: 'inherit', shell: true });
  }
  // Two counts, because a matched building keeps `source = 'user'`: the seed writes to it
  // but did not create it. The pull row is what every building the seed wrote has in common,
  // so that is the number `expected` can be compared against.
  const after = wranglerJson<{ seeded: number; written: number }>([
    target(),
    '--command',
    "SELECT (SELECT COUNT(*) FROM buildings WHERE source = 'seed') AS seeded, (SELECT COUNT(DISTINCT building_id) FROM record_pulls WHERE trigger_reason = 'seed') AS written",
  ]);
  log(`\nDone. Seeded buildings in ${target()} database: ${after[0]?.seeded}; buildings written by the seed: ${after[0]?.written}, expected ${expected}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
