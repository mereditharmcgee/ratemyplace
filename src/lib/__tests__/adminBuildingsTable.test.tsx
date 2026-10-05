import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import BuildingsTable from '../../components/admin/BuildingsTable';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const stats = { total_buildings: 38300, with_reviews: 50, with_landlords: 10, total_reviews: 60 };

function json(data: unknown) {
  return { ok: true, json: async () => data };
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.startsWith('/api/admin/buildings')) {
      const url = new URL(input, 'https://ratemyplace.org');
      return json({
        buildings: [],
        total: 0,
        offset: 0,
        limit: 100,
        stats,
        ...(url.searchParams.get('landlord') ? { filter: { landlord: { id: 'll-aa', name: 'AA Management' } } } : {}),
      });
    }
    if (input.startsWith('/api/admin/landlords')) return json({ landlords: [] });
    if (input.startsWith('/api/admin/managers')) return json({ managers: [] });
    return json({ data: { count: 0, sample: [] } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const listCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/admin/buildings'));

describe('BuildingsTable server-side filters', () => {
  it('reads ?landlord= on mount, fetches once with it, and shows a clearable chip', async () => {
    window.history.replaceState(null, '', '/admin/buildings?landlord=ll-aa');
    const fetchMock = stubFetch();
    const { findByText, getByRole } = render(<BuildingsTable />);

    await findByText(/Filtered to AA Management/);
    expect(listCalls(fetchMock)).toEqual(['/api/admin/buildings?limit=100&offset=0&landlord=ll-aa']);

    fireEvent.click(getByRole('button', { name: 'clear' }));
    await waitFor(() => expect(listCalls(fetchMock).at(-1)).toBe('/api/admin/buildings?limit=100&offset=0'));
    expect(window.location.search).toBe('');
  });

  it('the orphan toggle refetches with filter=orphans', async () => {
    const fetchMock = stubFetch();
    const { findByLabelText } = render(<BuildingsTable />);
    fireEvent.click(await findByLabelText('Outside Boston / New Haven, no reviews'));
    await waitFor(() => expect(listCalls(fetchMock).at(-1)).toBe('/api/admin/buildings?limit=100&offset=0&filter=orphans'));
  });

  it('search is debounced and sent to the server', async () => {
    const fetchMock = stubFetch();
    const { findByLabelText } = render(<BuildingsTable />);
    const input = await findByLabelText('Search buildings');
    fireEvent.change(input, { target: { value: ' Humph' } });
    fireEvent.change(input, { target: { value: ' Humphrey ' } });
    await waitFor(() => expect(listCalls(fetchMock).at(-1)).toBe('/api/admin/buildings?limit=100&offset=0&q=Humphrey'));
    expect(listCalls(fetchMock).filter((url) => url.includes('q='))).toHaveLength(1);
  });
});
