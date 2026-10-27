import { describe, expect, it } from 'vitest';
import {
  homeDropdownItems,
  homeItemHref,
  placeReviewHref,
  type HomeDbResult,
  type HomePrediction,
} from '../homeSearchItems';

// The homepage dropdown: buildings already on RateMyPlace first, then landlords, then
// other addresses.

function building(id: string, title: string, slug = id): HomeDbResult {
  return { id, type: 'building', title, subtitle: 'Brighton, Boston, MA', slug, reviewCount: 0, avgScore: null };
}

function landlord(id: string, title: string): HomeDbResult {
  return { id, type: 'landlord', title, subtitle: 'Landlord', slug: id, reviewCount: 0, avgScore: null };
}

function google(placeId: string, mainText: string, existingSlug?: string): HomePrediction {
  return {
    placeId,
    description: `${mainText}, Boston, MA, USA`,
    mainText,
    secondaryText: 'Boston, MA, USA',
    existing: existingSlug
      ? { slug: existingSlug, title: `${mainText} (ours)`, subtitle: 'Brighton, Boston, MA', reviewCount: 2, avgScore: 3.5 }
      : null,
  };
}

describe('homeDropdownItems', () => {
  it('orders our buildings, matched suggestions, landlords, then other addresses', () => {
    const items = homeDropdownItems(
      [landlord('l1', 'Example Realty'), building('b1', '12 Example Road')],
      [google('gp-new', '99 Example Road'), google('gp-match', '20 Sample Street', 'sample-slug')],
    );
    expect(items.map((i) => [i.kind, i.key])).toEqual([
      ['building', 'db-b1'],
      ['building', 'g-gp-match'],
      ['landlord', 'db-l1'],
      ['address', 'g-gp-new'],
    ]);
  });

  it('shows a matched suggestion as our building, with our address', () => {
    const [item] = homeDropdownItems([], [google('gp-match', '20 Sample Street', 'sample-slug')]);
    expect(item).toEqual({
      kind: 'building',
      key: 'g-gp-match',
      slug: 'sample-slug',
      title: '20 Sample Street (ours)',
      subtitle: 'Brighton, Boston, MA',
      reviewCount: 2,
      avgScore: 3.5,
      review: { placeId: 'gp-match' },
    });
  });

  it('shows a building once when our search and a suggestion both found it', () => {
    const items = homeDropdownItems(
      [building('b1', '12 Example Road', 'example-slug')],
      [google('gp-1', '12 Example Rd', 'example-slug'), google('gp-2', '12-14 Example Rd', 'example-slug')],
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'building', key: 'db-b1', review: { buildingId: 'b1' } });
  });

  it('drops an unmatched suggestion with exactly our street text, as before', () => {
    const items = homeDropdownItems([building('b1', '12 Example Road')], [google('gp-1', '12 EXAMPLE ROAD')]);
    expect(items.map((i) => i.kind)).toEqual(['building']);
  });

  it('keeps every unmatched suggestion in Google order', () => {
    const items = homeDropdownItems([], [google('gp-1', '1 A St'), google('gp-2', '2 B St')]);
    expect(items.map((i) => i.key)).toEqual(['g-gp-1', 'g-gp-2']);
    expect(items.every((i) => i.kind === 'address')).toBe(true);
  });
});

describe('homeItemHref', () => {
  it('opens a building page, a landlord page, or the review handoff for an address', () => {
    const [b, l, a] = homeDropdownItems([building('b1', '12 Example Road', 'example-slug'), landlord('l1', 'Example Realty')], [
      google('gp/1', '99 Example Road'),
    ]);
    expect(homeItemHref(b)).toBe('/building/example-slug');
    expect(homeItemHref(l)).toBe('/landlord/l1');
    expect(homeItemHref(a)).toBe('/review/new?placeId=gp%2F1');
  });

  it('builds the place handoff path', () => {
    expect(placeReviewHref('ChIJabc')).toBe('/review/new?placeId=ChIJabc');
  });
});
