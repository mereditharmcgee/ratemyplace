import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewsTable from '../../components/admin/ReviewsTable';
import ReviewEditForm from '../../components/reviews/ReviewEditForm';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

/**
 * Public pages show rent and square footage as ranges (rentSizeRanges.test.ts). The stored
 * values stay exact, and so do the two places that read them for a reason: the admin review
 * detail and the reviewer's own edit form. Every row here is fictional.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('admin review detail', () => {
  const review = {
    id: 'review-exact',
    user_id: 'user-exact',
    user_email: 'renter@example.com',
    building_id: 'building-exact',
    building_address: '1 Fictional Way',
    building_slug: '1-fictional-way',
    building_city: 'Boston',
    building_state: 'MA',
    building_landlord_id: null,
    building_landlord_name: null,
    landlord_name: null,
    review_title: 'A fictional review',
    review_text: 'Fictional text.',
    comments: '',
    overall_score: 3.5,
    status: 'pending',
    is_verified: 0,
    created_at: 1_735_689_600,
    move_in_year: 2024,
    move_in_season: 'fall',
    unit_type: '1br',
    unit_number: null,
    rent_amount: 2137,
    would_recommend_new: 'yes',
  };

  it('shows the exact rent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        const body = url.startsWith('/api/admin/reviews/')
          ? { review }
          : url.startsWith('/api/admin/reviews')
            ? { reviews: [review], statusCounts: { all: 1, pending: 1, approved: 0, rejected: 0, flagged: 0 }, total: 1 }
            : { landlords: [] };
        return { ok: true, json: async () => body };
      }),
    );
    render(<ReviewsTable />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '1 Fictional Way', expanded: false }));
    expect(await screen.findByText('$2137/mo')).toBeTruthy();
    expect(screen.queryByText(/\$2,000 to \$2,250/)).toBeNull();
  });
});

describe("the reviewer's own edit form", () => {
  it('starts the rent and square footage inputs at the exact stored values', () => {
    const review = {
      id: 'r-exact',
      building_address: '1 Fictional Way',
      neighborhood: 'Allston',
      city: 'Boston',
      unit_type: '2br',
      move_out_year_new: 'current',
      is_current_tenant: true,
      unit_structural: 4,
      rent_amount: 2611,
      square_footage: 1133,
    } as unknown as ReviewDetail;
    render(<ReviewEditForm review={review} />);
    expect((document.getElementById('review-edit-square-footage') as HTMLInputElement).value).toBe('1133');
    expect(screen.getByDisplayValue('2611')).toBeTruthy();
  });
});
