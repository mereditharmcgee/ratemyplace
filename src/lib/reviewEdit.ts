/**
 * What `PATCH /api/reviews/[id]` stores for the fields a reviewer edits beside the ratings.
 *
 * The edit form sends every field, but the route also takes a partial body, and a field the
 * body left out used to be written as blank: an edit that never mentioned the tenure or the
 * move-out erased them. A partial body now changes only what it sends. Each field in
 * `KEPT_WHEN_ABSENT` keeps its stored value when its key is absent (`withStoredFields`), and so
 * does the move-out (`moveOutFromEdit`). The ratings, `unit_type` and the move-in have their
 * own rules in the route and in `moveIn.ts`.
 *
 * Two pairs are read together, so each is kept only whole (`KEPT_PAIRS_WHEN_ABSENT`): a body
 * that sends neither half keeps both, and a body that sends either half writes both as sent,
 * because keeping one half while the other changes could show a stale half. They are
 * `review_text` with `comments` (a review card shows the first one set), and `laundry_type`
 * with `laundry_cost_per_load`.
 */

/** The reviews columns a partial edit leaves as stored when the body does not name them. */
export const KEPT_WHEN_ABSENT = [
  'unit_number',
  'bedrooms',
  'bathrooms',
  'square_footage',
  'rent_amount',
  'amenities',
  'utilities_included',
  'estimated_monthly_utilities',
  'tenure_months',
  'parking_type',
  'pet_types',
  'pest_types_experienced',
  'review_title',
  'landlord_name',
  'property_manager_name',
  'would_recommend_new',
  'had_pest_issues',
  'had_heat_issues',
  'had_water_issues',
  'had_security_deposit_issues',
  'had_eviction_threat',
  'accepts_housing_vouchers',
  'safely_lit_at_night',
] as const;

/** Column pairs read together: kept as stored only when the body sends neither half. */
export const KEPT_PAIRS_WHEN_ABSENT = [
  ['review_text', 'comments'],
  ['laundry_type', 'laundry_cost_per_load'],
] as const;

/** The stored move-out columns `moveOutFromEdit` reads. */
export interface StoredMoveOut {
  move_out_year_new: string | null;
  move_out_season: string | null;
  is_current_tenant: number | null;
}

/** Every stored column the route reads before an edit: the kept fields, pairs and move-out. */
export const STORED_EDIT_COLUMNS: readonly string[] = [
  ...KEPT_WHEN_ABSENT,
  ...KEPT_PAIRS_WHEN_ABSENT.flat(),
  'move_out_year_new',
  'move_out_season',
  'is_current_tenant',
];

/** The row `STORED_EDIT_COLUMNS` selects. */
export type StoredEditRow = Record<string, unknown> & Partial<StoredMoveOut>;

function sent(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * The body with each kept field it leaves out, and each kept pair it sends neither half of,
 * filled from the stored row, so the route's per-field handling stores the stored value back.
 * A key the body sends is never replaced, null and blank included: sending a blank still
 * clears a field.
 */
export function withStoredFields<T extends Record<string, unknown>>(
  body: T,
  stored: Record<string, unknown> | null | undefined,
): T {
  if (!stored || !body || typeof body !== 'object') return body;
  const filled: Record<string, unknown> = { ...body };
  const keep = (key: string) => {
    if (stored[key] !== undefined) filled[key] = stored[key];
  };
  for (const key of KEPT_WHEN_ABSENT) {
    if (!sent(body, key)) keep(key);
  }
  for (const pair of KEPT_PAIRS_WHEN_ABSENT) {
    if (!pair.some((key) => sent(body, key))) pair.forEach(keep);
  }
  return filled as T;
}

export interface MoveOutToStore {
  /** `reviews.move_out_year_new`: 'current', a year, '2020_or_earlier', or null for none. */
  year: string | null;
  /** `reviews.move_out_season`, set only on reviews written before January 2026. */
  season: string | null;
  /** `reviews.is_current_tenant`. */
  isCurrentTenant: number;
}

function moveOutYear(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * The move-out to store for an edit. A body without `move_out_year_new` keeps the stored
 * move-out and current-tenant flag as they are. A body with it stores what it sent (blank
 * means a past tenant with no move-out, 'current' a current tenant). The edit form has no
 * season control, so a stored season stays only while the year it was given with stays:
 * a changed year clears it rather than carrying it onto a year it was never given for. An
 * unchanged year keeps it, a blank one included, so an untouched save changes nothing.
 */
export function moveOutFromEdit(
  body: Record<string, unknown>,
  stored: Partial<StoredMoveOut> | null | undefined,
): MoveOutToStore {
  const storedYear = stored?.move_out_year_new ?? null;
  const storedSeason = stored?.move_out_season ?? null;
  if (!body || typeof body !== 'object' || !sent(body, 'move_out_year_new')) {
    return { year: storedYear, season: storedSeason, isCurrentTenant: stored?.is_current_tenant ?? 0 };
  }
  const year = moveOutYear(body.move_out_year_new);
  return {
    year,
    season: year === storedYear ? storedSeason : null,
    isCurrentTenant: year === 'current' ? 1 : 0,
  };
}
