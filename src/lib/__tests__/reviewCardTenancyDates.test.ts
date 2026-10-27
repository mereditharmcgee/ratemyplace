import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import { getCurrentYear } from '../privacy';

/** The season chip on a review card shows a tenancy range that runs forward in time. */

const baseReview = {
  id: 'review-1',
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

async function render(review: Record<string, unknown>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(ReviewCard, { props: { review } });
}

function text(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').replace(/\s+/g, ' ');
}

describe('ReviewCard tenancy dates', () => {
  const year = getCurrentYear();

  it('never shows a move-in later than the move-out year', async () => {
    const out = text(await render({
      ...baseReview,
      move_in_season: 'winter',
      move_in_year: year,
      move_out_year_new: String(year - 1),
      is_current_tenant: 0,
    }));
    expect(out).not.toContain(`Winter ${year}`);
    expect(out).toContain(String(year - 1));
    expect(out).toContain('About 1 year ago');
  });

  it('shows the full range when it runs forward', async () => {
    const out = text(await render({
      ...baseReview,
      move_in_season: 'summer',
      move_in_year: year - 2,
      move_out_year_new: String(year - 1),
      is_current_tenant: 0,
    }));
    expect(out).toContain(`Summer ${year - 2} · ${year - 1}`);
  });

  it('shows Current for a current tenant', async () => {
    const out = text(await render({
      ...baseReview,
      move_in_season: 'fall',
      move_in_year: year - 1,
      move_out_year_new: 'current',
      is_current_tenant: 1,
    }));
    expect(out).toContain(`Fall ${year - 1} · Current`);
  });

  it('spells out the "2020 or earlier" move-out bucket', async () => {
    const out = text(await render({
      ...baseReview,
      move_in_season: 'summer',
      move_in_year: 2015,
      move_out_year_new: '2020_or_earlier',
      is_current_tenant: 0,
    }));
    expect(out).toContain('Summer 2015 · 2020 or earlier');
    expect(out).not.toContain('2020_or_earlier');
  });
});
