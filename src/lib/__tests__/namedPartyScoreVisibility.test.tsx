import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import HomeSearch from '../../components/HomeSearch';
import SearchResults from '../../components/search/SearchResults';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseProps = {
  initialBuildings: [],
  totalBuildings: 0,
  totalLandlords: 1,
  query: '',
};

describe('named-party score visibility in search results', () => {
  it('withholds a landlord score below three reviews while preserving the review count', () => {
    const { container } = render(
      <SearchResults
        {...baseProps}
        initialLandlords={[{
          slug: 'thin-data-landlord',
          name: 'Thin Data Landlord',
          building_count: 1,
          review_count: 2,
          avg_overall: 4.8,
        }]}
      />
    );

    expect(container.textContent).not.toContain('4.8');
    expect(container.textContent).toContain('2 reviews');
    expect(container.textContent).toContain('Score after 3 reviews');
  });

  it('shows a landlord score at three reviews', () => {
    const { container } = render(
      <SearchResults
        {...baseProps}
        initialLandlords={[{
          slug: 'established-landlord',
          name: 'Established Landlord',
          building_count: 1,
          review_count: 3,
          avg_overall: 4.8,
        }]}
      />
    );

    expect(container.textContent).toContain('4.8');
    expect(container.textContent).toContain('3 reviews');
    expect(container.textContent).not.toContain('Score after 3 reviews');
  });

  it('labels a threshold-met landlord with no aggregate as unavailable', () => {
    const { container } = render(
      <SearchResults
        {...baseProps}
        initialLandlords={[{
          slug: 'legacy-landlord',
          name: 'Legacy Landlord',
          building_count: 1,
          review_count: 3,
          avg_overall: null,
        }]}
      />
    );

    expect(container.textContent).toContain('3 reviews');
    expect(container.textContent).toContain('Score unavailable');
    expect(container.textContent).not.toContain('Score after 3 reviews');
  });

  it('keeps a building score visible at one review', () => {
    const { container } = render(
      <SearchResults
        {...baseProps}
        totalBuildings={1}
        totalLandlords={0}
        initialBuildings={[{
          slug: 'one-review-building',
          address: '1 Main Street',
          city: 'Boston',
          state: 'MA',
          review_count: 1,
          avg_overall: 4.8,
        }]}
        initialLandlords={[]}
      />
    );

    expect(container.textContent).toContain('4.8');
    expect(container.textContent).toContain('1 review');
    expect(container.textContent).not.toContain('Score after 3 reviews');
  });

  it('defensively withholds a thin-data landlord score in home autocomplete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'landlord-1',
            type: 'landlord',
            title: 'Thin Data Landlord',
            subtitle: '2 reviews',
            slug: 'thin-data-landlord',
            reviewCount: 2,
            avgScore: 4.8,
          },
          {
            id: 'building-1',
            type: 'building',
            title: '1 Main Street',
            subtitle: 'Boston, MA',
            slug: '1-main-street',
            reviewCount: 1,
            avgScore: 3.7,
          },
          {
            id: 'building-2',
            type: 'building',
            title: '2 Main Street',
            subtitle: 'Boston, MA',
            slug: '2-main-street',
            reviewCount: 0,
            avgScore: null,
          },
        ],
      }),
    }));

    const { container, getByPlaceholderText } = render(<HomeSearch />);
    fireEvent.change(getByPlaceholderText('Search by address, neighborhood, or landlord...'), {
      target: { value: 'Thin' },
    });

    await waitFor(() => expect(container.textContent).toContain('Thin Data Landlord'));
    const landlordRow = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Thin Data Landlord'));

    expect(landlordRow?.textContent).not.toContain('4.8');
    expect(landlordRow?.textContent).toContain('Score after 3');
    expect(landlordRow?.textContent).toContain('2 reviews');

    const buildingRow = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('1 Main Street'));

    expect(buildingRow).toBeDefined();
    expect(buildingRow?.textContent).toContain('3.7');
    expect(buildingRow?.textContent).toContain('1 review');
    expect(buildingRow?.textContent).not.toContain('Score after 3');
  });

  it('labels a threshold-met null score as unavailable in home autocomplete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'landlord-legacy',
            type: 'landlord',
            title: 'Legacy Landlord',
            subtitle: '3 reviews',
            slug: 'legacy-landlord',
            reviewCount: 3,
            avgScore: null,
          },
          {
            id: 'building-1',
            type: 'building',
            title: '1 Main Street',
            subtitle: 'Boston, MA',
            slug: '1-main-street',
            reviewCount: 1,
            avgScore: 3.7,
          },
          {
            id: 'building-2',
            type: 'building',
            title: '2 Main Street',
            subtitle: 'Boston, MA',
            slug: '2-main-street',
            reviewCount: 0,
            avgScore: null,
          },
        ],
      }),
    }));

    const { container, getByPlaceholderText } = render(<HomeSearch />);
    fireEvent.change(getByPlaceholderText('Search by address, neighborhood, or landlord...'), {
      target: { value: 'Legacy' },
    });

    await waitFor(() => expect(container.textContent).toContain('Legacy Landlord'));
    const landlordRow = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Legacy Landlord'));

    expect(landlordRow?.textContent).toContain('Score unavailable');
    expect(landlordRow?.textContent).not.toContain('Score after 3');
    expect(landlordRow?.textContent).toContain('3 reviews');
  });
});
