# Live-review fixes (2026-10-05) — implementation plan

> **For agentic workers:** executed as three parallel branches (A, B, C) in separate worktrees, each by an Opus implementer with a spec review and a code-quality review, then merged in order A, B, C. Shared docs (`AGENTS.md`, `src/lib/AGENTS.md`, `.planning/`) are edited once at the end, not per branch.

**Source:** owner's live review of ratemyplace.org on 2026-10-05 (seven items) plus three findings from the pre-work audit: the breaker had paused the fill since 2026-09-17 after one transient fixture failure; the admin "Cleanup Empty Buildings" action targets every zero-review building including the 38,208 seeded parcels; editing a building in admin nulls its `admin_notes` and `owner_*` fields.

**Code map:** scratchpad `oct-fixes-code-map.md` (file paths, line numbers, SQL for every item). Conventions: `AGENTS.md`, `src/lib/AGENTS.md`, `src/components/AGENTS.md`. TDD; no new `any`; bound SQL; `npm test && npm run check && npm run build` before each PR.

## Branch A — queue, breaker, data (`fix/oct-queue`)

A1. **Breaker auto-resume for fixture-caused pauses.** New setting `records_breaker_pause_cause` (`'fixture' | 'errors'`, written when the breaker trips; cleared on resume). In `plan`, when the fill is paused AND the cause is `fixture` AND today's fixture passed AND no source is over the error threshold, set `records_fill_paused = '0'`, clear the cause, log `records_fill_resumed`, and send one "fill resumed" email. A human pause (no cause recorded) and an error-rate pause still require a manual resume. Tests in `recordsScheduler.test.ts`. Runbook section updated.
A2. **Fill prefers Allston–Brighton.** `FILL_PRIORITY_ZIPS = ['02134','02135']` as a second ORDER BY term in `topUpFill` after `has_any_pull`. Test in `recordsQueuePlanner.test.ts`.
A3. **Backfill reviewed buildings.** Admin endpoint `POST /api/admin/records/queue/backfill-reviewed` that enqueues a `follower` row (via `enqueue`) for every Boston building with an approved review and no deeper pull and no pending row; returns `{ data: { enqueued, skipped } }`; audited. Runbook: run once after deploy. (Operator runs it; the response is the receipt.)
A4. **Data fixes, one-off SQL in the PR description, applied by hand after merge:** unlink 333 Humphrey St (New Haven) from landlord "AA Management" (set `buildings.landlord_id = NULL` for that row; the review's free-text `landlord_name` stays); `UPDATE buildings SET neighborhood='Brighton' WHERE neighborhood='Aberdeen'`; delete the unlocked, unattempted pending `fill` rows so the ZIP preference applies today (then the 06:00 planner re-tops).

## Branch B — admin (`fix/oct-admin`)

B1. **Server-side building filters.** `GET /api/admin/buildings` accepts `landlord`, `q` (address/city/zip LIKE), `filter=orphans`; filtered `total`; `ORDER BY created_at DESC, id DESC`; list SELECT adds `admin_notes, owner_name, owner_entity, owner_website` (fixes the edit-wipe). `BuildingsTable` reads `?landlord=` on mount, debounced server search, an "Outside Boston / New Haven, no reviews" toggle, filter chip with clear, footer copy. Route tests.
B2. **Scoped cleanup.** `cleanup.ts` GET/POST use the orphan predicate only (`source='user'`, no reviews of any status, not saved, city not a Boston locality or New Haven); server refuses seeded rows; `DELETE … WHERE id IN (SELECT …)`; audit `buildings_bulk_deleted`; button copy says what it deletes. Route tests prove a seeded row and a reviewed row survive.
B3. **Landlord matching by geography.** `GET /api/admin/landlords` returns `cities`, `states`; admin reviews list returns `building_state`; `ReviewsTable.startLinking` preselects only when exactly one same-name landlord shares the building's state and city (Boston localities count as Boston), otherwise defaults to create with a visible warning naming the same-name landlords elsewhere; dropdown labels carry cities. `POST`/`PATCH` landlords accept `admin_notes`; a kept-separate decision writes a note; `LandlordsTable` shows notes and honours `?id=`. Test for `startLinking` decision logic (extract it to a pure function in `src/lib/admin/landlordMatch.ts`).

## Branch C — public UI (`fix/oct-public`)

C1. **Neighborhood aliases.** `BOSTON_SUB_AREAS` in `src/lib/bostonLocalities.ts` (Aberdeen→Brighton plus the common Google sub-areas listed in the code map); applied in `displayLocality`, in `titleCaseNeighborhood`, and in `places/details.ts`. Do not touch `BOSTON_LOCALITY_NAMES`. Tests: `locality.test.ts`; update the Aberdeen expectations in `recordsBuildingMeta.test.ts`.
C2. **Map fits its markers.** `BuildingMap.tsx`: fit bounds once on the first non-empty load, restricted to markers inside the Boston box when any exist, zoom clamped to 15, single marker → center at 15; geolocation pan only when the user is inside the fitted bounds; stable default center constant. No unit test exists; verify on production after deploy (preview has no Maps key).
C3. **Collapsed error-report form.** `#report-record` becomes a `<details>` with the heading in its `<summary>`; `RecordCorrectionForm client:visible`; inline script opens it from the header link, a `#report-record` URL, or hashchange. Render test asserts the details is closed by default; copy scan stays green (no banned words in comments).

## Merge order and after
A, then B, then C (rebase B and C onto main after each merge). Then one docs commit: `AGENTS.md` traps (cleanup scope; breaker auto-resume; building list filters), runbook, roadmap. Then the A4 one-off SQL and the backfill call, then a production check of the map and the collapsed form.
