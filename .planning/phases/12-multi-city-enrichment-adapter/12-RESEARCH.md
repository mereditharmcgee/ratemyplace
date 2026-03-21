# Phase 12: Multi-City Enrichment Adapter - Research

**Researched:** 2026-03-21
**Domain:** TypeScript adapter pattern, Socrata REST API (CT CAMA), CKAN API (Boston Assessing)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — user elected full Claude discretion for this phase.

### Claude's Discretion
All implementation decisions delegated to Claude:
- CityAdapter interface design (method signatures, return types)
- How to extract Boston logic from the monolithic 212-line enrich.ts into an adapter
- New Haven CT CAMA field mapping and display format (aim for parity with Boston where fields overlap)
- City detection logic using the `city` column in the buildings table
- Unsupported city message text and response format
- File organization (adapter files, dispatcher location)
- Whether helper functions (inferOwnerEntity, mapBuildingType, parseStreetAddress) stay shared or move into adapters

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FIX-02 | Admin auto-research routes to correct city data source based on building location instead of always querying Boston | City detection via `city` column on buildings table; dispatcher pattern routes to correct adapter |
| ENRICH-01 | Enrichment endpoint uses adapter pattern with a common `CityAdapter` interface for city-specific data sources | TypeScript interface design documented below; thin dispatcher wrapper replaces enrich.ts body |
| ENRICH-02 | Boston adapter extracted from existing monolithic `enrich.ts` endpoint | All Boston logic (API call, formatResult, fallback search) moves verbatim into `BostonAdapter`; helpers extracted to shared module |
| ENRICH-03 | New Haven adapter queries CT CAMA state dataset (`data.ct.gov`, resource `pqrn-qghw`) | CT CAMA field mapping documented; Socrata REST query pattern confirmed working |
| ENRICH-04 | Unsupported cities display "no auto-research data available" instead of failing silently | `NullAdapter` returns structured `unsupported: true` response that BuildingsTable renders gracefully |
</phase_requirements>

---

## Summary

Phase 12 refactors the 212-line monolithic `enrich.ts` endpoint into a dispatched adapter system. The endpoint handler becomes a thin 30-line dispatcher that reads the building's `city` column, selects the matching adapter, and delegates. Each adapter is a TypeScript class implementing a shared `CityAdapter` interface. Boston behavior is preserved exactly — the adapter is a direct extraction of existing code. New Haven uses the CT CAMA Socrata API (`data.ct.gov`, resource `pqrn-qghw`), which is live, requires no API key, and returns fields that map to the same normalized output shape Boston already uses.

The key architectural insight is that the normalized output shape (`EnrichResult`) already exists implicitly in the Boston `formatResult()` function. Making it an explicit interface locks the contract so future adapters cannot deviate. The response envelope (`address`, `searchedFor`, `results[]`, optional `fuzzyMatch`, optional `unsupported`) is also already established by the existing API — New Haven and the null adapter simply extend it.

**Primary recommendation:** Extract shared utilities to `src/lib/enrichment/helpers.ts`, define the interface in `src/lib/enrichment/types.ts`, implement adapters as classes in `src/lib/enrichment/adapters/`, and keep `enrich.ts` as a thin dispatcher. Zero changes to `BuildingsTable.tsx` response consumption except adding a new `unsupported` display branch.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript interfaces | Built-in | `CityAdapter` contract enforcement | Compile-time guarantee that adapters return the same shape |
| Cloudflare D1 / SQLite | Existing | Building lookup with `city` column | Already in use; `city` is already stored on all buildings |
| Socrata REST API | v2.1 | CT CAMA dataset queries | Standard CT open data format; no auth, no SDK needed |
| CKAN datastore_search | v3 | Boston Assessing API queries | Already in use; unchanged |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fetch` (native) | Runtime built-in | HTTP calls to both APIs | All Cloudflare Workers environments have native fetch |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TypeScript class per adapter | Plain function per adapter | Classes give a testable object with clear boundaries; functions are simpler but harder to mock. Classes preferred for this pattern. |
| Shared module for helpers | Helpers duplicated per adapter | Shared module is correct — `inferOwnerEntity` and `parseStreetAddress` are city-agnostic |
| Dispatching on `city` column | Dispatching on `state` column | `city` is more granular; two cities in the same state could use different datasets |

**Installation:** No new packages required.

---

## Architecture Patterns

### Recommended Project Structure
```
src/lib/enrichment/
├── types.ts          # CityAdapter interface, EnrichResult, EnrichResponse
├── helpers.ts        # inferOwnerEntity, parseStreetAddress, normalizeStreetName
├── dispatcher.ts     # selectAdapter(city: string): CityAdapter
└── adapters/
    ├── boston.ts     # BostonAdapter — exact extraction from current enrich.ts
    ├── new-haven.ts  # NewHavenAdapter — CT CAMA Socrata
    └── null.ts       # NullAdapter — unsupported cities

