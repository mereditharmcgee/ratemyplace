import { sqlLiteral } from '../ckan';
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
 * Strings go through the same `sqlLiteral` the live CKAN sources use, so there is one
 * quoting rule in the records code, not two. Numbers must be finite; null renders as NULL.
 *
 * A control character is rejected rather than escaped: the statement file is newline-
 * delimited and read back by eye, a raw newline or NUL inside a literal has no escape that
 * survives that, and no assessor value legitimately contains one (JSON.stringify already
 * escapes them out of the assessment payload). Anything that is not a string or a number
 * is a programming error, and says so instead of being coerced into a plausible literal.
 */
export function lit(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in seed SQL: ${value}`);
    return String(value);
  }
  if (typeof value !== 'string') throw new Error(`Unsupported ${typeof value} in seed SQL: ${String(value)}`);
  if (Array.from(value).some((c) => c.charCodeAt(0) < 0x20)) throw new Error(`Control character in a seed SQL literal: ${JSON.stringify(value)}`);
  return sqlLiteral(value);
}

function pullIdFor(buildingId: string): string {
  return `seed-${CURRENT_YEAR.fiscalYear}-${buildingId.replace(/^seed-/, '')}`;
}

function pullStatement(buildingId: string): string {
  const pullId = pullIdFor(buildingId);
  return (
    'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (' +
    [lit(pullId), lit(buildingId), lit('boston'), lit(FY2026_RESOURCE_ID), lit(`Property Assessment ${CURRENT_YEAR.fiscalYear}`), lit(`seed: bulk ${CURRENT_YEAR.fiscalYear} assessor download`), lit('ok'), '1', 'NULL', 'NULL', 'NULL', lit(SEED_TRIGGER_REASON)].join(', ') +
    // One pull row per building per fiscal year, re-stamped rather than duplicated: the
    // panel shows retrieved_at as the "as of" date, so a re-seed has to move it or the
    // page claims data is older than it is.
    ') ON CONFLICT(id) DO UPDATE SET retrieved_at = unixepoch();'
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

/**
 * The same COALESCE direction as the create path: what the row already knows about itself
 * wins (a human's coordinate, neighborhood, or ZIP is not overwritten by a parcel
 * centroid), what the assessor owns is refreshed, and the street key and number range are
 * ours to compute. An assessor NULL is an absence, not an erasure, so a blank year or unit
 * count leaves whatever the row had.
 *
 * The WHERE guard is for the gap between planning and applying: the plan is computed from
 * a snapshot of `buildings`, and `matchExistingBuildings` never puts a row with a
 * disagreeing parcel id in `matched`, but if one acquires a different parcel id in between,
 * this statement declines rather than overwriting it. (Its pull and record rows still
 * write; they are provenance for the parcel and are visible to the same human.)
 */
function matchStatement(building: ExistingBuilding, parcel: SeedBuilding): string {
  const { numLo, numHi } = addressRangeOf(building.address, parcel);
  return (
    'UPDATE buildings SET ' +
    [
      `parcel_id = ${lit(parcel.parcelId)}`,
      `sam_id = COALESCE(sam_id, ${lit(parcel.samId)})`,
      `neighborhood = COALESCE(neighborhood, ${lit(parcel.neighborhood)})`,
      `zip_code = COALESCE(zip_code, ${lit(parcel.zip)})`,
      `latitude = COALESCE(latitude, ${lit(parcel.latitude)})`,
      `longitude = COALESCE(longitude, ${lit(parcel.longitude)})`,
      `year_built = COALESCE(${lit(parcel.yearBuilt)}, year_built)`,
      `unit_count = COALESCE(${lit(parcel.unitCount)}, unit_count)`,
      `building_type = COALESCE(${lit(parcel.buildingType)}, building_type)`,
      `street_key = ${lit(parcel.streetKey)}`,
      `st_num_lo = ${lit(numLo)}`,
      `st_num_hi = ${lit(numHi)}`,
      'updated_at = unixepoch()',
    ].join(', ') +
    ` WHERE id = ${lit(building.id)} AND (parcel_id IS NULL OR parcel_id = ${lit(parcel.parcelId)});`
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
