import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VerificationModal from '../../components/profile/VerificationModal';

// A11Y-06: the tenancy verification dialog is the shared Dialog, named by its heading, with
// a named Close button and a file input the keyboard can reach. Fictional files only: these
// tests never touch a real document or the upload endpoint (fetch is stubbed).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const focused = () => document.activeElement as HTMLElement | null;
const fictionalPng = () => new File(['fictional image bytes'], 'example-lease.png', { type: 'image/png' });
const fictionalText = () => new File(['fictional text'], 'example-notes.txt', { type: 'text/plain' });

function renderModal(props: Partial<Parameters<typeof VerificationModal>[0]> = {}) {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  render(<VerificationModal reviewId="review-1" onClose={onClose} onSuccess={onSuccess} {...props} />);
  return { onClose, onSuccess };
}

const fileInput = () => screen.getByLabelText(/Click to upload/) as HTMLInputElement;

function choose(file: File) {
  fireEvent.change(fileInput(), { target: { files: [file] } });
}

describe('VerificationModal as a dialog', () => {
  it('is a dialog named "Verify Your Tenancy" and described by its intro', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Verify Your Tenancy' });
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('Upload proof that you lived at this address');
  });

  it('has a named Close button with a hidden icon, and every button is type="button"', () => {
    const { onClose } = renderModal();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('type')).toBe('button');
    }
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape asks to close', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(focused()!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('VerificationModal upload control', () => {
  it('labels the file input with the upload zone, and keeps it reachable (visually hidden, not display:none)', () => {
    renderModal();
    const input = fileInput();
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('file');
    const classes = input.className.split(/\s+/);
    expect(classes).toContain('sr-only');
    expect(classes).not.toContain('hidden');
    expect(input.closest('label')?.getAttribute('for')).toBe(input.id);
  });

  it('puts focus on the file input when it opens', () => {
    renderModal();
    expect(focused()).toBe(fileInput());
  });

  it('shows keyboard focus on the upload zone', () => {
    renderModal();
    const zone = fileInput().closest('label')!;
    expect(zone.className).toContain('has-[:focus-visible]:outline-2');
    expect(zone.className).toContain('has-[:focus-visible]:outline-teal-700');
  });

  it('returns focus to the file input after Remove', async () => {
    renderModal();
    choose(fictionalPng());
    await screen.findByText('example-lease.png');
    expect(screen.queryByLabelText(/Click to upload/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(focused()).toBe(fileInput()));
  });

  it('gives the preview image an empty alt, since the file name is shown beside it', async () => {
    renderModal();
    choose(fictionalPng());
    await screen.findByText('example-lease.png');
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('img')).not.toBeNull());
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('');
  });
});

describe('VerificationModal messages', () => {
  it('renders an empty alert region before any error', () => {
    renderModal();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('');
  });

  it('shows an invalid file type inside the alert region', () => {
    renderModal();
    choose(fictionalText());
    expect(screen.getByRole('alert').textContent).toContain('Invalid file type. Please upload a JPG, PNG, HEIC, or PDF file.');
  });

  it('shows a failed upload inside the alert region, and returns focus to Submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Example upload error' }) }),
    );
    renderModal();
    choose(fictionalPng());
    await screen.findByText('example-lease.png');
    const submit = screen.getByRole('button', { name: 'Submit for Verification' });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Example upload error'));
    // Submit disabled itself during the request; it is enabled again and holds focus.
    expect(submit.hasAttribute('disabled')).toBe(false);
    expect(focused()).toBe(submit);
  });

  it('hides the uploading spinner from assistive technology and keeps the Uploading text', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderModal();
    choose(fictionalPng());
    await screen.findByText('example-lease.png');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }));
    const uploading = await screen.findByRole('button', { name: 'Uploading...' });
    expect(uploading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
