# Phase 12: Multi-City Enrichment Adapter - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Refactor the admin auto-research feature to route to the correct city data source based on building location. Boston behavior is unchanged, New Haven enrichment works via CT CAMA, unsupported cities get a clear message, and the architecture uses a CityAdapter interface for future cities.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
User elected to let Claude handle all implementation decisions for this phase. It is a backend refactor with clear requirements (FIX-02, ENRICH-01 through ENRICH-04) and well-defined success criteria. Key decisions Claude should make:

- CityAdapter interface design (method signatures, return types)
- How to extract Boston logic from the monolithic 212-line enrich.ts into an adapter
- New Haven CT CAMA field mapping and display format (aim for parity with Boston where fields overlap)
- City detection logic using the `city` column in the buildings table
- Unsupported city message text and response format
- File organization (adapter files, dispatcher location)
- Whether helper functions (inferOwnerEntity, mapBuildingType, parseStreetAddress) stay shared or move into adapters

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/pages/api/admin/buildings/[id]/enrich.ts`: 212-line monolithic endpoint with Boston Assessing API logic, address parsing, owner entity inference, building type mapping, and result formatting
- `inferOwnerEntity()`: Owner name → entity type (LLC, trust, corporation, etc.) — reusable across cities
- `mapBuildingType()`: Property description → normalized type — Boston-specific but pattern is reusable
- `parseStreetAddress()` / `normalizeStreetName()`: Address parsing — reusable across cities
- `formatResult()`: Boston-specific field mapping to normalized output

### Established Patterns
- Admin auth check: `context.locals.user?.isAdmin` guard at top of handler
- Building lookup: `SELECT * FROM buildings WHERE id = ?` with city column available
- API response: always JSON with `results[]` array, `address`, `searchedFor` fields
- Error handling: structured JSON errors with `error` and `details` fields
- Fallback search: exact match first, then broad/fuzzy search

### Integration Points
- `src/pages/api/admin/buildings/[id]/enrich.ts`: Replace/refactor this endpoint
- `src/components/admin/BuildingsTable.tsx`: Calls the enrich endpoint — display logic may need updating if response shape changes
- Boston Assessing API: `data.boston.gov` CKAN datastore_search, resource `ee73430d-96c0-423e-ad21-c4cfb54c8961`
- CT CAMA API: `data.ct.gov` resource `pqrn-qghw` (Socrata, no API key needed) — live-tested and confirmed working

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The key constraint is that Boston behavior must remain identical from the admin's perspective.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-multi-city-enrichment-adapter*
*Context gathered: 2026-03-21*
