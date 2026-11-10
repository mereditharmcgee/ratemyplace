import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from '../motion';

// Phase 28 (A11Y-02): the map moves with setCenter instead of an animated panTo, and drops its
// marker transition, when the reader has asked the system for reduced motion.

const original = window.matchMedia;

afterEach(() => {
  window.matchMedia = original;
  vi.restoreAllMocks();
});

function stubMatchMedia(matches: boolean) {
  const spy = vi.fn((query: string) => ({ matches, media: query }) as unknown as MediaQueryList);
  window.matchMedia = spy as unknown as typeof window.matchMedia;
  return spy;
}

describe('prefersReducedMotion', () => {
  it('is true when the reduced-motion query matches', () => {
    const spy = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(spy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('is false when it does not match', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is false when matchMedia is missing', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });
});
