import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import LandlordsTable from '../../components/admin/LandlordsTable';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const landlord = (id: string, name: string, notes: string | null = null) => ({
  id,
  name,
  slug: id,
  description: null,
  website: null,
  phone: null,
  email: null,
  admin_notes: notes,
  building_count: 1,
  review_count: 0,
  avg_score: null,
  created_at: 1,
  cities: ['New Haven'],
  states: ['CT'],
});

const stats = { total_landlords: 2, total_buildings: 2, total_reviews: 0, high_rated: 0 };

describe('LandlordsTable ?id= deep link', () => {
  it('expands the linked landlord, loading further pages until it appears, and shows its admin notes', async () => {
    window.history.replaceState(null, '', '/admin/landlords?id=ll-2');
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('offset=0')
          ? { landlords: [landlord('ll-1', 'A Co')], total: 2, stats }
          : { landlords: [landlord('ll-2', 'B Co', 'Same name as landlord ll-9 (Boston, MA); kept separate 2026-10-05')], total: 2, stats },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { findByText, getByText } = render(<LandlordsTable />);
    expect(await findByText('Same name as landlord ll-9 (Boston, MA); kept separate 2026-10-05')).toBeTruthy();
    expect(getByText('New Haven, CT')).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/landlords?limit=100&offset=0',
      '/api/admin/landlords?limit=100&offset=1',
    ]);
  });

  it('stops paging when a page comes back empty while the total still claims more', async () => {
    window.history.replaceState(null, '', '/admin/landlords?id=ll-missing');
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('offset=0') ? { landlords: [landlord('ll-1', 'A Co')], total: 5, stats } : { landlords: [], total: 5, stats },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { findByText } = render(<LandlordsTable />);
    await findByText('A Co');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // Give a runaway effect room to fire again before checking it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/landlords?limit=100&offset=0',
      '/api/admin/landlords?limit=100&offset=1',
    ]);
  });

  it('without ?id= nothing is expanded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ landlords: [landlord('ll-1', 'A Co', 'secret')], total: 1, stats }) })));
    const { findByText, queryByText } = render(<LandlordsTable />);
    await findByText('A Co');
    await waitFor(() => expect(queryByText('secret')).toBeNull());
  });
});
