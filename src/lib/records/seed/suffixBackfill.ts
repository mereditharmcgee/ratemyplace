// The data step that follows a change to `SUFFIX_SPELLINGS` in `records/identity.ts`.
//
// Stored `buildings.street_key` values were computed under the old table, and seeded display
// addresses were formatted under it ("120 Grampian Wy" where a fresh seed now writes "120
// Grampian Way"). This module plans the three fixes, as separate files so each can be applied,
// skipped or rolled back on its own:
//
//   rekey.sql    every stored key re-split under the current table. Mandatory: dedupe and the
//                seed matcher look rows up by key, so a stale key is an invisible row.
//   respell.sql  seeded addresses whose last word is a short spelling, spelled out the way
//                `formatSeedAddress` now would. Optional: it changes the H1 and <title>, so it
//                bumps `updated_at` (the sitemap's lastmod); the re-key does not.
//   refresh.sql  one `refresh` queue row per affected seeded building, so its records are
//                pulled again under the new identity. Guarded by a cutoff (`pulledSince`, the
//                moment the Worker ran the new code), so a building already pulled since then is
//                skipped and re-applying the file after the batch drains is a no-op.
//
// Pure: `scripts/records-suffix-backfill.ts` reads the rows with a read-only SELECT and hands the
// file system in. Nothing here applies anything. Every value in the emitted SQL goes through
// `lit()`, as in the seed, because `wrangler d1 execute --file` binds nothing.
import { parseStreetAddress } from '../../enrichment/helpers';
import { addressKey, splitSuffix, streetKey } from '../identity';
import { PRIORITY } from '../queue';
import { titleWord } from './format';
import { lit } from './sql';

export interface KeyedBuildingRow {
  id: string;
  address: string;
  source: 'user' | 'seed';
  street_key: string;
  st_num_lo: number | null;
  st_num_hi: number | null;
  updated_at: number;
}

export interface Change {
  id: string;
  source: 'user' | 'seed';
  from: string;
  to: string;
}

export type RefusalReason = 'respell_changes_key' | 'lone_directional_base' | 'rekey_degenerate';

export interface Refusal {
  id: string;
  address: string;
  reason: RefusalReason;
}

export interface SuffixBackfillPlan {
  respells: Change[];
  rekeys: Change[];
  refused: Refusal[];
  /** Every row that appears in `respells`, `rekeys` or `refused`, as read: the run's snapshot. */
  before: KeyedBuildingRow[];
}

/** Statements per `wrangler d1 execute --file`: the seed's measured cliff (records-seed-boston.ts STATEMENTS_PER_FILE). */
export const MAX_STATEMENTS_PER_FILE = 999;

/** A trailing parenthesized tail, as the seed writes a comma tail: "5 Grampian Wy (Rear)". */
const TAIL = /^(.*?)(\s*\([^()]*\))?$/;
const LONE_DIRECTIONAL = /^[NSEW]$/;

function longestSpelling(spellings: readonly string[]): string {
  return spellings.reduce((a, b) => (b.length > a.length ? b : a));
}

/** The respelled address plus the street base it keeps, or null when there is nothing to respell. */
function respell(address: string): { address: string; base: string } | null {
  const [, main, tail = ''] = TAIL.exec(address) ?? [];
  if (!main || main.trim().split(/\s+/).length < 3) return null;
  const parsed = parseStreetAddress(main.trim());
  if (!parsed) return null;
  const { base, spellings } = splitSuffix(parsed.street);
  if (!spellings) return null;
  const lastWord = /\S+$/.exec(main)?.[0] ?? '';
  const longest = longestSpelling(spellings);
  if (!spellings.includes(lastWord.toUpperCase()) || lastWord.toUpperCase() === longest) return null;
  return { address: `${main.slice(0, main.length - lastWord.length)}${titleWord(longest)}${tail}`, base };
}

