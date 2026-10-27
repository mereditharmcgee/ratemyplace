import type { MoveInGiven } from './types';

/**
 * Converts a calendar month (1-12) to a season string.
 * December uses the user-provided year (e.g., December 2025 = Winter 2025, not Winter 2026).
 *   spring = March-May (3-5)
 *   summer = June-August (6-8)
 *   fall   = September-November (9-11)
 *   winter = December-February (12, 1, 2)
 */
export function getSeasonFromMonth(month: number): string {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'fall';
  return 'winter'; // 12, 1, 2
}

const seasonLabels: Record<string, string> = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall'
};

export function formatFuzzyDate(year: number, season: string): string {
  const seasonLabel = seasonLabels[season] || season;
  return `${seasonLabel} ${year}`;
}

/** The lowest move-out choice on the review form, stored as a token rather than a year. */
const MOVE_OUT_2020_OR_EARLIER = '2020_or_earlier';

/**
 * The fuzzy tenancy range on a review card's season chip: "Summer 2024 · 2025",
 * "Fall 2025 · Current", "2024 · Current" when the reviewer gave a move-in year but no month,
 * or one end alone. Only seasons and years, never a month or day. A move-in season without
 * a year is not a date, so it is left out.
 *
 * Callers pass only the move-in parts the reviewer gave (`givenMoveIn`). Reviews written
 * before `move_in_given` existed (migration 0034) say nothing about that: when the move-in
 * was skipped, the submit route stored winter of the current year (the columns are NOT
 * NULL), so a stored move-in can fall after the move-out year. A range that runs backwards
 * is impossible, so the move-in is left out and only the move-out shows. A placeholder
 * move-in on an old review whose range runs forward is still shown; it can't be told apart
 * from a real December-February move-in, and those reviews stay as stored.
 */
export function formatTenancyRange(input: {
  moveInSeason?: string | null;
  moveInYear?: number | string | null;
  moveOutSeason?: string | null;
  moveOutYear?: number | string | null;
  isCurrentTenant?: boolean;
}): string | null {
  const { moveInSeason, moveInYear, moveOutSeason, moveOutYear } = input;
  const isCurrent = input.isCurrentTenant === true || moveOutYear === 'current';

  const inYear = moveInYear ? Number(moveInYear) : NaN;
  let moveIn = Number.isFinite(inYear)
    ? (moveInSeason ? formatFuzzyDate(inYear, moveInSeason.toLowerCase()) : String(inYear))
    : null;

  let moveOut: string | null = null;
  // The latest year the move-out could be, to check that the range runs forward.
  let latestMoveOutYear: number | null = null;
  if (isCurrent) {
    moveOut = 'Current';
  } else if (moveOutYear === MOVE_OUT_2020_OR_EARLIER) {
    moveOut = '2020 or earlier';
    latestMoveOutYear = 2020;
  } else if (moveOutYear !== null && moveOutYear !== undefined && moveOutYear !== '') {
    const year = Number(moveOutYear);
    moveOut = moveOutSeason && Number.isFinite(year)
      ? formatFuzzyDate(year, moveOutSeason.toLowerCase())
      : String(moveOutYear);
    if (Number.isFinite(year)) latestMoveOutYear = year;
  }

  if (moveIn && latestMoveOutYear !== null && inYear > latestMoveOutYear) {
    moveIn = null;
  }

  if (moveIn && moveOut) return `${moveIn} · ${moveOut}`;
  return moveIn ?? moveOut ?? null;
}

/** The stored move-in columns, plus the record of which of them the reviewer gave. */
export interface StoredMoveInFields {
  move_in_season?: string | null;
  move_in_year?: number | string | null;
  move_in_given?: MoveInGiven | null;
}

/** The review columns a review card's season chip reads. */
export interface ReviewTenancyFields extends StoredMoveInFields {
  move_out_year_new?: string | null;
  is_current_tenant?: number | null;
}

/**
 * The move-in parts a reviewer gave, with skipped parts as null. `move_in_season` and
 * `move_in_year` are NOT NULL, so a skipped part holds a placeholder that is never shown.
 * A review written before `move_in_given` existed (NULL) is shown as stored.
 */
export function givenMoveIn(review: StoredMoveInFields): {
  season: string | null;
  year: number | string | null;
} {
  const season = review.move_in_season ?? null;
  const year = review.move_in_year ?? null;
  if (review.move_in_given === 'none') return { season: null, year: null };
  if (review.move_in_given === 'year_only') return { season: null, year };
  return { season, year };
}

/** Shown on the reviewer's edit page and the admin queue when the move-in was skipped. */
export const MOVE_IN_NOT_GIVEN = 'Not given';

/**
 * The reviewer's move-in in words, "Fall 2023" or "2023", or null when it was skipped.
 * For the reviewer's own edit page and the admin queue; public cards use the season chip.
 */
export function formatMoveIn(review: StoredMoveInFields): string | null {
  const { season, year } = givenMoveIn(review);
  const inYear = year ? Number(year) : NaN;
  if (!Number.isFinite(inYear)) return null;
  return season ? formatFuzzyDate(inYear, season.toLowerCase()) : String(inYear);
}

/**
 * What a review card hands its season chip. One spelling, so the dispute route's date match
 * (`reviewTenancyLabel`) reads exactly the range the card shows.
 */
export function reviewSeasonChipProps(review: ReviewTenancyFields): {
  moveInSeason: string | null | undefined;
  moveInYear: number | string | null | undefined;
  moveOutYear: string | null | undefined;
  isCurrentTenant: boolean;
} {
  const moveIn = givenMoveIn(review);
  return {
    moveInSeason: moveIn.season,
    moveInYear: moveIn.year,
    moveOutYear: review.move_out_year_new,
    isCurrentTenant: review.is_current_tenant === 1 || review.move_out_year_new === 'current',
  };
}

/** The dates a review card shows in its season chip, or null when it shows none. */
export function reviewTenancyLabel(review: ReviewTenancyFields): string | null {
  return formatTenancyRange(reviewSeasonChipProps(review));
}

export function getCurrentSeason(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

export function getCurrentYear(): number {
  return new Date().getFullYear();
}

/**
 * Returns a human-readable recency label based on how long ago someone lived there.
 * For current tenants, returns "Current tenant".
 * Otherwise, calculates years since move-out.
 */
export function formatRecency(review: {
  is_current_tenant?: number;
  move_out_year_new?: string;
}): string {
  if (review.is_current_tenant === 1) {
    return 'Current tenant';
  }

  // Determine move-out year from the canonical move_out_year_new column
  let moveOutYear: number | null = null;
  if (review.move_out_year_new && review.move_out_year_new !== 'current') {
    const parsed = parseInt(review.move_out_year_new);
    if (!isNaN(parsed)) moveOutYear = parsed;
  }

  if (!moveOutYear) return 'Past tenant';

  const yearsAgo = getCurrentYear() - moveOutYear;

  if (yearsAgo <= 0) return 'Within the last year';
  if (yearsAgo <= 1) return 'About 1 year ago';
  if (yearsAgo <= 3) return '1–3 years ago';
  if (yearsAgo <= 5) return '3–5 years ago';
  if (yearsAgo <= 10) return '5–10 years ago';
  return '10+ years ago';
}
