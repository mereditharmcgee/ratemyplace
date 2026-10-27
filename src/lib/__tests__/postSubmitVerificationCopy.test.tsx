import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import PostSubmitVerification from '../../components/profile/PostSubmitVerification';

/**
 * The prompt shown after a review is submitted used to say verified reviews "carry more
 * weight in building scores". No scoring code reads `is_verified`, so that was false. The
 * prompt now promises only what verification does: a badge on the review.
 */

afterEach(() => cleanup());

describe('post-submit verification prompt', () => {
  it('promises the badge and nothing about scores', () => {
    const { container } = render(<PostSubmitVerification reviewId="review-1" />);
    const text = container.textContent ?? '';
    expect(text).toContain('Verified reviews display a trust badge. Upload proof of tenancy to get verified.');
    expect(text).not.toMatch(/weight/i);
    expect(text).not.toMatch(/score/i);
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