/**
 * A seeded address with its last word spelled out the way `formatSeedAddress` now writes it:
 * '120 Grampian Wy' -> '120 Grampian Way', '5 Grampian Wy (Rear)' -> '5 Grampian Way (Rear)'.
 * Null when the last word is already its row's longest spelling, is not a suffix at all, or the
 * address has fewer than three words (a number, a name and a suffix).
 */
export function respelledSeedAddress(address: string): string | null {
  return respell(address)?.address ?? null;
}

/**
 * Re-key every row under the current suffix table, and respell the seeded rows whose display
 * address still carries a short spelling. Refuses rather than guesses:
 *
 * - `rekey_degenerate` — the stored key re-splits to nothing usable. NULL is never written; the
 *   row keeps its key and is listed for a human. Such a row is not respelled either.
 * - `lone_directional_base` — the respell would leave a one-letter directional as the street
 *   name ("7 N Way"), which no longer reads as the same street.
 * - `respell_changes_key` — the respelled address would key differently from the stored row
 *   (a different street key, or a different number range), so the page would stop matching
 *   the reviewer dedupe it matches today.
 *
 * User rows are never respelled: their address is what a person typed.
 */
export function planSuffixBackfill(rows: readonly KeyedBuildingRow[]): SuffixBackfillPlan {
  const plan: SuffixBackfillPlan = { respells: [], rekeys: [], refused: [], before: [] };
  for (const row of rows) {
    let touched = false;
    const key = streetKey(row.street_key);
    if (key === null) {
      plan.refused.push({ id: row.id, address: row.address, reason: 'rekey_degenerate' });
      plan.before.push(row);
      continue;
    }
    if (key !== row.street_key) {
      plan.rekeys.push({ id: row.id, source: row.source, from: row.street_key, to: key });
      touched = true;
    }
    const respelled = row.source === 'seed' ? respell(row.address) : null;
    if (respelled) {
      touched = true;
      const after = addressKey(respelled.address);
      if (LONE_DIRECTIONAL.test(respelled.base)) {
        plan.refused.push({ id: row.id, address: row.address, reason: 'lone_directional_base' });
      } else if (!after || after.streetKey !== key || after.numLo !== row.st_num_lo || after.numHi !== row.st_num_hi) {
        plan.refused.push({ id: row.id, address: row.address, reason: 'respell_changes_key' });
      } else {
        plan.respells.push({ id: row.id, source: row.source, from: row.address, to: respelled.address });
      }
    }
    if (touched) plan.before.push(row);
  }
  return plan;
}

/** Seeded ids whose records were pulled under the old identity: both lists, deduped and sorted. */
export function refreshIds(plan: SuffixBackfillPlan): string[] {
  const ids = [...plan.respells, ...plan.rekeys].filter((change) => change.source === 'seed').map((change) => change.id);
  return Array.from(new Set(ids)).sort();
}

function cutoff(pulledSince: number): string {
  if (!Number.isInteger(pulledSince) || pulledSince < 0) throw new Error(`pulledSince must be a unix timestamp in whole seconds, got ${pulledSince}`);
  return lit(pulledSince);
}

/** Key-only change: no `updated_at` bump, because nothing a reader sees changes. */
export function rekeyStatements(plan: SuffixBackfillPlan): string[] {
  return plan.rekeys.map((c) => `UPDATE buildings SET street_key = ${lit(c.to)} WHERE id = ${lit(c.id)} AND street_key = ${lit(c.from)};`);
}

export function rekeyRollbackStatements(plan: SuffixBackfillPlan): string[] {
  return plan.rekeys.map((c) => `UPDATE buildings SET street_key = ${lit(c.from)} WHERE id = ${lit(c.id)} AND street_key = ${lit(c.to)};`);
}

/** The H1 and <title> change, which is real content, so `updated_at` (sitemap lastmod) moves. */
export function respellStatements(plan: SuffixBackfillPlan): string[] {
  return plan.respells.map(
    (c) => `UPDATE buildings SET address = ${lit(c.to)}, updated_at = unixepoch() WHERE id = ${lit(c.id)} AND source = 'seed' AND address = ${lit(c.from)};`,
  );
}

