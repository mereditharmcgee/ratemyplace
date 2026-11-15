// Leaf module: imports only `recordZips` and types, and does no I/O, so it is safe inside the
// records-scheduler Worker (311 pulls run there).
import { recordZips } from './identity';
import type { BuildingIdentity } from './types';

/**
 * The ZIPs each Boston ward's parcels carry. Derived 2026-11-15 from the FY2026 assessor
 * (`ee73430d-96c0-423e-ad21-c4cfb54c8961`): a ward is a parcel id's first two digits, and a ZIP is
 * listed when at least ten distinct base parcels (the first seven digits, so a condominium's units
 * count once) in that ward carry it. The floor drops one-off typos such as a Charlestown parcel
 * filed under 02119.
 *
 * Read only by the 311 ward arm (`wardZipArm`), which accepts a request filed under one of these
 * ZIPs when its ward is the parcel's. Ward and ZIP lines rarely move, and a stale entry fails safe:
 * a missing ZIP leaves that request unmatched, as every request was before this table, and an extra
 * one only widens matching inside one ward.
 */
export const WARD_ZIPS: Readonly<Record<number, readonly string[]>> = {
  1: ['02128'],
  2: ['02129'],
  3: ['02108', '02109', '02110', '02111', '02113', '02114', '02116', '02118', '02210'],
  4: ['02115', '02116', '02118', '02215'],
  5: ['02108', '02114', '02115', '02116', '02215'],
  6: ['02127', '02210'],
  7: ['02125', '02127'],
  8: ['02118', '02119', '02125'],
  9: ['02118', '02119', '02120', '02127'],
  10: ['02115', '02116', '02120', '02130', '02199'],
  11: ['02119', '02130'],
  12: ['02119', '02121'],
  13: ['02119', '02121', '02125'],
  14: ['02121', '02124', '02126'],
  15: ['02121', '02122', '02124', '02125'],
  16: ['02122', '02124', '02125'],
  17: ['02124', '02126'],
  18: ['02126', '02131', '02136'],
  19: ['02130', '02131'],
  20: ['02131', '02132', '02467'],
  21: ['02134', '02135', '02215', '02445'],
  22: ['02134', '02135'],
};

/** The ward a canonical ten-digit Boston parcel id sits in (its first two digits), or null. */
export function parcelWard(parcelId: string | null): number | null {
  if (parcelId == null || !/^\d{10}$/.test(parcelId)) return null;
  const ward = Number.parseInt(parcelId.slice(0, 2), 10);
  return WARD_ZIPS[ward] ? ward : null;
}

export interface WardZipArm {
  ward: number;
  /** The ward's ZIPs that `recordZips` does not already list, in table order. Never empty. */
  zips: string[];
}

/**
 * The 311 ward arm: the parcel's ward, plus the ZIPs that ward's parcels carry beyond the page's
 * and the parcel's own. A 311 request filed under one of those ZIPs is kept only when it also
 * names the parcel's ward, so a same-named street in another ward never qualifies. Measured on
 * 2026-11-15: about 3.8% of legacy housing requests (4.3% in the new system) carry a ZIP other
 * than their parcel's, and three in four of those are in the parcel's own ward.
 *
 * Null when there is nothing to add: no Boston parcel, every ward ZIP already listed, or a page
 * with no usable ZIP. The last keeps the rule that a page with no ZIP stays unnarrowed rather
 * than narrowed by something else.
 */
export function wardZipArm(identity: Pick<BuildingIdentity, 'zip' | 'parcelZip' | 'parcelId'>): WardZipArm | null {
  const covered = recordZips(identity);
  if (covered.length === 0) return null;
  const ward = parcelWard(identity.parcelId);
  if (ward === null) return null;
  const zips = WARD_ZIPS[ward].filter((zip) => !covered.includes(zip));
  return zips.length > 0 ? { ward, zips } : null;
}
