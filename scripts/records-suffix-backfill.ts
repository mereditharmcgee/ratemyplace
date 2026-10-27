// scripts/records-suffix-backfill.ts
/**
 * Generate the data step that follows a change to `SUFFIX_SPELLINGS` in
 * `src/lib/records/identity.ts`: re-key stored `buildings.street_key` values, respell seeded
 * display addresses, and queue a records refresh for the affected seeded buildings.
 * Plan: docs/superpowers/plans/2026-10-26-street-suffix.md, sections 5.5 to 5.7 and 8.
 *
 * Usage:
 *   npm run records:suffix-backfill                       # read the local D1
 *   npm run records:suffix-backfill -- --remote           # read production (needs CLOUDFLARE_API_TOKEN)
 *   npm run records:suffix-backfill -- --remote --pulled-since <T_live>   # also write refresh.sql
 *   npm run records:suffix-backfill -- --remote --out <dir>   # put the run directory under <dir>
 *
 * It only ever runs two SELECTs and writes files. It NEVER applies anything: every file is
 * applied by hand with `wrangler d1 execute --file`, in the order `summary.txt` gives. This is
 * a data step, not a migration, so nothing goes into `migrations/`.
 *
 * Each run writes to a new directory, `<out>/<local|remote>-<D1 unixepoch>/` (default `<out>` is
 * `.cache/suffix-backfill`, which is gitignored). The directory is refused if it exists and
 * every file is opened exclusively, because the run directory is the rollback for what it
 * planned. A run that plans no change writes nothing.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { backfillFiles, planSuffixBackfill, writeBackfillRun, type KeyedBuildingRow } from '../src/lib/records/seed/suffixBackfill';
import { D1_DATABASE, wranglerJson } from './lib/wranglerD1';

const DEFAULT_OUT = '.cache/suffix-backfill';
const KNOWN_FLAGS = new Set(['--local', '--remote', '--pulled-since', '--out']);

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

/**
 * T_live, the moment the Worker started running the new code: a 10-digit unix timestamp no
 * later than D1's own clock. Null when the flag is absent, so no refresh file is written.
 */
function pulledSince(now: number): number | null {
  const raw = option('pulled-since');
  if (raw === null) return null;
  if (!/^\d{10}$/.test(raw)) throw new Error(`--pulled-since takes a 10-digit unix timestamp, got ${JSON.stringify(raw)}`);
  const value = Number.parseInt(raw, 10);
  if (value > now) throw new Error(`--pulled-since ${value} is later than D1's unixepoch() ${now}`);
  return value;
}

function main(): void {
  for (const arg of argv) {
    const flagName = arg.startsWith('--') ? arg.split('=')[0] : null;
    if (flagName && !KNOWN_FLAGS.has(flagName)) throw new Error(`Unknown flag ${flagName}`);
  }
  const where = target();
  const [{ now }] = wranglerJson<{ now: number }>([where, '--command', 'SELECT unixepoch() AS now']);
  if (!Number.isInteger(now)) throw new Error(`D1 returned no usable unixepoch(): ${JSON.stringify(now)}`);
  const since = pulledSince(now);

  const rows = wranglerJson<KeyedBuildingRow>([
    where,
    '--command',
    'SELECT id, address, source, street_key, st_num_lo, st_num_hi, updated_at FROM buildings WHERE street_key IS NOT NULL',
  ]);
  console.log(`Read ${rows.length} keyed buildings (${where}).`);

  const plan = planSuffixBackfill(rows);
  const out = (option('out') ?? DEFAULT_OUT).replace(/\\/g, '/').replace(/\/+$/, '');
  const dir = `${out}/${where.slice(2)}-${now}`;
  const files = backfillFiles(plan, { pulledSince: since, generatedAt: now, target: where, dir, database: D1_DATABASE });
  const summary = files.get('summary.txt');
  if (summary) console.log(`\n${summary}`);
  if (!writeBackfillRun(dir, files, { existsSync, mkdirSync, writeFileSync })) {
    console.log('Nothing to change; no files written.');
    return;
  }
  console.log(`Wrote ${files.size} files to ${dir}`);
}

main();
