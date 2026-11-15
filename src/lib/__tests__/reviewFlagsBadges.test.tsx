import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import ReviewFlags from '../../components/admin/ReviewFlags';
import ReviewsTable from '../../components/admin/ReviewsTable';
import { REVIEW_FLAG_LABELS, REVIEW_FLAGS_LIST_LABEL } from '../reviewFlags';

/** The admin row's moderation signals: a named list of text badges, one per known code. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReviewFlags', () => {
  it('names the list and shows a text badge per known code', () => {
    render(<ReviewFlags flags={['possible_email', 'repeat_reviewer', 'not_a_code']} />);
    const list = screen.getByRole('list', { name: REVIEW_FLAGS_LIST_LABEL });
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      REVIEW_FLAG_LABELS.possible_email,
      REVIEW_FLAG_LABELS.repeat_reviewer,
    ]);
  });

  it('renders nothing for no flags, an empty list, or only unknown codes', () => {
    for (const flags of [undefined, [], ['not_a_code', 42]]) {
      const { container } = render(<ReviewFlags flags={flags} />);
      expect(container.innerHTML).toBe('');
      cleanup();
    }
  });

  it('shows each code once, in code order', () => {
    render(<ReviewFlags flags={['repeat_reviewer', 'possible_email', 'repeat_reviewer']} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      REVIEW_FLAG_LABELS.possible_email,
      REVIEW_FLAG_LABELS.repeat_reviewer,
    ]);
  });
});

function row(id: string, address: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    user_id: `user-${id}`,
    user_email: `${id}@example.com`,
    building_id: `building-${id}`,
    building_address: address,
    building_slug: address.toLowerCase().replace(/ /g, '-'),
    building_city: 'Boston',
    building_state: 'MA',
    building_landlord_id: null,
    building_landlord_name: null,
    landlord_name: null,
    review_title: '',
    review_text: '',
    comments: '',
    overall_score: 4.2,
    status: 'pending',
    is_verified: 0,
    created_at: 1735689600,
    move_in_year: 2025,
    move_in_season: 'summer',
    unit_type: '1br',
    unit_number: null,
    rent_amount: null,
    would_recommend_new: 'yes',
    ...extra,
  };
}

describe('ReviewsTable moderation signals', () => {
  it('shows the list on a row that has signals and none on a row without the field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reviews: [
            row('r-1', '12 Example Rd', { integrity_flags: ['building_velocity'] }),
            row('r-2', '14 Example Rd'),
          ],
          statusCounts: { all: 2, pending: 2, approved: 0, rejected: 0, flagged: 0 },
          total: 2,
        }),
      }),
    );

    const { container } = render(<ReviewsTable />);
    await waitFor(() => expect(container.textContent).toContain('14 Example Rd'));

    const lists = screen.getAllByRole('list', { name: REVIEW_FLAGS_LIST_LABEL });
    expect(lists).toHaveLength(1);
    expect(lists[0].textContent).toBe(REVIEW_FLAG_LABELS.building_velocity);
    // It sits in the first row's header, beside that row's address.
    const firstHeading = screen.getByRole('heading', { name: '12 Example Rd' });
    expect(firstHeading.closest('.min-w-0')?.contains(lists[0])).toBe(true);
  });
});
