import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import HomeSearch from '../../components/HomeSearch';
import { NAMED_PARTY_MIN_REVIEWS } from '../scoring';
import { getEarlyScoreStyle, getScoreBgTint, getScoreColor, getScoreTextColor } from '../scoring-colors';

// The homepage dropdown: Boston-scoped Google suggestions, buildings already on RateMyPlace
// first with "See this building" and a secondary "Write a review", and a neutral header over
// the addresses we could not match.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ownBuilding = {
  id: 'b1',
  type: 'building',
  title: '12 Example Road',
  subtitle: 'Brighton, Boston, MA',
  slug: '12-example-road-boston',
  reviewCount: 0,
  avgScore: null,
};

const matched = {
  placeId: 'gp-match',
  description: '20 Sample Street, Brighton, MA, USA',
  mainText: '20 Sample Street',
  secondaryText: 'Brighton, MA, USA',
  existing: { slug: '20-24-sample-street-boston', title: '20-24 Sample Street', subtitle: 'Brighton, Boston, MA', reviewCount: 1, avgScore: 3.7 },
};

const unmatched = {
  placeId: 'gp-new',
  description: '99 Example Road, Brighton, MA, USA',
  mainText: '99 Example Road',
  secondaryText: 'Brighton, MA, USA',
  existing: null,
};

function stubFetch(dbResults: unknown[], predictions: unknown[]) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url.startsWith('/api/search/autocomplete') ? { results: dbResults } : { predictions }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function type(getByRole: (role: string) => HTMLElement, value: string) {
  fireEvent.change(getByRole('textbox'), { target: { value } });
}

describe('HomeSearch dropdown', () => {
  it('asks Google for the Boston scope only', async () => {
    const fetchMock = stubFetch([], [unmatched]);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, '99 Example Rd Brighton');
    await waitFor(() => expect(container.textContent).toContain('99 Example Road'));
    const placesCall = fetchMock.mock.calls.map(([url]) => url).find((url) => url.startsWith('/api/places/autocomplete'));
    expect(new URLSearchParams(placesCall!.split('?')[1]).get('scope')).toBe('boston');
  });

  it('lists buildings we have first, each opening its page with a review link beside it', async () => {
    stubFetch([ownBuilding], [unmatched, matched]);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, '12 Example');
    await waitFor(() => expect(container.textContent).toContain('20-24 Sample Street'));

    const text = container.textContent ?? '';
    expect(text).toContain('On RateMyPlace');
    expect(text.indexOf('12 Example Road')).toBeLessThan(text.indexOf('20-24 Sample Street'));
    expect(text.indexOf('20-24 Sample Street')).toBeLessThan(text.indexOf('Other addresses'));
    expect(text.indexOf('Other addresses')).toBeLessThan(text.indexOf('99 Example Road'));

    const buildingButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.includes('See this building'));
    expect(buildingButtons).toHaveLength(2);
    expect(buildingButtons[1].textContent).toContain('3.7');
    expect(buildingButtons[1].textContent).toContain('1 review');

    const reviewLinks = Array.from(container.querySelectorAll('a')).filter((a) => a.textContent === 'Write a review');
    expect(reviewLinks.map((a) => a.getAttribute('href'))).toEqual(['/review/new?building=b1', '/review/new?placeId=gp-match']);

    const addressRow = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('99 Example Road'));
    expect(addressRow?.textContent).toContain('Start a review');
    expect(addressRow?.textContent).not.toContain('See this building');
  });

  it('mutes an early building score to gray with a band dot, as the building page does', async () => {
    const early = { ...ownBuilding, id: 'b2', title: '14 Example Road', slug: '14-example-road-boston', reviewCount: 1, avgScore: 1.4 };
    const established = {
      ...ownBuilding,
      id: 'b3',
      title: '16 Example Road',
      slug: '16-example-road-boston',
      reviewCount: NAMED_PARTY_MIN_REVIEWS,
      avgScore: 1.4,
    };
    stubFetch([early, established], []);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, 'Example Road');
    await waitFor(() => expect(container.textContent).toContain('16 Example Road'));

    const [earlyScore, establishedScore] = Array.from(container.querySelectorAll('[data-home-score]'));
    expect(earlyScore.textContent).toBe('1.4');
    expect(earlyScore.className).toContain(getScoreBgTint(1.4));
    expect(earlyScore.className).toContain(getEarlyScoreStyle(1.4).text);
    expect(earlyScore.className).toContain('font-semibold');
    expect(earlyScore.className).not.toContain('font-bold');
    expect(earlyScore.className).not.toContain('text-red-');
    const marker = earlyScore.querySelector('[data-early-score-marker]');
    expect(marker?.getAttribute('aria-hidden')).toBe('true');
    expect(marker?.className).toContain(getScoreColor(1.4).bg);

    expect(establishedScore.textContent).toBe('1.4');
    expect(establishedScore.className).toContain(`font-bold ${getScoreTextColor(1.4)}`);
    expect(establishedScore.querySelector('[data-early-score-marker]')).toBeNull();
  });

  it('never says we do not have an address', async () => {
    stubFetch([], [unmatched]);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, '99 Example Road');
    await waitFor(() => expect(container.textContent).toContain('99 Example Road'));
    expect(container.textContent).not.toMatch(/don't have|do not have/i);
    expect(container.textContent).not.toContain('On RateMyPlace');
    expect(container.textContent).toContain('Other addresses');
  });

  it('shows no address header when every suggestion is a building we have', async () => {
    stubFetch([], [matched]);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, '20 Sample Street');
    await waitFor(() => expect(container.textContent).toContain('20-24 Sample Street'));
    expect(container.textContent).toContain('On RateMyPlace');
    expect(container.textContent).not.toContain('Other addresses');
    expect(container.textContent).toContain('Address suggestions powered by Google');
  });

  it('uses a placeholder short enough for a phone, with the full label for screen readers', () => {
    stubFetch([], []);
    const { getByRole } = render(<HomeSearch />);
    const input = getByRole('textbox');
    expect(input.getAttribute('placeholder')).toBe('Address, neighborhood, or landlord');
    expect(input.getAttribute('aria-label')).toBe('Search by address, neighborhood, or landlord');
  });
});
