import { textOrNull } from '../ckan';
import { toCanonicalParcel } from '../identity';
import type { SamPoint, SamRow } from './types';

/** Live Street Address Management (SAM) Addresses, CSV datastore resource. Verified 2026-09-09. */
export const SAM_RESOURCE_ID = '6d6cfc99-6f26-4974-bbb3-17b5dbad49a9';
export const SAM_PAGE_URL = 'https://data.boston.gov/dataset/live-street-address-management-sam-addresses';
export const SAM_FIELDS = ['SAM_ADDRESS_ID', 'RELATIONSHIP_TYPE', 'PARCEL_ID', 'MAILING_NEIGHBORHOOD', 'ZIP_CODE', 'POINT_X', 'POINT_Y', 'UNIT'] as const;

/**
 * Boston's bounding box, wide enough for Hyde Park to Charlestown and the harbor islands.
 * SAM rows that were never geocoded carry 0,0, and a handful carry a coordinate from the
 * wrong side of the state; both land outside this box and are dropped rather than pinning
 * a building to null island. Verified against the city boundary 2026-09-09.
 */
const BOSTON_BOUNDS = { minLat: 42.2, maxLat: 42.45, minLon: -71.2, maxLon: -70.9 } as const;

function num(value: unknown): number | null {
  const text = textOrNull(value);
  if (text === null) return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

function inBoston(latitude: number, longitude: number): boolean {
  return (
    latitude > BOSTON_BOUNDS.minLat
    && latitude < BOSTON_BOUNDS.maxLat
    && longitude > BOSTON_BOUNDS.minLon
    && longitude < BOSTON_BOUNDS.maxLon
  );
}

/**
 * Five-digit ZIP. Both SAM and the assessor hand back ZIPs that lost a leading zero to a
 * numeric column (2135), and SAM sometimes carries a ZIP+4. Anything that is not four or
 * five digits (optionally with a +4 tail) is not a ZIP, so it becomes null instead of a
 * plausible-looking wrong answer. Exported because the assessor's ZIP_CODE needs it too.
 */
export function zip5(value: unknown): string | null {
  const text = textOrNull(value);
  if (text === null) return null;
  const digits = text.replace(/\D/g, '');
  const head = digits.length === 9 ? digits.slice(0, 5) : digits;
  if (head.length < 4 || head.length > 5) return null;
  return head.padStart(5, '0');
}

/**
 * One point per parcel: the building's own address (RELATIONSHIP_TYPE 1) with the lowest
 * SAM id, or, when a parcel only has unit rows, the lowest unit row. Rows without a
 * canonical parcel id, without a coordinate, or with a coordinate outside Boston are
 * skipped — a parcel whose only row is skipped simply ends up without a point.
 */
export function indexSamByParcel(rows: Iterable<SamRow>): Map<string, SamPoint> {
  const best = new Map<string, { primary: boolean; id: number; point: SamPoint }>();
  for (const row of rows) {
    const parcel = toCanonicalParcel(textOrNull(row.PARCEL_ID));
    const samId = textOrNull(row.SAM_ADDRESS_ID);
    const longitude = num(row.POINT_X);
    const latitude = num(row.POINT_Y);
    if (!parcel || !samId || longitude === null || latitude === null) continue;
    if (!inBoston(latitude, longitude)) continue;
    const primary = textOrNull(row.RELATIONSHIP_TYPE) === '1';
    // A SAM id that is not a number sorts last rather than winning on arrival order.
    const parsed = Number.parseInt(samId, 10);
    const id = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
    const current = best.get(parcel);
    const better = !current || (primary && !current.primary) || (primary === current.primary && id < current.id);
    if (!better) continue;
    best.set(parcel, {
      primary,
      id,
      point: { samId, latitude, longitude, neighborhood: textOrNull(row.MAILING_NEIGHBORHOOD), zip: zip5(row.ZIP_CODE) },
    });
  }
  const points = new Map<string, SamPoint>();
  for (const [parcel, entry] of best) points.set(parcel, entry.point);
  return points;
}
