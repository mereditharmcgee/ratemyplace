import { describe, it, expect } from 'vitest';
import {
  getScoreColor,
  getScoreTextColor,
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
