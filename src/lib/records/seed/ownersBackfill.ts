// The one-time fill of `building_owners` (migration 0034) for buildings pulled before the pull
// started writing owner rows. `scripts/records-owners-backfill.ts` reads each building's newest
// stored assessor row with read-only SELECTs and hands the rows in; this module computes every
// owner row with the same `ownerRowFromAssessment` the pull uses (so `owner_key` is exactly
// `ownerKey()`, which SQL cannot compute) and writes the SQL. Nothing here applies anything:
// the files are applied by hand with `wrangler d1 execute --file`, which binds nothing, so
// every value goes through `lit()`, as in the seed.
//
// Safe to re-run, and safe against the pull running at the same time:
// - Each statement is an upsert keyed on building_id.
// - A building whose assessor rows were rewritten after the read (`building_records.created_at`
//   is reset on every re-pull) is skipped: that pull wrote its own owner row from fresher data.
// - An existing row is replaced only when it is older than the read, so a row a pull wrote
//   after the read is never overwritten with what the read saw.
// - A building deleted after the read is skipped rather than failing the statement on its
//   foreign key.
// The rollback deletes exactly the rows this run wrote: they all carry `updated_at` equal to
// the read time.
import { ownerRowFromAssessment, type OwnerRow } from '../ownerOfRecord';
import { lit } from './sql';

/** One stored assessor row as the read selects it: the newest fiscal year per building. */
export interface StoredOwnerAssessment {
  building_id: string;
  fiscal_year: string;
  owner: string | null;
  /** json_extract of a JSON boolean: 1 or 0. */
  condominium: number | boolean | null;
  parcel_id: string | null;
  land_use: string | null;
  land_use_description: string | null;
}

/** Buildings per read. Each read is one `wrangler d1 execute --json` call. */
export const OWNERS_READ_PAGE = 5000;

/** Rows per INSERT statement: about 200 bytes each, far under D1's 100 KB statement limit. */
export const ROWS_PER_STATEMENT = 100;

/** Statements per file, the seed's measured cliff for one `wrangler d1 execute --file`. */
export const MAX_STATEMENTS_PER_FILE = 999;

/**
 * One page of the read: each building's newest stored assessor row (the row the panel shows),
 * after `afterBuildingId` in id order. Only the fields an owner row needs are extracted, so a
 * page is a few hundred kilobytes instead of whole payloads. Read-only.
 */
export function newestAssessmentsSql(afterBuildingId: string, limit = OWNERS_READ_PAGE): string {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`limit must be a positive integer, got ${limit}`);
  return (
    'SELECT r.building_id, r.source_key AS fiscal_year, ' +
    "json_extract(r.payload, '$.owner') AS owner, " +
    "json_extract(r.payload, '$.condominium') AS condominium, " +
    "json_extract(r.payload, '$.parcelId') AS parcel_id, " +
    "json_extract(r.payload, '$.landUse') AS land_use, " +
    "json_extract(r.payload, '$.landUseDescription') AS land_use_description " +
    "FROM building_records r WHERE r.kind = 'assessment' AND r.building_id > " +
    lit(afterBuildingId) +
    ' AND r.source_key = (SELECT MAX(r2.source_key) FROM building_records r2 ' +
    "WHERE r2.building_id = r.building_id AND r2.kind = 'assessment') " +
    `ORDER BY r.building_id LIMIT ${limit}`
  );
}

