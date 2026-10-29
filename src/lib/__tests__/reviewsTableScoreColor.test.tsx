import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ReviewsTable from '../../components/admin/ReviewsTable';
import { getScoreTextColor } from '../scoring-colors';

/**
 * The admin reviews row prints the review's overall score in its band colour. A review with no
 * score prints "N/A", which used to come out in the Poor band's red because the band helper
 * was handed null. It is neutral gray-600 now, as in the buildings, landlords and managers
 * tables.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function reviewRow(id: string, overallScore: number | null) {
  return {
    id,
    user_id: 'user-1',
    user_email: `${id}@example.com`,
    building_id: 'building-1',
    building_address: `${id} Example Rd`,
    building_slug: `${id}-example-rd`,
    building_city: 'Boston',
    building_landlord_id: null,
    building_landlord_name: null,
    landlord_name: null,
    review_title: null,
    review_text: '',
    comments: '',
    overall_score: overallScore,
    status: 'pending',
    is_verified: 0,
    created_at: 1735689600,
    move_in_year: 2025,
    move_in_season: 'summer',
    unit_type: '1br',
    unit_number: null,
    rent_amount: null,
    would_recommend_new: 'yes',
  };
}

describe('ReviewsTable overall score colour', () => {
  it('prints a missing score as N/A in gray-600, not in a band colour', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reviews: [reviewRow('unscored', null), reviewRow('scored', 1.5)],
        statusCounts: { all: 2, pending: 2, approved: 0, rejected: 0, flagged: 0 },
        total: 2,
      }),
    }));

    render(<ReviewsTable />);
    await waitFor(() => expect(screen.getByText('N/A')).toBeTruthy());

    const missing = screen.getByText('N/A');
    expect(missing.className).toContain('text-gray-600');
    expect(missing.className).not.toContain(getScoreTextColor(1.5));
    expect(missing.className).not.toMatch(/text-(red|amber|emerald)-/);

    const scored = screen.getByText('1.5');
    expect(scored.className).toContain(getScoreTextColor(1.5));
  });
});
