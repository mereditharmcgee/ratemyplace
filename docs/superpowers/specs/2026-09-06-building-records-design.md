# Building Records Design

**Date:** 2026-09-06
**Milestone:** v1.7.0 "Public Record" (proposed; not yet in `.planning/`)
**Status:** Design approved in conversation 2026-09-06; spec pending owner review
**Source brief:** "Building records as a RateMyPlace feature" (owner handoff, 2026-09-06, from the Lanark Road investigation)
**Companion method:** `investigate-a-landlord` skill (human method; this spec covers the data)

## Purpose

RateMyPlace has 53 approved reviews across 91 buildings. 40 buildings have no review, and 25 of 27 landlords sit below the three-review threshold, so a renter who searches their address usually finds nothing and leaves.

This milestone adds a second layer to every building page: **public records**, pulled from City of Boston and Commonwealth of Massachusetts open data, shown as recorded, with every value cited and dated. Records are useful at zero reviews, and the person reading them is usually the person who lives there. That is the intended loop: read the record, then rate the place.

The division of labor is fixed and is the load-bearing product decision of this design:

> **Reviews are the judgment layer. The records panel has no opinion.**

Every rendered value in the panel is a field from a primary record or a count of such records. No ratios, no comparisons, no grades, no color coding, no inference.

## Decisions made during design

| # | Decision | Alternative rejected |
|---|---|---|
| 1 | Records panel with no derived indicator | A "transparency score" per building or landlord. Rejected because a score is a compression of facts into a judgment, would require methodology publication, and creates the juxtaposition problem the brief warns about |
| 2 | Sub-projects ship in order **A, C, B, D** (see Scope) | A and B together first. C (Boston coverage) changes the reader funnel immediately and produces the attention that justifies B's scraper fragility |
| 3 | Admin-triggered pulls in A, stored with provenance, behind a Worker-callable boundary | Lazy pull on public page view (rejected permanently: amplification vector, ties public latency to a third-party API). Scheduled Worker in A (deferred to C: no value at 91 buildings; adapters must be human-checked against the fixture before anything overwrites unattended) |
| 4 | Public correction form open to anyone; resolution is a re-pull, never an edit | Owner-only through the dispute channel (wrong key, adversarial framing). Contact-form only (no queue, no audit trail) |
| 5 | Permits shown as plain facts; peer comparison and neighborhood indicator both arrive in D | Peer zero-permit count in A. Rejected so D is designed once with both the count and the indicator in view, on the saved-query mechanism |
| 6 | Storage: insert-only `record_pulls` plus generic `building_records` with typed JSON payloads | One generic table with provenance per row (duplication). Typed table per source (a migration per new source on a database where migrations 0025 to 0027 already bit) |
| 7 | `parcel_id` added to `buildings`; the unused `public_info` JSON column is not used for records | Reusing `public_info` |
| 8 | Owner-of-record and LLC manager names are shown. Individuals' home addresses are never shown | None |

## Current source anchors

| Area | Current source evidence |
|---|---|
| Enrichment | `src/lib/enrichment/` has a city dispatcher (`dispatcher.ts`), a Boston adapter querying FY2026 assessor resource `ee73430d-96c0-423e-ad21-c4cfb54c8961` via `datastore_search` with exact `ST_NUM`/`ST_NAME` filters, and a New Haven adapter. `GET /api/admin/buildings/[id]/enrich` is admin-only, returns results for the admin to read, and stores nothing. Address helpers (`parseStreetAddress`, `normalizeStreetName`, `inferOwnerEntity`) live in `helpers.ts` |
| Buildings schema | `buildings` has `year_built`, `unit_count`, `building_type`, `owner_name`, `owner_entity`, `owner_website`, `admin_notes`, and `public_info` (JSON, read and written by nothing in `src`). No `parcel_id`, no SAM id |
| Building page | `src/pages/building/[slug].astro` renders a "Building details" definition list (type, year built, unit count) above the reviews section and a `ScoreCard` |
| Landlord page | `src/pages/landlord/[slug].astro` already has a below-threshold state for withheld scores |
| Public POST reference | `src/pages/api/disputes.ts`: content-type guard, rate limit, `request.json()`, Turnstile, validation, logic, in that order. Rate limiting is fail-closed |
| Scheduling | No Cron Trigger or scheduled Worker exists. v1.6 Phase 22 plans one for health counters and alert delivery |
| Migrations | Latest is `0028_audit_expand_action_types.sql`. Production 0025 to 0027 were applied via the dashboard console, not wrangler; never blindly `migrations apply --remote` |
| Tests | Vitest, 389 unit tests in `src/lib/__tests__/`, offline. Playwright E2E via `npm run e2e` |

