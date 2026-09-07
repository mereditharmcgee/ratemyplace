import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import RecordCorrectionsQueue from '../../components/admin/RecordCorrectionsQueue';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  };
}

const PENDING_CORRECTION = {
  id: 'corr-1',
  building_id: 'building-1',
  record_kind: 'assessment',
  claim: 'The owner name on file is out of date and needs to be re-pulled from the city.',
  has_contact_email: 0,
  has_pull: 0,
  status: 'pending' as const,
  resolution: null,
  resolution_notes: null,
  resolved_by: null,
  resolved_at: null,
  created_at: 1_700_000_000,
  building_address: '123 Main St, Boston, MA',
  building_slug: '123-main-st',
};

const REPULL_SUCCESS = {
  data: {
    summary: { parcelId: '1234567890', condominium: false, sources: [] },
    diff: {
      added: [{ kind: 'assessment', source_key: 'a1' }],
      removed: [],
      changed: [{ kind: 'permit', source_key: 'p1' }],
    },
  },
};

describe('RecordCorrectionsQueue', () => {
  it('renders the list from a stubbed fetch showing address, kind label, and claim', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ data: [PENDING_CORRECTION] })),
    );

    const { container } = render(<RecordCorrectionsQueue />);

    await waitFor(() => expect(container.textContent).toContain('123 Main St, Boston, MA'));
    expect(container.textContent).toContain('Property');
    expect(container.textContent).toContain(
      'The owner name on file is out of date and needs to be re-pulled from the city.',
    );
  });

  it('enables Resolve once a re-pull result comes back after Open then Re-pull', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/repull')) {
        return Promise.resolve(jsonResponse(REPULL_SUCCESS));
      }
      return Promise.resolve(jsonResponse({ data: [PENDING_CORRECTION] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(<RecordCorrectionsQueue />);

    await waitFor(() => expect(container.textContent).toContain('123 Main St, Boston, MA'));

    fireEvent.click(getByText('Open'));

    const resolveButton = await waitFor(() => getByText('Resolve') as HTMLButtonElement);
    expect(resolveButton.disabled).toBe(true);

    fireEvent.click(getByText('Re-pull from source'));

    await waitFor(() => expect(container.textContent).toContain('Added 1, removed 0, changed 1.'));
    expect((getByText('Resolve') as HTMLButtonElement).disabled).toBe(false);
  });

  it('clears the previous diff and disables Resolve when a second re-pull fails', async () => {
    let repullCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/repull')) {
        repullCalls += 1;
        if (repullCalls === 1) {
          return Promise.resolve(jsonResponse(REPULL_SUCCESS));
        }
        return Promise.resolve(jsonResponse({ error: 'A pull for this building is already running' }, false));
      }
      return Promise.resolve(jsonResponse({ data: [PENDING_CORRECTION] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(<RecordCorrectionsQueue />);

    await waitFor(() => expect(container.textContent).toContain('123 Main St, Boston, MA'));
    fireEvent.click(getByText('Open'));

    fireEvent.click(getByText('Re-pull from source'));
    await waitFor(() => expect(container.textContent).toContain('Added 1, removed 0, changed 1.'));
    expect((getByText('Resolve') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(getByText('Re-pull from source'));
    await waitFor(() => expect(container.textContent).toContain('A pull for this building is already running'));

    expect(container.textContent).not.toContain('Added 1, removed 0, changed 1.');
    expect((getByText('Resolve') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders Resolve enabled for an item with has_pull: 1 without a client re-pull', async () => {
    const pulled = { ...PENDING_CORRECTION, id: 'corr-2', has_pull: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [pulled] })));

    const { container, getByText } = render(<RecordCorrectionsQueue />);

    await waitFor(() => expect(container.textContent).toContain('123 Main St, Boston, MA'));
    fireEvent.click(getByText('Open'));

    const resolveButton = await waitFor(() => getByText('Resolve') as HTMLButtonElement);
    expect(resolveButton.disabled).toBe(false);
    expect(container.textContent).not.toContain('Re-pull before resolving.');
  });

  it('shows a PATCH 400 details message inline without touching the diff area', async () => {
    const pulled = { ...PENDING_CORRECTION, id: 'corr-3', has_pull: 1 };
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse(
            {
              error: 'Validation failed',
              details: [{ field: 'notes', message: 'A source mismatch needs a public note of at least 10 characters.' }],
            },
            false,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ data: [pulled] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(<RecordCorrectionsQueue />);

    await waitFor(() => expect(container.textContent).toContain('123 Main St, Boston, MA'));
    fireEvent.click(getByText('Open'));
    fireEvent.click(await waitFor(() => getByText('Resolve')));

    await waitFor(() =>
      expect(container.textContent).toContain('A source mismatch needs a public note of at least 10 characters.'),
    );
  });

  it('shows a load-failure banner with a Try again button that refetches', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(jsonResponse({ error: 'Failed to load corrections' }, false));
      }
      return Promise.resolve(jsonResponse({ data: [PENDING_CORRECTION] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(<RecordCorrectionsQueue />);

    await waitFor(() => expect(container.textContent).toContain('Failed to load corrections'));
    // The filter bar stays mounted underneath the error banner.
    expect(container.textContent).toContain('Pending');

    fireEvent.click(getByText('Try again'));

    await waitFor(() => expect(container.textContent).toContain('123 Main St, Boston, MA'));
    expect(container.textContent).not.toContain('Failed to load corrections');
  });
});