/** The inverse respell, which changes the content back and so bumps `updated_at` again. */
export function respellRollbackStatements(plan: SuffixBackfillPlan): string[] {
  return plan.respells.map(
    (c) => `UPDATE buildings SET address = ${lit(c.from)}, updated_at = unixepoch() WHERE id = ${lit(c.id)} AND source = 'seed' AND address = ${lit(c.to)};`,
  );
}

/**
 * One `refresh` row per affected seeded building. `INSERT OR IGNORE` yields to an existing
 * pending row (the partial unique index on pending `building_id`); the `EXISTS` skips a building
 * deleted since the plan; the `NOT EXISTS` skips one pulled at or after `pulledSince`, which
 * covers the pilot pulls, fill pulls under the new code, and a second apply after the batch drains.
 */
export function refreshStatements(plan: SuffixBackfillPlan, pulledSince: number): string[] {
  const since = cutoff(pulledSince);
  return refreshIds(plan).map((id) => {
    const building = lit(id);
    return (
      `INSERT OR IGNORE INTO records_queue (building_id, reason, priority, requested_at) SELECT ${building}, 'refresh', ${PRIORITY.refresh}, unixepoch() ` +
      `WHERE EXISTS (SELECT 1 FROM buildings WHERE id = ${building}) AND NOT EXISTS (SELECT 1 FROM record_pulls WHERE building_id = ${building} AND retrieved_at >= ${since});`
    );
  });
}

/** Closes refresh rows still pending from this run, before a code rollback pulls them under the old identity. */
export function refreshCancelStatements(plan: SuffixBackfillPlan, pulledSince: number): string[] {
  const since = cutoff(pulledSince);
  return refreshIds(plan).map(
    (id) => `UPDATE records_queue SET done_at = unixepoch() WHERE building_id = ${lit(id)} AND reason = 'refresh' AND done_at IS NULL AND requested_at >= ${since};`,
  );
}

export interface BackfillFileOptions {
  /** T_live: when the Worker started running the new code. Null writes no refresh files. */
  pulledSince: number | null;
  /** D1's `unixepoch()` when the rows were read. */
  generatedAt: number;
  target: '--local' | '--remote';
  /** The run directory the files will be written to, as the apply commands should name it. */
  dir: string;
  /** The D1 database name the apply commands name. */
  database: string;
}

function sqlFile(name: string, statements: readonly string[]): string {
  if (statements.length > MAX_STATEMENTS_PER_FILE) {
    throw new Error(`${name} would hold ${statements.length} statements; one wrangler d1 execute --file is capped at ${MAX_STATEMENTS_PER_FILE}`);
  }
  return `${statements.join('\n')}\n`;
}

/** 'Highway 128, Way 118, …': respells grouped by the word they write, most first. */
function countsByNewWord(plan: SuffixBackfillPlan): string {
  const counts = new Map<string, number>();
  for (const change of plan.respells) {
    const word = (TAIL.exec(change.to)?.[1] ?? change.to).split(/\s+/).pop() ?? '';
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word, n]) => `${word} ${n}`)
    .join(', ');
}

