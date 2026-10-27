import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';

/** A review card shows one unit size, taken from the bedrooms answer when it is known. */

const baseReview = {
  id: 'review-1',
  review_title: 'Fine place',
  is_verified: 0,
  overall_score: 3.5,
  unit_type: '2br',
  bedrooms: '2',
  bathrooms: '1',
  move_in_season: 'summer',
  move_in_year: 2024,
  move_out_year_new: 'current',
  is_current_tenant: 1,
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

describe('ReviewCard unit size', () => {
  it('shows a studio as a studio when the stored unit type says 1 bedroom', async () => {
    const out = text(await render({ ...baseReview, unit_type: '1br', bedrooms: 'studio' }));
    expect(out).toContain('Studio');
    expect(out).not.toContain('1 bedroom');
    expect(out.toLowerCase()).not.toContain('studio bed');
  });

  it('keeps the bedroom count for a consistent review', async () => {
    const out = text(await render(baseReview));
    expect(out).toContain('2 bedrooms');
    expect(out).toContain('2 beds');
  });

  it('labels one bedroom in the singular', async () => {
    const out = text(await render({ ...baseReview, unit_type: '1br', bedrooms: '1' }));
    expect(out).toContain('1 bedroom');
    expect(out).toContain('1 bed');
    expect(out).not.toContain('1 beds');
  });

  it('falls back to the stored unit type when bedrooms is missing', async () => {
    const out = text(await render({ ...baseReview, unit_type: '3br', bedrooms: null }));
    expect(out).toContain('3 bedrooms');
  });
});

describe('building page unit groups', () => {
  const source = readFileSync(join(process.cwd(), 'src/pages/building/[slug].astro'), 'utf8');

  it('groups reviews by the unit size the reviewer picked', () => {
    expect(source).toMatch(/resolveUnitType\(review\)/);
  });
});
