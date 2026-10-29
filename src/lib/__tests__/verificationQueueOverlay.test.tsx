import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import VerificationQueue from '../../components/admin/VerificationQueue';
import type { PendingVerification } from '../../pages/api/admin/pending-verifications';

// A11Y-06 on the admin verification queue: the thumbnail is a button that reports whether
// the full-size view is open, and the full-size view is the shared Dialog. One fictional
// queue row from a stubbed fetch; no document is ever loaded.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ROW: PendingVerification = {
  id: 'ver-example-1',
  review_id: 'review-example-1',
  user_id: 'user-example-1',
  r2_key: 'example/key',
  filename: 'example-lease.png',
  content_type: 'image/png',
  size_bytes: 2048,
  uploaded_at: 1767225600,
  building_address: '12 Example Rd',
  building_city: 'Boston',
  user_email: 'tenant@example.com',
};

async function renderQueue(rows: PendingVerification[] = [ROW]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ verifications: rows }) }));
  render(<VerificationQueue />);
  await screen.findByText('12 Example Rd');
}

const thumbnail = () => screen.getByRole('button', { name: /^Verification document/ });
const focused = () => document.activeElement as HTMLElement | null;

describe('VerificationQueue thumbnail', () => {
  it('is a button that keeps its hint text and says it opens a dialog', async () => {
    await renderQueue();
    const button = thumbnail();
    expect(button.getAttribute('type')).toBe('button');
    // A modal makes the page behind it inert, so an expanded state could never be heard.
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.hasAttribute('aria-expanded')).toBe(false);
    expect(button.textContent).toContain('Click to expand');

    button.focus();
    fireEvent.click(button);
    expect(button.textContent).toContain('Click to shrink');
  });

  it('returns focus to the thumbnail even when the click did not focus it, as in Safari', async () => {
    await renderQueue();
    const button = thumbnail();
    expect(focused()).toBe(document.body);
    fireEvent.click(button);
    fireEvent.keyDown(focused()!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focused()).toBe(button);
  });

  it('a PDF row stays a link, not a button', async () => {
    await renderQueue([{ ...ROW, content_type: 'application/pdf', filename: 'example-lease.pdf' }]);
    expect(screen.getByRole('link', { name: 'Open PDF' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Verification document/ })).toBeNull();
  });
});

describe('VerificationQueue full-size view', () => {
  it('is a dialog named "Verification document" with Close focused first', async () => {
    await renderQueue();
    thumbnail().focus();
    fireEvent.click(thumbnail());
    const dialog = screen.getByRole('dialog', { name: 'Verification document' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(dialog.contains(close)).toBe(true);
    expect(focused()).toBe(close);
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('Escape closes it and returns focus to the thumbnail', async () => {
    await renderQueue();
    const button = thumbnail();
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(focused()!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button.textContent).toContain('Click to expand');
    expect(focused()).toBe(button);
  });

  it('Close closes it and returns focus to the thumbnail', async () => {
    await renderQueue();
    const button = thumbnail();
    button.focus();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focused()).toBe(button);
  });

  it('a click on the dark area around the image closes it, as before', async () => {
    await renderQueue();
    fireEvent.click(thumbnail());
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses a white focus outline on its dark background', async () => {
    await renderQueue();
    fireEvent.click(thumbnail());
    expect(screen.getByRole('dialog').className).toContain('[--focus-ring:#fff]');
  });
});
