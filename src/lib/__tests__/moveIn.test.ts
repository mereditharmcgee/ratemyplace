import { describe, expect, it } from 'vitest';
import { moveInFromAnswer, moveInFromEdit, parseMoveInMonth, parseMoveInYear } from '../moveIn';
import { formatMoveIn, givenMoveIn, reviewSeasonChipProps, reviewTenancyLabel } from '../privacy';

/**
 * The move-in question on the review form is optional. A skipped move-in is stored as blank
 * (`move_in_given = 'none'`), not as winter of the current year, and public pages show only
 * the parts the reviewer gave. Reviews written before migration 0035 (`move_in_given` NULL)
 * are shown exactly as stored.
 */

const NOW = new Date(Date.UTC(2026, 9, 27, 15, 0, 0));

describe('parseMoveInMonth', () => {
  it('accepts 1 to 12 as a string or a number', () => {
    expect(parseMoveInMonth('1')).toBe(1);
    expect(parseMoveInMonth('12')).toBe(12);
    expect(parseMoveInMonth(9)).toBe(9);
  });

  it('treats a missing or malformed month as not given', () => {
    for (const raw of [null, undefined, '', '0', '13', '3.5', 'March', '1; DROP', 3.5, {}]) {
      expect(parseMoveInMonth(raw)).toBeNull();
    }
  });
});

describe('parseMoveInYear', () => {
  it('accepts a four-digit year up to next year', () => {
    expect(parseMoveInYear('2023', NOW)).toBe(2023);
    expect(parseMoveInYear(2026, NOW)).toBe(2026);
    expect(parseMoveInYear('2027', NOW)).toBe(2027);
  });

  it('treats a missing, malformed or out-of-range year as not given', () => {
    for (const raw of [null, undefined, '', '0', '1899', '2028', '23', '2023abc', 2023.5, 'NaN']) {
      expect(parseMoveInYear(raw, NOW)).toBeNull();
    }
  });
});

describe('moveInFromAnswer (new review)', () => {
  it('stores the season of the month and the year when both are given', () => {
    expect(moveInFromAnswer('10', '2023', NOW)).toEqual({ season: 'fall', year: 2023, given: 'season_and_year' });
    expect(moveInFromAnswer('12', '2024', NOW)).toEqual({ season: 'winter', year: 2024, given: 'season_and_year' });
  });

  it('stores a year without a month as year only', () => {
    expect(moveInFromAnswer(null, '2023', NOW)).toEqual({ season: 'winter', year: 2023, given: 'year_only' });
  });

  it('stores a skipped move-in as not given, with the old placeholder in the NOT NULL columns', () => {
    expect(moveInFromAnswer(null, null, NOW)).toEqual({ season: 'winter', year: 2026, given: 'none' });
  });

  it('stores a month without a year as not given', () => {
    expect(moveInFromAnswer('7', null, NOW)).toEqual({ season: 'summer', year: 2026, given: 'none' });
  });
});

describe('moveInFromEdit (edited review)', () => {
  const seasonAndYear = { move_in_season: 'fall', move_in_year: 2023, move_in_given: 'season_and_year' as const };
  const oldRow = { move_in_season: 'fall', move_in_year: 2023, move_in_given: null };
  const oldPlaceholder = { move_in_season: 'winter', move_in_year: 2026, move_in_given: null };
  const skipped = { move_in_season: 'winter', move_in_year: 2026, move_in_given: 'none' as const };
  const yearOnly = { move_in_season: 'winter', move_in_year: 2022, move_in_given: 'year_only' as const };

  it('leaves the move-in alone when the body does not carry it', () => {
    expect(moveInFromEdit({ unit_structural: 4 }, seasonAndYear, NOW)).toBeNull();
    expect(moveInFromEdit(null, seasonAndYear, NOW)).toBeNull();
  });

  it('keeps the stored season when the year is unchanged and no month is picked', () => {
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2023 }, seasonAndYear, NOW)).toBeNull();
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2023 }, oldRow, NOW)).toBeNull();
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2022 }, yearOnly, NOW)).toBeNull();
  });

  it('leaves an old placeholder move-in as stored when the reviewer does not change it', () => {
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2026 }, oldPlaceholder, NOW)).toBeNull();
  });

  it('keeps a skipped move-in skipped when the reviewer leaves it blank', () => {
    expect(moveInFromEdit({ move_in_month: null, move_in_year: null }, skipped, NOW)).toBeNull();
  });

  it('stores a cleared year as not given', () => {
    expect(moveInFromEdit({ move_in_month: null, move_in_year: null }, seasonAndYear, NOW))
      .toEqual({ season: 'winter', year: 2026, given: 'none' });
    expect(moveInFromEdit({ move_in_month: null, move_in_year: null }, oldPlaceholder, NOW))
      .toEqual({ season: 'winter', year: 2026, given: 'none' });
  });

  it('keeps a season the reviewer gave when only the year changes', () => {
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2022 }, seasonAndYear, NOW))
      .toEqual({ season: 'fall', year: 2022, given: 'season_and_year' });
    expect(moveInFromEdit({ move_in_month: null, move_in_year: '2021' }, seasonAndYear, NOW))
      .toEqual({ season: 'fall', year: 2021, given: 'season_and_year' });
    expect(moveInFromEdit(
      { move_in_month: null, move_in_year: 2022 },
      { move_in_season: 'Summer', move_in_year: 2023, move_in_given: 'season_and_year' },
      NOW,
    )).toEqual({ season: 'summer', year: 2022, given: 'season_and_year' });
  });

  it('stores a new year without a month as year only when no season was given', () => {
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2021 }, yearOnly, NOW))
      .toEqual({ season: 'winter', year: 2021, given: 'year_only' });
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2024 }, skipped, NOW))
      .toEqual({ season: 'winter', year: 2024, given: 'year_only' });
  });

  it('stores a new year without a month as year only on a review written before 0035', () => {
    // The stored season may be the old winter placeholder, so it is not carried over.
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2021 }, oldRow, NOW))
      .toEqual({ season: 'winter', year: 2021, given: 'year_only' });
    expect(moveInFromEdit({ move_in_month: null, move_in_year: 2024 }, oldPlaceholder, NOW))
      .toEqual({ season: 'winter', year: 2024, given: 'year_only' });
  });

  it('stores year only when a stored season is not a season', () => {
    expect(moveInFromEdit(
      { move_in_month: null, move_in_year: 2022 },
      { move_in_season: 'autumn', move_in_year: 2023, move_in_given: 'season_and_year' },
      NOW,
    )).toEqual({ season: 'winter', year: 2022, given: 'year_only' });
  });

  it('stores a cleared year as not given even when a season was given', () => {
    expect(moveInFromEdit({ move_in_month: null, move_in_year: '' }, seasonAndYear, NOW))
      .toEqual({ season: 'winter', year: 2026, given: 'none' });
  });

  it('stores a picked month and year', () => {
    expect(moveInFromEdit({ move_in_month: 4, move_in_year: 2023 }, seasonAndYear, NOW))
      .toEqual({ season: 'spring', year: 2023, given: 'season_and_year' });
    expect(moveInFromEdit({ move_in_month: 6, move_in_year: 2024 }, skipped, NOW))
      .toEqual({ season: 'summer', year: 2024, given: 'season_and_year' });
  });

  it('fills a missing year key from the stored year', () => {
    expect(moveInFromEdit({ move_in_month: 4 }, seasonAndYear, NOW))
      .toEqual({ season: 'spring', year: 2023, given: 'season_and_year' });
    expect(moveInFromEdit({ move_in_month: 4 }, skipped, NOW))
      .toEqual({ season: 'spring', year: 2026, given: 'none' });
  });
});

