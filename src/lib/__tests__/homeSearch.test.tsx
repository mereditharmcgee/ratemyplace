import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import HomeSearch from '../../components/HomeSearch';
import { NAMED_PARTY_MIN_REVIEWS } from '../scoring';
import { getEarlyScoreStyle, getScoreBgTint, getScoreColor, getScoreTextColor } from '../scoring-colors';
import { browserNav } from '../reviewPaths';

// The homepage dropdown: Boston-scoped Google suggestions, buildings already on RateMyPlace
// first with "See this building" and a secondary "Write a review", and a neutral header over
// the addresses we could not match. It is a WAI-ARIA APG combobox with a listbox popup
// (A11Y-03): every row is an option, and a building row is two options, open and review.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SEARCH_LABEL = 'Search by address, neighborhood, or landlord';

const ownBuilding = {
  id: 'b1',
  type: 'building',
  title: '12 Example Road',
  subtitle: 'Brighton, Boston, MA',
  slug: '12-example-road-boston',
  reviewCount: 0,
  avgScore: null,
};

const ownLandlord = {
  id: 'l1',
  type: 'landlord',
  title: 'Example Property Group',
  subtitle: '2 reviews',
  slug: 'example-property-group',
  reviewCount: 2,
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

function spyOnNav() {
  return vi.spyOn(browserNav, 'go').mockImplementation(() => {});
}

function type(getByRole: (role: string) => HTMLElement, value: string) {
  fireEvent.change(getByRole('combobox'), { target: { value } });
}

function options(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
}

function statusRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector('[role="status"]');
  if (!region) throw new Error('no status region');
  return region as HTMLElement;
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

  it('lists buildings we have first, each opening its page with a review option beside it', async () => {
    const go = spyOnNav();
    stubFetch([ownBuilding], [unmatched, matched]);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, '12 Example');
    await waitFor(() => expect(container.textContent).toContain('20-24 Sample Street'));

    const text = container.textContent ?? '';
    expect(text).toContain('On RateMyPlace');
    expect(text.indexOf('12 Example Road')).toBeLessThan(text.indexOf('20-24 Sample Street'));
    expect(text.indexOf('20-24 Sample Street')).toBeLessThan(text.indexOf('Other addresses'));
    expect(text.indexOf('Other addresses')).toBeLessThan(text.indexOf('99 Example Road'));

    const openOptions = options(container).filter((o) => o.textContent?.includes('See this building'));
    expect(openOptions).toHaveLength(2);
    expect(openOptions[1].textContent).toContain('3.7');
    expect(openOptions[1].textContent).toContain('1 review');

    // "Write a review" is its own option, named with the building it belongs to.
    const reviewOptions = screen.getAllByRole('option', { name: /Write a review/ });
    expect(reviewOptions).toHaveLength(2);
    expect(reviewOptions[0].textContent).toBe('Write a review');
    expect(screen.getByRole('option', { name: 'Write a review 12 Example Road' })).toBe(reviewOptions[0]);
    expect(screen.getByRole('option', { name: 'Write a review 20-24 Sample Street' })).toBe(reviewOptions[1]);

    const addressRow = options(container).find((o) => o.textContent?.includes('99 Example Road'));
    expect(addressRow?.textContent).toContain('Start a review');
    expect(addressRow?.textContent).not.toContain('See this building');

    // A choice closes the popup, so each review option is clicked from a fresh search.
    fireEvent.click(reviewOptions[0]);
    type(getByRole, '12 Example ');
    await waitFor(() => expect(screen.getAllByRole('option', { name: /Write a review/ })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('option', { name: /Write a review/ })[1]);
    expect(go.mock.calls.map(([url]) => url)).toEqual(['/review/new?building=b1', '/review/new?placeId=gp-match']);
  });

  it('clicking a building option opens its page, and an address option starts a review', async () => {
    const go = spyOnNav();
    stubFetch([ownBuilding], [unmatched]);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, '12 Example');
    await waitFor(() => expect(container.textContent).toContain('99 Example Road'));

    fireEvent.click(screen.getByRole('option', { name: /12 Example Road.*See this building/ }));
    expect(go).toHaveBeenLastCalledWith('/building/12-example-road-boston');

    type(getByRole, '12 Example R');
    await waitFor(() => expect(container.textContent).toContain('99 Example Road'));
    fireEvent.click(screen.getByRole('option', { name: /99 Example Road/ }));
    expect(go).toHaveBeenLastCalledWith('/review/new?placeId=gp-new');
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

  it('shows a building we have in another state as our building, with the early-rating chip', async () => {
    // The server keeps an out-of-state suggestion only when it is one of our buildings.
    const go = spyOnNav();
    const elsewhere = {
      placeId: 'gp-ct',
      description: '40 Sample Street, Elsewhere, CT, USA',
      mainText: '40 Sample Street',
      secondaryText: 'Elsewhere, CT, USA',
      existing: { slug: '40-sample-street-elsewhere', title: '40 Sample Street', subtitle: 'Elsewhere, CT', reviewCount: 1, avgScore: 3.7 },
    };
    stubFetch([], [elsewhere]);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, '40 Sample Street, Elsewhere, CT');
    await waitFor(() => expect(container.textContent).toContain('40 Sample Street'));

    expect(container.textContent).toContain('On RateMyPlace');
    expect(container.textContent).not.toContain('Other addresses');
    const row = options(container).find((o) => o.textContent?.includes('See this building'));
    expect(row?.textContent).toContain('Elsewhere, CT');

    const chip = container.querySelector('[data-home-score]');
    expect(chip?.textContent).toBe('3.7');
    expect(chip?.className).toContain(getEarlyScoreStyle(3.7).text);
    expect(chip?.className).not.toContain(getScoreTextColor(3.7));
    expect(chip?.querySelector('[data-early-score-marker]')?.className).toContain(getScoreColor(3.7).bg);

    fireEvent.click(screen.getByRole('option', { name: /Write a review/ }));
    expect(go).toHaveBeenCalledWith('/review/new?placeId=gp-ct');
  });

  it('uses a placeholder short enough for a phone, with the full label for screen readers', () => {
    stubFetch([], []);
    const { getByRole } = render(<HomeSearch />);
    const input = getByRole('combobox');
    expect(input.getAttribute('placeholder')).toBe('Address, neighborhood, or landlord');
    expect(input.getAttribute('aria-label')).toBe(SEARCH_LABEL);
  });
});

