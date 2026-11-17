import type { R2Bucket } from '@cloudflare/workers-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteVerificationImage, getVerificationImage, uploadVerificationImage } from '../storage';

// A proof-of-address key names the user and the review, and the upload names the tenant's
// file. An R2 error can echo the key, so the storage helpers log a failure without the
// error object, and nothing they log carries the key or the filename.

const USER = 'tenant-sentinel-1';
const REVIEW = 'review-sentinel-1';
const KEY = `users/${USER}/verifications/${REVIEW}/1700000001.pdf`;
const FILENAME = 'lease-sentinel-unit-4b.pdf';

function refusingBucket(): R2Bucket {
  const refuse = async (key: string) => {
    throw new Error(`R2 refused ${key}`);
  };
  return { put: refuse, get: refuse, delete: refuse } as unknown as R2Bucket;
}

/** A stand-in upload: the helper reads only these four members. */
const file = {
  name: FILENAME,
  type: 'application/pdf',
  size: 2048,
  stream: () => null,
} as unknown as File;

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .flat()
    .map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg)))
    .join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verification storage logs', () => {
  it('a failed upload logs neither the key nor the filename', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await uploadVerificationImage(refusingBucket(), USER, REVIEW, file);
    expect(result.success).toBe(false);
    expect(spy).toHaveBeenCalled();
    const text = logged(spy);
    expect(text).not.toContain(USER);
    expect(text).not.toContain(REVIEW);
    expect(text).not.toContain('users/');
    expect(text).not.toContain(FILENAME);
  });

  it('a failed read logs no key', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getVerificationImage(refusingBucket(), KEY)).toBeNull();
    expect(spy).toHaveBeenCalled();
    const text = logged(spy);
    expect(text).not.toContain(USER);
    expect(text).not.toContain(REVIEW);
    expect(text).not.toContain('users/');
  });

  it('a failed delete logs nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await deleteVerificationImage(refusingBucket(), KEY)).toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
