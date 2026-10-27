import { describe, expect, it } from 'vitest';
import { formatTenancyRange } from '../privacy';

/**
 * The season chip on a review card shows a fuzzy tenancy range: move-in season and year,
 * then the move-out year (or "Current"). Older reviews were stored with a placeholder
 * move-in of winter of the submission year, so a stored move-in can fall after the
 * move-out year. A range that runs backwards is never shown.
 */
describe('formatTenancyRange', () => {
  it('shows move-in season and year with the move-out year', () => {
    expect(formatTenancyRange({ moveInSeason: 'summer', moveInYear: 2024, moveOutYear: '2025' })).toBe('Summer 2024 · 2025');
  });

  it('shows Current for a current tenant', () => {
    expect(formatTenancyRange({ moveInSeason: 'fall', moveInYear: 2025, moveOutYear: 'current', isCurrentTenant: true })).toBe('Fall 2025 · Current');
    expect(formatTenancyRange({ moveInSeason: 'fall', moveInYear: 2025, moveOutYear: 'current' })).toBe('Fall 2025 · Current');
  });

  it('allows a move-in and move-out in the same year', () => {
    expect(formatTenancyRange({ moveInSeason: 'winter', moveInYear: 2025, moveOutYear: '2025' })).toBe('Winter 2025 · 2025');
  });

  it('drops a move-in that falls after the move-out year', () => {
    expect(formatTenancyRange({ moveInSeason: 'winter', moveInYear: 2026, moveOutYear: '2025' })).toBe('2025');
    expect(formatTenancyRange({ moveInSeason: 'winter', moveInYear: '2026', moveOutYear: 2023 })).toBe('2023');
  });

  it('labels the "2020 or earlier" move-out bucket in words', () => {
    expect(formatTenancyRange({ moveInSeason: 'summer', moveInYear: 2015, moveOutYear: '2020_or_earlier' })).toBe('Summer 2015 · 2020 or earlier');
  });

  it('drops a move-in after 2020 when the move-out is "2020 or earlier"', () => {
    expect(formatTenancyRange({ moveInSeason: 'winter', moveInYear: 2026, moveOutYear: '2020_or_earlier' })).toBe('2020 or earlier');
  });

  it('shows only the move-in when there is no move-out', () => {
    expect(formatTenancyRange({ moveInSeason: 'spring', moveInYear: 2023 })).toBe('Spring 2023');
  });

  it('shows only the move-out when the move-in is incomplete', () => {
    expect(formatTenancyRange({ moveInSeason: null, moveInYear: 2023, moveOutYear: '2024' })).toBe('2024');
    expect(formatTenancyRange({ moveInSeason: 'spring', moveInYear: null, moveOutYear: '2024' })).toBe('2024');
  });

  it('accepts a capitalized season', () => {
    expect(formatTenancyRange({ moveInSeason: 'Winter', moveInYear: 2024, moveOutYear: '2025' })).toBe('Winter 2024 · 2025');
  });

  it('uses a move-out season when one is given', () => {
    expect(formatTenancyRange({ moveInSeason: 'summer', moveInYear: 2024, moveOutSeason: 'fall', moveOutYear: '2025' })).toBe('Summer 2024 · Fall 2025');
  });

  it('returns null when there is nothing to show', () => {
    expect(formatTenancyRange({})).toBeNull();
    expect(formatTenancyRange({ moveInSeason: null, moveInYear: null, moveOutYear: null })).toBeNull();
  });

  it('never shows an exact month or day', () => {
    const out = formatTenancyRange({ moveInSeason: 'summer', moveInYear: 2024, moveOutYear: '2025' }) ?? '';
    expect(out).not.toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
    expect(out).not.toMatch(/\d{1,2}\/\d{1,2}/);
  });
});