export interface OwnersBackfillPlan {
  read: number;
  rows: OwnerRow[];
  skippedCondominium: number;
  skippedBlankOwner: number;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** The owner rows for what was read, plus what was left out and why. Pure. */
export function planOwnersBackfill(stored: readonly StoredOwnerAssessment[]): OwnersBackfillPlan {
  const rows: OwnerRow[] = [];
  let skippedCondominium = 0;
  let skippedBlankOwner = 0;
  for (const row of stored) {
    const condominium = row.condominium === 1 || row.condominium === true;
    const owner = ownerRowFromAssessment(row.building_id, {
      fiscalYear: row.fiscal_year,
      parcelId: textOrNull(row.parcel_id),
      owner: textOrNull(row.owner),
      condominium,
      landUse: textOrNull(row.land_use),
      landUseDescription: textOrNull(row.land_use_description),
    });
    if (owner) rows.push(owner);
    else if (condominium) skippedCondominium += 1;
    else skippedBlankOwner += 1;
  }
  return { read: stored.length, rows, skippedCondominium, skippedBlankOwner };
}

const COLUMNS = 'building_id, fiscal_year, parcel_id, owner, owner_key, is_entity, residential, updated_at';

/**
 * One upsert for up to `ROWS_PER_STATEMENT` rows. `readAt` is D1's `unixepoch()` when the rows
 * were read; it is every written row's `updated_at` and the cutoff for the two freshness guards.
 */
export function ownerInsertStatement(rows: readonly OwnerRow[], readAt: number): string {
  if (rows.length === 0) throw new Error('ownerInsertStatement needs at least one row');
  if (!Number.isInteger(readAt)) throw new Error(`readAt must be a unix timestamp, got ${readAt}`);
  const values = rows
    .map(
      (row) =>
        `(${[lit(row.buildingId), lit(row.fiscalYear), lit(row.parcelId), lit(row.owner), lit(row.ownerKey), lit(row.isEntity), lit(row.residential), lit(readAt)].join(', ')})`,
    )
    .join(', ');
  return (
    `INSERT INTO building_owners (${COLUMNS}) ` +
    'SELECT v.column1, v.column2, v.column3, v.column4, v.column5, v.column6, v.column7, v.column8 ' +
    `FROM (VALUES ${values}) AS v ` +
    'WHERE EXISTS (SELECT 1 FROM buildings b WHERE b.id = v.column1) ' +
    "AND NOT EXISTS (SELECT 1 FROM building_records r WHERE r.building_id = v.column1 AND r.kind = 'assessment' " +
    `AND r.created_at > ${lit(readAt)}) ` +
    'ON CONFLICT(building_id) DO UPDATE SET fiscal_year = excluded.fiscal_year, parcel_id = excluded.parcel_id, ' +
    'owner = excluded.owner, owner_key = excluded.owner_key, is_entity = excluded.is_entity, ' +
    'residential = excluded.residential, updated_at = excluded.updated_at ' +
    'WHERE building_owners.updated_at < excluded.updated_at;'
  );
}

export function ownerRollbackStatement(readAt: number): string {
  if (!Number.isInteger(readAt)) throw new Error(`readAt must be a unix timestamp, got ${readAt}`);
  return `DELETE FROM building_owners WHERE updated_at = ${lit(readAt)};`;
}

export interface OwnersBackfillFileOptions {
  /** D1's `unixepoch()` when the rows were read. */
  readAt: number;
  target: '--local' | '--remote';
  /** The run directory, as the apply commands should name it. */
  dir: string;
  /** The D1 database name the apply commands name. */
  database: string;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface KeyStats {
  key: string;
  buildings: number;
  isEntity: boolean;
  residentialParcels: Set<string>;
}

/** Counts the summary reports. Names only for entities; a person's name never goes in the summary. */
function keyStats(rows: readonly OwnerRow[]): KeyStats[] {
  const byKey = new Map<string, KeyStats>();
  for (const row of rows) {
    const stats = byKey.get(row.ownerKey) ?? { key: row.ownerKey, buildings: 0, isEntity: row.isEntity === 1, residentialParcels: new Set<string>() };
    stats.buildings += 1;
    if (row.residential === 1 && row.parcelId) stats.residentialParcels.add(row.parcelId);
    byKey.set(row.ownerKey, stats);
  }
  return [...byKey.values()];
}

function summary(plan: OwnersBackfillPlan, options: OwnersBackfillFileOptions, sqlFiles: readonly string[]): string {
  const command = (file: string) => {
    const path = `${options.dir}/${file}`;
    return `npx wrangler d1 execute ${options.database} ${options.target} --file ${/\s/.test(path) ? `"${path}"` : path}`;
  };
  const stats = keyStats(plan.rows);
  const entityKeys = stats.filter((s) => s.isEntity);
  const linkedPersonKeys = stats.filter((s) => !s.isEntity && s.residentialParcels.size >= 2);
  const largest = [...entityKeys].sort((a, b) => b.buildings - a.buildings || a.key.localeCompare(b.key)).slice(0, 10);
  const lines = [
    'Owner of record backfill. Generated only: nothing in this directory has been applied.',
    `target: ${options.target}`,
    `read at (D1 unixepoch, every row's updated_at): ${options.readAt}`,
    `run directory: ${options.dir}`,
    '',
    `buildings read (newest assessor row each): ${plan.read}`,
    `owner rows to write: ${plan.rows.length}`,
    `  entity owners: ${plan.rows.filter((r) => r.isEntity === 1).length}`,
    `  residential parcels: ${plan.rows.filter((r) => r.residential === 1).length}`,
    `skipped, condominium (no single owner shown): ${plan.skippedCondominium}`,
    `skipped, blank owner: ${plan.skippedBlankOwner}`,
    `distinct owner names: ${stats.length}`,
    `  entity names (link): ${entityKeys.length}`,
    `  person names with 2+ residential parcels (link): ${linkedPersonKeys.length}`,
    `  person names below that (never link): ${stats.length - entityKeys.length - linkedPersonKeys.length}`,
    '',
    'Largest entity owners by buildings:',
    ...(largest.length > 0 ? largest.map((s) => `  ${s.buildings}  ${s.key}`) : ['  (none)']),
    '',
    'Apply by hand, after migration 0034 and after the Pages and Worker deploys, in this order:',
    ...sqlFiles.map((file, i) => `  ${i + 1}. ${command(file)}`),
    '',
    'Check:',
    `  npx wrangler d1 execute ${options.database} ${options.target} --command "SELECT COUNT(*) AS n FROM building_owners WHERE updated_at = ${options.readAt}"`,
    '',
    'Rollback (removes only the rows this run wrote):',
    `  ${command('rollback.sql')}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * File name -> content for one run: the upsert files, the rollback and the summary. A plan with
 * no owner rows gives an empty map, so a run with nothing to write writes nothing.
 */
export function ownersBackfillFiles(plan: OwnersBackfillPlan, options: OwnersBackfillFileOptions): Map<string, string> {
  const files = new Map<string, string>();
  if (plan.rows.length === 0) return files;
  const statements = chunk(plan.rows, ROWS_PER_STATEMENT).map((rows) => ownerInsertStatement(rows, options.readAt));
  const sqlFiles = chunk(statements, MAX_STATEMENTS_PER_FILE).map((group, i) => {
    const name = `owners-${String(i + 1).padStart(3, '0')}.sql`;
    files.set(name, `${group.join('\n')}\n`);
    return name;
  });
  files.set('rollback.sql', `${ownerRollbackStatement(options.readAt)}\n`);
  files.set('summary.txt', summary(plan, options, sqlFiles));
  return files;
}
