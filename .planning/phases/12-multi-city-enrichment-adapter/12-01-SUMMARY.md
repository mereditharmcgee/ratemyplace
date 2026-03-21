---
phase: 12
plan: 01
subsystem: enrichment
tags: [adapter-pattern, refactor, typescript, boston-assessing, city-routing]
dependency_graph:
  requires: []
  provides: [enrichment-adapter-interface, boston-adapter, null-adapter, enrichment-dispatcher]
  affects: [src/pages/api/admin/buildings/[id]/enrich.ts]
tech_stack:
  added: []
  patterns: [adapter-pattern, dispatcher-pattern, tdd]
key_files:
  created:
    - src/lib/enrichment/types.ts
    - src/lib/enrichment/helpers.ts
    - src/lib/enrichment/dispatcher.ts
    - src/lib/enrichment/adapters/boston.ts
    - src/lib/enrichment/adapters/null.ts
    - src/lib/__tests__/enrichment.test.ts
  modified:
    - src/pages/api/admin/buildings/[id]/enrich.ts
decisions:
  - "Dispatcher strips trailing state abbreviation from city (e.g. 'Boston, MA' -> 'boston') before map lookup"
  - "Cambridge is NOT routed to BostonAdapter — Boston Assessing is City of Boston only; Cambridge stays NullAdapter until verified"
  - "mapBuildingType() stays in boston.ts (Boston LU_DESC codes are city-specific); not shared"
  - "BostonAdapter.enrich() returns source: 'Boston Assessing' for future UI labeling"
metrics:
  duration_minutes: 3
  completed_date: "2026-03-21"
  tasks_completed: 2
  files_changed: 7
---

# Phase 12 Plan 01: Multi-City Enrichment Adapter — Foundation Summary

**One-liner:** CityAdapter interface + BostonAdapter extraction + NullAdapter + thin dispatcher endpoint replacing 212-line monolithic enrich.ts.

## What Was Built

The 212-line monolithic `enrich.ts` endpoint was refactored into a dispatched adapter system. The endpoint is now a 45-line thin dispatcher that reads the building's `city` column, selects the appropriate adapter via `selectAdapter()`, and delegates all city-specific logic.

**New files:**
- `src/lib/enrichment/types.ts` — `CityAdapter` interface, `EnrichResult`, `EnrichResponse`, `BuildingRecord` types
- `src/lib/enrichment/helpers.ts` — Shared utilities extracted verbatim: `inferOwnerEntity`, `parseStreetAddress`, `normalizeStreetName`
- `src/lib/enrichment/adapters/boston.ts` — `BostonAdapter` with all Boston Assessing API logic (CKAN queries, exact match, fuzzy fallback, field mapping)
- `src/lib/enrichment/adapters/null.ts` — `NullAdapter` returning `unsupported: true` with empty results
- `src/lib/enrichment/dispatcher.ts` — `selectAdapter(city)` with case-insensitive normalization and state suffix stripping
- `src/lib/__tests__/enrichment.test.ts` — 18 unit tests covering dispatcher routing, NullAdapter, all three helpers, and BostonAdapter (field mapping + fuzzy fallback)

**Modified:**
- `src/pages/api/admin/buildings/[id]/enrich.ts` — replaced with 45-line thin dispatcher; no city-specific code remains

## Verification

- `npm test -- enrichment`: 18/18 tests pass
- `npm run build`: clean (no TypeScript errors)
- `npm test`: 207/207 tests pass (no regressions)

## Deviations from Plan

None — plan executed exactly as written.

The CORRECTION note in Task 1 (do not import NewHavenAdapter yet) was followed: the dispatcher only registers `'boston'` in the CITY_ADAPTERS map. Plan 02 will add the `'new haven'` entry when NewHavenAdapter is created.

## Decisions Made

1. **Cambridge not routed to BostonAdapter** — Research confirmed Boston Assessing API is City of Boston parcels only. Cambridge stays NullAdapter until verified.
2. **`mapBuildingType()` stays in boston.ts** — LU_DESC codes are Boston-specific. New Haven will have its own description normalizer.
3. **`source: 'Boston Assessing'` added to all BostonAdapter responses** — Enables future UI to show per-source labeling without breaking existing consumers.
4. **State suffix stripping in dispatcher** — `city.replace(/,\s*[A-Z]{2}$/, '')` handles "Boston, MA" style values from Google Places before map lookup.

## Self-Check: PASSED

Files exist:
- src/lib/enrichment/types.ts: FOUND
- src/lib/enrichment/helpers.ts: FOUND
- src/lib/enrichment/dispatcher.ts: FOUND
- src/lib/enrichment/adapters/boston.ts: FOUND
- src/lib/enrichment/adapters/null.ts: FOUND
- src/lib/__tests__/enrichment.test.ts: FOUND

Commits:
- 26fe4fe: test(12-01): add failing tests for enrichment adapter system
- 987fe00: feat(12-01): enrichment adapter system — types, helpers, dispatcher, NullAdapter, BostonAdapter
- cf2668b: feat(12-01): replace monolithic enrich.ts with thin dispatcher
