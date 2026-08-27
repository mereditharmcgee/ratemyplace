import { describe, expect, it } from 'vitest';
import { normalizeReleaseId } from '../release';

describe('normalizeReleaseId', () => {
  const sha = 'A'.repeat(40);

  it('accepts only a full hexadecimal commit SHA and lowercases it', () => {
    expect(normalizeReleaseId(sha, 'unknown')).toBe('a'.repeat(40));
  });

  it.each([undefined, null, '', 'abc123', 'g'.repeat(40), 'a'.repeat(41)])(
    'uses the explicit fallback for %j',
    (value) => {
      expect(normalizeReleaseId(value, 'unknown')).toBe('unknown');
    }
  );

  it('supports both declared safe fallbacks', () => {
    expect(normalizeReleaseId(undefined, 'development')).toBe('development');
    expect(normalizeReleaseId(undefined, 'unknown')).toBe('unknown');
  });
});
