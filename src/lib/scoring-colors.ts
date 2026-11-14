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

export interface ScoreChipColor extends ScoreColor {
  /** Tailwind border class in the band's own fill, so the band still reads on the tint. */
  border: string;
}

// A small score chip or tile: the band's light tint with dark band text and a 1px border in
// the band's fill. White text on the getScoreColor fill is under WCAG AA for two bands (2.13:1
// on Mixed amber-500, 3.65:1 on Good emerald-600), and these surfaces print small text. Text
// on tint, as painted from the Tailwind 4 tokens: emerald-800 on emerald-50 7.22,
// amber-800 on amber-50 6.83, amber-900 on amber-100 8.13, red-800 on red-50 7.63.
// Used by the admin review score chips and the profile saved-building tile; every other
// surface keeps getScoreColor.
export function getScoreChipColor(score: number): ScoreChipColor {
  if (score >= 4) return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-600', label: 'Good' };
  if (score >= 3) return { bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-500',   label: 'Mixed' };
  if (score >= 2) return { bg: 'bg-amber-100',  text: 'text-amber-900',   border: 'border-amber-700',   label: 'Concerning' };
  return            { bg: 'bg-red-50',     text: 'text-red-800',     border: 'border-red-700',     label: 'Poor' };
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

// Text colour for a band label drawn on a light tint of its own SCORE_HEX (the map info
// window paints the marker colour at alpha 0x20 over white). The marker colours themselves
// are fills, not text: Mixed was 1.95:1 and Good 3.24:1 as their own label. Each band's 800
// shade (Tailwind v3 hexes, like SCORE_HEX) on its tint: Good 6.61, Mixed 6.45,
// Concerning 5.79, Poor 6.73, and no score in gray-600 at 6.45.
export const SCORE_TEXT_HEX = {
  good: '#065F46',       // emerald-800
  mixed: '#92400E',      // amber-800
  concerning: '#854D0E', // yellow-800, the 800 of the Concerning marker's yellow-700
  poor: '#991B1B',       // red-800
  none: '#4B5563',       // gray-600
} as const;

export function getScoreTextHex(score: number | null): string {
  if (score === null) return SCORE_TEXT_HEX.none;
  if (score >= 4) return SCORE_TEXT_HEX.good;
  if (score >= 3) return SCORE_TEXT_HEX.mixed;
  if (score >= 2) return SCORE_TEXT_HEX.concerning;
  return SCORE_TEXT_HEX.poor;
}

// The muted look of an early rating, a building score from fewer reviews than
// NAMED_PARTY_MIN_REVIEWS (see earlyRating.ts). The number drops its band colour for a
// neutral gray, and a small dot beside it carries the band, so a 1.4 still reads as Poor
// without shouting it. Gray-600 is about 7.6:1 on white and 6.8:1 or better on Paper
// (#F6F4EE) and the score tints, so it clears WCAG AA (4.5:1) at any text size.
// The dot is the band's own fill from getScoreColor / SCORE_HEX, same boundaries.
// It is the only place the band shows, so it needs 3:1 against what it sits on (white, Paper
// and the score tints). Mixed amber-500 is 2.13 on white, 1.94 on Paper and 2.05 on amber-50,
// so its dot gets a 1px amber-700 ring: 5.03 on white, 4.57 on Paper, 4.85 on amber-50. The
// other fills pass alone (emerald-600 3.32 on Paper is the lowest). The map info window draws
// its dot from markerHex beside the band name in text, so it takes no ring.
export const EARLY_SCORE_TEXT_HEX = '#4B5563'; // gray-600

const MIXED_MARKER_RING = 'ring-1 ring-amber-700';

export interface EarlyScoreStyle {
  /** Tailwind text class for the score number. */
  text: string;
  /** Tailwind classes for the band dot beside it: the band fill, plus a ring for Mixed. */
  marker: string;
  /** Hex of `text`, for non-Tailwind contexts (the map info window). */
  textHex: string;
  /** Hex of `marker`. */
  markerHex: string;
}

export function getEarlyScoreStyle(score: number): EarlyScoreStyle {
  const band = getScoreColor(score);
  return {
    text: 'text-gray-600',
    marker: band.label === 'Mixed' ? `${band.bg} ${MIXED_MARKER_RING}` : band.bg,
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
