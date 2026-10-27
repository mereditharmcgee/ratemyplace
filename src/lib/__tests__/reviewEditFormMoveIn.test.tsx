import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

/**
 * The reviewer's own edit page shows the move-in they gave and starts the year select from
 * it. A skipped move-in reads "Not given" with the year blank, never the stored placeholder.
 */

afterEach(() => {
  cleanup();
});

function review(fields: Partial<ReviewDetail>): ReviewDetail {
  return {
    id: 'r1',
    building_address: '12 Example Rd',
    neighborhood: 'Brighton',
    city: 'Boston',
    unit_type: '2br',
    move_out_year_new: 'current',
    is_current_tenant: true,
    unit_structural: 4,
    ...fields,
  } as ReviewDetail;
}

function yearSelect(): HTMLSelectElement {
  const select = screen
    .getAllByRole('combobox')
    .find((el) => (el as HTMLSelectElement).options[0]?.textContent === 'Year');
  if (!select) throw new Error('no year select');
  return select as HTMLSelectElement;
}

describe('ReviewEditForm move-in', () => {
  it('shows a skipped move-in as not given, with the year blank', () => {
    render(<ReviewEditForm review={review({ move_in_season: 'winter', move_in_year: 2026, move_in_given: 'none' })} />);
    expect(screen.getByText(/Move-in: Not given/)).toBeTruthy();
    expect(screen.queryByText(/Move-in: Winter 2026/)).toBeNull();
    expect(yearSelect().value).toBe('');
  });

  it('shows a year-only move-in as the year', () => {
    render(<ReviewEditForm review={review({ move_in_season: 'winter', move_in_year: 2022, move_in_given: 'year_only' })} />);
    expect(screen.getByText(/Move-in: 2022/)).toBeTruthy();
    expect(yearSelect().value).toBe('2022');
  });

  it('shows a review written before move_in_given existed as stored', () => {
    render(<ReviewEditForm review={review({ move_in_season: 'winter', move_in_year: 2026, move_in_given: null })} />);
    expect(screen.getByText(/Move-in: Winter 2026/)).toBeTruthy();
    expect(yearSelect().value).toBe('2026');
  });
});