src/pages/api/admin/buildings/[id]/enrich.ts
  # Becomes: auth + DB lookup + selectAdapter(city) + adapter.enrich(building) + return response
```

### Pattern 1: CityAdapter Interface

**What:** A TypeScript interface that every city adapter implements. The dispatcher returns an instance; the caller only sees the interface.

**When to use:** Whenever adding a new city data source. Implement the interface, register in the dispatcher map — nothing else changes.

```typescript
// src/lib/enrichment/types.ts

export interface EnrichResult {
  address: string;
  city: string;
  zipCode?: string;
  owner?: string;
  ownerEntityInferred?: string | null;
  yearBuilt?: number | null;
  yearRemodeled?: number | null;
  unitCount?: number | null;
  residentialUnits?: number | null;
  commercialUnits?: number | null;
  propertyType?: string;
  buildingType?: string;
  rawBuildingType?: string;
  totalValue?: number | null;
  grossArea?: number | null;
  livingArea?: number | null;
  structureClass?: string;
  overallCondition?: string;
}

export interface EnrichResponse {
  address: string;
  searchedFor?: { number: string; street: string };
  results: EnrichResult[];
  fuzzyMatch?: boolean;
  unsupported?: boolean;    // NEW: true for NullAdapter
  message?: string;
}

export interface BuildingRecord {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

export interface CityAdapter {
  enrich(building: BuildingRecord): Promise<EnrichResponse>;
}
```

### Pattern 2: Dispatcher (city string → adapter)

**What:** A pure mapping function — no business logic, just routing.

**When to use:** Called once per request inside `enrich.ts` before delegating.

```typescript
// src/lib/enrichment/dispatcher.ts
import { BostonAdapter } from './adapters/boston';
import { NewHavenAdapter } from './adapters/new-haven';
import { NullAdapter } from './adapters/null';
import type { CityAdapter } from './types';

const CITY_ADAPTERS: Record<string, new () => CityAdapter> = {
  'boston': BostonAdapter,
  'cambridge': BostonAdapter,     // Boston Assessing covers Cambridge records too
  'new haven': NewHavenAdapter,
};

export function selectAdapter(city: string | null): CityAdapter {
  if (!city) return new NullAdapter();
  const key = city.trim().toLowerCase();
  const AdapterClass = CITY_ADAPTERS[key];
  return AdapterClass ? new AdapterClass() : new NullAdapter();
}
```

Note: Cambridge may or may not appear in the Boston Assessing dataset — the CITY_ADAPTERS map can route it there as a future optimization, but whether records actually appear is unverified. Keep as comment or test post-implementation.

### Pattern 3: NullAdapter (unsupported cities)

**What:** Returns a well-formed `EnrichResponse` with `unsupported: true` and an empty `results` array instead of throwing.

**When to use:** Any city not in the dispatch map.

```typescript
// src/lib/enrichment/adapters/null.ts
import type { CityAdapter, BuildingRecord, EnrichResponse } from '../types';

export class NullAdapter implements CityAdapter {
  async enrich(building: BuildingRecord): Promise<EnrichResponse> {
    return {
      address: building.address,
      results: [],
      unsupported: true,
      message: 'No auto-research data available for this city.',
    };
  }
}
```

### Pattern 4: CT CAMA Socrata Query (New Haven)

**What:** Socrata REST API query against `data.ct.gov`, resource `pqrn-qghw`. No API key required. Filter by `address_number` and `street_name`.

**Confirmed live fields from API (2026-03-21):**
- `owner` — owner name (maps to `owner`)
- `ayb` — actual year built (maps to `yearBuilt`)
- `state_use_description` — property use description (maps to `propertyType` / `buildingType`)
- `gross_area_of_primary_building` — (maps to `grossArea`)
- `living_area` — (maps to `livingArea`)
- `number_of_buildings` — (maps to `unitCount` approximation — note: this is buildings not units)
- `appraised_total` — (maps to `totalValue`)
- `condition_description` — (maps to `overallCondition`)
- `property_city` — city name for the result display
- `address_number` + `street_name` — used for filtering

**Socrata query pattern:**

```typescript
// src/lib/enrichment/adapters/new-haven.ts
const CT_CAMA_API = 'https://data.ct.gov/resource/pqrn-qghw.json';

const params = new URLSearchParams({
  '$where': `address_number='${primaryNumber}' AND street_name='${streetName}'`,
  '$limit': '10',
});

const response = await fetch(`${CT_CAMA_API}?${params}`);
const records: CtCamaRecord[] = await response.json();
```

**Field mapping to EnrichResult:**

| CT CAMA Field | EnrichResult Field | Notes |
|---------------|--------------------|-------|
| `owner` | `owner` | Direct |
| `owner` (via inferOwnerEntity) | `ownerEntityInferred` | Shared helper |
| `ayb` | `yearBuilt` | Parse as integer |
| `state_use_description` | `propertyType` | Raw description |
| `state_use_description` (via mapBuildingType-style) | `buildingType` | Normalized |
| `gross_area_of_primary_building` | `grossArea` | Parse as integer |
| `living_area` | `livingArea` | Parse as integer |
| `appraised_total` | `totalValue` | Parse as integer |
| `condition_description` | `overallCondition` | Direct |
| `address_number` + `street_name` | `address` | Concatenated |
| `property_city` | `city` | Direct |

**Important:** CT CAMA does not have a direct unit count field equivalent to Boston's `RES_UNITS`. `number_of_buildings` is available but counts structures, not apartments. Map it to `unitCount` as a best-effort approximation and accept `null` when not present. `residentialUnits` and `commercialUnits` will be `null` for CT CAMA results (BuildingsTable already handles `null` gracefully with `|| 'N/A'`).

### Pattern 5: Thin dispatcher in enrich.ts

```typescript
// src/pages/api/admin/buildings/[id]/enrich.ts (after refactor)
import type { APIContext } from 'astro';
import { getDB } from '../../../../../lib/db';
import { selectAdapter } from '../../../../../lib/enrichment/dispatcher';

export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403, headers: { 'Content-Type': 'application/json' }
    });
  }

  const buildingId = context.params.id;
  if (!buildingId) {
    return new Response(JSON.stringify({ error: 'Building ID required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getDB((context.locals as any).runtime);
  const building = await db.prepare('SELECT * FROM buildings WHERE id = ?')
    .bind(buildingId)
    .first<{ id: string; address: string; city: string; state: string; zip_code: string }>();

  if (!building) {
    return new Response(JSON.stringify({ error: 'Building not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const adapter = selectAdapter(building.city);
    const result = await adapter.enrich(building);
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Enrichment error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to query enrichment database',
      details: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

### Anti-Patterns to Avoid

- **City string comparison without normalization:** `building.city === 'Boston'` breaks for `boston`, `BOSTON`, `Boston, MA`. Always `.trim().toLowerCase()` before lookup.
- **Putting API logic in the dispatcher:** Dispatcher must only return adapter instances — no fetch calls, no business logic.
- **Partial interface implementation:** TypeScript won't catch missing optional methods at runtime in Cloudflare Workers. Keep the interface simple — one required `enrich()` method.
- **Hardcoding "Boston Assessing Results" in BuildingsTable:** The UI currently hardcodes this label (line 719). It should be updated to show "Auto-Research Results" or use the source field if added to the response. (Low priority — add `source` field to `EnrichResponse` optionally.)

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CT CAMA address search | Custom geocoding or fuzzy match | Socrata `$where` filter on `address_number` + `street_name` | The dataset has structured address fields; exact filter is sufficient for admin lookup |
| Owner entity classification | Custom NLP or regex expansion | Existing `inferOwnerEntity()` shared helper | Already handles LLC, trust, corp, partnership, REIT — move to shared module, reuse in both adapters |
| HTTP client | axios or node-fetch | Native `fetch` | Cloudflare Workers runtime provides fetch natively |
| City normalization | Complex canonicalization library | `.trim().toLowerCase()` lookup table | All cities stored in D1 come from user input via Google Places; casing may vary but the set is small and known |

---

## Common Pitfalls

### Pitfall 1: CT CAMA Street Name Format Mismatch

**What goes wrong:** Boston address `"110 Daisy Hill Cond"` gets stored in D1 as `"110 Daisy Hill Cond"`, but CT CAMA `street_name` field stores `"DAISY HILL COND"` (all caps). Filtering on exact case will return zero results.

**Why it happens:** The CT CAMA dataset uses all-caps street names (confirmed from live API sample). Building addresses in D1 may be mixed case from Google Places autocomplete.

**How to avoid:** Normalize both sides before the Socrata `$where` query — uppercase the building address's parsed street name before sending to CT CAMA, matching their convention. `normalizeStreetName()` from the existing `helpers.ts` already does this (`.toUpperCase()`).

**Warning signs:** Zero results for addresses you know exist in New Haven.

### Pitfall 2: City Column Null or Unexpected Values

**What goes wrong:** `building.city` is null for buildings created before city was required, or contains values like `"New Haven, CT"` instead of `"New Haven"`.

**Why it happens:** D1 allows null, and Google Places sometimes includes state in the city field.

**How to avoid:** The dispatcher already handles null → NullAdapter. For the string, strip trailing `, XX` patterns before lookup: `city.replace(/,\s*[A-Z]{2}$/, '').trim().toLowerCase()`.

**Warning signs:** Buildings in New Haven being routed to NullAdapter incorrectly.

### Pitfall 3: Socrata $where Injection

**What goes wrong:** Building address with an apostrophe (e.g., `"O'Brien"`) breaks the `$where` filter string and causes a 400 or incorrect query.

**Why it happens:** Socrata `$where` uses SoQL string literals delimited by single quotes. An unescaped apostrophe terminates the string.

**How to avoid:** Escape single quotes by doubling them in the value: `value.replace(/'/g, "''")` before interpolating into the `$where` clause. Alternatively use `$q` for full-text search as the broad fallback (same pattern as Boston's broad search).

**Warning signs:** 400 error from `data.ct.gov` for addresses with apostrophes.

### Pitfall 4: BuildingsTable UI Renders Boston-Only Label

**What goes wrong:** The UI hardcodes `"Boston Assessing Results"` as the section header (BuildingsTable.tsx line 719). New Haven results will display under a misleading label.

**Why it happens:** The label was written when only Boston was supported.

**How to avoid:** Update the results section header. Either use a generic "Auto-Research Results" label, or include a `source` field in `EnrichResponse` (e.g., `source: 'Boston Assessing'` or `source: 'CT CAMA'`) and use it in the UI.

**Warning signs:** New Haven enrichment data appearing under "Boston Assessing Results" header.

### Pitfall 5: CT CAMA Returns Array Not Object

**What goes wrong:** Socrata REST API returns a JSON array `[{...}, {...}]`, not a CKAN-style `{result: {records: [...]}}` envelope. Treating it as CKAN format will fail silently with undefined.

**Why it happens:** Different API conventions — Boston uses CKAN, New Haven uses Socrata.

**How to avoid:** CT CAMA response is directly `const records: CtCamaRecord[] = await response.json()`. No `.result.records` unwrapping needed.

**Warning signs:** `undefined` or empty results when the API is returning data.

---

## Code Examples

### CT CAMA Exact Address Query

```typescript
// Source: live API test 2026-03-21, data.ct.gov resource pqrn-qghw
const streetName = normalizeStreetName(parsed.street); // returns UPPER CASE
const primaryNumber = parsed.number.replace(/[-A-Z].*/i, '');

const params = new URLSearchParams({
  '$where': `address_number='${primaryNumber}' AND upper(street_name)='${streetName.replace(/'/g, "''")}'`,
  '$limit': '10',
});

const response = await fetch(`https://data.ct.gov/resource/pqrn-qghw.json?${params}`);
if (!response.ok) throw new Error(`CT CAMA API returned ${response.status}`);
const records: CtCamaRecord[] = await response.json();
```

### CT CAMA Broad Fallback (full-text search)

```typescript
// Socrata $q parameter for full-text search — equivalent to Boston's broad search
const broadParams = new URLSearchParams({
  '$q': `${primaryNumber} ${streetName}`,
  '$where': `property_city='NEW HAVEN'`,  // scope to city
  '$limit': '10',
});
```

### CtCamaRecord Interface

```typescript
interface CtCamaRecord {
  address_number: string;
  street_name: string;
  property_city: string;
  owner: string;
  ayb: string;              // actual year built
  state_use_description: string;
  gross_area_of_primary_building: string;
  living_area: string;
  number_of_buildings: string;
  appraised_total: string;
  condition_description?: string;
  zone?: string;
  total_rooms?: string;
  number_of_bedroom?: string;
}
```

### Shared helpers.ts (extracted from current enrich.ts)

```typescript
// src/lib/enrichment/helpers.ts
// Move these functions verbatim from enrich.ts:
// - inferOwnerEntity(ownerName: string): string | null
// - parseStreetAddress(address: string): { number: string; street: string } | null
// - normalizeStreetName(street: string): string

// mapBuildingType stays in boston.ts (Boston-specific LU_DESC codes)
// New Haven will have its own state_use_description mapper
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic enrich.ts with Boston only | Adapter pattern with dispatcher | Phase 12 | Future cities added without touching existing code |
| Hardcoded Boston resource ID in endpoint | Resource IDs scoped to adapter files | Phase 12 | Cleaner separation of concerns |

**Deprecated/outdated:**
- Monolithic `enrich.ts` body: all city-specific logic moves to adapters; only dispatcher shell remains.

---

## Open Questions

1. **Does "New Haven" match exactly what's in the `city` column for New Haven buildings?**
   - What we know: D1 `city` column stores values from Google Places API input. Buildings created via the review form inherit the city from address autocomplete.
   - What's unclear: Whether Google Places returns `"New Haven"` or `"New Haven, CT"` or other variants.
   - Recommendation: Add city stripping logic (`city.replace(/,\s*[A-Z]{2}$/, '').trim().toLowerCase()`) in the dispatcher regardless. Safe and defensive.

2. **Does CT CAMA `property_city` filter reliably scope to New Haven?**
   - What we know: The Socrata dataset is statewide CT CAMA. The `property_city` field for New Haven records confirmed as `"New Haven"` (verified from live query returning New Haven records).
   - What's unclear: Whether filtering by `property_city='NEW HAVEN'` in the broad fallback is necessary, or whether address_number+street_name uniquely identifies properties statewide.
   - Recommendation: Include `property_city` filter in broad fallback to avoid false matches from identically-numbered streets in other CT cities.

3. **Should Cambridge route to the Boston adapter?**
   - What we know: Cambridge has its own assessing database; Boston Assessing API is specifically for City of Boston parcels.
   - What's unclear: Whether Cambridge records appear in Boston's CKAN dataset.
   - Recommendation: Do not route Cambridge to BostonAdapter. Leave Cambridge as NullAdapter unless verified. Add a comment in the dispatcher map noting this.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via `npm test`) |
| Config file | None detected — inferred from package.json scripts |
| Quick run command | `npm test -- enrichment` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENRICH-01 | `selectAdapter('boston')` returns BostonAdapter instance | unit | `npm test -- enrichment` | Wave 0 |
| ENRICH-01 | `selectAdapter('new haven')` returns NewHavenAdapter instance | unit | `npm test -- enrichment` | Wave 0 |
| ENRICH-01 | All adapters satisfy CityAdapter interface (TypeScript compile) | build | `npm run build` | Existing |
| ENRICH-02 | BostonAdapter returns same shape as current enrich.ts for a known address | unit (mocked fetch) | `npm test -- enrichment` | Wave 0 |
| ENRICH-03 | NewHavenAdapter parses CT CAMA records into EnrichResult shape | unit (mocked fetch) | `npm test -- enrichment` | Wave 0 |
| ENRICH-04 | NullAdapter returns `unsupported: true`, empty `results[]` | unit | `npm test -- enrichment` | Wave 0 |
| FIX-02 | `selectAdapter(null)` returns NullAdapter (not BostonAdapter) | unit | `npm test -- enrichment` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- enrichment`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/enrichment.test.ts` — covers all adapter unit tests above
- [ ] Mocked fetch responses for Boston API and CT CAMA in test fixtures

---

## Sources

### Primary (HIGH confidence)
- Live API query: `https://data.ct.gov/resource/pqrn-qghw.json?$where=property_city='New Haven'&$limit=2` — confirmed field names, data format, no-auth access
- Live API query: `https://data.ct.gov/resource/pqrn-qghw.json?$limit=2` — full field list confirmed
- Direct code read: `src/pages/api/admin/buildings/[id]/enrich.ts` — all 212 lines, all helper function signatures
- Direct code read: `src/components/admin/BuildingsTable.tsx` — full `enrichBuilding`, `applyEnrichment`, and results display logic

### Secondary (MEDIUM confidence)
- Socrata REST API documentation pattern: inferred from live query behavior — `$where`, `$limit`, `$q` parameters all confirmed working
- CKAN datastore_search pattern: already in production use, behavior confirmed

### Tertiary (LOW confidence)
- Cambridge/Boston Assessing API overlap: not verified — flagged as open question

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all APIs confirmed live
- Architecture: HIGH — adapter pattern is straightforward TypeScript, all interface shapes derived from existing code
- CT CAMA field mapping: HIGH — confirmed from live API response
- Pitfalls: HIGH — derived from direct code inspection and live API testing

**Research date:** 2026-03-21
**Valid until:** 2026-06-21 (CT CAMA dataset stable; Boston Assessing resource ID stable)
