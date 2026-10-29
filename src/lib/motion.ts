// Client leaf module (clientLeafModules.test.ts): no runtime imports.

/**
 * Whether the reader has asked the system for reduced motion. False outside a browser and
 * where matchMedia is missing, so callers keep their animated default there.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
