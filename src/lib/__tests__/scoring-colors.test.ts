import { describe, it, expect } from 'vitest';
import {
  getScoreColor,
  getScoreTextColor,
  getEarlyScoreStyle,
  EARLY_SCORE_TEXT_HEX,
  getScoreHex,
  getScoreBgTint,
  SCORE_HEX,
} from '../scoring-colors';

describe('getScoreColor (canonical band)', () => {
  it('Good band (≥4) → emerald-600 fill, "Good" label', () => {
    expect(getScoreColor(4)).toEqual({ bg: 'bg-emerald-600', text: 'text-white', label: 'Good' });
    expect(getScoreColor(5).label).toBe('Good');
  });

  it('Mixed band (3.0–3.9) → amber-500 fill, "Mixed" label', () => {
    expect(getScoreColor(3).label).toBe('Mixed');
    expect(getScoreColor(3.9).bg).toBe('bg-amber-500');
  });

  it('Concerning band (2.0–2.9) → amber-700 fill, "Concerning" label', () => {
    expect(getScoreColor(2).label).toBe('Concerning');
    expect(getScoreColor(2.9).bg).toBe('bg-amber-700');
  });

  it('Poor band (<2) → red-700 fill, "Poor" label', () => {
    expect(getScoreColor(1).label).toBe('Poor');
    expect(getScoreColor(1.9).bg).toBe('bg-red-700');
  });
});

describe('getScoreTextColor', () => {
  it('emerald for ≥4, amber for ≥3, red below', () => {
    expect(getScoreTextColor(4.5)).toBe('text-emerald-700');
    expect(getScoreTextColor(3.5)).toBe('text-amber-700');
    expect(getScoreTextColor(2.5)).toBe('text-red-700');
    expect(getScoreTextColor(1.0)).toBe('text-red-700');
  });
});

// WCAG relative luminance and contrast ratio, for checking the early-rating text colour.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('getEarlyScoreStyle (muted early rating)', () => {
  it('draws the number in neutral gray for every band, never a band colour', () => {
    for (const score of [1, 1.4, 1.9, 2, 2.9, 3, 3.1, 3.9, 4, 5]) {
      const style = getEarlyScoreStyle(score);
      expect(style.text).toBe('text-gray-600');
      expect(style.text).not.toBe(getScoreTextColor(score));
      expect(style.textHex).toBe(EARLY_SCORE_TEXT_HEX);
    }
  });

  it('keeps the band on the dot, with the same boundaries as getScoreColor and getScoreHex', () => {
    for (const score of [1, 1.4, 1.9, 2, 2.9, 3, 3.1, 3.9, 4, 5]) {
      expect(getEarlyScoreStyle(score).marker).toBe(getScoreColor(score).bg);
      expect(getEarlyScoreStyle(score).markerHex).toBe(getScoreHex(score));
    }
    expect(getEarlyScoreStyle(1.4).marker).toBe('bg-red-700');
    expect(getEarlyScoreStyle(2.5).marker).toBe('bg-amber-700');
    expect(getEarlyScoreStyle(3.9).marker).toBe('bg-amber-500');
    expect(getEarlyScoreStyle(4).marker).toBe('bg-emerald-600');
  });

  it('pairs the gray class with its hex', () => {
    expect(EARLY_SCORE_TEXT_HEX).toBe('#4B5563'); // gray-600
  });

  // White cards, the Paper page background and the score tints (emerald-50, amber-50,
  // amber-100, red-50) behind the breakdown tiles. AA for normal text is 4.5:1.
  it('clears WCAG AA for normal-size text on every surface an early score sits on', () => {
    for (const surface of ['#FFFFFF', '#F6F4EE', '#ECFDF5', '#FFFBEB', '#FEF3C7', '#FEF2F2']) {
      expect(contrast(EARLY_SCORE_TEXT_HEX, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('getScoreHex / SCORE_HEX', () => {
  it('returns brand-aligned hex for each band', () => {
    expect(getScoreHex(4.5)).toBe(SCORE_HEX.good);
    expect(getScoreHex(3.5)).toBe(SCORE_HEX.mixed);
    expect(getScoreHex(2.5)).toBe(SCORE_HEX.concerning);
    expect(getScoreHex(1.5)).toBe(SCORE_HEX.poor);
    expect(getScoreHex(null)).toBe(SCORE_HEX.none);
  });

  it('hex values match the Tailwind classes used in getScoreColor', () => {
    expect(SCORE_HEX.good).toBe('#059669');       // emerald-600
    expect(SCORE_HEX.mixed).toBe('#F59E0B');      // amber-500
    expect(SCORE_HEX.concerning).toBe('#A16207'); // amber-700
    expect(SCORE_HEX.poor).toBe('#B91C1C');       // red-700
  });
});

describe('getScoreBgTint (4-tier soft tint)', () => {
  it('renders Concerning distinct from Poor', () => {
    expect(getScoreBgTint(4.5)).toBe('bg-emerald-50');
    expect(getScoreBgTint(3.5)).toBe('bg-amber-50');
    expect(getScoreBgTint(2.5)).toBe('bg-amber-100');
    expect(getScoreBgTint(1.5)).toBe('bg-red-50');
  });
});
