import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import RecordsQueuePanel from '../../components/admin/RecordsQueuePanel';
import type { RecordsQueueParkedRow, RecordsQueueStats } from '../api-types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, ok = true) {
  return { ok, json: async () => data };
}

const PAUSED_STATS: RecordsQueueStats = {
  pendingByReason: { button: 2, follower: 3, refresh: 5, fill: 7 },
  parked: 1,
  oldestPendingAgeSeconds: 720,
  completedLast24h: 42,
  fillPaused: true,
};

const RUNNING_STATS: RecordsQueueStats = { ...PAUSED_STATS, fillPaused: false };

const LONG_ERROR = `HTTP 409 from data.boston.gov: ${'x'.repeat(200)}`;

const PARKED_ROW: RecordsQueueParkedRow = {
  id: 17,
  reason: 'fill',
  attempts: 5,
  last_error: LONG_ERROR,
  requested_at: 1_700_000_000,
  address: '23-27 Lanark Rd, Boston, MA 02135',
  slug: '23-27-lanark-rd',
};

function queuePayload(
  overrides: Partial<{ stats: RecordsQueueStats; parked: RecordsQueueParkedRow[]; lastFixture: unknown }> = {},
) {
  return { stats: PAUSED_STATS, parked: [], lastFixture: null, ...overrides };
}

/** The `dd` that follows the `dt` carrying this label — the panel's counts are a definition list. */
function statValue(container: HTMLElement, label: string): string {
  const term = Array.from(container.querySelectorAll('dt')).find((dt) => dt.textContent?.trim() === label);
  return term?.nextElementSibling?.textContent?.trim() ?? '';
}

describe('RecordsQueuePanel', () => {
  it('renders the four pending counts, parked, completed, oldest age, and the paused state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(queuePayload())));

    const { container, getByText } = render(<RecordsQueuePanel />);

    await waitFor(() => expect(container.textContent).toContain('Fill paused'));

    expect(statValue(container, 'Button')).toBe('2');
    expect(statValue(container, 'Follower')).toBe('3');
    expect(statValue(container, 'Refresh')).toBe('5');
    expect(statValue(container, 'Fill')).toBe('7');
    expect(statValue(container, 'Parked')).toBe('1');
    expect(statValue(container, 'Completed (24 h)')).toBe('42');
    expect(statValue(container, 'Oldest pending')).toBe('12 min');
    expect(getByText('Resume fill')).toBeTruthy();
  });

  it('humanizes the oldest pending age in hours and days', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(queuePayload({ stats: { ...PAUSED_STATS, oldestPendingAgeSeconds: 3 * 3600 + 61 } })),
      ),
    );
    const { container } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(statValue(container, 'Oldest pending')).toBe('3 h'));

    cleanup();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(queuePayload({ stats: { ...PAUSED_STATS, oldestPendingAgeSeconds: 2 * 86_400 + 5 } })),
      ),
    );
    const second = render(<RecordsQueuePanel />);
    await waitFor(() => expect(statValue(second.container, 'Oldest pending')).toBe('2 d'));
  });

  it('POSTs the flipped pause flag and re-renders from the returned stats', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/pause')) {
        return Promise.resolve(jsonResponse({ stats: RUNNING_STATS }));
      }
      return Promise.resolve(jsonResponse(queuePayload()));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(getByText('Resume fill')).toBeTruthy());

    fireEvent.click(getByText('Resume fill'));

    await waitFor(() => expect(getByText('Pause fill')).toBeTruthy());
    expect(container.textContent).toContain('Fill running');

    const pauseCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/pause'));
    expect(pauseCall).toBeTruthy();
    expect(pauseCall?.[0]).toBe('/api/admin/records/queue/pause');
    expect(pauseCall?.[1].method).toBe('POST');
    expect(pauseCall?.[1].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(pauseCall?.[1].body)).toEqual({ paused: false });

    fireEvent.click(getByText('Pause fill'));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/pause'));
      expect(JSON.parse(calls[calls.length - 1][1].body)).toEqual({ paused: true });
    });
  });

  it('renders parked rows with a truncated error and retries one by id, then re-fetches', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.endsWith('/retry')) {
        return Promise.resolve(jsonResponse({ stats: RUNNING_STATS }));
      }
      return Promise.resolve(jsonResponse(queuePayload({ parked: [PARKED_ROW] })));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container, getByText } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(container.textContent).toContain('23-27 Lanark Rd, Boston, MA 02135'));

    expect(container.querySelector('a[href="/building/23-27-lanark-rd"]')).toBeTruthy();

    const errorCell = container.querySelector('[title]') as HTMLElement | null;
    expect(errorCell?.getAttribute('title')).toBe(LONG_ERROR);
    expect((errorCell?.textContent ?? '').length).toBeLessThanOrEqual(120);
    expect(errorCell?.textContent).not.toBe(LONG_ERROR);

    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(getByText('Retry'));

    await waitFor(() => {
      const retryCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/retry'));
      expect(retryCall?.[0]).toBe('/api/admin/records/queue/retry');
      expect(retryCall?.[1].method).toBe('POST');
      expect(JSON.parse(retryCall?.[1].body)).toEqual({ id: 17 });
    });

    // Retry POST plus the follow-up GET.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(callsBefore + 2));
    expect(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0])).toBe('/api/admin/records/queue');
  });

  it('shows the empty state when nothing is parked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(queuePayload())));
    const { container } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(container.textContent).toContain('No parked rows'));
  });

  it('says the fixture has not run yet when there is no stored result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(queuePayload())));
    const { container } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(container.textContent).toContain('Fixture: not run yet'));
  });

  it('reports a clean fixture run with its date', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(queuePayload({ lastFixture: { at: 1_757_000_000, failures: 0, failed: [], sourceErrors: [] } })),
      ),
    );
    const { container } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(container.textContent).toContain('Fixture: all checks passed at'));
    expect(container.textContent).toContain(
      new Date(1_757_000_000 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    );
  });

  it('reports failed checks and thrown sources, then lists the failed labels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          queuePayload({
            lastFixture: {
              at: 1_757_000_000,
              failures: 3,
              failed: ['assessor parcel', 'violations count'],
              sourceErrors: [{ label: '311 requests', message: 'HTTP 500' }],
            },
          }),
        ),
      ),
    );
    const { container } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(container.textContent).toContain('Fixture: 2 check(s) failed, 1 source(s) threw at'));
    expect(container.textContent).toContain('assessor parcel');
    expect(container.textContent).toContain('violations count');
    expect(container.textContent).toContain('311 requests');
  });

  it('shows an error instead of a blank panel when the queue cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { container } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(container.textContent).toContain('Could not load the queue'));
  });

  it('shows an error when the queue endpoint answers with a failure status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Failed to load the queue' }, false)));
    const { container } = render(<RecordsQueuePanel />);
    await waitFor(() => expect(container.textContent).toContain('Could not load the queue'));
  });

  it('re-fetches every 60 seconds and stops polling once unmounted', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(queuePayload()));
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<RecordsQueuePanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
