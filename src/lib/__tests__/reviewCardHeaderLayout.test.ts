import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import { getCurrentYear } from '../privacy';

/**
 * Visual-audit regression test: at 375px the review-card header's right column
 * (unit, SeasonChip, recency label, rent) sat on top of the star row because the
 * season chip's nowrap pill and a two-column flex layout had no mobile fallback.
 * This asserts the meta cluster is one wrapping flex row carrying the classes
 * that keep it from overlapping the left column, and that it still contains
 * the season chip text and the recency label.
 */

const baseReview = {
  id: 'review-1',
  review_title: 'Great place to live',
  is_verified: 0,
  overall_score: 4.2,
  unit_type: '1br',
  move_in_season: 'summer',
  move_in_year: 2025,
  move_out_year_new: String(getCurrentYear()),
  is_current_tenant: 0,
  rent_amount: 2100,
  unit_structural: 4,
  unit_plumbing: 4,
  building_common_areas: 4,
  landlord_maintenance: 4,
};

async function renderReviewCard(review: Record<string, unknown>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(ReviewCard, {
    props: { review },
  });
}

function metaContainer(html: string): HTMLElement {
  const fragment = document.createElement('div');
  fragment.innerHTML = html;
  // The meta cluster is the sibling of the min-w-0/flex-1 left column inside the header row.
  const meta = fragment.querySelector('.flex-wrap.gap-x-3') as HTMLElement | null;
  if (!meta) throw new Error('Rendered review card is missing the header meta container');
  return meta;
}

describe('ReviewCard header layout at phone width', () => {
  it('renders the unit/season/recency/rent meta as one wrapping row', async () => {
    const html = await renderReviewCard(baseReview);
    const meta = metaContainer(html);
    const classList = meta.getAttribute('class') ?? '';

    // Wraps instead of forcing a fixed-width right column that can overlap the star row.
    expect(classList).toContain('flex-wrap');
    expect(classList).toContain('items-center');
    expect(classList).toContain('gap-x-3');
    expect(classList).toContain('gap-y-1');

    // From sm up, reverts to the original stacked, right-aligned, width-capped column.
    expect(classList).toContain('sm:block');
    expect(classList).toContain('sm:text-right');
    expect(classList).toContain('sm:min-w-0');
    expect(classList).toContain('sm:max-w-[45%]');
  });

  it('keeps the season chip text and recency label inside the meta row', async () => {
    const html = await renderReviewCard(baseReview);
    const meta = metaContainer(html);

    expect(meta.textContent).toContain('Summer 2025');
    expect(meta.textContent).toContain('Within the last year');
    expect(meta.textContent).toContain('$2,100/mo');
  });

  it('renders each non-chip meta child as a block-level <p> and the chip as inline-block', async () => {
    const html = await renderReviewCard(baseReview);
    const meta = metaContainer(html);

    const children = Array.from(meta.children) as HTMLElement[];
    const chipChildren = children.filter((child) => child.tagName === 'SPAN' && child.className.includes('inline-block'));
    const nonChipChildren = children.filter((child) => !chipChildren.includes(child));

    expect(chipChildren).toHaveLength(1);
    expect(chipChildren[0].className).toContain('inline-block');

    // Below sm these blockify inside the wrapping flex row; from sm up they stack as separate lines.
    expect(nonChipChildren.length).toBeGreaterThan(0);
    for (const child of nonChipChildren) {
      expect(child.tagName).toBe('P');
    }
  });

  it('never lets the star row sit inside the same column as the meta cluster', async () => {
    const html = await renderReviewCard(baseReview);
    const fragment = document.createElement('div');
    fragment.innerHTML = html;
    const leftColumn = fragment.querySelector('.min-w-0.flex-1') as HTMLElement | null;
    if (!leftColumn) throw new Error('Rendered review card is missing the left column');

    // Star row lives in the left column, not the meta cluster.
    expect(leftColumn.textContent).toContain('overall');
    const meta = metaContainer(html);
    expect(meta.textContent).not.toContain('overall');
  });
});
