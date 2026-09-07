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
  contact_email: null,
  status: 'pending' as const,
  resolution: null,
  resolution_notes: null,
  resolved_by: null,
  resolved_at: null,
  created_at: 1_700_000_000,
  building_address: '123 Main St, Boston, MA',
  building_slug: '123-main-st',
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
        return Promise.resolve(
          jsonResponse({
            data: {
              summary: { parcelId: '1234567890', condominium: false, sources: [] },
              diff: {
                added: [{ kind: 'assessment', source_key: 'a1' }],
                removed: [],
                changed: [{ kind: 'permit', source_key: 'p1' }],
              },
            },
          }),
        );
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
});
