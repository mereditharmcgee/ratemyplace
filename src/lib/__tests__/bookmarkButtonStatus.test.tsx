import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BookmarkButton from '../../components/ui/BookmarkButton';

// The save toast arrives without moving focus, so it is read from a status region that is
// on the page before the message appears (plan rule P3.2). Stubbed fetch only.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSave(ok: boolean) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => ({}) }));
}

describe('BookmarkButton status', () => {
  it('renders an empty status region before any toast', () => {
    render(<BookmarkButton buildingId="b1" initialSaved={false} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
  });

  it('reads "Building saved" from the status region', async () => {
    stubSave(true);
    render(<BookmarkButton buildingId="b1" initialSaved={false} />);
    const status = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Save building' }));
    await waitFor(() => expect(status.textContent).toBe('Building saved'));
    // The button's name still swaps with its state.
    expect(screen.getByRole('button', { name: 'Remove from saved buildings' })).toBeTruthy();
  });

  it('reads "Removed from saved" and errors from the same region', async () => {
    stubSave(true);
    render(<BookmarkButton buildingId="b1" initialSaved />);
    const status = screen.getByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Remove from saved buildings' }));
    await waitFor(() => expect(status.textContent).toBe('Removed from saved'));

    cleanup();
    stubSave(false);
    render(<BookmarkButton buildingId="b1" initialSaved={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save building' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Something went wrong'));
  });

  it('returns focus to the button after the request, since disabling it dropped focus', async () => {
    stubSave(true);
    render(<BookmarkButton buildingId="b1" initialSaved={false} />);
    const button = screen.getByRole('button', { name: 'Save building' });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Building saved'));
    expect(document.activeElement).toBe(button);
  });

  it('keeps the visible pill only while there is a toast', async () => {
    vi.useFakeTimers();
    try {
      stubSave(true);
      render(<BookmarkButton buildingId="b1" initialSaved={false} />);
      const status = screen.getByRole('status');
      expect(status.firstElementChild).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Save building' }));
      await vi.waitFor(() => expect(status.textContent).toBe('Building saved'));
      expect(status.firstElementChild?.className).toContain('bg-gray-900');
      await vi.advanceTimersByTimeAsync(2000);
      expect(status.textContent).toBe('');
      expect(status.firstElementChild).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