## Scope

Four sub-projects, one milestone. **This spec fully designs A.** C, B, and D are scoped here so A's boundaries are drawn correctly, and each gets its own spec before implementation.

### A. Records foundation (this spec)

Parcel id on buildings, provenance tables, grade A Boston adapters (assessor, permits, ISD violations, code enforcement, 311, RentSmart), admin-triggered pull, the public records panel on the building page, and the correction path. Applies to buildings already in the database.

### C. Boston coverage (next)

Bulk seed of whole-building residential parcels from the assessor (FY2026 counts: A 3,116; R4 2,485; R3 13,343; R2 16,701; RC 2,956; CD 74,254 condo units), condo handling, tiered enrichment (assessor basics for every parcel; deeper pulls only for buildings with a review, a saved-building follower, or an admin trigger), the scheduled refresh Worker, the "rate this place" call to action on empty pages, and the tie-in to v1.6 Phase 29's sitemap. Requires updating `ops/growth/STRATEGY.md`, which currently defers reader acquisition, and the v1.6 roadmap line deferring "neighborhood content farms".

### B. Entity record (after C)

CorpWeb (`corp.sec.state.ma.us`) scraper with retries and a "needs manual verification" flag, admin verification UI, LLC manager names, resident agent, status, and organization date on the building page, and "other buildings with the same tax mailing address" on the landlord page. The brief is explicit: never label that list a portfolio, because a shared mailing address can be a management company or a lawyer's office. Entity records are new `building_records` kinds; the schema in this spec does not change.

### D. Neighborhood indicator (after A has shipped and a correction has been processed at least once)

A saved-query table for peer groups (same land-use code, same zip codes, similar gross area, expressed so the reader can see how the group was chosen), the zero-permit peer count, and one derived indicator such as permit activity relative to the peer group, stated as a fact ("fewer permits on record than N of M comparable buildings"), with the peer definition published on `/methodology`.

### Out of scope for the milestone

Courts (`masscourts.org`, reCAPTCHA-gated; the brief says a tenant-facing product must not display docket data automatically), registry of deeds (grade B/C; only after legal review), SBA/UCC, and all texture sources (Wayback, OCPF, review sites). New cities.

## Section 1: Schema (migration `0029_building_records.sql`)

### `buildings` additions

```sql
ALTER TABLE buildings ADD COLUMN parcel_id TEXT;   -- canonical 10-digit form, leading zero kept
ALTER TABLE buildings ADD COLUMN sam_id TEXT;      -- Boston SAM id, secondary key for the violations feed
CREATE INDEX idx_buildings_parcel_id ON buildings(parcel_id);
```

Existing rows are backfilled by the first pull, not by the migration; the assessor is where the parcel id comes from.

### `record_pulls` (insert-only; this is the provenance)

```sql
CREATE TABLE record_pulls (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  jurisdiction TEXT NOT NULL,              -- 'boston'
  source_id TEXT NOT NULL,                 -- CKAN resource id; later a CorpWeb identifier
  source_label TEXT NOT NULL,              -- human name, e.g. 'Approved Building Permits'
  query TEXT NOT NULL,                     -- exact filter JSON or SQL sent
  status TEXT NOT NULL CHECK (status IN ('ok','empty','error')),
  row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  triggered_by TEXT REFERENCES users(id),  -- admin user; NULL when the Worker runs it (C)
  correction_id TEXT,                      -- set when a correction caused this pull
  retrieved_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_record_pulls_building ON record_pulls(building_id, source_id, retrieved_at);
```

### `building_records`

```sql
CREATE TABLE building_records (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  pull_id TEXT NOT NULL REFERENCES record_pulls(id),
  kind TEXT NOT NULL,                      -- see Record kinds
  source_key TEXT NOT NULL,                -- permit number, case id, fiscal year, etc.
  payload TEXT NOT NULL,                   -- JSON, validated on read against the kind's type
  source_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (building_id, kind, source_key)
);
CREATE INDEX idx_building_records_building_kind ON building_records(building_id, kind);
```

A successful pull for a source **replaces** the rows that source owns, inside one batch, so the panel reflects the latest pull and the superseded pull's metadata survives in `record_pulls`. Each `RecordSource` declares its replace scope: for permits, violations, enforcement, 311, and RentSmart that is every row of the source's kinds for the building; for the assessor, each fiscal year is its own source and owns only the `assessment` row whose `source_key` is that fiscal year, so pulling FY2026 never removes FY2021. A pull with status `error` writes no record rows and leaves the prior rows in place.

### `record_corrections`

