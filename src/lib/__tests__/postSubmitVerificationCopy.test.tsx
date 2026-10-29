import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostSubmitVerification from '../../components/profile/PostSubmitVerification';

/**
 * The prompt shown after a review is submitted used to say verified reviews "carry more
 * weight in building scores". No scoring code reads `is_verified`, so that was false. The
 * prompt now promises only what verification does: a badge on the review.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('post-submit verification prompt', () => {
  it('promises the badge and nothing about scores', () => {
    const { container } = render(<PostSubmitVerification reviewId="review-1" />);
    const text = container.textContent ?? '';
    expect(text).toContain('Verified reviews display a trust badge. Upload proof of tenancy to get verified.');
    expect(text).not.toMatch(/weight/i);
    expect(text).not.toMatch(/score/i);
  });

  it('Verify Now is a plain button that opens the verification dialog', () => {
    render(<PostSubmitVerification reviewId="review-1" />);
    const verify = screen.getByRole('button', { name: 'Verify Now' });
    expect(verify.getAttribute('type')).toBe('button');
    verify.focus();
    fireEvent.click(verify);
    expect(screen.getByRole('dialog', { name: 'Verify Your Tenancy' })).toBeTruthy();
  });

  it('moves focus to the success message after a successful upload, since Verify Now is gone', async () => {
    // Stubbed upload and a fictional file: nothing is sent anywhere.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    render(<PostSubmitVerification reviewId="review-1" />);
    const verify = screen.getByRole('button', { name: 'Verify Now' });
    verify.focus();
    fireEvent.click(verify);

    const file = new File(['fictional image bytes'], 'example-lease.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/Click to upload/), { target: { files: [file] } });
    await screen.findByText('example-lease.png');
    fireEvent.click(screen.getByRole('button', { name: 'Submit for Verification' }));

    const success = await screen.findByText(/An admin will review your document shortly/);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify Now' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(success));
    expect(success.getAttribute('tabindex')).toBe('-1');
  });

  it('returns focus to Verify Now when the dialog is closed without uploading', () => {
    render(<PostSubmitVerification reviewId="review-1" />);
    const verify = screen.getByRole('button', { name: 'Verify Now' });
    verify.focus();
    fireEvent.click(verify);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(verify);
  });
});

describe('scoring ignores document verification', () => {
  // The claim above was removed because this holds. If a scoring module ever starts
  // reading is_verified, the methodology page and this prompt both need revisiting.
  const libDir = join(process.cwd(), 'src/lib');
  const scoringFiles = readdirSync(libDir).filter((name) => /^scoring.*\.ts$/.test(name));

  it('finds the scoring modules', () => {
    expect(scoringFiles).toEqual(expect.arrayContaining(['scoring.ts', 'scoring-sql.ts']));
  });

  it('no scoring module reads is_verified', () => {
    const readers = scoringFiles.filter((name) => /is_verified|isVerified/.test(readFileSync(join(libDir, name), 'utf8')));
    expect(readers).toEqual([]);
  });
});
