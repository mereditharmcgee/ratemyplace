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
  move_out_year?: number;
  move_out_year_new?: string;
}): string {
  if (review.is_current_tenant === 1) {
    return 'Current tenant';
  }

  // Determine move-out year from new or legacy field
  let moveOutYear: number | null = null;
  if (review.move_out_year_new && review.move_out_year_new !== 'current') {
    const parsed = parseInt(review.move_out_year_new);
    if (!isNaN(parsed)) moveOutYear = parsed;
  }
  if (!moveOutYear && review.move_out_year) {
    moveOutYear = review.move_out_year;
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