```sql
CREATE TABLE record_corrections (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  record_kind TEXT,                        -- NULL means "the whole panel"
  claim TEXT NOT NULL,                     -- 20..1000 chars, validated at the endpoint
  contact_email TEXT,                      -- optional; the only thing stored about the filer
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolution TEXT CHECK (resolution IN ('repulled_unchanged','repulled_updated','source_mismatch_noted')),
  resolution_notes TEXT,                   -- renders publicly only for source_mismatch_noted
  resolved_by TEXT REFERENCES users(id),
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_record_corrections_status ON record_corrections(status, created_at);
```

No table stores an IP. The correction endpoint's rate limit uses the existing `rate_limits` mechanism under the documented exception in root `AGENTS.md`.

### Record kinds and payloads (`src/lib/records/types.ts`)

Discriminated union on `kind`. A payload that fails validation on read renders that section as "record unavailable" and is logged with `logError`; it never throws into the page.

| kind | source_key | payload fields (all as recorded) |
|---|---|---|
| `assessment` | fiscal year (`FY2026`) | parcel id, owner, mailing addressee, mailing street/city/state/zip, land use code, year built, year remodel, gross area, living area, residential units, commercial units, total/land/building value, `condominium` flag |
| `permit` | `permitnumber` | work type, permit type, description, comments, applicant, declared valuation, total fees, issued date, expiration date, status, occupancy type |
| `violation` | `case_no` | status, code, value, description, violation address fields, status datetime |
| `enforcement_ticket` | ticket/case id | date, description, status, contact address |
| `service_request` | `case_enquiry_id` | open/closed dates, case status, closure reason, title, subject, reason, type, source, classification (`housing` or `other`) |
| `rentsmart` | address key | the roll-up fields as returned |

`enrichment/types.ts` and `records/types.ts` stay separate in A. Converging them is a follow-up once records are trusted.

## Section 2: Pull pipeline and adapters (`src/lib/records/`)

### Module shape

| File | Responsibility |
|---|---|
| `types.ts` | Record kinds, payload types, `RecordSource` interface, `PullSummary` |
| `identity.ts` | Builds a `BuildingIdentity` from a `buildings` row: parsed number(s) and street, every address form to try, parcel id in both forms, SAM id, zip |
| `jurisdictions.ts` | Maps city to `RecordSource[]`. Boston has six datasets, expanded to eleven sources because each assessor fiscal year is its own source. Everything else (including New Haven) returns `[]`, and the panel renders "records are not available for this city yet" |
| `sources/boston/assessor.ts` | One `RecordSource` per fiscal year (FY2026 plus five prior, six years total), sharing a per-year column map; the current-year source resolves parcel and SAM id |
| `sources/boston/permits.ts` | Approved Building Permits `6ddcd912-32a0-43df-9908-63574f8c7e77` |
| `sources/boston/violations.ts` | ISD violations `800a2663-1d6a-46e7-9356-bedb70f5332c` |
| `sources/boston/enforcement.ts` | Public Works code enforcement `90ed3816-5e70-443c-803d-9a71f44470be` |
| `sources/boston/serviceRequests.ts` | 311 yearly resources 2011 to 2026 plus new-system `254adca6-64ab-4c5c-9fc0-a6da622be185`; classification list |
| `sources/boston/rentsmart.ts` | RentSmart `dc615ff7-2ff3-416a-922b-f0f334f085d0` |
| `pull.ts` | `pullBuildingRecords(db, building, { triggeredBy, correctionId })`. **Worker-callable: knows nothing about HTTP.** |
| `query.ts` | `getBuildingRecords(db, buildingId)`: validated, grouped by kind, latest pull metadata per source |
| `display.ts` | Pure functions for display rules (owner-entity gate, condo gate, counts, date ranges) so they are unit-testable without rendering |

### `RecordSource` contract

Input: `BuildingIdentity`. Output: `{ sourceId, sourceLabel, query, rows: { kind, sourceKey, payload, sourceUrl? }[] }`, or a typed `SourceError`. Every source: 10-second fetch timeout, 500-row cap per source, deduplication on `sourceKey` before return.

### Pull semantics

1. Resolve identity. If `parcel_id` is missing, run the assessor first and write `parcel_id` and `sam_id` to `buildings`.
2. For each source in the jurisdiction list, in order: run it, insert one `record_pulls` row, and if status is `ok` or `empty`, replace that building's rows for that source's kinds in one `db.batch`. A source that throws records `error`, keeps prior rows, and does not stop the remaining sources.
3. Return a `PullSummary` (per-source status and row counts) for the admin UI.

### Identity handling

