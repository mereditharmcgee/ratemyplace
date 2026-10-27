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
 * "Fall 2025 · Current", or one end alone. Only seasons and years, never a month or day.
 *
 * When a reviewer skips the optional move-in question, the submit route stores winter of the
 * current year (the columns are NOT NULL), so a stored move-in can fall after the move-out
 * year. A range that runs backwards is impossible, so the move-in is left out and only the
 * move-out shows. A placeholder move-in on a range that runs forward is still shown; it
 * can't be told apart from a real December-February move-in.
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

  let moveIn = moveInSeason && moveInYear
    ? formatFuzzyDate(Number(moveInYear), moveInSeason.toLowerCase())
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

  if (moveIn && latestMoveOutYear !== null && Number(moveInYear) > latestMoveOutYear) {
    moveIn = null;
  }

  if (moveIn && moveOut) return `${moveIn} · ${moveOut}`;
  return moveIn ?? moveOut ?? null;
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
