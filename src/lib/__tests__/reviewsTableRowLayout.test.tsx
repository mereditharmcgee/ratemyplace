import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import ReviewsTable from '../../components/admin/ReviewsTable';

/**
 * Visual-audit regression test: at 375px the admin reviews row's left block
 * (address + "email • date") had no min-w-0, so a long email ran underneath
 * the right-aligned score/status cluster instead of truncating. This asserts
 * the left block can shrink, the email line truncates, and the right cluster
 * never shrinks in response.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function successfulJsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

const LONG_EMAIL = 'a-genuinely-long-tenant-email-address-for-overlap-testing@example.com';

describe('ReviewsTable row layout at phone width', () => {
  it('gives the left address/email block min-w-0 so it can shrink instead of overflow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulJsonResponse({
      reviews: [{
        id: 'review-1',
        user_id: 'user-1',
        user_email: LONG_EMAIL,
        building_id: 'building-1',
        building_address: '12 Brighton Ave',
        building_slug: '12-brighton-ave',
        building_city: 'Boston',
        building_landlord_id: null,
        building_landlord_name: null,
        landlord_name: null,
        review_title: 'A very long review title that should truncate instead of wrapping under the score',
        review_text: '',
        comments: '',
        overall_score: 4.2,
        status: 'approved',
        is_verified: 0,
        created_at: 1735689600,
        move_in_year: 2025,
        move_in_season: 'summer',
        unit_type: '1br',
        unit_number: null,
        rent_amount: null,
        would_recommend_new: 'yes',
      }],
      statusCounts: { all: 1, pending: 0, approved: 1, rejected: 0, flagged: 0 },
      total: 1,
    })));

    const { container, getByText } = render(<ReviewsTable />);

    await waitFor(() => expect(container.textContent).toContain('12 Brighton Ave'));

    const emailParagraph = getByText(
      (_, el) => el?.tagName === 'P' && !!el.textContent?.startsWith(LONG_EMAIL),
    );
    expect(emailParagraph.className).toContain('truncate');

    const leftBlock = emailParagraph.parentElement;
    expect(leftBlock?.className).toContain('min-w-0');
    expect(leftBlock?.className).toContain('flex-1');

    // The right-hand score/status/chevron cluster must not shrink in response.
    const rightCluster = leftBlock?.nextElementSibling as HTMLElement | null;
    expect(rightCluster).not.toBeNull();
    expect(rightCluster?.className).toContain('shrink-0');

    const titleParagraph = getByText(
      (_, el) =>
        el?.tagName === 'P' &&
        !!el.textContent?.includes('A very long review title that should truncate'),
    );
    expect(titleParagraph.className).toContain('truncate');
  });
});
