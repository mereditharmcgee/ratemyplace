import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import SearchResults from '../../components/search/SearchResults';
import { SEARCH_SEEDED_COPY } from '../records/display';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Result cards on a phone. The address and the right-hand score or "No reviews yet · city
 * records" label share one row. When the label kept its full width and the address column
 * took what was left, a 375px screen left the address about 90px, and a long street name
 * broke mid-word. The row now wraps: the address keeps a minimum width, and when the label
 * cannot fit beside it, the label moves to its own line below the address, still on the right.
 *
 * jsdom-style environments do no layout, so this pins the classes that produce that
 * behaviour; the widths themselves are checked in a browser at 320, 375 and 390px.
 */

const seededBuilding = {
  slug: '12-example-road',
  address: '1044-1046 Examplewashington Street',
  neighborhood: 'Brighton',
  city: 'Boston',
  state: 'MA',
  review_count: 0,
  avg_overall: null,
  has_records: 1,
};

function cardParts(card: Element) {
  const row = card.firstElementChild as HTMLElement;
  const [main, side] = Array.from(row.children) as HTMLElement[];
  return { row, main, side, title: main.querySelector('h3') as HTMLElement };
}

function expectWrappingRow(card: Element) {
  const { row, main, side, title } = cardParts(card);
  // The row wraps instead of squeezing the address column.
  expect(row.className).toMatch(/\bflex\b/);
  expect(row.className).toMatch(/\bflex-wrap\b/);
  // The address column grows into free space but never starts below 10rem.
  expect(main.className).toMatch(/\bmin-w-0\b/);
  expect(main.className).toMatch(/\bgrow\b/);
  expect(main.className).toMatch(/\bbasis-40\b/);
  expect(main.className).not.toMatch(/\bflex-1\b/);
  // Words break only when a single word is wider than the whole card.
  expect(title.className).toMatch(/\bbreak-words\b/);
  expect(title.className).not.toMatch(/\bbreak-all\b/);
  // The score or label is its own flex item, outside the address column, and stays against
  // the right edge when it wraps below the address.
  expect(main.contains(side)).toBe(false);
  expect(side.className).toMatch(/\bml-auto\b/);
  expect(side.className).toMatch(/\btext-right\b/);
  return { main, side, title };
}

describe('search result card layout', () => {
  it('puts a seeded building label in its own wrapping item beside the address', () => {
    const { container } = render(
      <SearchResults initialBuildings={[seededBuilding]} initialLandlords={[]} totalBuildings={1} totalLandlords={0} query="example" />,
    );
    const card = container.querySelector('a[href="/building/12-example-road"]')!;
    const { title, side } = expectWrappingRow(card);
    expect(title.textContent).toBe('1044-1046 Examplewashington Street');
    expect(side.textContent).toBe(SEARCH_SEEDED_COPY);
  });

  it('lays out a reviewed building the same way, score in the side item', () => {
    const { container } = render(
      <SearchResults
        initialBuildings={[{ ...seededBuilding, review_count: 2, avg_overall: 3.9 }]}
        initialLandlords={[]}
        totalBuildings={1}
        totalLandlords={0}
        query="example"
      />,
    );
    const { side } = expectWrappingRow(container.querySelector('a[href^="/building/"]')!);
    expect(side.textContent).toContain('3.9');
    expect(side.textContent).toContain('2 reviews');
  });

  it('lays out landlord cards the same way', () => {
    const { container } = render(
      <SearchResults
        initialBuildings={[]}
        initialLandlords={[{ slug: 'example-realty', name: 'Example Realty Management Company', building_count: 2, review_count: 1, avg_overall: 4 }]}
        totalBuildings={0}
        totalLandlords={1}
        query="example"
      />,
    );
    const { side } = expectWrappingRow(container.querySelector('a[href="/landlord/example-realty"]')!);
    expect(side.textContent).toContain('Score after');
  });

  it('renders Load more cards with the same markup as the first page', async () => {
    const second = { ...seededBuilding, slug: '14-example-road', address: '14 Example Road' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [second], total: 0 }))));
    const { container, getByRole } = render(
      <SearchResults initialBuildings={[seededBuilding]} initialLandlords={[]} totalBuildings={2} totalLandlords={0} query="example" />,
    );
    fireEvent.click(getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(container.querySelector('a[href="/building/14-example-road"]')).not.toBeNull());

    const shape = (card: Element) =>
      Array.from(card.querySelectorAll('*')).map((el) => `${el.tagName}.${el.className}`);
    const first = container.querySelector('a[href="/building/12-example-road"]')!;
    const loaded = container.querySelector('a[href="/building/14-example-road"]')!;
    expect(loaded.className).toBe(first.className);
    expect(shape(loaded)).toEqual(shape(first));
  });
});
