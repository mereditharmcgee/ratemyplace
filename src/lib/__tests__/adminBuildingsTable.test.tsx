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

  it('Load more is refused while a filter change is still fetching, so two filters never mix', async () => {
    const page = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${prefix}-${i}`,
        address: `${i} ${prefix} St`,
        slug: `${prefix}-${i}`,
        neighborhood: null,
        city: 'Chicago',
        state: 'IL',
        zip_code: null,
        latitude: null,
        longitude: null,
        year_built: null,
        unit_count: null,
        building_type: null,
        landlord_id: null,
        landlord_name: null,
        property_manager_id: null,
        property_manager_name: null,
        created_at: 1,
        admin_notes: null,
        owner_name: null,
        owner_entity: null,
        owner_website: null,
        review_count: 0,
        avg_score: null,
      }));
    let releaseOrphans: () => void = () => {};
    const orphansGate = new Promise<void>((resolve) => {
      releaseOrphans = resolve;
    });
    const fetchMock = vi.fn(async (input: string) => {
      if (input.startsWith('/api/admin/buildings')) {
        const url = new URL(input, 'https://ratemyplace.org');
        if (url.searchParams.get('filter') === 'orphans') {
          await orphansGate;
          return json({ buildings: page('orphan', 3), total: 3, offset: 0, limit: 100, stats });
        }
        const offset = Number(url.searchParams.get('offset'));
        return json({ buildings: page(`all${offset}`, 100), total: 250, offset, limit: 100, stats });
      }
      if (input.startsWith('/api/admin/landlords')) return json({ landlords: [] });
      if (input.startsWith('/api/admin/managers')) return json({ managers: [] });
      return json({ data: { count: 0, sample: [] } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { findByRole, findByLabelText, findByText, queryByText } = render(<BuildingsTable />);
    const loadMore = await findByRole('button', { name: /Load more \(150 remaining\)/ });

    fireEvent.click(await findByLabelText('Outside Boston / New Haven, no reviews'));
    await waitFor(() => expect(listCalls(fetchMock).at(-1)).toContain('filter=orphans'));
    expect((loadMore as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(loadMore);
    expect(listCalls(fetchMock).some((url) => url.includes('offset=100'))).toBe(false);

    releaseOrphans();
    await findByText('0 orphan St');
    expect(queryByText('0 all0 St')).toBeNull();
    expect(listCalls(fetchMock).some((url) => url.includes('offset=100'))).toBe(false);
  });

  it('the edit form landlord dropdown tells namesakes apart by city', async () => {
    const building = {
      id: 'b-1', address: '6 Elm St', slug: 'b-1', neighborhood: null, city: 'New Haven', state: 'CT', zip_code: null,
      latitude: null, longitude: null, year_built: null, unit_count: null, building_type: null, landlord_id: null,
      landlord_name: null, property_manager_id: null, property_manager_name: null, created_at: 1, admin_notes: null,
      owner_name: null, owner_entity: null, owner_website: null, review_count: 0, avg_score: null,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.startsWith('/api/admin/buildings')) return json({ buildings: [building], total: 1, offset: 0, limit: 100, stats });
      if (input.startsWith('/api/admin/landlords')) {
        return json({
          landlords: [
            { id: 'll-b', name: 'AA Management', cities: ['Boston'], states: ['MA'] },
            { id: 'll-n', name: 'AA Management', cities: ['New Haven'], states: ['CT'] },
            { id: 'll-e', name: 'Empty Co', cities: [], states: [] },
          ],
        });
      }
      if (input.startsWith('/api/admin/managers')) return json({ managers: [] });
      return json({ data: { count: 0, sample: [] } });
    }));
    const { findByText, findByRole } = render(<BuildingsTable />);
    fireEvent.click(await findByText('6 Elm St'));
    fireEvent.click(await findByRole('button', { name: 'Edit building' }));
    expect(await findByRole('option', { name: 'AA Management — Boston' })).toBeTruthy();
    expect(await findByRole('option', { name: 'AA Management — New Haven' })).toBeTruthy();
    expect(await findByRole('option', { name: 'Empty Co — no buildings yet' })).toBeTruthy();
  });

  it('Refresh also refetches the orphan cleanup count', async () => {
    const fetchMock = stubFetch();
    const { findByRole } = render(<BuildingsTable />);
    const cleanupCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/admin/cleanup').length;
    await waitFor(() => expect(cleanupCalls()).toBe(1));
    fireEvent.click(await findByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(cleanupCalls()).toBe(2));
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