- **Parcel resolution:** assessor by exact `ST_NUM` and normalized `ST_NAME` using the existing helpers. Ranged addresses (`23-27`) try each number and the hyphenated form. Street names are matched exactly, never prefix-matched.
- **Condo detection:** multiple assessor rows with different parcel ids for one address means a condominium building. A stores no `parcel_id`, stores an `assessment` row with `condominium: true` and no owner fields, and the admin summary says why.
- **Parcel id forms:** stored as the 10-digit form with the leading zero. Permits and violations query both forms.
- **Permits:** by both parcel forms and every address form; deduplicated on permit number.
- **311:** each yearly resource queried per address form on `location`; deduplicated on `case_enquiry_id` across files. Classification into `housing` versus `other` is a published list of `reason` and `type` values in `serviceRequests.ts`, exported so the public page can link to it. The split is a fact about the list, not a judgment.
- **Assessment history:** the six most recent fiscal years, each a separate resource with a per-year column map. A year whose columns do not match its map records as `empty`, never guesses.

### Limits

Pages Functions allow 50 subrequests per invocation. A full Boston pull is about 26 fetches (6 assessor years, 1 permits, 1 violations, 1 enforcement, 16 for 311, 1 RentSmart). The 311 resource list is the number most likely to grow; if it pushes the total past 40, split 311 into its own admin action.

### Admin surface

- `POST /api/admin/buildings/[id]/records/pull`: admin check, calls `pullBuildingRecords`, writes an audit log entry (`records.pull`), returns the `PullSummary`.
- In `BuildingsTable.tsx`: a "Pull records" button per building showing the summary, and a "Pull all Boston" control that calls the endpoint one building at a time from the client with a progress indicator. No server-side loop.
- The existing "auto-research" enrich flow is untouched.

### Fixture

- **Offline:** recorded Boston responses for 23-27 Lanark Road in `src/lib/__tests__/helpers/records/`. `npm test` never touches the network.
- **Live, by hand:** `scripts/records-fixture-check.ts` hits Boston and diffs against the brief's expected values (parcel `2102098000`; owner Lanark Road LLC; mailing PO Box 35006; land use A; remodel 1980; FY2026 total value $6,720,200; zero permits under every query form; no ISD violations; two 2008 trash tickets with contact address 1505 Commonwealth Ave; 98 311 cases 2011 to 2026, four housing-related). Run before the first production pull and whenever Boston changes a schema. It is not part of CI.

## Section 3: Public records panel

### Placement

`src/components/BuildingRecords.astro`, rendered in `src/pages/building/[slug].astro` directly below "Building details". Server-rendered from D1 via `getBuildingRecords`. No React island, no client fetch. If a building has no `record_pulls` rows, the panel does not render. A Boston building that has been pulled but returned nothing shows the empty states below.

### Header

"Public records", one framing sentence (facts from City of Boston and Commonwealth records, shown as recorded, with no rating applied), the most recent `retrieved_at` across sources, and a "Report a record error" link to the correction form.

### Sections

Each section carries its own "as of" date and a "Source" link to the dataset page on data.boston.gov.

1. **Property.** Parcel id, owner of record, owner mailing address (gated, see rules), land use, year built, last remodel year, units, current assessed value with fiscal year, and a six-year value history table.
2. **Building permits.** Count, date range covered ("permits on record from September 2006"), total declared valuation with the caveat that it is the applicant's own estimate and a floor, then the list: date, type, description, status. Zero count renders: "No permitted work on record since 2006. This means no permits were filed, not that no maintenance was done."
3. **Violations.** ISD violations, open then closed: date, code, description, status. Empty: "No violations on record."
4. **Code enforcement.** Tickets: date, description, status. Empty: "No code enforcement tickets on record."
5. **311 requests.** Two counts, housing-related and other. Housing-related listed with date, type, and closure status. Others summarized as a count with a line explaining they are parking, trash, and streetlight requests at or near this address, and a link to the classification list.
6. **RentSmart.** Rendered only when the city's roll-up disagrees with the sections above: "The city's RentSmart summary reports X for this address." A cross-check, not a section.

A section whose latest pull is `error` and which has no prior rows renders "record unavailable" with the date of the failed attempt.

### Display rules (each enforced by a unit test where a test can enforce it)

