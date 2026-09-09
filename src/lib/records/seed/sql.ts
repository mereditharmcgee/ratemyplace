import { ASSESSOR_PAGE_URL, ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../sources/boston/assessor';
import type { ExistingBuilding, SeedBuilding } from './types';

export const SEED_TRIGGER_REASON = 'seed';
const CURRENT_YEAR = ASSESSOR_YEARS[0];

export interface SeedPlan {
  created: Array<{ parcel: SeedBuilding; slug: string }>;
  matched: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
}

/**
 * SQL literal for a file applied with `wrangler d1 execute --file`, which binds nothing.
 * Strings double their quotes; numbers must be finite; null renders as NULL.
 */
export function lit(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in seed SQL: ${value}`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function pullIdFor(buildingId: string): string {
  return `seed-${CURRENT_YEAR.fiscalYear}-${buildingId.replace(/^seed-/, '')}`;
}

function pullStatement(buildingId: string): string {
  const pullId = pullIdFor(buildingId);
  return (
    'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (' +
    [lit(pullId), lit(buildingId), lit('boston'), lit(FY2026_RESOURCE_ID), lit(`Property Assessment ${CURRENT_YEAR.fiscalYear}`), lit(`seed: bulk ${CURRENT_YEAR.fiscalYear} assessor download`), lit('ok'), '1', 'NULL', 'NULL', 'NULL', lit(SEED_TRIGGER_REASON)].join(', ') +
    ') ON CONFLICT(id) DO NOTHING;'
  );
}

function recordStatement(buildingId: string, parcel: SeedBuilding): string {
  const pullId = pullIdFor(buildingId);
  return (
    'INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, source_url) VALUES (' +
    [lit(`${pullId}-assessment`), lit(buildingId), lit(pullId), lit('assessment'), lit(parcel.assessment.fiscalYear), lit(JSON.stringify(parcel.assessment)), lit(ASSESSOR_PAGE_URL)].join(', ') +
    ') ON CONFLICT(building_id, kind, source_key) DO UPDATE SET payload = excluded.payload, pull_id = excluded.pull_id;'
  );
}

function createStatement(parcel: SeedBuilding, slug: string): string {
  const id = `seed-${parcel.parcelId}`;
  return (
    'INSERT INTO buildings (id, address, slug, neighborhood, city, state, zip_code, latitude, longitude, year_built, unit_count, building_type, parcel_id, sam_id, source, street_key, st_num_lo, st_num_hi) VALUES (' +
    [lit(id), lit(parcel.address), lit(slug), lit(parcel.neighborhood), lit('Boston'), lit('MA'), lit(parcel.zip), lit(parcel.latitude), lit(parcel.longitude), lit(parcel.yearBuilt), lit(parcel.unitCount), lit(parcel.buildingType), lit(parcel.parcelId), lit(parcel.samId), lit('seed'), lit(parcel.streetKey), lit(parcel.numLo), lit(parcel.numHi)].join(', ') +
    // Address and slug are stable once published; everything the assessor owns refreshes.
    ') ON CONFLICT(id) DO UPDATE SET neighborhood = COALESCE(buildings.neighborhood, excluded.neighborhood), zip_code = COALESCE(buildings.zip_code, excluded.zip_code), latitude = COALESCE(buildings.latitude, excluded.latitude), longitude = COALESCE(buildings.longitude, excluded.longitude), year_built = excluded.year_built, unit_count = excluded.unit_count, building_type = excluded.building_type, sam_id = COALESCE(buildings.sam_id, excluded.sam_id), street_key = excluded.street_key, st_num_lo = excluded.st_num_lo, st_num_hi = excluded.st_num_hi, updated_at = unixepoch();'
  );
}

function matchStatement(building: ExistingBuilding, parcel: SeedBuilding): string {
  const { numLo, numHi } = addressRangeOf(building.address, parcel);
  return (
    'UPDATE buildings SET ' +
    [
      `parcel_id = ${lit(parcel.parcelId)}`,
      `sam_id = COALESCE(sam_id, ${lit(parcel.samId)})`,
      `street_key = ${lit(parcel.streetKey)}`,
      `st_num_lo = ${lit(numLo)}`,
      `st_num_hi = ${lit(numHi)}`,
      `latitude = COALESCE(latitude, ${lit(parcel.latitude)})`,
      `longitude = COALESCE(longitude, ${lit(parcel.longitude)})`,
      'updated_at = unixepoch()',
    ].join(', ') +
    ` WHERE id = ${lit(building.id)};`
  );
}

/** An existing row keeps its own number range (it may be one number inside the parcel's range). */
function addressRangeOf(address: string, parcel: SeedBuilding): { numLo: number; numHi: number } {
  const match = /^(\d+)(?:-(\d+))?/.exec(address.trim());
  if (!match) return { numLo: parcel.numLo, numHi: parcel.numHi };
  const lo = Number.parseInt(match[1], 10);
  const hi = match[2] ? Number.parseInt(match[2], 10) : lo;
  return { numLo: Math.min(lo, hi), numHi: Math.max(lo, hi) };
}

/** Three statements per building, in an order that satisfies the foreign keys. */
export function seedStatements(plan: SeedPlan): string[] {
  const statements: string[] = [];
  for (const { building, parcel } of plan.matched) {
    statements.push(matchStatement(building, parcel), pullStatement(building.id), recordStatement(building.id, parcel));
  }
  for (const { parcel, slug } of plan.created) {
    const id = `seed-${parcel.parcelId}`;
    statements.push(createStatement(parcel, slug), pullStatement(id), recordStatement(id, parcel));
  }
  return statements;
}
