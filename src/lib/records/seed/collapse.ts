import { parseIntOrNull, textOrNull } from '../ckan';
import { addressKey, toCanonicalParcel } from '../identity';
import { ASSESSOR_FIXED_COLUMNS, ASSESSOR_YEARS, MODERN_COLUMNS, assessmentFromRow } from '../sources/boston/assessor';
import { isSeedParcelRow, normalizeLandUse } from './filters';
import { buildingTypeFor, formatSeedAddress, titleCaseNeighborhood } from './format';
import { zip5 } from './sam';
import type { AssessorRow, SamPoint, SeedBuilding } from './types';

/** Everything the adapter reads plus the address and district columns the seed needs. */
export const ASSESSOR_SEED_FIELDS: readonly string[] = Array.from(
  new Set([
    ...ASSESSOR_FIXED_COLUMNS,
    ...Object.values(MODERN_COLUMNS).filter((c): c is string => Boolean(c)),
    'BLDG_SEQ', 'ST_NUM', 'ST_NUM2', 'ST_NAME', 'CITY', 'ZIP_CODE',
  ]),
);

export type SkipReason = 'land_use' | 'no_parcel' | 'no_address';

export interface CollapseResult {
  buildings: SeedBuilding[];
  skipped: Array<{ pid: string | null; reason: SkipReason }>;
}

/**
 * Units a land-use code implies for one building when the assessor leaves RES_UNITS blank.
 * LU describes the *parcel*, so on a multi-building lot applying it per building is a
 * stated guess, not a fact: a second, blank R3 row is credited three units on the theory
 * that a three-family lot's second structure is also a three-family. Rows the assessor did
 * count are always preferred; nothing is implied for A, R4, or RC.
 */
const IMPLIED_UNITS: Record<string, number> = { R2: 2, R3: 3 };

function seq(row: AssessorRow): number {
  return parseIntOrNull(textOrNull(row.BLDG_SEQ)) ?? 1;
}

/**
 * Filters, then collapses the assessor's one-row-per-building-per-parcel into one
 * SeedBuilding per parcel: the lowest *surviving* BLDG_SEQ row supplies the address, year,
 * and assessment, and residential units are summed across the parcel's rows. Pure; the row
 * order is not assumed. `skipped` counts rows, not parcels — one parcel can contribute
 * several skipped rows.
 */
export function collapseAssessorRows(rows: Iterable<AssessorRow>, sam: ReadonlyMap<string, SamPoint>): CollapseResult {
  const byParcel = new Map<string, AssessorRow[]>();
  const skipped: CollapseResult['skipped'] = [];
  for (const row of rows) {
    const pid = toCanonicalParcel(textOrNull(row.PID));
    if (!pid) {
      skipped.push({ pid: textOrNull(row.PID), reason: 'no_parcel' });
      continue;
    }
    // Named explicitly: `AssessorRow`'s index signature does not satisfy the filter's
    // `Pick<AssessorRow, 'LU' | 'LU_DESC'>`, which requires both keys to be present.
    if (!isSeedParcelRow({ LU: row.LU, LU_DESC: row.LU_DESC })) {
      skipped.push({ pid, reason: 'land_use' });
      continue;
    }
    const list = byParcel.get(pid) ?? [];
    list.push(row);
    byParcel.set(pid, list);
  }

  const buildings: SeedBuilding[] = [];
  for (const [pid, list] of byParcel) {
    list.sort((a, b) => seq(a) - seq(b));
    const first = list[0];
    const address = formatSeedAddress(first.ST_NUM, first.ST_NUM2, first.ST_NAME);
    const key = address ? addressKey(address) : null;
    if (!address || !key) {
      skipped.push({ pid, reason: 'no_address' });
      continue;
    }
    const landUse = normalizeLandUse(first.LU);
    const implied = IMPLIED_UNITS[landUse] ?? null;
    const perRow = list.map((r) => parseIntOrNull(textOrNull(r.RES_UNITS)) ?? implied).filter((n): n is number => n !== null);
    const unitCount = perRow.length > 0 ? perRow.reduce((a, b) => a + b, 0) : null;
    const point = sam.get(pid) ?? null;
    buildings.push({
      parcelId: pid,
      address,
      streetKey: key.streetKey,
      numLo: key.numLo,
      numHi: key.numHi,
      neighborhood: titleCaseNeighborhood(point?.neighborhood ?? textOrNull(first.CITY)),
      zip: point?.zip ?? zip5(first.ZIP_CODE),
      unitCount,
      yearBuilt: parseIntOrNull(textOrNull(first.YR_BUILT)),
      buildingType: buildingTypeFor(landUse),
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      samId: point?.samId ?? null,
      assessment: assessmentFromRow(first, ASSESSOR_YEARS[0]),
    });
  }
  return { buildings, skipped };
}
