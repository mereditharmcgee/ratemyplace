import { isBostonLocality } from '../locality';

/** A landlord with the places its linked buildings are in (from `GET /api/admin/landlords`). */
export interface LandlordGeo {
  id: string;
  name: string;
  cities: string[];
  states: string[];
}

export interface LandlordCandidates<T extends LandlordGeo> {
  /** The one same-name landlord in the building's area, or null when there is none or more than one. */
  exact: T | null;
  /** Every other same-name landlord, for the admin to see before creating a namesake. */
  elsewhere: T[];
}

const key = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

function sameArea(landlord: LandlordGeo, building: { city: string | null; state: string | null }): boolean {
  const state = key(building.state);
  if (!state || !landlord.states.some((s) => key(s) === state)) return false;
  const city = key(building.city);
  if (!city) return false;
  if (landlord.cities.some((c) => key(c) === city)) return true;
  // Boston is spelled many ways (Allston, Dorchester, "Boston, MA"); any two of them are one city.
  return isBostonLocality(building.city) && landlord.cities.some((c) => isBostonLocality(c));
}

/**
 * Which existing landlord a tenant-named landlord should link to. Names match trimmed and
 * case-insensitively; a name alone is not enough, because unrelated companies share names
 * across cities ("AA Management" in Boston and in New Haven). A candidate is in the
 * building's area when a state matches and a city matches (Boston localities all count as
 * Boston). `exact` is set only when exactly one candidate is in the area; a landlord with
 * no buildings has no area and is never exact.
 */
export function classifyLandlordCandidates<T extends LandlordGeo>(
  name: string | null | undefined,
  building: { city: string | null; state: string | null },
  landlords: readonly T[],
): LandlordCandidates<T> {
  const wanted = key(name);
  if (!wanted) return { exact: null, elsewhere: [] };

  const sameName = landlords.filter((l) => key(l.name) === wanted);
  const inArea = sameName.filter((l) => sameArea(l, building));
  const exact = inArea.length === 1 ? inArea[0] : null;
  return { exact, elsewhere: sameName.filter((l) => l !== exact) };
}

const NOTE_MAX = 1000;

/**
 * The `admin_notes` recorded on a new landlord created despite same-name landlords
 * elsewhere, so the decision to keep them apart is visible later.
 */
export function keptSeparateNote(elsewhere: readonly LandlordGeo[], now: Date = new Date()): string {
  const parts = elsewhere.map((l) => {
    const where = [...l.cities, ...l.states].filter(Boolean).join(', ') || 'no buildings';
    return `Same name as landlord ${l.id} (${where})`;
  });
  const tail = `; kept separate ${now.toISOString().slice(0, 10)}`;
  let head = parts.join('; ');
  // Keep the decision and its date even when many namesakes overflow the column limit.
  if (head.length + tail.length > NOTE_MAX) head = `${head.slice(0, NOTE_MAX - tail.length - 1)}…`;
  return head + tail;
}

/** Dropdown label: the name plus where its buildings are, so namesakes can be told apart. */
export function landlordOptionLabel(landlord: LandlordGeo): string {
  return landlord.cities.length ? `${landlord.name} — ${landlord.cities.join(', ')}` : `${landlord.name} — no buildings yet`;
}
