---
phase: 12-multi-city-enrichment-adapter
plan: "02"
subsystem: enrichment
tags: [new-haven, ct-cama, adapter, socrata, multi-city, admin-ui]
dependency_graph:
  requires: [12-01]
  provides: [ENRICH-03, ENRICH-04]
  affects: [src/components/admin/BuildingsTable.tsx]
tech_stack:
  added: []
  patterns:
    - Socrata SoQL $where clause with escaped single quotes
    - TDD RED-GREEN cycle for adapter implementation
key_files:
  created:
    - src/lib/enrichment/adapters/new-haven.ts
  modified:
    - src/lib/enrichment/dispatcher.ts
    - src/components/admin/BuildingsTable.tsx
    - src/lib/__tests__/enrichment.test.ts
decisions:
  - "NewHavenAdapter uses Socrata SoQL $where=address_number='N' AND upper(street_name)='S' as exact match, then $q broad fallback"
  - "Single quotes escaped by doubling in SoQL ($where clause) — SoQL standard for string literals"
  - "Unsupported-city block renders separately from empty-results block — cleaner conditional logic, avoids !unsupported guard in main path"
  - "Dynamic source label from enrichResult.source; fallback to 'Auto-Research Results' if missing"
metrics:
  duration: 3 minutes
  completed: 2026-03-21
  tasks_completed: 2
  files_changed: 4
  tests_added: 8
  tests_total: 215
---

# Phase 12 Plan 02: New Haven CT CAMA Adapter and Multi-City UI Summary

**One-liner:** CT CAMA Socrata adapter for New Haven with apostrophe-safe SoQL queries, broad fallback, and dynamic source label in admin BuildingsTable.

## What Was Built

### Task 1: NewHavenAdapter + Dispatcher Registration (TDD)

Implemented `src/lib/enrichment/adapters/new-haven.ts` with `NewHavenAdapter` class implementing `CityAdapter`:

- Queries `https://data.ct.gov/resource/pqrn-qghw.json` (Socrata raw JSON array, not CKAN envelope)
- Exact match: `$where=address_number='N' AND upper(street_name)='S'`
- Apostrophe escaping: replaces `'` with `''` in SoQL string literals (handles addresses like "12 O'Brien St")
- Broad fallback: `$q={number} {street}&$where=property_city='NEW HAVEN'` when exact returns empty
- Field mapping from CT CAMA: `ayb`→`yearBuilt`, `state_use_description`→`propertyType`/`buildingType`, `appraised_total`→`totalValue`, `condition_description`→`overallCondition`
- `mapCtBuildingType()` normalizes CT use descriptions to consistent building types
- Returns `source: 'CT CAMA'` in all responses

Updated `src/lib/enrichment/dispatcher.ts`:
- Added `NewHavenAdapter` import
- Added `'new haven': NewHavenAdapter` to `CITY_ADAPTERS` map
- `selectAdapter('New Haven, CT')` strips state suffix → matches `'new haven'`

### Task 2: BuildingsTable UI Multi-City Update

Updated `src/components/admin/BuildingsTable.tsx`:

1. **Dynamic source label:** Header now shows `{enrichResult.source} Results` (e.g., "CT CAMA Results", "Boston Assessing Results") with fallback to "Auto-Research Results"
2. **Unsupported city block:** New amber message box for `enrichResult.unsupported === true` — shows `enrichResult.message` ("No auto-research data available for this city.") with Dismiss button
3. **Source-aware empty results:** Empty-results message now reads "No matching records found in {source} for ..." instead of hardcoded Boston reference

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed apostrophe test to capture first fetch URL**
- **Found during:** Task 1 - GREEN phase
- **Issue:** Test captured last URL from `mockImplementation` which was the broad fallback URL (not containing escaped apostrophe). The exact-match URL (first call) correctly had `O''BRIEN` but was overwritten by the second call's URL.
- **Fix:** Changed test to collect all URLs into `capturedUrls[]` array and assert on `capturedUrls[0]`
- **Files modified:** `src/lib/__tests__/enrichment.test.ts`
- **Commit:** 9e377e6

## Test Results

- 8 new tests added for NewHavenAdapter and dispatcher routing
- 215 total tests pass (up from 207)
- Build clean (TypeScript + Astro)

## Commits

| Hash | Description |
|------|-------------|
| 7ba690e | test(12-02): add failing tests for NewHavenAdapter and dispatcher routing (RED) |
| 9e377e6 | feat(12-02): implement NewHavenAdapter and register in dispatcher (GREEN) |
| 1d10edf | feat(12-02): update BuildingsTable UI for multi-city enrichment display |

## Self-Check: PASSED

All created files confirmed on disk. All task commits verified in git log.