describe('givenMoveIn and formatMoveIn', () => {
  it('shows a new review with month and year as season and year', () => {
    const review = { move_in_season: 'fall', move_in_year: 2023, move_in_given: 'season_and_year' as const };
    expect(givenMoveIn(review)).toEqual({ season: 'fall', year: 2023 });
    expect(formatMoveIn(review)).toBe('Fall 2023');
  });

  it('shows a year-only move-in as the year', () => {
    const review = { move_in_season: 'winter', move_in_year: 2022, move_in_given: 'year_only' as const };
    expect(givenMoveIn(review)).toEqual({ season: null, year: 2022 });
    expect(formatMoveIn(review)).toBe('2022');
  });

  it('shows nothing for a skipped move-in, whatever the placeholder', () => {
    const review = { move_in_season: 'winter', move_in_year: 2026, move_in_given: 'none' as const };
    expect(givenMoveIn(review)).toEqual({ season: null, year: null });
    expect(formatMoveIn(review)).toBeNull();
  });

  it('shows a review written before migration 0035 as stored', () => {
    expect(formatMoveIn({ move_in_season: 'winter', move_in_year: 2026, move_in_given: null })).toBe('Winter 2026');
    expect(formatMoveIn({ move_in_season: 'summer', move_in_year: 2024 })).toBe('Summer 2024');
  });
});

describe('season chip props', () => {
  it('passes only what the reviewer gave', () => {
    expect(reviewSeasonChipProps({
      move_in_season: 'winter', move_in_year: 2026, move_in_given: 'none', move_out_year_new: 'current', is_current_tenant: 1,
    })).toEqual({ moveInSeason: null, moveInYear: null, moveOutYear: 'current', isCurrentTenant: true });
  });

  it('labels new and old reviews the way the card shows them', () => {
    expect(reviewTenancyLabel({ move_in_season: 'winter', move_in_year: 2026, move_in_given: 'none', move_out_year_new: '2025', is_current_tenant: 0 })).toBe('2025');
    expect(reviewTenancyLabel({ move_in_season: 'winter', move_in_year: 2026, move_in_given: 'none', move_out_year_new: 'current', is_current_tenant: 1 })).toBe('Current');
    expect(reviewTenancyLabel({ move_in_season: 'winter', move_in_year: 2023, move_in_given: 'year_only', move_out_year_new: '2025', is_current_tenant: 0 })).toBe('2023 · 2025');
    expect(reviewTenancyLabel({ move_in_season: 'fall', move_in_year: 2023, move_in_given: 'season_and_year', move_out_year_new: 'current', is_current_tenant: 1 })).toBe('Fall 2023 · Current');
    // Written before 0035: shown as stored, including the old placeholder.
    expect(reviewTenancyLabel({ move_in_season: 'winter', move_in_year: 2026, move_in_given: null, move_out_year_new: 'current', is_current_tenant: 1 })).toBe('Winter 2026 · Current');
    expect(reviewTenancyLabel({ move_in_season: 'winter', move_in_year: 2026, move_out_year_new: '2025', is_current_tenant: 0 })).toBe('2025');
  });
});
