const COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function normalizeReleaseId(
  value: unknown,
  fallback: 'development' | 'unknown'
): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return COMMIT_SHA.test(normalized) ? normalized : fallback;
}

const injectedRelease = typeof __RMP_BUILD_RELEASE_ID__ === 'string'
  ? __RMP_BUILD_RELEASE_ID__
  : undefined;

export const RELEASE_ID = normalizeReleaseId(
  injectedRelease,
  import.meta.env.DEV ? 'development' : 'unknown'
);
