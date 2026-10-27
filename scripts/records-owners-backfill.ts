// scripts/records-owners-backfill.ts
/**
 * Generate the one-time fill of `building_owners` (migration 0034) for every building pulled
 * before the records pull started writing owner rows.
 *
 * Usage:
 *   npm run records:owners-backfill                  # read the local D1
 *   npm run records:owners-backfill -- --remote      # read production (needs CLOUDFLARE_API_TOKEN)
 *   npm run records:owners-backfill -- --remote --out <dir>   # put the run directory under <dir>
 *
 * It only ever runs SELECTs and writes files. It NEVER applies anything: every file is applied
 * by hand with `wrangler d1 execute --file`, in the order `summary.txt` gives, after migration
 * 0034 and after the site and the records Worker are deployed. The read walks
 * `building_records` once for each building's newest assessor row, a few seconds of D1 time in
 * all; run it off-hours.
 *
 * Each run writes to a new directory, `<out>/<local|remote>-<D1 unixepoch>/` (default `<out>` is
 * `.cache/owners-backfill`, which is gitignored). The directory is refused if it exists and
 * every file is opened exclusively, because the run directory holds the rollback for what it
 * wrote. A run that finds no owner to write writes nothing.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { writeBackfillRun } from '../src/lib/records/seed/suffixBackfill';
import {
  OWNERS_READ_PAGE,
  newestAssessmentsSql,
  ownersBackfillFiles,
  planOwnersBackfill,
  type StoredOwnerAssessment,
} from '../src/lib/records/seed/ownersBackfill';
import { D1_DATABASE, wranglerJson } from './lib/wranglerD1';

const DEFAULT_OUT = '.cache/owners-backfill';
const KNOWN_FLAGS = new Set(['--local', '--remote', '--out']);

const argv = process.argv.slice(2);

/** `--name value` or `--name=value`; null when absent. A value that is itself a flag is an error. */
function option(name: string): string | null {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
  return value;
}

function target(): '--local' | '--remote' {
  const remote = argv.includes('--remote');
  if (remote && argv.includes('--local')) throw new Error('Pass --local or --remote, not both');
  return remote ? '--remote' : '--local';
}

function main(): void {
  for (const arg of argv) {
    const flagName = arg.startsWith('--') ? arg.split('=')[0] : null;
    if (flagName && !KNOWN_FLAGS.has(flagName)) throw new Error(`Unknown flag ${flagName}`);
  }
  const where = target();

  const tables = wranglerJson<{ name: string }>([where, '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'building_owners'"]);
  if (tables.length === 0) throw new Error('building_owners does not exist on this database yet: apply migrations/0034_building_owners.sql first');

  // Taken before the first read, so every row read is at least this old: a pull that rewrites
  // a building's assessor rows after this moment is newer than the read, and the guards in the
  // emitted SQL let that pull's own owner row stand.
  const [{ now }] = wranglerJson<{ now: number }>([where, '--command', 'SELECT unixepoch() AS now']);
  if (!Number.isInteger(now)) throw new Error(`D1 returned no usable unixepoch(): ${JSON.stringify(now)}`);

  const stored: StoredOwnerAssessment[] = [];
  let after = '';
  for (;;) {
    const page = wranglerJson<StoredOwnerAssessment>([where, '--command', newestAssessmentsSql(after, OWNERS_READ_PAGE)]);
    stored.push(...page);
    console.log(`Read ${stored.length} buildings' newest assessor rows (${where}).`);
    if (page.length < OWNERS_READ_PAGE) break;
    const last = page[page.length - 1].building_id;
    if (last <= after) throw new Error(`read did not advance past ${after}`);
    after = last;
  }

  const plan = planOwnersBackfill(stored);
  const out = (option('out') ?? DEFAULT_OUT).replace(/\\/g, '/').replace(/\/+$/, '');
  const dir = `${out}/${where.slice(2)}-${now}`;
  const files = ownersBackfillFiles(plan, { readAt: now, target: where, dir, database: D1_DATABASE });
  const summary = files.get('summary.txt');
  if (summary) console.log(`\n${summary}`);
  if (!writeBackfillRun(dir, files, { existsSync, mkdirSync, writeFileSync })) {
    console.log('No owner rows to write; no files written.');
    return;
  }
  console.log(`Wrote ${files.size} files to ${dir}`);
}

main();
