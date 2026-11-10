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

// Hex equivalents for non-Tailwind contexts (Google Maps markers, generated
// images, PDFs). Values are the Tailwind v3 hexes of the classes in
// getScoreColor, except concerning (see its note).
export const SCORE_HEX = {
  good: '#059669',       // emerald-600
  mixed: '#F59E0B',      // amber-500
  concerning: '#A16207', // yellow-700 (Tailwind v3), not the amber-700 of the Concerning badge class
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

// The muted look of an early rating, a building score from fewer reviews than
// NAMED_PARTY_MIN_REVIEWS (see earlyRating.ts). The number drops its band colour for a
// neutral gray, and a small dot beside it carries the band, so a 1.4 still reads as Poor
// without shouting it. Gray-600 is about 7.6:1 on white and 6.8:1 or better on Paper
// (#F6F4EE) and the score tints, so it clears WCAG AA (4.5:1) at any text size.
// The dot is the band's own fill from getScoreColor / SCORE_HEX, same boundaries.
export const EARLY_SCORE_TEXT_HEX = '#4B5563'; // gray-600

export interface EarlyScoreStyle {
  /** Tailwind text class for the score number. */
  text: string;
  /** Tailwind background class for the band dot beside it. */
  marker: string;
  /** Hex of `text`, for non-Tailwind contexts (the map info window). */
  textHex: string;
  /** Hex of `marker`. */
  markerHex: string;
}

export function getEarlyScoreStyle(score: number): EarlyScoreStyle {
  return {
    text: 'text-gray-600',
    marker: getScoreColor(score).bg,
    textHex: EARLY_SCORE_TEXT_HEX,
    markerHex: getScoreHex(score),
  };
}

// Soft-tinted background tier for score-detail cards. Matches the 4-tier
// band so Concerning (2.0–2.9) renders distinctly from Poor (<2.0).
export function getScoreBgTint(score: number): string {
  if (score >= 4) return 'bg-emerald-50';
  if (score >= 3) return 'bg-amber-50';
  if (score >= 2) return 'bg-amber-100';
  return 'bg-red-50';
}
