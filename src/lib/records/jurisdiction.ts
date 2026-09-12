// Which jurisdiction knows how to pull records for a city — and nothing else.
//
// This is a leaf module on purpose: it imports nothing. `jurisdictions.ts` (plural) maps a
// jurisdiction to its source modules, and importing that from a React island drags all six
// Boston CKAN adapters into the client bundle. Server code that only needs to ask "is this
// a Boston building?" imports this file; `jurisdictions.ts` re-exports these three so
// existing server call sites keep working.
//
// Do not add an import here. A consumer that needs a source list wants `sourcesForCity`
// from `jurisdictions.ts` instead.

export type Jurisdiction = 'boston';

/**
 * Strip a trailing ", XX" state, lowercase. Deliberately looser than
 * enrichment/dispatcher.ts, which requires an uppercase state and treats "Boston, ma" as
 * unrecognized. Trimmed first as well as last, so the `$`-anchored state pattern still
 * matches when the stored city carries trailing whitespace ("Boston, MA ").
 */
export function normalizeCity(city: string): string {
  return city.trim().replace(/,\s*[A-Z]{2}$/i, '').trim().toLowerCase();
}

export function jurisdictionForCity(city: string | null): Jurisdiction | null {
  if (!city) return null;
  return normalizeCity(city) === 'boston' ? 'boston' : null;
}
