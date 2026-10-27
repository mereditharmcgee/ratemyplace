// Canonical score band system. Mirrors brand.md §4.2 (Score Signals).
// Single source of truth — all score-band labels and colors site-wide come
// from this file. New surfaces (map markers, OG images, PDF exports) should
// import these helpers rather than rolling their own thresholds.

export interface ScoreColor {
  bg: string;
  text: string;
  label: string;
}

export function getScoreColor(score: number): ScoreColor {
  if (score >= 4) return { bg: 'bg-emerald-600', text: 'text-white', label: 'Good' };
  if (score >= 3) return { bg: 'bg-amber-500',   text: 'text-white', label: 'Mixed' };
  if (score >= 2) return { bg: 'bg-amber-700',   text: 'text-white', label: 'Concerning' };
  return            { bg: 'bg-red-700',     text: 'text-white', label: 'Poor' };
}

export function getScoreTextColor(score: number): string {
  if (score >= 4) return 'text-emerald-700';
  if (score >= 3) return 'text-amber-700';
  return 'text-red-700';
}

// Lighter shade of the same band for an early rating, a building score from fewer reviews
// than NAMED_PARTY_MIN_REVIEWS (see earlyRating.ts). Same band boundaries as
// getScoreTextColor, one step lighter where that still reads on the Paper page background
// (#F6F4EE): emerald-600 and red-600. Mixed stays amber-700, because amber-600 is about
// 2.9:1 on Paper; the lighter weight, count and label still mark it early. These shades
// clear 3:1 on Paper, white and the score tints, not 4.5:1, so use them for large text
// only (24px and up).
export function getEarlyScoreTextColor(score: number): string {
  if (score >= 4) return 'text-emerald-600';
  if (score >= 3) return 'text-amber-700';
  return 'text-red-600';
}

// Hex equivalents for non-Tailwind contexts (Google Maps markers, generated
// images, PDFs). Values match the Tailwind classes in getScoreColor exactly.
export const SCORE_HEX = {
  good: '#059669',       // emerald-600
  mixed: '#F59E0B',      // amber-500
  concerning: '#A16207', // amber-700
  poor: '#B91C1C',       // red-700
  none: '#6B7280',       // gray-500 — for null / no-data
} as const;

export function getScoreHex(score: number | null): string {
  if (score === null) return SCORE_HEX.none;
  if (score >= 4) return SCORE_HEX.good;
  if (score >= 3) return SCORE_HEX.mixed;
  if (score >= 2) return SCORE_HEX.concerning;
  return SCORE_HEX.poor;
}

// Soft-tinted background tier for score-detail cards. Matches the 4-tier
// band so Concerning (2.0–2.9) renders distinctly from Poor (<2.0).
export function getScoreBgTint(score: number): string {
  if (score >= 4) return 'bg-emerald-50';
  if (score >= 3) return 'bg-amber-50';
  if (score >= 2) return 'bg-amber-100';
  return 'bg-red-50';
}
