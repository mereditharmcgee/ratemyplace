import { parseIntOrNull, textOrNull } from '../ckan';
import { addressKey, toCanonicalParcel } from '../identity';
import { ASSESSOR_FIXED_COLUMNS, ASSESSOR_YEARS, MODERN_COLUMNS, assessmentFromRow } from '../sources/boston/assessor';
import { isSeedParcelRow } from './filters';
import { buildingTypeFor, formatSeedAddress, titleCaseNeighborhood } from './format';
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

const IMPLIED_UNITS: Record<string, number> = { R2: 2, R3: 3 };

function seq(row: AssessorRow): number {
  return parseIntOrNull(textOrNull(row.BLDG_SEQ)) ?? 1;
}

function zip5(value: unknown): string | null {
  const text = textOrNull(value)?.replace(/\D/g, '');
  return text ? text.padStart(5, '0').slice(0, 5) : null;
}

/**
 * Filters, then collapses the assessor's one-row-per-building-per-parcel into one
 * SeedBuilding per parcel: lowest BLDG_SEQ row supplies the address, year, and assessment;
 * residential units are summed across rows. Pure; the row order is not assumed.
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
    const landUse = (textOrNull(first.LU) ?? '').trim().toUpperCase();
    const summed = list.map((r) => parseIntOrNull(textOrNull(r.RES_UNITS))).filter((n): n is number => n !== null);
    const unitCount = summed.length > 0 ? summed.reduce((a, b) => a + b, 0) : (IMPLIED_UNITS[landUse] ?? null);
    const point = sam.get(pid) ?? null;
    buildings.push({
      parcelId: pid,
      address,
      streetKey: key.streetKey,
      numLo: key.numLo,
      numHi: key.numHi,
      neighborhood: titleCaseNeighborhood(point?.neighborhood ?? textOrNull(first.CITY)),
      zip: point?.zip ? zip5(point.zip) : zip5(first.ZIP_CODE),
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
