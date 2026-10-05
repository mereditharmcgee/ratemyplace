import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import OrphanCleanupButton from '../../components/admin/OrphanCleanupButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LABEL = 'Delete user-added buildings outside Boston and New Haven with no reviews and no saves';

function stub(count: number) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () =>
      init?.method === 'POST'
        ? { data: { deleted: count } }
        : { data: { count, sample: [{ id: 'o-1', address: '7 Lake St', city: 'Chicago', state: 'IL', created_at: 1 }] } },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OrphanCleanupButton', () => {
  it('says exactly what it deletes and shows the preview count', async () => {
    stub(3);
    const { findByRole } = render(<OrphanCleanupButton onDeleted={() => {}} />);
    expect((await findByRole('button', { name: `${LABEL} (3)` }))).toBeTruthy();
  });

  it('is disabled when there is nothing to delete', async () => {
    stub(0);
    const { findByRole } = render(<OrphanCleanupButton onDeleted={() => {}} />);
    expect(((await findByRole('button', { name: `${LABEL} (0)` })) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms with the count before it POSTs, and does nothing on cancel', async () => {
    const fetchMock = stub(3);
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);
    const onDeleted = vi.fn();
    const { findByRole } = render(<OrphanCleanupButton onDeleted={onDeleted} />);
    fireEvent.click(await findByRole('button', { name: `${LABEL} (3)` }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0][0]).toContain('Delete 3 user-added building(s)');
    expect(confirmSpy.mock.calls[0][0]).toContain('7 Lake St, Chicago');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('POSTs after confirm and reports back', async () => {
    const fetchMock = stub(3);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    const onDeleted = vi.fn();
    const { findByRole } = render(<OrphanCleanupButton onDeleted={onDeleted} />);
    fireEvent.click(await findByRole('button', { name: `${LABEL} (3)` }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    expect(alertSpy).toHaveBeenCalledWith('Deleted 3 building(s).');
  });
});
