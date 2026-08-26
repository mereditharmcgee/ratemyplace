import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import LandlordsTable from '../../components/admin/LandlordsTable';
import ManagersTable from '../../components/admin/ManagersTable';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function successfulJsonResponse(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

describe('admin named-party score visibility', () => {
  it('keeps a thin-data landlord score visible and labels it below the public threshold', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulJsonResponse({
      landlords: [{
        id: 'landlord-1',
        name: 'Thin Data Landlord',
        slug: 'thin-data-landlord',
        description: null,
        website: null,
        phone: null,
        email: null,
        building_count: 1,
        review_count: 2,
        avg_score: 4.8,
        created_at: 1,
      }],
      total: 1,
      stats: {
        total_landlords: 1,
        total_buildings: 1,
        total_reviews: 2,
        high_rated: 0,
      },
    })));

    const { container } = render(<LandlordsTable />);

    await waitFor(() => expect(container.textContent).toContain('Thin Data Landlord'));
    expect(container.textContent).toContain('4.8');
    expect(container.textContent).toContain('Below 3-review public threshold');
  });

  it('keeps manager scores visible but excludes thin data from the high-rated statistic', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successfulJsonResponse({
      managers: [
        {
          id: 'manager-1',
          name: 'Thin Data Manager',
          slug: 'thin-data-manager',
          company_name: null,
          description: null,
          website: null,
          phone: null,
          email: null,
          building_count: 1,
          review_count: 2,
          avg_score: 4.8,
          created_at: 1,
        },
        {
          id: 'manager-2',
          name: 'Established Manager',
          slug: 'established-manager',
          company_name: null,
          description: null,
          website: null,
          phone: null,
          email: null,
          building_count: 1,
          review_count: 3,
          avg_score: 4.2,
          created_at: 1,
        },
      ],
    })));

    const { container, getByText } = render(<ManagersTable />);

    await waitFor(() => expect(container.textContent).toContain('Thin Data Manager'));
    expect(container.textContent).toContain('4.8');
    expect(container.textContent).toContain('Below 3-review public threshold');
    expect(getByText('High rated (4+)').previousElementSibling?.textContent).toBe('1');
  });
});
