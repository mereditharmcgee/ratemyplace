import { describe, it, expect } from 'vitest';
import { KEPT_PAIRS_WHEN_ABSENT, KEPT_WHEN_ABSENT, moveOutFromEdit, withStoredFields } from '../reviewEdit';

const PAST = { move_out_year_new: '2019', move_out_season: 'fall', is_current_tenant: 0 };
const CURRENT = { move_out_year_new: 'current', move_out_season: null, is_current_tenant: 1 };

describe('moveOutFromEdit', () => {
  it('keeps the stored move-out, season and current-tenant flag when the body has no move-out', () => {
    expect(moveOutFromEdit({}, PAST)).toEqual({ year: '2019', season: 'fall', isCurrentTenant: 0 });
    expect(moveOutFromEdit({ bedrooms: '2' }, CURRENT)).toEqual({ year: 'current', season: null, isCurrentTenant: 1 });
  });

  it('keeps a stored current tenant with no stored year as stored', () => {
    const legacy = { move_out_year_new: null, move_out_season: null, is_current_tenant: 1 };
    expect(moveOutFromEdit({}, legacy)).toEqual({ year: null, season: null, isCurrentTenant: 1 });
  });

  it('keeps the season when the body sends the stored year', () => {
    expect(moveOutFromEdit({ move_out_year_new: '2019' }, PAST)).toEqual({ year: '2019', season: 'fall', isCurrentTenant: 0 });
  });

  it('clears the season when the body changes the year', () => {
    expect(moveOutFromEdit({ move_out_year_new: '2023' }, PAST)).toEqual({ year: '2023', season: null, isCurrentTenant: 0 });
    expect(moveOutFromEdit({ move_out_year_new: 'current' }, PAST)).toEqual({ year: 'current', season: null, isCurrentTenant: 1 });
  });

  it('stores a blank or null move-out as a past tenant with none', () => {
    expect(moveOutFromEdit({ move_out_year_new: '' }, PAST)).toEqual({ year: null, season: null, isCurrentTenant: 0 });
    expect(moveOutFromEdit({ move_out_year_new: null }, CURRENT)).toEqual({ year: null, season: null, isCurrentTenant: 0 });
  });

  it('keeps a stored season with no stored year when the body sends no year either', () => {
    const noYear = { move_out_year_new: null, move_out_season: 'fall', is_current_tenant: 0 };
    expect(moveOutFromEdit({ move_out_year_new: '' }, noYear)).toEqual({ year: null, season: 'fall', isCurrentTenant: 0 });
    expect(moveOutFromEdit({ move_out_year_new: '2023' }, noYear)).toEqual({ year: '2023', season: null, isCurrentTenant: 0 });
  });

  it('reads a numeric year as its text, the way the column stores it', () => {
    expect(moveOutFromEdit({ move_out_year_new: 2019 }, PAST)).toEqual({ year: '2019', season: 'fall', isCurrentTenant: 0 });
  });

  it('treats a missing stored row as nothing stored', () => {
    expect(moveOutFromEdit({}, null)).toEqual({ year: null, season: null, isCurrentTenant: 0 });
    expect(moveOutFromEdit({ move_out_year_new: '2024' }, null)).toEqual({ year: '2024', season: null, isCurrentTenant: 0 });
  });
});

describe('withStoredFields', () => {
  it('fills each kept field the body leaves out from the stored row', () => {
    const stored = { bedrooms: '2', tenure_months: 36, had_pest_issues: 1 };
    expect(withStoredFields({ unit_structural: 4 }, stored)).toEqual({
      unit_structural: 4,
      bedrooms: '2',
      tenure_months: 36,
      had_pest_issues: 1,
    });
  });

  it('never replaces a field the body sends, null and blank included', () => {
    const stored = { bedrooms: '2', tenure_months: 36, review_title: 'Old' };
    expect(withStoredFields({ bedrooms: null, tenure_months: '', review_title: 'New' }, stored)).toEqual({
      bedrooms: null,
      tenure_months: '',
      review_title: 'New',
    });
  });

  it('fills only the kept fields and pairs', () => {
    const stored = { unit_structural: 5, move_out_year_new: '2019', unit_type: '1br' };
    expect(withStoredFields({}, stored)).toEqual({});
    for (const field of ['move_out_year_new', 'unit_type']) {
      expect(KEPT_WHEN_ABSENT).not.toContain(field);
      expect(KEPT_PAIRS_WHEN_ABSENT.flat()).not.toContain(field);
    }
  });

  it('keeps a read-together pair as stored only when the body sends neither half', () => {
    const stored = { review_text: 'Stored text', comments: 'Stored text', laundry_type: 'coin_op', laundry_cost_per_load: 2.5 };
    expect(withStoredFields({ unit_structural: 4 }, stored)).toEqual({ unit_structural: 4, ...stored });
    // One half sent: the pair is written as sent, so the other half is not filled.
    expect(withStoredFields({ review_text: 'New text', laundry_cost_per_load: null }, stored)).toEqual({
      review_text: 'New text',
      laundry_cost_per_load: null,
    });
  });

  it('leaves the body alone when there is no stored row', () => {
    expect(withStoredFields({ unit_structural: 4 }, null)).toEqual({ unit_structural: 4 });
  });
});
