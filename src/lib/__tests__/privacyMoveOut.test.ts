import { describe, expect, it } from 'vitest';
import { formatMoveOut, moveOutEditChoices, moveOutEditValue } from '../privacy';
import { supplementaryItems } from '../surveyItems';

/**
 * A stored move-out in words, as the season chip spells it: "Current", "2020 or earlier", a
 * year, or a season and year. New reviews store no move-out season, and the lowest choice is
 * the token "2020_or_earlier", so neither may leak through as "null" or as the raw token.
 */
describe('formatMoveOut', () => {
  it('shows Current for a current tenant', () => {
    expect(formatMoveOut({ moveOutYear: 'current' })).toBe('Current');
    expect(formatMoveOut({ moveOutYear: 'current', isCurrentTenant: true })).toBe('Current');
    expect(formatMoveOut({ moveOutYear: null, isCurrentTenant: true })).toBe('Current');
  });

  it('labels the "2020 or earlier" bucket in words', () => {
    expect(formatMoveOut({ moveOutYear: '2020_or_earlier' })).toBe('2020 or earlier');
    expect(formatMoveOut({ moveOutSeason: 'fall', moveOutYear: '2020_or_earlier' })).toBe('2020 or earlier');
  });

  it('shows a move-out year with no season as the year alone', () => {
    expect(formatMoveOut({ moveOutYear: '2025' })).toBe('2025');
    expect(formatMoveOut({ moveOutSeason: null, moveOutYear: '2025' })).toBe('2025');
    expect(formatMoveOut({ moveOutSeason: null, moveOutYear: 2025, isCurrentTenant: false })).toBe('2025');
  });

  it('shows a stored season with the year', () => {
    expect(formatMoveOut({ moveOutSeason: 'fall', moveOutYear: '2024' })).toBe('Fall 2024');
    expect(formatMoveOut({ moveOutSeason: 'Spring', moveOutYear: 2023 })).toBe('Spring 2023');
  });

  it('returns null when no move-out was given', () => {
    expect(formatMoveOut({ moveOutYear: null })).toBeNull();
    expect(formatMoveOut({ moveOutYear: undefined })).toBeNull();
    expect(formatMoveOut({ moveOutYear: '' })).toBeNull();
    expect(formatMoveOut({ moveOutSeason: 'fall', moveOutYear: null, isCurrentTenant: false })).toBeNull();
  });
});

/**
 * Where the move-out select on the reviewer's edit page starts. An untouched save sends this
 * value back, so it must be the stored answer: a past tenant with no stored move-out must not
 * start at "I still live here", which the edit route would save as a current tenant.
 */
describe('moveOutEditValue', () => {
  it('starts a current tenant at current', () => {
    expect(moveOutEditValue({ is_current_tenant: true, move_out_year_new: 'current' })).toBe('current');
    expect(moveOutEditValue({ is_current_tenant: 1, move_out_year_new: 'current' })).toBe('current');
    expect(moveOutEditValue({ is_current_tenant: true, move_out_year_new: null })).toBe('current');
  });

  it('starts a past tenant at the stored move-out', () => {
    expect(moveOutEditValue({ is_current_tenant: false, move_out_year_new: '2024' })).toBe('2024');
    expect(moveOutEditValue({ is_current_tenant: 0, move_out_year_new: '2020_or_earlier' })).toBe('2020_or_earlier');
  });

  it('starts a past tenant with no stored move-out blank, not at current', () => {
    expect(moveOutEditValue({ is_current_tenant: false, move_out_year_new: null })).toBe('');
    expect(moveOutEditValue({ is_current_tenant: 0, move_out_year_new: '' })).toBe('');
    expect(moveOutEditValue({ is_current_tenant: false })).toBe('');
  });
});

/**
 * The edit page's move-out choices always hold the stored answer, so the select shows what is
 * stored instead of falling back to its first choice, "I still live here".
 */
describe('moveOutEditChoices', () => {
  const options = supplementaryItems.moveOutTiming.options;

  it('is the form list when the list holds the stored answer', () => {
    expect(moveOutEditChoices(options, 'current')).toEqual(options);
    expect(moveOutEditChoices(options, '2024')).toEqual(options);
    expect(moveOutEditChoices(options, '2020_or_earlier')).toEqual(options);
  });

  it('adds a blank choice for a past tenant with no stored move-out', () => {
    expect(moveOutEditChoices(options, '')).toEqual([{ value: '', label: 'Select...' }, ...options]);
  });

  it('adds a stored year the list no longer offers', () => {
    expect(moveOutEditChoices(options, '2019')).toEqual([{ value: '2019', label: '2019' }, ...options]);
  });
});
