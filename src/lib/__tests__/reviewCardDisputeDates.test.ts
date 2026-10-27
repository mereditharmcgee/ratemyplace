import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import { getCurrentYear, reviewTenancyLabel } from '../privacy';
import type { ReviewTenancyFields } from '../privacy';

/**
 * The dispute form names a review by its building page plus the dates its card shows, so the
 * label the dispute route matches against must be exactly the text on the card. And the card
 * must not print the review's internal id: reviews have no public link of their own.
 */

const year = getCurrentYear();

const baseReview = {
  id: 'rvw7k2q9xm4tz8pa',
  review_title: 'Fine place',
  is_verified: 0,
  overall_score: 3.5,
  unit_type: '2br',
  bedrooms: '2',
  would_recommend_new: 'yes',
  unit_structural: 4,
  building_common_areas: 4,
  landlord_maintenance: 3,
};

const shapes: Array<[string, ReviewTenancyFields]> = [
  ['a forward range', { move_in_season: 'summer', move_in_year: year - 3, move_out_year_new: String(year - 1), is_current_tenant: 0 }],
  ['a current tenant', { move_in_season: 'fall', move_in_year: year - 1, move_out_year_new: 'current', is_current_tenant: 1 }],
  ['current by move-out only', { move_in_season: 'spring', move_in_year: year - 2, move_out_year_new: 'current', is_current_tenant: 0 }],
  ['a placeholder move-in after the move-out', { move_in_season: 'winter', move_in_year: year, move_out_year_new: String(year - 1), is_current_tenant: 0 }],
  ['the 2020-or-earlier bucket', { move_in_season: 'summer', move_in_year: 2015, move_out_year_new: '2020_or_earlier', is_current_tenant: 0 }],
];

async function render(review: Record<string, unknown>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(ReviewCard, { props: { review } });
}

function text(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+/g, ' ');
}

describe('review card dates match the dispute label', () => {
  it.each(shapes)('%s', async (_name, dates) => {
    const review = { ...baseReview, ...dates };
    const label = reviewTenancyLabel(review);
    expect(label).toBeTruthy();
    expect(text(await render(review))).toContain(label as string);
  });
});

describe('review card does not print the review id', () => {
  it('leaves the internal id out of the markup', async () => {
    const html = await render({ ...baseReview, ...shapes[0][1] });
    expect(html).not.toContain(baseReview.id);
  });
});
