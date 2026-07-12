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
