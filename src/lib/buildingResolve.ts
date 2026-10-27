// "Which existing building is this address?" — the read-only half of `POST /api/buildings`,
// shared with the `/review/new?placeId=` handoff so a page load can find the right building
// without writing one.
//
// The tier order is the route's, and this is now the one place it is spelled:
//   1. an exact Google place id (`findBuildingByPlaceId`);
//   2. `findBuildingByAddress` — Boston address key plus range containment (records/dedupe);
//   3. an exact case-insensitive (address, city), only for a manual entry with no place id.
//
// SERVER ONLY. Nothing here writes; stamping a matched row stays in the POST route.
import { PLACE_ID_PATTERN } from './places';
import { findBuildingByAddress } from './records/dedupe';
import type { RecordsDb } from './records/types';
import { isValidZipCode, sanitizeText } from './validation';

export type ResolveTier = 'place_id' | 'address_key' | 'exact_address';

export interface ResolveInput {
  placeId: string | null;
  address: string;
  city: string;
  zip: string | null;
}

export interface ResolvedBuilding {
  id: string;
  slug: string;
  tier: ResolveTier;
}

/**
 * Clean request input the way POST always has: markup stripped, lengths capped (500 for the
 * street, 120 for the city), a ZIP kept only when it is a valid one, and a place id kept only
 * when it is a string in Google's id format. Null when the street or city is empty after
 * cleaning.
 */
export function resolveInputFrom(raw: {
  placeId?: unknown;
  streetAddress: string;
  city: string;
  zipCode?: unknown;
}): ResolveInput | null {
  const address = sanitizeText(raw.streetAddress).slice(0, 500);
  const city = sanitizeText(raw.city).slice(0, 120);
  if (!address || !city) return null;
  const zip = typeof raw.zipCode === 'string' && isValidZipCode(raw.zipCode.trim()) ? raw.zipCode.trim() : null;
  const placeId = typeof raw.placeId === 'string' && PLACE_ID_PATTERN.test(raw.placeId) ? raw.placeId : null;
  return { placeId, address, city, zip };
}

/** READ-ONLY. The one spelling of tier 1. */
export async function findBuildingByPlaceId(db: RecordsDb, placeId: string): Promise<{ id: string; slug: string } | null> {
  return db
    .prepare('SELECT id, slug FROM buildings WHERE google_place_id = ?')
    .bind(placeId)
    .first<{ id: string; slug: string }>();
}

/** READ-ONLY. The route's three tiers, in the route's order. */
export async function findExistingBuilding(db: RecordsDb, input: ResolveInput): Promise<ResolvedBuilding | null> {
  // Google-sourced: the place id is exact.
  if (input.placeId) {
    const byPlace = await findBuildingByPlaceId(db, input.placeId);
    if (byPlace) return { id: byPlace.id, slug: byPlace.slug, tier: 'place_id' };
  }

  // Boston, any source: the seeded (or earlier user) page for this address, so one building
  // never gets two pages.
  const byAddress = await findBuildingByAddress(db, { address: input.address, city: input.city, zip: input.zip });
  if (byAddress) return { id: byAddress.id, slug: byAddress.slug, tier: 'address_key' };

  // Manual entry anywhere: exact (address, city), case-insensitive.
  if (!input.placeId) {
    const exact = await db
      .prepare('SELECT id, slug FROM buildings WHERE LOWER(address) = LOWER(?) AND LOWER(city) = LOWER(?) LIMIT 1')
      .bind(input.address, input.city)
      .first<{ id: string; slug: string }>();
    if (exact) return { id: exact.id, slug: exact.slug, tier: 'exact_address' };
  }

  return null;
}
