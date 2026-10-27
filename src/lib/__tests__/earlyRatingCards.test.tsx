import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import SearchResults from '../../components/search/SearchResults';
import BuildingScoreSummary from '../../components/ratings/BuildingScoreSummary.astro';
import { NAMED_PARTY_MIN_REVIEWS } from '../scoring';
import { getEarlyScoreTextColor, getScoreTextColor } from '../scoring-colors';

/**
 * Listing cards: a building score from fewer than NAMED_PARTY_MIN_REVIEWS reviews is an
 * early rating (lighter, "from N review(s)", "Early rating"); at the threshold the card is
 * unchanged. Search renders the card in a React island for both the first page and Load
 * more, so one render covers both; landlord and property manager pages use the Astro one.
 */

afterEach(() => cleanup());

function searchCard(reviewCount: number, score = 3.9) {
  return render(
    <SearchResults
      initialBuildings={[
        { slug: '12-example-rd', address: '12 Example Rd', city: 'Boston', state: 'MA', review_count: reviewCount, avg_overall: score },
      ]}
      initialLandlords={[]}
      totalBuildings={1}
      totalLandlords={0}
      query="12 Example"
    />,
  ).container;
}

describe('search result card', () => {
  it('marks a one-review score as an early rating with its count beside it', () => {
    const container = searchCard(1);
    const score = container.querySelector('[data-early-rating]');
    expect(score).not.toBeNull();
    expect(score!.textContent).toContain('3.9');
    expect(score!.textContent).toContain('from 1 review');
    expect(score!.textContent).toContain('Early rating');
    const number = score!.firstElementChild as HTMLElement;
    expect(number.className).toContain(getEarlyScoreTextColor(3.9));
    expect(number.className).toContain('font-semibold');
    expect(number.className).not.toContain('font-bold');
  });

  it('marks every count below the threshold, using the constant', () => {
    const container = searchCard(NAMED_PARTY_MIN_REVIEWS - 1);
    expect(container.querySelector('[data-early-rating]')).not.toBeNull();
    expect(container.textContent).toContain(`from ${NAMED_PARTY_MIN_REVIEWS - 1} review`);
  });

  it('leaves a score at the threshold as it was', () => {
    const container = searchCard(NAMED_PARTY_MIN_REVIEWS, 1.4);
    expect(container.querySelector('[data-early-rating]')).toBeNull();
    expect(container.textContent).toContain(`${NAMED_PARTY_MIN_REVIEWS} reviews`);
    expect(container.textContent).not.toContain('Early rating');
    expect(container.textContent).not.toContain('from ');
    expect(container.innerHTML).toContain(getScoreTextColor(1.4));
    expect(container.innerHTML).toContain('font-bold');
  });

  it('leaves a building with no review as it was', () => {
    const container = render(
      <SearchResults
        initialBuildings={[{ slug: 'x', address: '12 Example Rd', city: 'Boston', state: 'MA', review_count: 0, avg_overall: null }]}
        initialLandlords={[]}
        totalBuildings={1}
        totalLandlords={0}
        query="12 Example"
      />,
    ).container;
    expect(container.textContent).toContain('No reviews yet');
    expect(container.textContent).not.toContain('Early rating');
  });
});

describe('BuildingScoreSummary (landlord and property manager pages)', () => {
  async function renderSummary(score: number, reviewCount: number): Promise<HTMLElement> {
    const container = await AstroContainer.create();
    const html = await container.renderToString(BuildingScoreSummary, { props: { score, reviewCount } });
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  }

  it('marks a two-review score as an early rating', async () => {
    const root = await renderSummary(2.4, 2);
    expect(root.querySelector('[data-early-rating]')).not.toBeNull();
    expect(root.textContent).toContain('2.4');
    expect(root.textContent).toContain('from 2 reviews');
    expect(root.textContent).toContain('Early rating');
    expect(root.innerHTML).toContain(getEarlyScoreTextColor(2.4));
  });

  it('leaves an established score as it was', async () => {
    const root = await renderSummary(4.2, NAMED_PARTY_MIN_REVIEWS + 1);
    expect(root.querySelector('[data-early-rating]')).toBeNull();
    expect(root.textContent).toContain(`${NAMED_PARTY_MIN_REVIEWS + 1} reviews`);
    expect(root.textContent).not.toContain('Early rating');
    expect(root.innerHTML).toContain(getScoreTextColor(4.2));
  });
});
