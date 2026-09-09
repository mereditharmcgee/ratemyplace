import { textOrNull } from '../ckan';
import { toCanonicalParcel } from '../identity';
import type { SamPoint, SamRow } from './types';

/** Live Street Address Management (SAM) Addresses, CSV datastore resource. Verified 2026-09-09. */
export const SAM_RESOURCE_ID = '6d6cfc99-6f26-4974-bbb3-17b5dbad49a9';
export const SAM_PAGE_URL = 'https://data.boston.gov/dataset/live-street-address-management-sam-addresses';
export const SAM_FIELDS = ['SAM_ADDRESS_ID', 'RELATIONSHIP_TYPE', 'PARCEL_ID', 'MAILING_NEIGHBORHOOD', 'ZIP_CODE', 'POINT_X', 'POINT_Y', 'UNIT'] as const;

function num(value: unknown): number | null {
  const text = textOrNull(value);
  if (text === null) return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * One point per parcel: the building's own address (RELATIONSHIP_TYPE 1) with the lowest
 * SAM id, or, when a parcel only has unit rows, the lowest unit row. Rows without a
 * canonical parcel id or a coordinate are skipped.
 */
export function indexSamByParcel(rows: Iterable<SamRow>): Map<string, SamPoint> {
  const best = new Map<string, { primary: boolean; id: number; point: SamPoint }>();
  for (const row of rows) {
    const parcel = toCanonicalParcel(textOrNull(row.PARCEL_ID));
    const samId = textOrNull(row.SAM_ADDRESS_ID);
    const longitude = num(row.POINT_X);
    const latitude = num(row.POINT_Y);
    if (!parcel || !samId || longitude === null || latitude === null) continue;
    const primary = textOrNull(row.RELATIONSHIP_TYPE) === '1';
    const id = Number.parseInt(samId, 10);
    const current = best.get(parcel);
    const better = !current || (primary && !current.primary) || (primary === current.primary && id < current.id);
    if (!better) continue;
    best.set(parcel, {
      primary,
      id,
      point: { samId, latitude, longitude, neighborhood: textOrNull(row.MAILING_NEIGHBORHOOD), zip: textOrNull(row.ZIP_CODE) },
    });
  }
  return new Map([...best].map(([parcel, entry]) => [parcel, entry.point]));
}