- **Owner mailing address is shown only when the owner of record is an entity**, decided by `inferOwnerEntity`. An individual's mailing address is never rendered, even though the assessor publishes it, because it is usually their home.
- **Condominium buildings show no owner.** The Property section states that the building is divided into individually owned condominium units.
- **Banned words cannot appear in panel copy:** cash-out, extracted, cross-collateralized, deferred maintenance, pattern, evasive, delay. A test scans the component's static strings.
- **Every rendered value is a field from a record or a count of records.** No ratios, no comparisons, no color coding. Nothing from `scoring-colors.ts` appears in the panel.
- **Nothing in the panel links to a review or a score.** Visually a separate document from the review section and the score card.
- **The assessor's `OVERALL_COND` field is not displayed in A.** It is the city's characterization, not an observation; whether it belongs is an open question for D.

### Landlord and property-manager pages

No change in A. The "same tax mailing address" list is B.

## Section 4: Correction path

### Public form

"Report a record error" opens a React island (`client:load`, modeled on the dispute form) at `/building/[slug]#report-record`. Fields: section (select of the six kinds plus "the whole panel"), what you believe is wrong (required, 20 to 1,000 characters), optional email for the outcome. No name, no role. Tenants, owners, and neighbors file the same form.

### Endpoint: `POST /api/records/corrections`

Follows the disputes reference order exactly: content-type guard, rate limit (3 per hour per IP, fail-closed), `request.json()`, Turnstile, validation (building exists, kind in the allowed set or null, claim bounds, email format if present), insert. Returns `{ data: { id } }`. Stores nothing about the filer except the optional email.

### Admin queue

"Record corrections" tab in the admin panel listing pending items (building, kind, claim, age). Opening one shows the claim beside the current records for that kind and one action: **Re-pull from source**, which calls `pullBuildingRecords` with `correctionId` set and then shows a diff (rows added, removed, changed). The admin closes with one of:

| Resolution | Meaning | Public effect |
|---|---|---|
| `repulled_unchanged` | The primary source still says what the panel says | None |
| `repulled_updated` | The source changed; the panel now reflects it | Panel updated by the re-pull |
| `source_mismatch_noted` | The filer is right and the city's data is wrong | `resolution_notes` renders under that section: "A correction was filed on this record on [date]. The source has not updated." |

Every resolution writes an audit log entry (`records.correction.resolve`) carrying the correction id and pull id. If an email was given, the outcome goes out in general terms through `lib/email.ts` with `fireAndForget`.

### Deliberately absent

No "edit this value" anywhere. No way to hide a section on request. No owner verification, because the resolution does not depend on who asks. Source-mismatch notes are the only admin-authored text that can appear in the panel; they are dated and attributed to the site, not a person.

## Section 5: Testing, documentation, rollout

### Tests (offline)

- Per-source adapter tests on recorded responses, including the Lanark fixture end to end.
- Identity: ranged and hyphenated numbers, both parcel forms, exact street matching, condo detection.
- Pull semantics: one failing source leaves the other five written; re-pull replaces without duplicating on `source_key`; `record_pulls` is insert-only; `error` status preserves prior rows.
- Read validation: malformed payload renders "record unavailable"; the page still renders.
- Display rules: individual mailing address suppressed; condo owner suppressed; banned-word scan; no score colors.
- Corrections endpoint: guard order, rate limit, Turnstile, validation bounds; resolution writes an audit entry.
- Admin pull endpoint: 403 without admin; audit entry on success.

### Documentation changed in the same release

- `MASTER.md`: "Public records" under Built today, listing the six sources, display rules, and the correction process.
- `/privacy`: records are public government data shown as recorded; the correction form stores only an optional email.
- `/methodology`: one sentence stating records are not part of any score.
- `ops/growth/STRATEGY.md`: dated entry recording the deliberate inversion of the reader-first rule, effective when C ships.
- Root `AGENTS.md` traps: parcel leading-zero drift across datasets; 311 is 16 yearly resources plus a new-system resource with a different schema.
- `.planning/`: new milestone v1.7.0 "Public Record" with phases A, C, B, D; note in the v1.6 roadmap that Phase 29 (sitemap) and Phase 30 (pilot) both strengthen once C lands.

### Rollout

1. Feature branch off `main`.
2. Migration `0029_building_records.sql` applied via the dashboard console per `migrations/AGENTS.md`; ledger reconciled per the same guide.
3. Deploy. Production shows no panel until a building is pulled.
4. Pull Lanark first; compare to the brief by eye and with the live fixture script.
5. Pull the remaining Boston buildings from the admin table.
6. Run `/qa` on three buildings: Lanark, one condominium, one with an individual owner.
7. `npm run check`, `npm test`, `npm run build` clean before merge.

## Open questions

None blocking A. Carried to later specs:

- Whether `OVERALL_COND` belongs in the panel (D).
- Whether the existing `enrichment/` module folds into `records/` once C seeds from the assessor.
- Which land-use codes C seeds (three-plus family only, or including two-family).