function summary(plan: SuffixBackfillPlan, options: BackfillFileOptions, written: ReadonlySet<string>): string {
  const command = (file: string) => {
    const path = `${options.dir}/${file}`;
    return `npx wrangler d1 execute ${options.database} ${options.target} --file ${/\s/.test(path) ? `"${path}"` : path}`;
  };
  const ids = refreshIds(plan);
  const lines = [
    'Street-suffix backfill. Generated only: nothing in this directory has been applied.',
    `target: ${options.target}`,
    `generated at (D1 unixepoch): ${options.generatedAt}`,
    `pulled since (T_live): ${options.pulledSince ?? 'not given'}`,
    `run directory: ${options.dir}`,
    '',
    `respell: ${plan.respells.length}${plan.respells.length > 0 ? ` (${countsByNewWord(plan)})` : ''}`,
    `re-key: ${plan.rekeys.length}`,
    `refused: ${plan.refused.length}`,
    `refresh ids: ${ids.length}`,
    '',
    'Re-keys:',
    ...(plan.rekeys.length > 0 ? plan.rekeys.map((c) => `  ${c.id}: ${c.from} -> ${c.to}`) : ['  (none)']),
    'Refusals:',
    ...(plan.refused.length > 0 ? plan.refused.map((r) => `  ${r.id} "${r.address}": ${r.reason}`) : ['  (none)']),
    '',
    'Apply by hand, in this order, after the Pages and Worker deploys:',
  ];
  if (written.has('rekey.sql')) lines.push('  1. Re-key (always):', `     ${command('rekey.sql')}`);
  if (written.has('respell.sql')) lines.push('  2. Respell (only if the owner approved it):', `     ${command('respell.sql')}`);
  if (written.has('refresh.sql')) lines.push('  3. Refresh (only after the pilot passed; apply once):', `     ${command('refresh.sql')}`);
  else if (ids.length > 0) lines.push('  refresh.sql not written: pass --pulled-since <T_live>');
  lines.push('', 'Rollback, in this order:');
  if (written.has('refresh-cancel.sql')) lines.push(`  ${command('refresh-cancel.sql')}`);
  if (written.has('respell-rollback.sql')) lines.push(`  ${command('respell-rollback.sql')}`);
  if (written.has('rekey-rollback.sql')) lines.push(`  ${command('rekey-rollback.sql')}`);
  return `${lines.join('\n')}\n`;
}

/**
 * File name -> content for one run. Each SQL file holds statements only (no comments); the
 * run's metadata and the exact apply commands are in `summary.txt`, and `before.json` is the
 * snapshot of every touched row. A plan with no changes gives an empty map, so a no-op run
 * writes nothing at all.
 */
export function backfillFiles(plan: SuffixBackfillPlan, options: BackfillFileOptions): Map<string, string> {
  const files = new Map<string, string>();
  if (plan.rekeys.length > 0) {
    files.set('rekey.sql', sqlFile('rekey.sql', rekeyStatements(plan)));
    files.set('rekey-rollback.sql', sqlFile('rekey-rollback.sql', rekeyRollbackStatements(plan)));
  }
  if (plan.respells.length > 0) {
    files.set('respell.sql', sqlFile('respell.sql', respellStatements(plan)));
    files.set('respell-rollback.sql', sqlFile('respell-rollback.sql', respellRollbackStatements(plan)));
  }
  if (options.pulledSince !== null && refreshIds(plan).length > 0) {
    files.set('refresh.sql', sqlFile('refresh.sql', refreshStatements(plan, options.pulledSince)));
    files.set('refresh-cancel.sql', sqlFile('refresh-cancel.sql', refreshCancelStatements(plan, options.pulledSince)));
  }
  if (files.size === 0) return files;
  const written = new Set(files.keys());
  files.set('before.json', `${JSON.stringify(plan.before, null, 2)}\n`);
  files.set('summary.txt', summary(plan, options, written));
  return files;
}

/** The three calls `writeBackfillRun` makes, injected so `src/lib` imports no `node:` module. */
export interface RunDirFs {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): unknown;
  writeFileSync(path: string, data: string, options: { flag: 'wx' }): void;
}

/**
 * Writes one run into a directory that must not exist yet, every file opened with `wx` so a
 * file that appears in between fails the write instead of being overwritten. A run directory is
 * the rollback for what it planned, so it is never reused. Returns false, touching nothing,
 * when there is nothing to write.
 */
export function writeBackfillRun(dir: string, files: ReadonlyMap<string, string>, fs: RunDirFs): boolean {
  if (files.size === 0) return false;
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite existing run directory ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of files) fs.writeFileSync(`${dir}/${name}`, content, { flag: 'wx' });
  return true;
}
