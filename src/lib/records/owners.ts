// The write side of `building_owners` (migration 0034): the statements a records pull adds to
// each assessor year's batch, so a building's owner row and the assessor rows it is read from
// land together or not at all. A rejected batch rolls the owner row back with everything else,
// which keeps the pull's promise that a failed write leaves a source exactly as it was.
//
// This runs in the site's admin pulls and in the records-scheduler Worker, so it stays
// runtime-agnostic: no `node:` imports, nothing that only exists under tsx. A change here needs
// `npm run records:worker:deploy` as well as the site deploy.
//
// The row is the newest fiscal year the building has an assessor row for, which is the row the
// records panel shows as current. Each year's batch only writes when no newer year is stored,
// so the years can run in any order and an empty newer year falls back to the next one down.
// The read side is `ownerList.ts`; the one-time fill for buildings pulled before this shipped
// is `npm run records:owners-backfill`.
import { ownerRowFromAssessment } from './ownerOfRecord';
import type { RecordRow, RecordsDb, RecordsPreparedStatement } from './types';

export const OWNERS_TABLE = 'building_owners';

const OWNER_COLUMNS = 'building_id, fiscal_year, parcel_id, owner, owner_key, is_entity, residential, updated_at';

/** No assessor row newer than this one is stored for the building. Binds: building id, fiscal year. */
const NO_NEWER_YEAR =
  "NOT EXISTS (SELECT 1 FROM building_records r WHERE r.building_id = ? AND r.kind = 'assessment' AND r.source_key > ?)";

/**
 * Whether migration 0034 has run. Until it has, a pull writes no owner row and fails nothing:
 * the site and the Worker can deploy ahead of the migration. Never throws; a check that cannot
 * answer counts as "not there", which costs an owner row and nothing else.
 */
export async function ownersTableExists(db: RecordsDb): Promise<boolean> {
  try {
    const row = await db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(OWNERS_TABLE)
      .first<{ present: number }>();
    return row !== null;
  } catch {
    return false;
  }
}

/**
 * The owner statements for one assessor year's batch, appended after that year's own
 * delete-then-insert. `rows` is what the year's source returned (one row, or none).
 *
 * When no newer year is stored, this year is the building's current one: its old owner row
 * goes, and this year's row goes in if it names an owner. A condominium parcel or a blank
 * owner therefore leaves no row, and a year that came back empty clears the row so the next
 * year down (whose batch runs after) can write its own. When a newer year is stored, both
 * statements do nothing.
 */
export function ownerStatements(
  db: RecordsDb,
  buildingId: string,
  fiscalYear: string,
  rows: readonly RecordRow[],
): RecordsPreparedStatement[] {
  const statements = [
    db.prepare(`DELETE FROM building_owners WHERE building_id = ? AND ${NO_NEWER_YEAR}`).bind(buildingId, buildingId, fiscalYear),
  ];
  // The first row for the year, matching the dedupe in pull.ts's replaceStatements.
  const assessment = rows.find((row) => row.kind === 'assessment' && row.sourceKey === fiscalYear);
  const owner = assessment?.kind === 'assessment' ? ownerRowFromAssessment(buildingId, assessment.payload) : null;
  if (owner) {
    statements.push(
      db
        .prepare(`INSERT OR REPLACE INTO building_owners (${OWNER_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, unixepoch() WHERE ${NO_NEWER_YEAR}`)
        .bind(
          owner.buildingId,
          owner.fiscalYear,
          owner.parcelId,
          owner.owner,
          owner.ownerKey,
          owner.isEntity,
          owner.residential,
          buildingId,
          fiscalYear,
        ),
    );
  }
  return statements;
}

/**
 * The owner row's half of the fiscal-year rollover at the end of a Boston pull: a row read from
 * a year that has dropped off the assessor list goes with that year's stored rows, so no
 * building stays in an owner list on the strength of a record the panel no longer shows.
 */
export function ownerRolloverStatement(db: RecordsDb, buildingId: string, fiscalYears: readonly string[]): RecordsPreparedStatement {
  return db
    .prepare(`DELETE FROM building_owners WHERE building_id = ? AND fiscal_year NOT IN (${fiscalYears.map(() => '?').join(',')})`)
    .bind(buildingId, ...fiscalYears);
}
