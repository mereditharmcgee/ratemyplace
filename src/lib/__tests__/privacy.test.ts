import { describe, it, expect } from 'vitest';
import { formatFuzzyDate, getCurrentSeason, getCurrentYear, formatRecency, getSeasonFromMonth } from '../privacy';

// ═══════════════════════════════════════════════════
// getSeasonFromMonth
// ═══════════════════════════════════════════════════

describe('getSeasonFromMonth', () => {
  it('returns spring for March (3)', () => {
    expect(getSeasonFromMonth(3)).toBe('spring');
  });

  it('returns spring for April (4)', () => {
    expect(getSeasonFromMonth(4)).toBe('spring');
  });

  it('returns spring for May (5)', () => {
    expect(getSeasonFromMonth(5)).toBe('spring');
  });

  it('returns summer for June (6)', () => {
    expect(getSeasonFromMonth(6)).toBe('summer');
  });

  it('returns summer for July (7)', () => {
    expect(getSeasonFromMonth(7)).toBe('summer');
  });

  it('returns summer for August (8)', () => {
    expect(getSeasonFromMonth(8)).toBe('summer');
  });

  it('returns fall for September (9)', () => {
    expect(getSeasonFromMonth(9)).toBe('fall');
  });

  it('returns fall for October (10)', () => {
    expect(getSeasonFromMonth(10)).toBe('fall');
  });

  it('returns fall for November (11)', () => {
    expect(getSeasonFromMonth(11)).toBe('fall');
  });

  it('returns winter for December (12)', () => {
    expect(getSeasonFromMonth(12)).toBe('winter');
  });

  it('returns winter for January (1)', () => {
    expect(getSeasonFromMonth(1)).toBe('winter');
  });

  it('returns winter for February (2)', () => {
    expect(getSeasonFromMonth(2)).toBe('winter');
  });

  it('correctly assigns December 2025 to winter (not winter 2026)', () => {
    // December should return 'winter' - storing with user-provided year 2025 gives "Winter 2025"
    expect(getSeasonFromMonth(12)).toBe('winter');
  });
});
