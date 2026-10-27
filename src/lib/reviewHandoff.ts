// The `/review/new?placeId=` handoff from the homepage: turn a Google place into either an
// existing building or a pre-filled address step. READ-ONLY. Before October 2026 the page
// inserted a `buildings` row on GET, with no address tier and no key columns; now the only
// writer is `POST /api/buildings`, reached through the address step's Continue.
//
// SERVER ONLY: imported by the new.astro frontmatter, never by a component. It reaches D1
// and, through `fetchPlace`, a paid Google API.
//
// Logging rule (AGENTS.md non-negotiable 1): log lines carry an event name and an error
// message only, never the user id, the place id or the address, so no line ties a reviewer
// to the building they are about to review.
import { findBuildingByPlaceId, findExistingBuilding, resolveInputFrom, type ResolveTier } from './buildingResolve';
import { logError } from './logger';
import { PLACE_ID_PATTERN, type ParsedPlace } from './places';
import { addressKey } from './records/identity';
import type { RecordsDb } from './records/types';

/** The four columns the review form renders. Island props are serialized into the page. */
export interface ReviewFormBuilding {
  id: string;
  address: string;
  neighborhood?: string;
  city: string;
}

/** A place for the address step to confirm. Structurally the form's own PlaceData. */
export interface HandoffPlace {
  placeId: string;
  streetAddress: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  latitude?: number;
  longitude?: number;
  existingBuilding: null;
}

export const HANDOFF_COPY = {
  unavailable: 'Address lookup is temporarily unavailable. Please search for your address below.',
  lookupFailed: 'We could not look up that address. Please search for it below.',
  incomplete: 'That address came back incomplete. Please enter it manually below.',
  failed: 'Something went wrong loading that address. Please search for it below.',
  notFound: 'We could not find that building. Please search for your address below.',
  partOf: (address: string) =>
    `The city's property records list the address you picked as part of ${address}, so your review goes on that building's page.`,
} as const;

export type HandoffResult =
  | { kind: 'existing'; buildingId: string; matchedBy: ResolveTier; partOf: boolean }
  | { kind: 'confirm'; place: HandoffPlace }
  | { kind: 'error'; message: string };

export interface HandoffDeps {
  db: RecordsDb;
  /** Null when no Places key is configured. */
  fetchPlace: ((placeId: string) => Promise<ParsedPlace | null>) | null;
  /** The per-user rate limiter. False or a throw means refuse (fail closed). */
  allowPlacesLookup: () => Promise<boolean>;
}

interface FormBuildingRow {
  id: string;
  address: string;
  neighborhood: string | null;
  city: string | null;
}

/** The only columns that reach the review form island. Null when there is no such row. */
export async function loadReviewFormBuilding(db: RecordsDb, id: string): Promise<ReviewFormBuilding | null> {
  const row = await db
    .prepare('SELECT id, address, neighborhood, city FROM buildings WHERE id = ?')
    .bind(id)
    .first<FormBuildingRow>();
  if (!row) return null;
  return { id: row.id, address: row.address, neighborhood: row.neighborhood ?? undefined, city: row.city ?? '' };
}

function errorMessage(error: unknown, placeId: string): string {
  const message = error instanceof Error ? error.message : String(error);
  // A fetch failure can name the URL, which carries the place id.
  return placeId ? message.split(placeId).join('<placeId>') : message;
}

async function lookupAllowed(deps: HandoffDeps): Promise<boolean> {
  try {
    return (await deps.allowPlacesLookup()) === true;
  } catch {
    return false;
  }
}

/** True when the matched row's number range is not the one the reader picked. */
async function isPartOfWiderParcel(db: RecordsDb, buildingId: string, streetAddress: string): Promise<boolean> {
  const key = addressKey(streetAddress);
  if (!key) return false;
  const row = await db
    .prepare('SELECT st_num_lo, st_num_hi FROM buildings WHERE id = ?')
    .bind(buildingId)
    .first<{ st_num_lo: number | null; st_num_hi: number | null }>();
  if (!row || row.st_num_lo === null || row.st_num_hi === null) return false;
  return row.st_num_lo !== key.numLo || row.st_num_hi !== key.numHi;
}

/** READ-ONLY. Never throws: anything unexpected is `failed`, logged without ids or addresses. */
export async function resolveReviewHandoff(deps: HandoffDeps, placeId: string): Promise<HandoffResult> {
  const fail = (message: string): HandoffResult => ({ kind: 'error', message });
  try {
    if (!PLACE_ID_PATTERN.test(placeId)) return fail(HANDOFF_COPY.lookupFailed);

    // A place we already hold costs nothing: no limiter slot, no Google call.
    const known = await findBuildingByPlaceId(deps.db, placeId);
    if (known) return { kind: 'existing', buildingId: known.id, matchedBy: 'place_id', partOf: false };

    if (!deps.fetchPlace) return fail(HANDOFF_COPY.unavailable);
    // The limiter gates only the paid call, and fails closed.
    if (!(await lookupAllowed(deps))) return fail(HANDOFF_COPY.unavailable);

    let place: ParsedPlace | null;
    try {
      place = await deps.fetchPlace(placeId);
    } catch (error) {
      logError('review_handoff_places_failed', { error: errorMessage(error, placeId) });
      return fail(HANDOFF_COPY.failed);
    }
    if (!place) return fail(HANDOFF_COPY.lookupFailed);
    if (!place.streetAddress || !place.city) return fail(HANDOFF_COPY.incomplete);

    const input = resolveInputFrom({
      placeId: place.placeId,
      streetAddress: place.streetAddress,
      city: place.city,
      zipCode: place.zipCode,
    });
    if (!input) return fail(HANDOFF_COPY.incomplete);

    const hit = await findExistingBuilding(deps.db, input);
    if (hit) {
      const partOf = hit.tier === 'address_key' && (await isPartOfWiderParcel(deps.db, hit.id, input.address));
      return { kind: 'existing', buildingId: hit.id, matchedBy: hit.tier, partOf };
    }

    return {
      kind: 'confirm',
      place: {
        placeId: place.placeId,
        streetAddress: place.streetAddress,
        neighborhood: place.neighborhood,
        city: place.city,
        state: place.state,
        zipCode: place.zipCode,
        latitude: place.latitude,
        longitude: place.longitude,
        existingBuilding: null,
      },
    };
  } catch (error) {
    logError('review_handoff_failed', { error: errorMessage(error, placeId) });
    return fail(HANDOFF_COPY.failed);
  }
}