describe('HomeSearch combobox semantics', () => {
  async function openWithEveryKind() {
    stubFetch([ownBuilding, ownLandlord], [unmatched]);
    const view = render(<HomeSearch />);
    type(view.getByRole, '12 Example');
    await waitFor(() => expect(view.container.textContent).toContain('99 Example Road'));
    return { ...view, input: screen.getByRole('combobox', { name: SEARCH_LABEL }) };
  }

  it('is a collapsed combobox until results arrive, then controls a named listbox', async () => {
    stubFetch([ownBuilding, ownLandlord], [unmatched]);
    const { getByRole, container } = render(<HomeSearch />);
    const input = screen.getByRole('combobox', { name: SEARCH_LABEL });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');

    type(getByRole, '12 Example');
    await waitFor(() => expect(container.textContent).toContain('99 Example Road'));
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox', { name: SEARCH_LABEL });
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);

    const own = within(listbox).getByRole('group', { name: 'On RateMyPlace' });
    expect(within(own).getAllByRole('option')).toHaveLength(3);
    const other = within(listbox).getByRole('group', { name: 'Other addresses' });
    expect(within(other).getAllByRole('option')).toHaveLength(1);

    // The attribution is not a choice: it sits outside the listbox, its icon hidden.
    expect(listbox.textContent).not.toContain('powered by Google');
    const attribution = screen.getByText('Address suggestions powered by Google');
    expect(attribution.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ArrowDown walks building, its review option, the landlord, then the address, and wraps', async () => {
    const { input, container } = await openWithEveryKind();
    const all = options(container);
    expect(all.map((o) => o.textContent)).toEqual([
      expect.stringContaining('See this building'),
      'Write a review',
      expect.stringContaining('Example Property Group'),
      expect.stringContaining('Start a review'),
    ]);

    for (const option of all) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
      expect(option.getAttribute('aria-selected')).toBe('true');
    }
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(all[0].id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.getAttribute('aria-activedescendant')).toBe(all[3].id);
  });

  it('marks the keyboard-active option with an outline as well as the tint', async () => {
    const { input, container } = await openWithEveryKind();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const landlord = options(container)[2];
    expect(landlord.className).toContain('bg-teal-50');
    expect(landlord.className).toContain('outline-teal-700');
    expect(options(container)[3].className).not.toContain('outline-teal-700');
  });

  it('Enter on the active option goes where a click would', async () => {
    const go = spyOnNav();
    const { input } = await openWithEveryKind();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(go).toHaveBeenCalledWith('/review/new?building=b1');

    go.mockClear();
    type(screen.getByRole, '12 Example R');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(go).toHaveBeenCalledWith('/landlord/example-property-group');
  });

  it('Enter with no active option leaves the choice to the form, which searches', async () => {
    const go = spyOnNav();
    const { input, container } = await openWithEveryKind();
    const enter = fireEvent.keyDown(input, { key: 'Enter' });
    // Not prevented: the browser's own Enter submits the form.
    expect(enter).toBe(true);
    expect(go).not.toHaveBeenCalled();

    fireEvent.submit(container.querySelector('form')!);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith('/search?q=12%20Example');
  });

  it('Escape closes the popup, and a second Escape clears the text', async () => {
    const { input } = await openWithEveryKind();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect((input as HTMLInputElement).value).toBe('12 Example');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('Tab closes the popup without choosing', async () => {
    const go = spyOnNav();
    const { input } = await openWithEveryKind();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it.each(['ArrowLeft', 'ArrowRight', 'Home', 'End'])(
    '%s returns to the text, so Enter then searches for what was typed',
    async (key) => {
      const go = spyOnNav();
      const { input, container } = await openWithEveryKind();
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input.getAttribute('aria-activedescendant')).not.toBeNull();

      // Not prevented: the caret still moves in the text.
      expect(fireEvent.keyDown(input, { key })).toBe(true);
      expect(input.getAttribute('aria-activedescendant')).toBeNull();
      expect(input.getAttribute('aria-expanded')).toBe('true');

      expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
      expect(go).not.toHaveBeenCalled();
      fireEvent.submit(container.querySelector('form')!);
      expect(go).toHaveBeenCalledWith('/search?q=12%20Example');
    },
  );

  it('a blur to another control closes the popup; a blur to nowhere (a phone keyboard Done) leaves it', async () => {
    const { input } = await openWithEveryKind();
    fireEvent.blur(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');

    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    fireEvent.blur(input, { relatedTarget: elsewhere });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    elsewhere.remove();
  });

  /** A fetch that answers only when the test says so. */
  function heldFetch() {
    const held: { answer: (value: unknown) => void } = { answer: () => {} };
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          held.answer = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, held };
  }

  async function answerWith(held: { answer: (value: unknown) => void }, results: unknown[]) {
    await act(async () => {
      held.answer({ ok: true, json: async () => ({ results }) });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it('results that land after focus has moved to another control do not open the popup', async () => {
    const { fetchMock, held } = heldFetch();
    const { getByRole } = render(<HomeSearch />);
    const input = screen.getByRole('combobox', { name: SEARCH_LABEL });
    input.focus();
    type(getByRole, '12 Example');
    // The 150ms debounce sends the lookup; the reader tabs on before it answers.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    await answerWith(held, [ownBuilding, ownLandlord, { ...ownBuilding, id: 'b2', slug: 'b2' }]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();

    // Back in the box, the results it now holds open as usual.
    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    elsewhere.remove();
  });

  it('a response for text that has since been cleared is dropped', async () => {
    const { fetchMock, held } = heldFetch();
    const { getByRole } = render(<HomeSearch />);
    const input = screen.getByRole('combobox', { name: SEARCH_LABEL });
    input.focus();
    type(getByRole, '12 Example');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Escape on the closed popup clears the text while the lookup is still out.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');

    await answerWith(held, [ownBuilding, ownLandlord, { ...ownBuilding, id: 'b2', slug: 'b2' }]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('options are not tabbable and hold no button or link, and decorative glyphs are hidden', async () => {
    const { container } = await openWithEveryKind();
    const listbox = screen.getByRole('listbox');
    expect(listbox.querySelector('button, a, input, [tabindex]')).toBeNull();
    for (const option of options(container)) {
      expect(option.tabIndex).not.toBe(0);
    }

    const plus = within(listbox).getByText('+');
    expect(plus.closest('[aria-hidden="true"]')).not.toBeNull();
    for (const arrow of within(listbox).getAllByText('→')) {
      expect(arrow.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    // The visible words are unchanged.
    expect(listbox.textContent).toContain('See this building →');
    expect(listbox.textContent).toContain('Start a review →');
  });

  it('says how many results there are once they settle, from a region that was there first', async () => {
    stubFetch([ownBuilding, ownLandlord], [unmatched]);
    const { getByRole, container } = render(<HomeSearch />);
    const region = statusRegion(container);
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    type(getByRole, '12 Example');
    // A building, a landlord and an address: three results, though the building is two options.
    await waitFor(() => expect(region.textContent).toBe('3 results available'), { timeout: 2000 });
    expect(region.closest('[role="listbox"]')).toBeNull();
  });

  it('says "No results" when nothing matches', async () => {
    stubFetch([], []);
    const { getByRole, container } = render(<HomeSearch />);
    type(getByRole, 'Nowhere at all');
    await waitFor(() => expect(statusRegion(container).textContent).toBe('No results'), { timeout: 2000 });
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('false');
  });
});
