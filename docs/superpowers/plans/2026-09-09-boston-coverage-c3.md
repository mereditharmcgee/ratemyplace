# Boston Coverage C3: Page States, Records Button, Search, Reviewer Dedupe, Sitemap, Docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the reader-facing half of sub-project C: a public "Get this building's city records" button that enqueues one pull, the seeded-page states, a follower enqueue on save, search that returns every Boston building (reviewed first), reviewer dedupe onto seeded pages, a chunked sitemap with `robots.txt`, seeded-page metadata, and the docs and strategy text that lift the reader-first deferral. Unpausing the city-wide fill is the owner's last step after this release and is documented, not coded.

**Architecture:** New logic is pure functions over the `RecordsDb` interface in `src/lib/records/` (coverage state, request validation, dedupe lookup) plus two small `src/lib/` modules (search SQL fragments, sitemap queries), all unit-tested on the `node:sqlite` D1 double. Routes stay thin and follow `src/pages/api/records/corrections.ts` exactly for guard order and envelopes. One new React island (`RecordsRequestButton`) copies `RecordCorrectionForm`'s Turnstile pattern. Every reader-visible string lands in `src/lib/records/display.ts` so the existing banned-words reflection covers it.

**Tech Stack:** TypeScript, Astro 5 SSR, React 18 islands, Vitest (+ Testing Library, `experimental_AstroContainer`), Cloudflare D1, Turnstile.

**Spec:** `docs/superpowers/specs/2026-09-08-boston-coverage-design.md` Sections 4, 5, 6, 7 (with the C1/C2 "as built" amendments). **Prerequisites already true:** migrations 0031 and 0032 are on production; the seed has run (38,208 seeded buildings, every one with an FY2026 assessor `record_pulls` row and an assessment record; the 14 matched user rows got the same); C2 is merged (`enqueue`, `records_queue`, `app_settings`, the Worker). Branch: `feat/boston-coverage-c3` from `main` at `7876b82`.

**Facts the plan relies on (verified 2026-09-09 against the worktree):**

- `enqueue(db, { buildingId, reason, now })` in `src/lib/records/queue.ts:100` returns `{ status: 'queued' | 'already_queued' }`. Against a pending `fill` row it deletes and re-inserts as `button` in one batch; against a pending `button`/`follower` row (same priority 0) it returns `already_queued`; it refuses to replace a live-leased row. `PRIORITY = { button: 0, follower: 0, refresh: 1, fill: 2 }`. `purgeFinished` never deletes `button` or `follower` rows.
- `QueueReason` and `TriggerReason` live in `src/lib/records/types.ts:174,181`. `RecordsDb` (`types.ts:199-217`) is satisfied by a real `D1Database`, so `getDB(context)` can be passed straight in.
- `DEEPER_SOURCE_IDS` is currently defined in `src/lib/records/scheduler.ts:62-64` from `sourcesForCity('Boston')` in `jurisdictions.ts`; it is the five non-assessor resource ids. "Has deeper records" in the spec means **any** `record_pulls` row for one of them, whatever its status (the `planRefresh` form), not the fill's `status IN ('ok','empty')` form.
- Every building with a `parcel_id` has at least the seed's assessor pull row, so `getBuildingRecords` returns a view and `BuildingRecords.astro` renders the panel (and the Turnstile script tag, gated on `view`, lines 256-261). The button therefore lives **inside the panel**; no "no-panel" branch is needed.
- `SourceState.astro` renders `NEVER_PULLED_COPY` ('Not retrieved yet.') per source when its status is null. That is already the four-row state of a seeded page.
- `src/lib/records/display.ts` has a reflection test (`recordsDisplay.test.ts`) that fails if any exported ALL_CAPS string is missing from `PANEL_COPY`, and `recordsPanelCopy.test.ts` scans `BuildingRecords.astro` plus every `.astro` in `src/components/records/` for `BANNED_WORDS` (`cash-out, extracted, cross-collateralized, deferred maintenance, pattern, evasive, delay`).
- `RecordCorrectionForm.tsx` is the Turnstile pattern: explicit `window.turnstile.render(ref, { sitekey: '0x4AAAAAACo4KpkxsacPhM2r', theme: 'light', callback, 'expired-callback' })`, a 100 ms poll for the async script, `reset` after a failed POST because tokens are single-use, `remove` on unmount. Its test `recordCorrectionForm.test.tsx` shows the `stubTurnstile()` harness.
- `src/pages/api/records/corrections.ts` is the public-route reference: 415 content-type guard before `request.json()`, `checkRateLimit(db, getClientIP(context), name, n, window)` with the fail-closed 503 branch and `buildRateLimitHeaders`, a body-shape 400, `verifyTurnstile(token, getEnv(context).TURNSTILE_SECRET_KEY, clientIP)` → **400** on failure, `logError(event, ctx)` from `src/lib/logger.ts`, envelopes `{ data }` / `{ error }` / `{ error, details }`. `verifyTurnstile` returns `{ success: true }` locally when `TURNSTILE_SECRET_KEY` is unset. Its route test `recordsCorrectionsRoute.test.ts` shows the hand-built `APIContext` and the `vi.mock('../turnstile', …)` that must precede the route import.
- `src/lib/rateLimit.ts`: `checkRateLimit(db, identifier, endpoint, maxAttempts, windowSeconds)` consumes a slot per call; `getClientIP(context)` reads `CF-Connecting-IP`.
- `src/pages/api/buildings/[id]/save.ts` POST: 401 → 400 (no id) → building 404 → `INSERT INTO saved_buildings`, UNIQUE swallowed as idempotent `{ saved: true }`. No test exists for it.
- `src/pages/api/buildings.ts` POST: auth 401 → `checkRateLimit(db, user.id, 'building-create', 20, 3600)` → `request.json()` with no guard → body `{ placeId, streetAddress, neighborhood, city, state, zipCode, latitude, longitude }` → sanitize → dedupe by `google_place_id` when `placeId` is set, else exact `LOWER(address)`/`LOWER(city)` → inline slug (address body + `-` + city, single collision check adding `Date.now().toString(36)`) → 10-column INSERT → 201 `{ building: { id, slug }, created: true }` / 200 `{ …, created: false }`. It never writes `street_key`, `st_num_lo`, `st_num_hi`, or `source`. Called only by `src/components/reviews/ReviewForm.tsx` (manual path sends no `placeId`; Google path sends all eight fields).
- `src/lib/records/identity.ts`: `addressKey(address) → { streetKey, numLo, numHi } | null`, `streetKey(street)`, `splitSuffix`, `isDegenerateStreet`, private `normalizeStreet` (drops everything from the first comma, so a comma-delimited "…, Boston, MA 02135" tail is already handled) and private `splitStreet`. Keys use the assessor spelling (`'COMMONWEALTH AV'`, `'LANARK RD'`). No helper strips a comma-less trailing "Boston" / "MA" / ZIP; `addressKey('1027 Commonwealth Ave Boston')` currently yields the wrong key `'COMMONWEALTH AVE BOSTON'`.
- `rangeContains(parcel, key)` in `src/lib/records/seed/match.ts:49` carries the street-side parity rule; `zip5(value)` in `src/lib/records/seed/sam.ts:40` normalizes ZIPs.
- `src/lib/locality.ts` has a private `KNOWN_NEIGHBORHOODS` set (Boston plus four New Haven names) and exports `displayLocality`, `localityLine`.
- Search: `src/pages/search.astro` (eight queries, `HAVING COUNT(r.id) > 0` in all; buildings search-mode count at lines 31-41 and rows at 45-58; browse mode below) and `src/pages/api/search/results.ts` (a `baseQuery` template chosen on `query`; `HAVING` in both variants). The LIKE escape is written `ESCAPE '\\'` inside template literals. `normalizeSearchQuery(query): string[][]` in `src/lib/searchQuery.ts` has **no production caller**. `SearchResults.tsx` `BuildingCard` already renders "No reviews yet" when `avg_overall` is falsy. The map (`src/pages/api/buildings/map.ts`) has its own `HAVING` and is not touched. Autocomplete already returns unreviewed buildings. **There is no page/endpoint parity test.**
- `BaseLayout.astro` props are exactly `title` and `description`; it appends ` | RateMyPlace` to the title. The building page passes `title={building.address}` and `description={`Reviews for ${building.address} in ${displayLocality(building)}`}` at line 193 of `src/pages/building/[slug].astro`, whose SELECT is `b.*` so `source`, `parcel_id`, `street_key` are on the row. With zero approved reviews `scores` is `null`, the header shows "No reviews yet", and the sidebar column (lines 292-331) renders empty.
- No sitemap, no `robots.txt`, no `@astrojs/sitemap`. `buildings.updated_at`, `reviews.created_at`, `record_pulls.retrieved_at` are all unix seconds. `SITE_URL` is on `App.Platform['env']`; read it with `getEnv(context).SITE_URL`. Static public pages present: `/`, `/about`, `/contact`, `/guidelines`, `/map`, `/methodology`, `/privacy`, `/search`, `/terms`. Landlord pages are `/landlord/[slug]`, property-manager pages `/property-manager/[slug]`.
- Test infra: `createRecordsTestDb()` / `insertBuilding(db, overrides)` in `src/lib/__tests__/helpers/recordsDb.ts` (stub `users`, `buildings`, `rate_limits`, `audit_logs`, `reviews`, `saved_buildings`; real 0029–0032 applied). Tests must be named `records*.test.ts(x)` in `src/lib/__tests__/` for `npx vitest run records`. Every `node:sqlite` suite opens with `const suite = sqliteAvailable ? describe : describe.skip;`. Page render tests: `namedPartySsrVisibility.test.ts` renders a page through `AstroContainer` with `params` and `locals`.

**Conventions:** TDD; `npm test`, `npm run check`, `npm run build` before each commit; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no `any`; every SQL against D1 is bound (`?`), never interpolated; no `b.*` in any public JSON; explicit column lists. Turnstile and the map cannot be exercised locally or on preview; verify on production.

**As-built decisions this plan makes where the spec was silent or the repo convention differs (record them in the spec amendment in Task 10):**

1. Content-type failure is **415** and Turnstile failure is **400**, matching the sibling public route `corrections.ts`, not the 400/403 the spec sketched.
2. The `HAVING COUNT(r.id) > 0` guard is removed only from the **query-mode** buildings queries. Browse mode (no query) stays reviewed-only: listing 38,000 unreviewed pages under "Reviewed buildings" is noise, and the spec's intent was the search box.
3. The seeded result line reads `No reviews yet · city records`, shown for any row with zero reviews whose building is Boston with a parcel id.
4. Reviewer dedupe treats a submitted city of "Boston" **or any Boston neighborhood name** as Boston, because Google Places often returns the neighborhood as the locality.
5. Slug collisions in `POST /api/buildings` now loop with `-2`, `-3`, … like `seedSlug`, instead of one timestamp suffix.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/records/identity.ts` | Modify: export `stripTrailingLocality`; `addressKey` applies it |
| `src/lib/records/coverage.ts` | Create: `DEEPER_SOURCE_IDS` (moved), `hasDeeperPull`, `pendingQueueReason`, `recordsRequestState` |
| `src/lib/records/scheduler.ts` | Modify: re-export `DEEPER_SOURCE_IDS` from `coverage.ts` |
| `src/lib/records/request.ts` | Create: request limits, `buttonRequestsSince`, `validateRequestBody` |
| `src/pages/api/records/request.ts` | Create: `POST /api/records/request` |
| `src/pages/api/buildings/[id]/save.ts` | Modify: follower enqueue after a first-time save |
| `src/lib/records/display.ts` | Modify: button, status, no-reviews card, and search copy constants (all in `PANEL_COPY`) |
| `src/components/records/RecordsRequestButton.tsx` | Create: the island |
| `src/components/BuildingRecords.astro` | Modify: compute request state; mount the island or the status line above the ledger |
| `src/lib/buildingMeta.ts` | Create: `buildingPageMeta` |
| `src/pages/building/[slug].astro` | Modify: metadata via `buildingPageMeta`; no-reviews sidebar card |
| `src/lib/searchSql.ts` | Create: `buildingSearchWhere`, `buildingSearchSelect`, `BUILDING_SEARCH_ORDER` |
| `src/pages/search.astro`, `src/pages/api/search/results.ts` | Modify: query-mode buildings queries use the shared fragments, no `HAVING` |
| `src/components/search/SearchResults.tsx` | Modify: `has_records` on the row; seeded copy in the score position |
| `src/lib/locality.ts` | Modify: export `isBostonLocality` |
| `src/lib/records/dedupe.ts` | Create: `findBuildingByAddress` |
| `src/pages/api/buildings.ts` | Modify: content-type and body guards; dedupe onto seeded rows; write key columns; slug loop |
| `src/lib/sitemap.ts` | Create: allowlist, chunking, queries, XML rendering |
| `src/pages/sitemap.xml.ts`, `src/pages/sitemaps/static.xml.ts`, `src/pages/sitemaps/buildings-[n].xml.ts`, `src/pages/robots.txt.ts` | Create: the routes |
| `src/lib/api-types.ts` | Modify: `RecordsRequestResponse` |
| `src/lib/__tests__/helpers/recordsDb.ts` | Modify: `insertBuilding` gains `source`, `street_key`, `st_num_lo`, `st_num_hi`, `neighborhood`, `google_place_id`, `latitude`, `longitude`; stub gains `landlords`, `property_managers`; `reviews` stub gains `overall_score`, `move_out_year_new` |
| Tests | `recordsAddressKey.test.ts` (extend), `recordsCoverage.test.ts`, `recordsRequestRoute.test.ts`, `recordsFollowerEnqueue.test.ts`, `recordsRequestButton.test.tsx`, `buildingRecordsRender.test.ts` (extend), `recordsBuildingMeta.test.ts`, `recordsBuildingPageSource.test.ts`, `recordsSearchSql.test.ts`, `recordsSearchParity.test.ts`, `recordsDedupe.test.ts`, `recordsBuildingsRoute.test.ts`, `recordsSitemap.test.ts`, `recordsDisplay.test.ts` / `recordsPanelCopy.test.ts` (extend) |
| Docs | `AGENTS.md`, `src/lib/AGENTS.md`, `MASTER.md`, `docs/runbooks/records-scheduler.md`, `ops/growth/STRATEGY.md`, `.planning/milestones/v1.6.0-ROADMAP.md`, `.planning/milestones/v1.7.0-ROADMAP.md`, `src/pages/methodology.astro`, `src/pages/privacy.astro`, spec amendment |

---

### Task 1: `stripTrailingLocality` in `identity.ts`

The dedupe (Task 8) keys manual-entry addresses like "1027 Commonwealth Ave Boston" or "10 Centre St Jamaica Plain MA 02130". The comma form is already handled by `normalizeStreet`; the comma-less form is not, and the fix must live in `identity.ts` so the seed's matcher (`addressKey(building.address)` in `seed/match.ts`) and the endpoint cannot fork.

**Files:**
- Modify: `src/lib/records/identity.ts`
- Test: `src/lib/__tests__/recordsAddressKey.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/__tests__/recordsAddressKey.test.ts` (inside its existing top-level `describe`, or a new one if the file has none):

```ts
import { addressKey, stripTrailingLocality } from '../records/identity';

describe('stripTrailingLocality', () => {
  it('peels a trailing city, state, and ZIP written without commas', () => {
    expect(stripTrailingLocality('COMMONWEALTH AVE BOSTON')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE BOSTON MA')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE BOSTON MA 02215')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE 02215')).toBe('COMMONWEALTH AVE');
    expect(stripTrailingLocality('COMMONWEALTH AVE MA 02215-1234')).toBe('COMMONWEALTH AVE');
  });

  it('peels a two-word neighborhood', () => {
    expect(stripTrailingLocality('CENTRE ST JAMAICA PLAIN')).toBe('CENTRE ST');
    expect(stripTrailingLocality('E BROADWAY SOUTH BOSTON MA')).toBe('E BROADWAY');
  });

  it('leaves a street whose name or suffix merely resembles a locality token', () => {
    expect(stripTrailingLocality('BOSTON ST')).toBe('BOSTON ST');
    expect(stripTrailingLocality('LANARK CT')).toBe('LANARK CT');
    expect(stripTrailingLocality('BEACON ST')).toBe('BEACON ST');
    expect(stripTrailingLocality('DORCHESTER AVE')).toBe('DORCHESTER AVE');
  });

  it('never strips the whole street away', () => {
    expect(stripTrailingLocality('BOSTON')).toBe('BOSTON');
    expect(stripTrailingLocality('SOUTH BOSTON')).toBe('SOUTH BOSTON');
    expect(stripTrailingLocality('02135')).toBe('02135');
  });

  it('only treats MA as a state when a ZIP or a locality sits beside it', () => {
    expect(stripTrailingLocality('LANARK RD MA')).toBe('LANARK RD MA');
    expect(stripTrailingLocality('LANARK RD BOSTON MA')).toBe('LANARK RD');
  });
});

describe('addressKey with a trailing locality', () => {
  it('keys a comma-less manual entry the same as the assessor', () => {
    expect(addressKey('1027 Commonwealth Ave Boston')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
    expect(addressKey('1027 Commonwealth Ave Boston MA 02215')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
    expect(addressKey('10 Centre St Jamaica Plain MA 02130')).toEqual({ streetKey: 'CENTRE ST', numLo: 10, numHi: 10 });
  });

  it('still keys the comma form and the plain form', () => {
    expect(addressKey('23-27 Lanark Rd, Boston, MA 02135')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 27 });
    expect(addressKey('5 Boston St')).toEqual({ streetKey: 'BOSTON ST', numLo: 5, numHi: 5 });
    expect(addressKey('12 Lanark Ct')).toEqual({ streetKey: 'LANARK CT', numLo: 12, numHi: 12 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run recordsAddressKey`
Expected: FAIL — `stripTrailingLocality` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/records/identity.ts`, below `UNIT_PATTERN` and above `normalizeStreet`, add:

```ts
/**
 * Locality words a person types after the street when there is no comma to cut at:
 * "1027 Commonwealth Ave Boston", "10 Centre St Jamaica Plain MA 02130". Boston's own
 * neighborhoods are here because Google Places and manual entry both use them as the
 * city. Uppercase, because it runs after `normalizeStreet`. Multi-word names are matched
 * as a unit, longest first.
 */
const TRAILING_LOCALITIES: ReadonlySet<string> = new Set([
  'BOSTON',
  'ALLSTON',
  'BRIGHTON',
  'CHARLESTOWN',
  'CHINATOWN',
  'DORCHESTER',
  'DOWNTOWN',
  'FENWAY',
  'MATTAPAN',
  'ROSLINDALE',
  'ROXBURY',
  'SEAPORT',
  'HYDE PARK',
  'JAMAICA PLAIN',
  'SOUTH BOSTON',
  'EAST BOSTON',
  'WEST ROXBURY',
  'SOUTH END',
  'NORTH END',
  'BACK BAY',
  'BEACON HILL',
  'MISSION HILL',
  'WEST END',
]);

const ZIP_TOKEN = /^\d{5}(?:-\d{4})?$/;

function trailingLocalityLength(words: readonly string[]): number {
  for (const n of [2, 1]) {
    if (words.length > n && TRAILING_LOCALITIES.has(words.slice(-n).join(' '))) return n;
  }
  return 0;
}

/**
 * Peel a trailing ZIP, then "MA", then a locality from an already-normalized (uppercase,
 * comma-free) street. Every step keeps at least one word, so a street that *is* a locality
 * word ("BOSTON") survives. "MA" is only a state when a ZIP was just removed or a locality
 * precedes it — otherwise it is left alone, and "CT" is never touched at all, because both
 * are also street suffixes ("Lanark Ct"). Called by `addressKey`, which is what the seed's
 * existing-row matcher and the reviewer dedupe both key with; not by `streetKey`, whose
 * input is a bare assessor street name.
 */
export function stripTrailingLocality(streetUpper: string): string {
  const words = streetUpper.split(' ').filter((word) => word.length > 0);
  let sawZip = false;
  if (words.length > 1 && ZIP_TOKEN.test(words[words.length - 1])) {
    words.pop();
    sawZip = true;
  }
  if (words.length > 1 && words[words.length - 1] === 'MA') {
    const before = words.slice(0, -1);
    if (sawZip || trailingLocalityLength(before) > 0) words.pop();
  }
  const localityWords = trailingLocalityLength(words);
  if (localityWords > 0) words.splice(words.length - localityWords, localityWords);
  return words.join(' ');
}
```

Then in `addressKey`, replace

```ts
const { base, spellings } = splitSuffix(parsed.street);
```

with

```ts
const { base, spellings } = splitStreet(stripTrailingLocality(normalizeStreet(parsed.street)));
```

(`splitSuffix` is `splitStreet(normalizeStreet(...))`; this inserts the stripper between the two. `streetKey` is unchanged on purpose.)

- [ ] **Step 4: Run the identity and seed suites**

Run: `npx vitest run recordsAddressKey recordsIdentity recordsSeedMatch recordsSearchQuery`
Expected: all PASS (the seed matcher's fixtures use comma forms or bare streets and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/records/identity.ts src/lib/__tests__/recordsAddressKey.test.ts
git commit -m "feat(records): addressKey strips a comma-less trailing locality

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `coverage.ts` — has a building got deeper records, and what is pending

One module answers the question three callers ask (the button endpoint, the follower enqueue, the panel): has this building ever had a deeper pull, and is anything queued for it. `DEEPER_SOURCE_IDS` moves here from `scheduler.ts` (which re-exports it) so a request path does not import the scheduler.

**Files:**
- Create: `src/lib/records/coverage.ts`
- Modify: `src/lib/records/scheduler.ts` (re-export), `src/lib/__tests__/helpers/recordsDb.ts` (`insertBuilding` overrides)
- Test: `src/lib/__tests__/recordsCoverage.test.ts`

- [ ] **Step 1: Extend the test helper**

In `src/lib/__tests__/helpers/recordsDb.ts`, widen `insertBuilding`'s override type and INSERT to include `neighborhood`, `google_place_id`, `latitude`, `longitude`, `source`, `street_key`, `st_num_lo`, `st_num_hi`:

```ts
export async function insertBuilding(
  db: TestD1Database,
  overrides: Partial<{
    id: string;
    address: string;
    slug: string;
    neighborhood: string | null;
    city: string;
    state: string;
    zip_code: string;
    parcel_id: string | null;
    sam_id: string | null;
    google_place_id: string | null;
    latitude: number | null;
    longitude: number | null;
    source: 'user' | 'seed';
    street_key: string | null;
    st_num_lo: number | null;
    st_num_hi: number | null;
  }> = {},
): Promise<string> {
  const row = {
    id: 'bldg-lanark',
    address: '23-27 Lanark Rd, Boston, MA 02135',
    slug: overrides.id ?? 'bldg-lanark',
    neighborhood: null,
    city: 'Boston',
    state: 'MA',
    zip_code: '02135',
    parcel_id: null,
    sam_id: null,
    google_place_id: null,
    latitude: null,
    longitude: null,
    source: 'user' as const,
    street_key: null,
    st_num_lo: null,
    st_num_hi: null,
    ...overrides,
  };
  await db
    .prepare(
      'INSERT INTO buildings (id, address, slug, neighborhood, city, state, zip_code, parcel_id, sam_id, google_place_id, latitude, longitude, source, street_key, st_num_lo, st_num_hi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(row.id, row.address, row.slug, row.neighborhood, row.city, row.state, row.zip_code, row.parcel_id, row.sam_id, row.google_place_id, row.latitude, row.longitude, row.source, row.street_key, row.st_num_lo, row.st_num_hi)
    .run();
  return row.id;
}
```

Keep the existing defaults (id `bldg-lanark`, slug = id) so current callers are unchanged. Also add two stub tables to `createRecordsStubDb()` (needed by Tasks 6–8; harmless now) and two columns to the `reviews` stub:

```sql
CREATE TABLE landlords (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL);
CREATE TABLE property_managers (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL);
```

and in the `reviews` stub add `overall_score REAL` and `move_out_year_new TEXT` (both nullable). Run `npx vitest run records` to confirm nothing regresses.

- [ ] **Step 2: Write the failing tests**

`src/lib/__tests__/recordsCoverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { DEEPER_SOURCE_IDS, hasDeeperPull, pendingQueueReason, recordsRequestState } from '../records/coverage';
import { DEEPER_SOURCE_IDS as SCHEDULER_DEEPER } from '../records/scheduler';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { enqueue } from '../records/queue';

const suite = sqliteAvailable ? describe : describe.skip;

async function insertPull(db: ReturnType<typeof createRecordsTestDb>, buildingId: string, sourceId: string, status = 'ok'): Promise<void> {
  await db
    .prepare(
      "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (?, ?, 'boston', ?, 'label', 'q', ?, 0, NULL, NULL, NULL, 'admin')",
    )
    .bind(`${buildingId}-${sourceId}-${status}`, buildingId, sourceId, status)
    .run();
}

suite('coverage', () => {
  it('lists the five non-assessor sources and scheduler re-exports the same array', () => {
    expect(DEEPER_SOURCE_IDS).toHaveLength(5);
    expect(DEEPER_SOURCE_IDS).not.toContain(FY2026_RESOURCE_ID);
    expect(SCHEDULER_DEEPER).toBe(DEEPER_SOURCE_IDS);
  });

  it('hasDeeperPull ignores assessor rows and counts an errored deeper row', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
    expect(await hasDeeperPull(db, id)).toBe(false);
    await insertPull(db, id, PERMITS_RESOURCE_ID, 'error');
    expect(await hasDeeperPull(db, id)).toBe(true);
  });

  it('pendingQueueReason reports the pending row and ignores finished ones', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    expect(await pendingQueueReason(db, id)).toBeNull();
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    expect(await pendingQueueReason(db, id)).toBe('fill');
    await db.prepare('UPDATE records_queue SET done_at = 2000 WHERE building_id = ?').bind(id).run();
    expect(await pendingQueueReason(db, id)).toBeNull();
  });

  it('recordsRequestState walks the page-state table', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
    expect(await recordsRequestState(db, id)).toBe('never_pulled');

    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    expect(await recordsRequestState(db, id)).toBe('fill_queued');

    await enqueue(db, { buildingId: id, reason: 'button', now: 1_001 });
    expect(await recordsRequestState(db, id)).toBe('requested');

    await insertPull(db, id, PERMITS_RESOURCE_ID);
    expect(await recordsRequestState(db, id)).toBe('pulled');
  });

  it('recordsRequestState is ineligible for a non-Boston, no-parcel, or unknown building', async () => {
    const db = createRecordsTestDb();
    const noParcel = await insertBuilding(db, { id: 'b1', parcel_id: null });
    const newHaven = await insertBuilding(db, { id: 'b2', city: 'New Haven', state: 'CT', parcel_id: '123456789' });
    expect(await recordsRequestState(db, noParcel)).toBe('ineligible');
    expect(await recordsRequestState(db, newHaven)).toBe('ineligible');
    expect(await recordsRequestState(db, 'nope')).toBe('ineligible');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run recordsCoverage`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `coverage.ts`**

```ts
// What the site knows about a Boston building's records coverage, for the request paths
// that must not pull anything themselves: the reader-facing button, the follower enqueue on
// save, and the panel's page state. Read-only; the queue module owns every write.
import { sourcesForCity } from './jurisdictions';
import type { QueueReason, RecordsDb } from './types';

/**
 * Every Boston source that is not the assessor. "Covered" means at least one pull of one of
 * these: the seed wrote an FY2026 assessor row for all 38,208 seeded buildings, so counting
 * the assessor would mark the whole city as done. The scheduler re-exports this array.
 */
export const DEEPER_SOURCE_IDS: string[] = sourcesForCity('Boston')
  .filter((source) => !source.kinds.includes('assessment'))
  .map((source) => source.id);

const DEEPER_PLACEHOLDERS = DEEPER_SOURCE_IDS.map(() => '?').join(', ');

/** Any deeper pull row at all, whatever its status — the `planRefresh` notion, not the fill's. */
export async function hasDeeperPull(db: RecordsDb, buildingId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS present FROM record_pulls WHERE building_id = ? AND source_id IN (${DEEPER_PLACEHOLDERS}) LIMIT 1`)
    .bind(buildingId, ...DEEPER_SOURCE_IDS)
    .first<{ present: number }>();
  return row !== null;
}

/** The reason on the building's one pending queue row, or null when nothing is queued. */
export async function pendingQueueReason(db: RecordsDb, buildingId: string): Promise<QueueReason | null> {
  const row = await db
    .prepare('SELECT reason FROM records_queue WHERE building_id = ? AND done_at IS NULL')
    .bind(buildingId)
    .first<{ reason: QueueReason }>();
  return row?.reason ?? null;
}

/**
 * The page-state table from the design spec, Section 4:
 * - `ineligible`: not a Boston building with a parcel id (or no such building) — nothing to offer.
 * - `pulled`: a deeper pull exists; the ledger is the normal one and the button never returns.
 * - `requested`: a button, follower, or refresh row is pending; say so, offer no button.
 * - `fill_queued`: only the city-wide pass has it; say so, and still offer the button.
 * - `never_pulled`: offer the button.
 */
export type RecordsRequestState = 'ineligible' | 'pulled' | 'requested' | 'fill_queued' | 'never_pulled';

export async function recordsRequestState(db: RecordsDb, buildingId: string): Promise<RecordsRequestState> {
  const building = await db
    .prepare('SELECT city, parcel_id FROM buildings WHERE id = ?')
    .bind(buildingId)
    .first<{ city: string | null; parcel_id: string | null }>();
  if (!building || building.city !== 'Boston' || building.parcel_id === null) return 'ineligible';
  if (await hasDeeperPull(db, buildingId)) return 'pulled';
  const pending = await pendingQueueReason(db, buildingId);
  if (pending === 'fill') return 'fill_queued';
  if (pending !== null) return 'requested';
  return 'never_pulled';
}
```

In `src/lib/records/scheduler.ts`, delete the local `DEEPER_SOURCE_IDS` definition (lines 57-64, comment included) and add near the imports:

```ts
export { DEEPER_SOURCE_IDS } from './coverage';
import { DEEPER_SOURCE_IDS } from './coverage';
```

(keep whichever internal uses the scheduler has; `sourcesForCity` may become an unused import there — remove it if so).

- [ ] **Step 5: Run**

Run: `npx vitest run recordsCoverage recordsScheduler recordsQueuePlanner`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/records/coverage.ts src/lib/records/scheduler.ts src/lib/__tests__/helpers/recordsDb.ts src/lib/__tests__/recordsCoverage.test.ts
git commit -m "feat(records): coverage module for deeper-pull and page-state reads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `POST /api/records/request` — the button endpoint

**Files:**
- Create: `src/lib/records/request.ts`, `src/pages/api/records/request.ts`
- Modify: `src/lib/api-types.ts`
- Test: `src/lib/__tests__/recordsRequestRoute.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { enqueue } from '../records/queue';
import { REQUEST_DAILY_CAP, REQUEST_PER_IP } from '../records/request';

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) =>
    token === 'good' ? { success: true } : { success: false, error: 'Bot verification failed. Please try again.' }),
}));
import { POST } from '../../pages/api/records/request';

const suite = sqliteAvailable ? describe : describe.skip;

interface ContextOptions {
  ip?: string;
  body?: unknown;
  contentType?: string | null;
}

function createContext(db: TestD1Database, options: ContextOptions = {}): APIContext {
  const { ip = '203.0.113.10', body, contentType = 'application/json' } = options;
  const headers: Record<string, string> = { 'CF-Connecting-IP': ip };
  if (contentType !== null) headers['Content-Type'] = contentType;
  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const request = new Request('https://ratemyplace.org/api/records/request', init);
  return { request, locals: { user: null, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } } } as unknown as APIContext;
}

async function insertPull(db: TestD1Database, buildingId: string, sourceId: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (?, ?, 'boston', ?, 'label', 'q', 'ok', 0, NULL, NULL, NULL, 'seed')",
    )
    .bind(`${buildingId}-${sourceId}`, buildingId, sourceId)
    .run();
}

async function pendingRows(db: TestD1Database, buildingId: string): Promise<Array<{ reason: string }>> {
  const { results } = await db.prepare('SELECT reason FROM records_queue WHERE building_id = ? AND done_at IS NULL').bind(buildingId).all<{ reason: string }>();
  return results;
}

suite('POST /api/records/request', () => {
  let db: TestD1Database;
  let id: string;
  const good = (buildingId: string) => ({ buildingId, turnstileToken: 'good' });

  beforeEach(async () => {
    db = createRecordsTestDb();
    id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
  });
  afterEach(() => vi.clearAllMocks());

  it('415 on a non-JSON content type, before anything else', async () => {
    const res = await POST(createContext(db, { contentType: 'text/plain', body: 'x' }));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'Unsupported Media Type' });
  });

  it('429 after three requests from one IP in an hour', async () => {
    for (let i = 0; i < REQUEST_PER_IP; i += 1) await POST(createContext(db, { body: good(id) }));
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'Too many requests. Please try again later.' });
    expect(res.headers.get('Retry-After')).not.toBeNull();
  });

  it('400 on a body that is not an object', async () => {
    const res = await POST(createContext(db, { body: 'null' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Validation failed', details: [{ field: 'buildingId', message: 'Building is required.' }] });
  });

  it('429 with its own message once 300 button rows were created today', async () => {
    for (let i = 0; i < REQUEST_DAILY_CAP; i += 1) {
      const other = await insertBuilding(db, { id: `cap-${i}`, parcel_id: `21023960${String(i).padStart(2, '0')}` });
      await enqueue(db, { buildingId: other, reason: 'button', now: Math.floor(Date.now() / 1000) });
    }
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Today's limit for city-records requests has been reached. Please try again tomorrow." });
  });

  it('400 on a failed Turnstile check', async () => {
    const res = await POST(createContext(db, { body: { buildingId: id, turnstileToken: 'bad' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bot verification failed. Please try again.' });
  });

  it('400 when buildingId is missing', async () => {
    const res = await POST(createContext(db, { body: { turnstileToken: 'good' } }));
    expect(res.status).toBe(400);
  });

  it('404 for an unknown, non-Boston, or parcel-less building', async () => {
    const noParcel = await insertBuilding(db, { id: 'np', parcel_id: null });
    const ct = await insertBuilding(db, { id: 'ct', city: 'New Haven', state: 'CT', parcel_id: '123456789' });
    for (const target of ['nope', noParcel, ct]) {
      const res = await POST(createContext(db, { body: good(target) }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Building not found' });
    }
  });

  it('409 when a deeper pull already exists', async () => {
    await insertPull(db, id, PERMITS_RESOURCE_ID);
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'City records for this building have already been retrieved.' });
    expect(await pendingRows(db, id)).toEqual([]);
  });

  it('202 queued, then 202 already_queued on a second press, with one pending row', async () => {
    const first = await POST(createContext(db, { body: good(id) }));
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ data: { status: 'queued' } });
    expect(first.headers.get('X-RateLimit-Limit')).toBe(String(REQUEST_PER_IP));

    const second = await POST(createContext(db, { body: good(id) }));
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ data: { status: 'already_queued' } });
    expect(await pendingRows(db, id)).toEqual([{ reason: 'button' }]);
  });

  it('replaces a pending fill row with a button row', async () => {
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    const res = await POST(createContext(db, { body: good(id) }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ data: { status: 'queued' } });
    expect(await pendingRows(db, id)).toEqual([{ reason: 'button' }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run recordsRequestRoute`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/records/request.ts`**

```ts
// Limits and validation for the reader-facing records request. The route in
// `src/pages/api/records/request.ts` is the only writer; keep the numbers here so the test,
// the privacy page, and the route agree.
import type { ValidationError } from '../validation';
import type { RecordsDb } from './types';

/** Per-IP: three presses an hour. The same shape as the correction form's limit. */
export const REQUEST_PER_IP = 3;
export const REQUEST_WINDOW_SECONDS = 3600;
/** Site-wide: 300 button rows a day, counted from `records_queue` (button rows are never purged). */
export const REQUEST_DAILY_CAP = 300;
export const REQUEST_CAP_WINDOW_SECONDS = 86_400;

export async function buttonRequestsSince(db: RecordsDb, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'button' AND requested_at >= ?")
    .bind(since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function validateRequestBody(body: Record<string, unknown>): ValidationError[] {
  const { buildingId } = body;
  if (!buildingId || typeof buildingId !== 'string' || !buildingId.trim()) {
    return [{ field: 'buildingId', message: 'Building is required.' }];
  }
  return [];
}
```

(Check `ValidationError` is exported from `src/lib/validation.ts`; `corrections.ts` imports it from there.)

- [ ] **Step 4: Implement the route `src/pages/api/records/request.ts`**

```ts
import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../lib/db';
import { getEnv } from '../../../lib/runtime';
import { logError } from '../../../lib/logger';
import { buildRateLimitHeaders, checkRateLimit, getClientIP } from '../../../lib/rateLimit';
import { verifyTurnstile } from '../../../lib/turnstile';
import { enqueue } from '../../../lib/records/queue';
import { recordsRequestState } from '../../../lib/records/coverage';
import {
  REQUEST_CAP_WINDOW_SECONDS,
  REQUEST_DAILY_CAP,
  REQUEST_PER_IP,
  REQUEST_WINDOW_SECONDS,
  buttonRequestsSince,
  validateRequestBody,
} from '../../../lib/records/request';

/**
 * POST /api/records/request
 *
 * The reader-facing "Get this building's city records" button. It enqueues one pull for the
 * companion Worker; it never pulls anything itself (AGENTS.md: no fetch from a city API in a
 * request). Unauthenticated JSON POST, so the guard order is the corrections route's:
 * content type -> per-IP rate limit -> body shape -> site-wide daily cap -> Turnstile ->
 * validation -> building -> coverage -> enqueue. Nothing about the presser is stored: the
 * queue row carries the building and the time, and the rate limiter keeps the IP for an hour
 * as it does for every public form.
 */
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export const POST: APIRoute = async (context: APIContext) => {
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return json(415, { error: 'Unsupported Media Type' });
  }

  try {
    const db = getDB(context);
    const clientIP = getClientIP(context);
    const rateLimit = await checkRateLimit(db, clientIP, 'records_request', REQUEST_PER_IP, REQUEST_WINDOW_SECONDS);
    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many requests. Please try again later.';
      return json(status, { error: message }, buildRateLimitHeaders(rateLimit, REQUEST_PER_IP));
    }
    const limitHeaders = buildRateLimitHeaders(rateLimit, REQUEST_PER_IP);

    const body: unknown = await context.request.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return json(400, { error: 'Validation failed', details: [{ field: 'buildingId', message: 'Building is required.' }] });
    }
    const record = body as Record<string, unknown>;

    const now = Math.floor(Date.now() / 1000);
    if ((await buttonRequestsSince(db, now - REQUEST_CAP_WINDOW_SECONDS)) >= REQUEST_DAILY_CAP) {
      return json(429, { error: "Today's limit for city-records requests has been reached. Please try again tomorrow." }, limitHeaders);
    }

    const turnstile = await verifyTurnstile(
      typeof record.turnstileToken === 'string' ? record.turnstileToken : '',
      getEnv(context).TURNSTILE_SECRET_KEY,
      clientIP,
    );
    if (!turnstile.success) {
      return json(400, { error: turnstile.error || 'Bot verification failed. Please try again.' });
    }

    const errors = validateRequestBody(record);
    if (errors.length > 0) return json(400, { error: 'Validation failed', details: errors });
    const buildingId = (record.buildingId as string).trim();

    const state = await recordsRequestState(db, buildingId);
    if (state === 'ineligible') return json(404, { error: 'Building not found' });
    if (state === 'pulled') return json(409, { error: 'City records for this building have already been retrieved.' });

    const result = await enqueue(db, { buildingId, reason: 'button', now });
    return json(202, { data: { status: result.status } }, limitHeaders);
  } catch (error) {
    logError('records_request_failed', { error: error instanceof Error ? error.message : String(error) });
    return json(500, { error: 'Failed to request records' });
  }
};
```

Note the local `json()` helper is private to this file (a `_`-prefixed shared helper is a follow-up, not this task). In `src/lib/api-types.ts`, next to `RecordsQueueStats`, add:

```ts
/** POST /api/records/request — 202 body. */
export interface RecordsRequestResponse {
  data: { status: 'queued' | 'already_queued' };
}
```

- [ ] **Step 5: Run**

Run: `npx vitest run recordsRequestRoute && npm run check`
Expected: PASS, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/records/request.ts src/pages/api/records/request.ts src/lib/api-types.ts src/lib/__tests__/recordsRequestRoute.test.ts
git commit -m "feat(records): public POST /api/records/request enqueues one button pull

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Follower enqueue on save

**Files:**
- Modify: `src/pages/api/buildings/[id]/save.ts`
- Test: `src/lib/__tests__/recordsFollowerEnqueue.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { enqueue } from '../records/queue';
import { POST } from '../../pages/api/buildings/[id]/save';

const suite = sqliteAvailable ? describe : describe.skip;

function createContext(db: TestD1Database, buildingId: string, userId: string | null = 'user-1'): APIContext {
  const request = new Request(`https://ratemyplace.org/api/buildings/${buildingId}/save`, { method: 'POST' });
  return {
    request,
    params: { id: buildingId },
    locals: { user: userId ? { id: userId } : null, runtime: { env: { DB: db } } },
  } as unknown as APIContext;
}

async function insertPull(db: TestD1Database, buildingId: string, sourceId: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (?, ?, 'boston', ?, 'label', 'q', 'ok', 0, NULL, NULL, NULL, 'seed')",
    )
    .bind(`${buildingId}-${sourceId}`, buildingId, sourceId)
    .run();
}

async function pending(db: TestD1Database, buildingId: string): Promise<string[]> {
  const { results } = await db.prepare('SELECT reason FROM records_queue WHERE building_id = ? AND done_at IS NULL').bind(buildingId).all<{ reason: string }>();
  return results.map((r) => r.reason);
}

suite('POST /api/buildings/[id]/save enqueues a follower pull', () => {
  let db: TestD1Database;
  let id: string;

  beforeEach(async () => {
    db = createRecordsTestDb();
    await db.prepare("INSERT INTO users (id, email) VALUES ('user-1', 'u@example.com')").run();
    id = await insertBuilding(db, { parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
  });

  it('saves and enqueues a follower row for a never-pulled Boston building', async () => {
    const res = await POST(createContext(db, id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
    expect(await pending(db, id)).toEqual(['follower']);
  });

  it('does not enqueue when a deeper pull exists', async () => {
    await insertPull(db, id, PERMITS_RESOURCE_ID);
    await POST(createContext(db, id));
    expect(await pending(db, id)).toEqual([]);
  });

  it('leaves a pending fill row alone', async () => {
    await enqueue(db, { buildingId: id, reason: 'fill', now: 1_000 });
    await POST(createContext(db, id));
    expect(await pending(db, id)).toEqual(['fill']);
  });

  it('a second save is idempotent and still leaves one pending row', async () => {
    await POST(createContext(db, id));
    const res = await POST(createContext(db, id));
    expect(res.status).toBe(200);
    expect(await pending(db, id)).toEqual(['follower']);
  });

  it('does not enqueue for a building without a parcel', async () => {
    const other = await insertBuilding(db, { id: 'plain', parcel_id: null });
    await POST(createContext(db, other));
    expect(await pending(db, other)).toEqual([]);
  });

  it('still 401s without a session and 404s for an unknown building', async () => {
    expect((await POST(createContext(db, id, null))).status).toBe(401);
    expect((await POST(createContext(db, 'nope'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run recordsFollowerEnqueue`
Expected: FAIL — the first test finds no `follower` row.

- [ ] **Step 3: Implement**

In `src/pages/api/buildings/[id]/save.ts` add the imports

```ts
import { logError } from '../../../../lib/logger';
import { errorMessage } from '../../../../lib/records/errors';
import { recordsRequestState } from '../../../../lib/records/coverage';
import { enqueue } from '../../../../lib/records/queue';
```

and, immediately after the inner `try { INSERT … } catch (UNIQUE) { … }` block and before the final `return new Response(JSON.stringify({ saved: true }) …)`:

```ts
    // A save is a follow: the building's records now matter to someone, so ask the Worker
    // for them — once, and only when nobody (button, follower, or the city-wide pass) has
    // asked already. Isolated so a queue hiccup cannot turn a saved row into a 500.
    try {
      if ((await recordsRequestState(db, buildingId)) === 'never_pulled') {
        await enqueue(db, { buildingId, reason: 'follower', now: Math.floor(Date.now() / 1000) });
      }
    } catch (err) {
      logError('records_follower_enqueue_failed', { buildingId, error: errorMessage(err) });
    }
```

The UNIQUE branch returns early, so a re-save does not re-enqueue; the pending index guarantees one row either way.

- [ ] **Step 4: Run**

Run: `npx vitest run recordsFollowerEnqueue && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/pages/api/buildings/[id]/save.ts" src/lib/__tests__/recordsFollowerEnqueue.test.ts
git commit -m "feat(records): saving a building enqueues a follower pull

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The button island and the panel's page states

**Files:**
- Modify: `src/lib/records/display.ts`, `src/components/BuildingRecords.astro`, `src/lib/__tests__/recordsPanelCopy.test.ts`, `src/lib/__tests__/buildingRecordsRender.test.ts`
- Create: `src/components/records/RecordsRequestButton.tsx`
- Test: `src/lib/__tests__/recordsRequestButton.test.tsx`

- [ ] **Step 1: Copy constants (test first)**

`recordsDisplay.test.ts`'s reflection will fail until each new ALL_CAPS export is in `PANEL_COPY`, so add them together. In `src/lib/records/display.ts`, after `CAPPED_ROWS_COPY`:

```ts
// Reader-facing request button and page states (design spec Section 4). The button asks the
// companion Worker to fetch; nothing is fetched in the request. Copy stays here so the
// banned-words scan covers it.
export const REQUEST_BUTTON_LABEL = "Get this building's city records";
export const REQUEST_BUTTON_HELP =
  'Permits, violations, code enforcement tickets, and 311 requests are fetched from the city when someone asks. It takes a few minutes.';
export const REQUEST_VERIFYING_COPY = 'Checking that you are a person, then sending the request.';
export const REQUESTED_COPY = 'Records requested. They usually appear within a few minutes; reload to check.';
export const FILL_QUEUED_COPY = 'Queued for the city-wide pass.';
export const REQUEST_ALREADY_PULLED_COPY = 'These records have already been retrieved. Reload to see them.';
export const REQUEST_FAILED_COPY = 'The request did not go through. Please try again.';

// The building page's no-reviews card and the search result line for a seeded building.
export const NO_REVIEWS_CARD_TITLE = 'No reviews yet.';
export const NO_REVIEWS_CARD_BODY = 'Lived here? Rate this place.';
export const NO_REVIEWS_BREAKDOWN_COPY = 'Rating breakdown appears after the first review.';
export const SEARCH_SEEDED_COPY = 'No reviews yet · city records';
```

and add all eleven names to the `PANEL_COPY` object literal. Run `npx vitest run recordsDisplay` → PASS.

- [ ] **Step 2: Write the failing island test** `src/lib/__tests__/recordsRequestButton.test.tsx`

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordsRequestButton from '../../components/records/RecordsRequestButton';
import {
  FILL_QUEUED_COPY,
  REQUESTED_COPY,
  REQUEST_ALREADY_PULLED_COPY,
  REQUEST_BUTTON_LABEL,
} from '../records/display';

type TurnstileWindow = Window & { turnstile?: unknown };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as TurnstileWindow).turnstile;
});

function stubTurnstile(token = 'test-token') {
  (window as TurnstileWindow).turnstile = {
    render: (_container: HTMLElement, options: { callback?: (token: string) => void }) => {
      options.callback?.(token);
      return 'widget-1';
    },
    reset: vi.fn(),
    remove: vi.fn(),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RecordsRequestButton', () => {
  it('renders the button and, for a fill-queued building, the fill line', () => {
    render(<RecordsRequestButton buildingId="b1" initialState="fill_queued" />);
    expect(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeTruthy();
    expect(screen.getByText(FILL_QUEUED_COPY)).toBeTruthy();
  });

  it('on press renders Turnstile, posts the token, and shows the requested line', async () => {
    stubTurnstile('tok');
    const fetchMock = vi.fn(async () => jsonResponse(202, { data: { status: 'queued' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);

    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(REQUESTED_COPY));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/records/request');
    expect(JSON.parse(String(init.body))).toEqual({ buildingId: 'b1', turnstileToken: 'tok' });
    expect(screen.queryByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeNull();
  });

  it('treats already_queued like queued', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(202, { data: { status: 'already_queued' } })));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(REQUESTED_COPY));
  });

  it('shows the already-pulled line on a 409', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, { error: 'City records for this building have already been retrieved.' })));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain(REQUEST_ALREADY_PULLED_COPY));
  });

  it('shows the server error, resets the widget, and offers the button again on a 429', async () => {
    stubTurnstile();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(429, { error: 'Too many requests. Please try again later.' })));
    render(<RecordsRequestButton buildingId="b1" initialState="never_pulled" />);
    await userEvent.click(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Too many requests'));
    expect(((window as TurnstileWindow).turnstile as { reset: ReturnType<typeof vi.fn> }).reset).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: REQUEST_BUTTON_LABEL })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run recordsRequestButton`
Expected: FAIL — component missing.

- [ ] **Step 4: Implement `src/components/records/RecordsRequestButton.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  FILL_QUEUED_COPY,
  REQUESTED_COPY,
  REQUEST_ALREADY_PULLED_COPY,
  REQUEST_BUTTON_HELP,
  REQUEST_BUTTON_LABEL,
  REQUEST_FAILED_COPY,
  REQUEST_VERIFYING_COPY,
} from '../../lib/records/display';

// The reader-facing records button. Pressing it renders Turnstile on demand (the correction
// form's pattern, but only after the press so a page that is merely read never loads a
// widget) and posts the token to /api/records/request, which enqueues one pull for the
// companion Worker. Every string comes from display.ts so the banned-words scan sees it.

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const TURNSTILE_SITEKEY = '0x4AAAAAACo4KpkxsacPhM2r';

interface Props {
  buildingId: string;
  initialState: 'never_pulled' | 'fill_queued';
}

type Phase = 'idle' | 'verifying' | 'sending' | 'requested' | 'already_pulled';

export default function RecordsRequestButton({ buildingId, initialState }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);

  const submit = async (token: string) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setPhase('sending');
    try {
      const response = await fetch('/api/records/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingId, turnstileToken: token }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 202) {
        setPhase('requested');
        return;
      }
      if (response.status === 409) {
        setPhase('already_pulled');
        return;
      }
      setError(data.error || REQUEST_FAILED_COPY);
      setPhase('idle');
    } catch {
      setError(REQUEST_FAILED_COPY);
      setPhase('idle');
    } finally {
      sendingRef.current = false;
      // Tokens are single-use: a failed POST needs a fresh challenge before the next press.
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  };

  useEffect(() => {
    if (phase !== 'verifying') return;
    let interval: ReturnType<typeof setInterval> | null = null;
    const renderWidget = () => {
      if (!turnstileRef.current || !window.turnstile) return;
      if (widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
        return;
      }
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        theme: 'light',
        callback: (token: string) => void submit(token),
        'expired-callback': () => setPhase((current) => (current === 'verifying' ? 'idle' : current)),
      });
    };
    if (window.turnstile) renderWidget();
    else {
      interval = setInterval(() => {
        if (window.turnstile) {
          if (interval) clearInterval(interval);
          interval = null;
          renderWidget();
        }
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(
    () => () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    },
    [],
  );

  if (phase === 'requested') {
    return <p role="status" className="text-sm text-gray-600">{REQUESTED_COPY}</p>;
  }
  if (phase === 'already_pulled') {
    return <p role="status" className="text-sm text-gray-600">{REQUEST_ALREADY_PULLED_COPY}</p>;
  }

  const busy = phase === 'verifying' || phase === 'sending';
  return (
    <div>
      {initialState === 'fill_queued' && <p className="text-sm text-gray-600">{FILL_QUEUED_COPY}</p>}
      <p className={`text-sm text-gray-600 ${initialState === 'fill_queued' ? 'mt-1' : ''}`}>{REQUEST_BUTTON_HELP}</p>
      {!busy && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPhase('verifying');
          }}
          className="mt-3 inline-flex min-h-[44px] items-center rounded-[4px] border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50"
        >
          {REQUEST_BUTTON_LABEL}
        </button>
      )}
      {busy && <p className="mt-3 text-sm text-gray-600" aria-live="polite">{REQUEST_VERIFYING_COPY}</p>}
      <div ref={turnstileRef} className="mt-3" hidden={!busy} />
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
```

The Turnstile container must stay mounted (hidden, not unmounted) so `reset` works; the effect keys on `phase === 'verifying'`. If `npm run check` objects to the global `Window` augmentation clashing with the per-component declarations in `ContactForm.tsx` / `DisputeForm.tsx` / `ConfirmStep.tsx`, use the same local form those files use instead (copy `RecordCorrectionForm.tsx`'s declaration verbatim).

- [ ] **Step 5: Mount it in `BuildingRecords.astro`**

Add imports:

```ts
import { recordsRequestState, type RecordsRequestState } from '../lib/records/coverage';
import { REQUESTED_COPY } from '../lib/records/display';
import RecordsRequestButton from './records/RecordsRequestButton';
```

Extend the isolated read (inside the same try, after `view = await getBuildingRecords(...)`):

```ts
let requestState: RecordsRequestState = 'ineligible';
try {
  view = await getBuildingRecords(Astro.locals.runtime.env.DB, buildingId);
  if (view) requestState = await recordsRequestState(Astro.locals.runtime.env.DB, buildingId);
} catch (error) {
  … existing handler …
  view = null;
  requestState = 'ineligible';
}
```

Then between `<CorrectionNotes notes={notesFor('assessment')} />` (end of the facts strip block, line 118) and `<div class="mt-6 border-b border-gray-200">` (the ledger), insert:

```astro
    {requestState === 'requested' && (
      <p class="mt-4 text-sm text-gray-600" role="status">{REQUESTED_COPY}</p>
    )}
    {(requestState === 'never_pulled' || requestState === 'fill_queued') && (
      <div class="mt-4 border-t border-gray-200 pt-4">
        <RecordsRequestButton client:load buildingId={buildingId} initialState={requestState} />
      </div>
    )}
```

The Turnstile script tag at the bottom is already gated on `view`, which is exactly the set of pages that can show the button; leave it.

- [ ] **Step 6: Extend the copy scan and the render test**

In `recordsPanelCopy.test.ts`, change the filter to `.filter((name) => name.endsWith('.astro') || name.endsWith('.tsx'))` and add `'RecordsRequestButton.tsx'` to the by-name list (if `RecordCorrectionForm.tsx` then trips the scan on an existing word, report it rather than editing that form).

In `buildingRecordsRender.test.ts` add a `describe('request button states')` block using the file's `renderPanel` and a local `insertPull` like Task 2's. For each case insert a building with `parcel_id: '2102396000'` and an FY2026 assessor pull row (so the panel renders), then:

- never pulled → HTML contains `REQUEST_BUTTON_LABEL` and not `REQUESTED_COPY`;
- `enqueue(... 'fill')` → contains `FILL_QUEUED_COPY` and `REQUEST_BUTTON_LABEL`;
- `enqueue(... 'button')` → contains `REQUESTED_COPY`, not the label;
- a permits pull row → contains neither;
- the existing "renders no panel at all for a building that has never been pulled" case still passes.

Compare against the imported constants, not retyped strings.

- [ ] **Step 7: Run**

Run: `npx vitest run recordsRequestButton buildingRecordsRender recordsPanelCopy recordsDisplay && npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/records/display.ts src/components/records/RecordsRequestButton.tsx src/components/BuildingRecords.astro src/lib/__tests__/recordsRequestButton.test.tsx src/lib/__tests__/recordsPanelCopy.test.ts src/lib/__tests__/buildingRecordsRender.test.ts
git commit -m "feat(records): reader-facing records button and page states in the panel

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Seeded-page metadata and the no-reviews card

**Files:**
- Create: `src/lib/buildingMeta.ts`
- Modify: `src/pages/building/[slug].astro`
- Test: `src/lib/__tests__/recordsBuildingMeta.test.ts`, `src/lib/__tests__/recordsBuildingPageSource.test.ts`

- [ ] **Step 1: Write the failing tests**

`recordsBuildingMeta.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildingPageMeta } from '../buildingMeta';

describe('buildingPageMeta', () => {
  const seeded = { address: '23-27 Lanark Road', city: 'Boston', neighborhood: 'Aberdeen', parcel_id: '2102396000' };

  it('describes a seeded page by its city records when no review exists', () => {
    expect(buildingPageMeta(seeded, 0)).toEqual({
      title: '23-27 Lanark Road, Boston',
      description:
        'City of Boston records for 23-27 Lanark Road: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.',
    });
  });

  it('switches to review metadata once a review exists', () => {
    expect(buildingPageMeta(seeded, 1)).toEqual({
      title: '23-27 Lanark Road',
      description: 'Reviews for 23-27 Lanark Road in Aberdeen',
    });
  });

  it('keeps review metadata for a building without a parcel or outside Boston', () => {
    expect(buildingPageMeta({ ...seeded, parcel_id: null }, 0).title).toBe('23-27 Lanark Road');
    expect(buildingPageMeta({ address: '1 Elm St', city: 'New Haven', neighborhood: null, parcel_id: '1' }, 0).description).toBe(
      'Reviews for 1 Elm St in New Haven',
    );
  });
});
```

`recordsBuildingPageSource.test.ts` (a source scan, the `methodologyContents.test.ts` style):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/pages/building/[slug].astro'), 'utf8');

describe('building page source', () => {
  it('derives its title and description from buildingPageMeta', () => {
    expect(source).toMatch(/buildingPageMeta\(/);
    expect(source).toMatch(/<BaseLayout title=\{meta\.title\} description=\{meta\.description\}>/);
  });

  it('renders the no-reviews card from display.ts copy', () => {
    for (const name of ['NO_REVIEWS_CARD_TITLE', 'NO_REVIEWS_CARD_BODY', 'NO_REVIEWS_BREAKDOWN_COPY']) {
      expect(source).toContain(`{${name}}`);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run recordsBuildingMeta recordsBuildingPageSource`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/buildingMeta.ts`**

```ts
import { displayLocality } from './locality';

export interface BuildingMetaInput {
  address: string;
  city: string | null;
  neighborhood?: string | null;
  parcel_id: string | null;
}

/**
 * Title and description for a building page. A Boston building with a parcel and no
 * approved review is a city-records page and says so (design spec Section 6); the moment a
 * review exists, the review metadata takes over. `BaseLayout` appends " | RateMyPlace".
 */
export function buildingPageMeta(building: BuildingMetaInput, approvedReviewCount: number): { title: string; description: string } {
  const recordsOnly = approvedReviewCount === 0 && building.city === 'Boston' && building.parcel_id !== null;
  if (!recordsOnly) {
    return { title: building.address, description: `Reviews for ${building.address} in ${displayLocality(building)}` };
  }
  return {
    title: `${building.address}, Boston`,
    description: `City of Boston records for ${building.address}: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.`,
  };
}
```

- [ ] **Step 4: Edit `src/pages/building/[slug].astro`**

Imports: add `import { buildingPageMeta } from '../../lib/buildingMeta';` and `import { NO_REVIEWS_CARD_TITLE, NO_REVIEWS_CARD_BODY, NO_REVIEWS_BREAKDOWN_COPY } from '../../lib/records/display';`. After `const showBuildingDetails = hasBuildingDetails(building);` add `const meta = buildingPageMeta(building, reviews.length);`. Change line 193 to `<BaseLayout title={meta.title} description={meta.description}>`.

In the sidebar, directly after `{scores && <ScoreCard scores={scores} type="building" />}`, add:

```astro
        {!scores && (
          <div class="bg-white rounded-[6px] border border-gray-200 p-6">
            <h3 class="font-semibold text-gray-900">{NO_REVIEWS_CARD_TITLE}</h3>
            <p class="mt-1 text-sm text-gray-600">{NO_REVIEWS_CARD_BODY}</p>
            <a
              href={`/review/new?building=${building.id}`}
              class="mt-4 inline-block bg-teal-700 text-white font-semibold px-6 py-2 rounded-[4px] hover:bg-teal-800 transition-colors"
            >
              Write a review
            </a>
            <p class="mt-4 text-xs text-gray-500">{NO_REVIEWS_BREAKDOWN_COPY}</p>
          </div>
        )}
```

The header's "No reviews yet" and the bottom `EmptyState` stay as they are.

- [ ] **Step 5: Run**

Run: `npx vitest run recordsBuildingMeta recordsBuildingPageSource namedPartySsrVisibility && npm run check && npm run build`
Expected: PASS, clean build.

- [ ] **Step 6: Commit**

```bash
git add src/lib/buildingMeta.ts "src/pages/building/[slug].astro" src/lib/__tests__/recordsBuildingMeta.test.ts src/lib/__tests__/recordsBuildingPageSource.test.ts
git commit -m "feat(building): records-page metadata and no-reviews card for seeded pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Search returns every Boston building, reviewed first

**Files:**
- Create: `src/lib/searchSql.ts`
- Modify: `src/pages/search.astro`, `src/pages/api/search/results.ts`, `src/components/search/SearchResults.tsx`
- Test: `src/lib/__tests__/recordsSearchSql.test.ts`, `src/lib/__tests__/recordsSearchParity.test.ts`

- [ ] **Step 1: Write the failing tests**

`recordsSearchSql.test.ts` builds the full buildings statement from the fragments and runs it on the stub (which after Task 2 has `landlords`, and `reviews` with `overall_score`, `move_out_year_new`, `created_at`, `status`):

```ts
import { describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { BUILDING_SEARCH_ORDER, buildingSearchSelect, buildingSearchWhere } from '../searchSql';

const suite = sqliteAvailable ? describe : describe.skip;
const YEAR = 2026;

async function review(db: TestD1Database, buildingId: string, score: number, id = `${buildingId}-r${score}`): Promise<void> {
  await db
    .prepare("INSERT INTO reviews (id, building_id, status, created_at, overall_score) VALUES (?, ?, 'approved', 1_750_000_000, ?)")
    .bind(id, buildingId, score)
    .run();
}

async function search(db: TestD1Database, query: string): Promise<Array<{ slug: string; review_count: number; has_records: number }>> {
  const where = buildingSearchWhere(query);
  const sql = `SELECT ${buildingSearchSelect('r', YEAR)}
    FROM buildings b
    LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
    LEFT JOIN landlords l ON b.landlord_id = l.id
    WHERE ${where.sql}
    GROUP BY b.id
    ${BUILDING_SEARCH_ORDER}
    LIMIT 50`;
  const { results } = await db.prepare(sql).bind(...where.binds).all<{ slug: string; review_count: number; has_records: number }>();
  return results;
}

suite('building search SQL', () => {
  it('expands suffix abbreviations and ANDs terms', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', address: '1027 Commonwealth Avenue', parcel_id: '1', source: 'seed' });
    await insertBuilding(db, { id: 'b', address: '1027 Commonwealth Ave', parcel_id: '2', source: 'seed' });
    await insertBuilding(db, { id: 'c', address: '12 Commonwealth Ave', parcel_id: '3', source: 'seed' });
    const slugs = (await search(db, '1027 comm ave')).map((r) => r.slug).sort();
    expect(slugs).toEqual(['a', 'b']);
  });

  it('puts reviewed buildings first in the old order, then the rest by address', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'z', address: '9 Lanark Rd', parcel_id: '1', source: 'seed' });
    await insertBuilding(db, { id: 'y', address: '5 Lanark Rd', parcel_id: '2', source: 'seed' });
    await insertBuilding(db, { id: 'x', address: '7 Lanark Rd', parcel_id: '3' });
    await insertBuilding(db, { id: 'w', address: '3 Lanark Rd', parcel_id: '4' });
    await review(db, 'x', 4);
    await review(db, 'w', 3, 'w-1');
    await review(db, 'w', 5, 'w-2');
    expect((await search(db, 'lanark')).map((r) => r.slug)).toEqual(['w', 'x', 'y', 'z']);
  });

  it('flags city records only for Boston buildings with a parcel', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'p', address: '1 Lanark Rd', parcel_id: '1' });
    await insertBuilding(db, { id: 'q', address: '2 Lanark Rd', parcel_id: null });
    const rows = await search(db, 'lanark');
    expect(rows.find((r) => r.slug === 'p')?.has_records).toBe(1);
    expect(rows.find((r) => r.slug === 'q')?.has_records).toBe(0);
  });

  it('still matches a neighborhood or landlord name with the whole query', async () => {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO landlords (id, name, slug) VALUES ('l1', 'Acme Realty', 'acme')").run();
    await insertBuilding(db, { id: 'n', address: '1 Oak St', neighborhood: 'Allston' });
    await db.prepare("UPDATE buildings SET landlord_id = 'l1' WHERE id = 'n'").run();
    expect((await search(db, 'allston')).map((r) => r.slug)).toEqual(['n']);
    expect((await search(db, 'acme realty')).map((r) => r.slug)).toEqual(['n']);
  });

  it('escapes LIKE wildcards in every bind', () => {
    const { binds } = buildingSearchWhere('100% Main_St');
    for (const bind of binds) expect(bind).not.toMatch(/(?<!\\)[%_](?!$)|^[%_]$/);
  });
});
```

(The last test's intent: no unescaped `%`/`_` inside a bind other than the outer wildcards. If the regex is awkward, assert `binds.every((b) => b.startsWith('%') && b.endsWith('%') && !/[^\\]%[^$]/.test(b.slice(1, -1)))` instead.)

`recordsSearchParity.test.ts` — the guard that did not exist:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'src/pages/search.astro'), 'utf8');
const endpoint = readFileSync(join(process.cwd(), 'src/pages/api/search/results.ts'), 'utf8');

describe('search page and results endpoint stay aligned', () => {
  for (const [name, source] of [['search.astro', page], ['results.ts', endpoint]] as const) {
    it(`${name} builds the query-mode buildings query from searchSql`, () => {
      expect(source).toMatch(/buildingSearchWhere\(/);
      expect(source).toMatch(/buildingSearchSelect\(/);
      expect(source).toMatch(/BUILDING_SEARCH_ORDER/);
    });
  }

  it('the page keeps browse mode and landlords reviewed-only', () => {
    expect((page.match(/HAVING COUNT\(r\.id\) > 0/g) ?? []).length).toBe(6);
  });

  it('the endpoint keeps browse mode and landlords reviewed-only', () => {
    expect((endpoint.match(/HAVING COUNT\(r\.id\) > 0/g) ?? []).length).toBe(2);
  });
});
```

(Counts: the page had 8 `HAVING`s, minus the two query-mode buildings queries = 6. The endpoint's buildings `baseQuery` template splits into a query variant without `HAVING` and a no-query variant with it, plus the landlords template = 2. Adjust the numbers only if the actual edit differs, and say why in the test.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run recordsSearchSql recordsSearchParity`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/searchSql.ts`**

```ts
// The one place the buildings search query is spelled. `search.astro` (SSR first page) and
// `api/search/results.ts` (Load more) both build from these, which is what keeps their
// counts, rows, and order in step — a parity that used to be a comment.
import { normalizeSearchQuery } from './searchQuery';
import { recencyWeightedOverallSql } from './scoring-sql';
import { escapeLikePattern } from './validation';

export interface SqlFragment {
  sql: string;
  binds: string[];
}

const LIKE = "LIKE ? ESCAPE '\\'";

function contains(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

/**
 * WHERE body for a non-empty query. Every term must appear in the address under one of its
 * spellings ("comm ave" matches an address stored as "Ave" or "Avenue", and still needs
 * "comm"); failing that, the whole query names a neighborhood or a landlord. Table aliases
 * are fixed: `b` buildings, `l` landlords.
 */
export function buildingSearchWhere(query: string): SqlFragment {
  const whole = contains(query.trim());
  const terms = normalizeSearchQuery(query);
  const binds: string[] = [];
  const clauses = terms.map((spellings) => {
    for (const spelling of spellings) binds.push(contains(spelling));
    return `(${spellings.map(() => `b.address ${LIKE}`).join(' OR ')})`;
  });
  let addressClause: string;
  if (clauses.length > 0) {
    addressClause = clauses.join(' AND ');
  } else {
    addressClause = `b.address ${LIKE}`;
    binds.push(whole);
  }
  binds.push(whole, whole);
  return { sql: `(${addressClause}) OR b.neighborhood ${LIKE} OR l.name ${LIKE}`, binds };
}

/** Column list for a buildings result row. Explicit — never `b.*` (admin_notes, owner_*). */
export function buildingSearchSelect(reviewAlias: string, currentYear: number): string {
  return `b.slug, b.address, b.neighborhood, b.city, b.state,
    COUNT(${reviewAlias}.id) AS review_count,
    ${recencyWeightedOverallSql(reviewAlias, currentYear)} AS avg_overall,
    l.name AS landlord_name,
    (b.city = 'Boston' AND b.parcel_id IS NOT NULL) AS has_records`;
}

/** Reviewed buildings first in their existing order; everything else by address. */
export const BUILDING_SEARCH_ORDER = 'ORDER BY (COUNT(r.id) > 0) DESC, COUNT(r.id) DESC, avg_overall DESC, b.address ASC, b.id ASC';
```

- [ ] **Step 4: Rewire the page and the endpoint**

`src/pages/search.astro`, search mode only (lines 31-58): replace the buildings count and rows queries with

```ts
const where = buildingSearchWhere(query);
const countResult = await db.prepare(`
  SELECT COUNT(*) AS total FROM (
    SELECT b.id FROM buildings b
    LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
    LEFT JOIN landlords l ON b.landlord_id = l.id
    WHERE ${where.sql}
    GROUP BY b.id
  )`).bind(...where.binds).first<{ total: number }>();
totalBuildings = countResult?.total ?? 0;
if (totalBuildings > 0) {
  const rows = await db.prepare(`
    SELECT ${buildingSearchSelect('r', currentYear)}
    FROM buildings b
    LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
    LEFT JOIN landlords l ON b.landlord_id = l.id
    WHERE ${where.sql}
    GROUP BY b.id
    ${BUILDING_SEARCH_ORDER}
    LIMIT ?`).bind(...where.binds, PAGE_SIZE).all();
  buildings = rows.results || [];
}
```

Import `{ BUILDING_SEARCH_ORDER, buildingSearchSelect, buildingSearchWhere } from '../lib/searchSql'`. Landlords queries and all of browse mode are untouched. `likePattern` stays for the landlord queries.

`src/pages/api/search/results.ts`, buildings branch: when `query` is non-empty use the same three fragments (`WHERE ${where.sql} GROUP BY b.id` for the count; the select, `${BUILDING_SEARCH_ORDER} LIMIT ? OFFSET ?` for rows, binds `[...where.binds, limit, offset]`); the no-query variant keeps its `HAVING COUNT(r.id) > 0` and the old select and order. Simplest shape: build `{ countSql, rowsSql, binds }` in an `if (query) { … } else { … }` and run them below.

`src/components/search/SearchResults.tsx`: add `has_records?: number` to `Building`; in `BuildingCard`'s else-branch render `{building.review_count === 0 && building.has_records ? SEARCH_SEEDED_COPY : 'No reviews yet'}` (import `SEARCH_SEEDED_COPY` from `../../lib/records/display`). Leave the browse heading "Reviewed buildings" as is — browse is still reviewed-only.

- [ ] **Step 5: Run**

Run: `npx vitest run recordsSearchSql recordsSearchParity searchResults && npm run check && npm run build`
Expected: PASS. Then start the dev server (`npm run dev` on the worktree's local D1, which holds the seeded rows) and confirm in the browser: `/search?q=1027+comm+ave` lists Commonwealth Avenue buildings with the seeded line; `/search?q=lanark` shows the reviewed 27 Lanark Road first; `/search` (browse) is unchanged; Load more on a large result set keeps the seeded ordering.

- [ ] **Step 6: Commit**

```bash
git add src/lib/searchSql.ts src/pages/search.astro src/pages/api/search/results.ts src/components/search/SearchResults.tsx src/lib/__tests__/recordsSearchSql.test.ts src/lib/__tests__/recordsSearchParity.test.ts
git commit -m "feat(search): every Boston building matches, reviewed first, with suffix expansion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Reviewer dedupe onto seeded buildings

**Files:**
- Modify: `src/lib/locality.ts` (export `isBostonLocality`), `src/pages/api/buildings.ts`
- Create: `src/lib/records/dedupe.ts`
- Test: `src/lib/__tests__/recordsDedupe.test.ts`, `src/lib/__tests__/recordsBuildingsRoute.test.ts`

- [ ] **Step 1: Write the failing tests**

`recordsDedupe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { findBuildingByAddress } from '../records/dedupe';
import { isBostonLocality } from '../locality';

const suite = sqliteAvailable ? describe : describe.skip;

suite('findBuildingByAddress', () => {
  it('matches a single number inside a seeded range, under any suffix spelling', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'seed-1', address: '23-27 Lanark Rd', slug: '23-27-lanark-rd-boston', source: 'seed', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27, parcel_id: '1' });
    const hit = await findBuildingByAddress(db, { address: '25 Lanark Road', city: 'Boston', zip: null });
    expect(hit).toEqual({ id: 'seed-1', slug: '23-27-lanark-rd-boston' });
  });

  it('respects street-side parity', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'odd', address: '61-69 Chiswick Rd', source: 'seed', street_key: 'CHISWICK RD', st_num_lo: 61, st_num_hi: 69 });
    expect(await findBuildingByAddress(db, { address: '66 Chiswick Rd', city: 'Boston', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: '65 Chiswick Rd', city: 'Boston', zip: null })).toEqual({ id: 'odd', slug: 'odd' });
  });

  it('breaks a two-building tie with the ZIP and refuses to guess without one', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'g1', address: '15 Gordon St', zip_code: '02134', source: 'seed', street_key: 'GORDON ST', st_num_lo: 15, st_num_hi: 15 });
    await insertBuilding(db, { id: 'g2', address: '15 Gordon St', slug: 'g2-slug', zip_code: '02135', source: 'seed', street_key: 'GORDON ST', st_num_lo: 15, st_num_hi: 15 });
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: '02135' })).toEqual({ id: 'g2', slug: 'g2-slug' });
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: '15 Gordon St', city: 'Boston', zip: '02136' })).toBeNull();
  });

  it('prefers a user row over a seeded twin on the same range', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'seed-x', address: '10 Elm St', source: 'seed', street_key: 'ELM ST', st_num_lo: 10, st_num_hi: 10 });
    await insertBuilding(db, { id: 'user-x', address: '10 Elm St', slug: 'user-x', source: 'user', street_key: 'ELM ST', st_num_lo: 10, st_num_hi: 10 });
    expect((await findBuildingByAddress(db, { address: '10 Elm Street', city: 'Boston', zip: null }))?.id).toBe('user-x');
  });

  it('keys a comma-less city tail and a neighborhood city', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'c', address: '1027 Commonwealth Av', source: 'seed', street_key: 'COMMONWEALTH AV', st_num_lo: 1027, st_num_hi: 1027 });
    expect((await findBuildingByAddress(db, { address: '1027 Commonwealth Ave Boston', city: 'Allston', zip: null }))?.id).toBe('c');
  });

  it('returns null outside Boston, for an unparseable address, or with no candidate', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'c', address: '1 Lanark Rd', source: 'seed', street_key: 'LANARK RD', st_num_lo: 1, st_num_hi: 1 });
    expect(await findBuildingByAddress(db, { address: '1 Lanark Rd', city: 'New Haven', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: 'Lanark Rd', city: 'Boston', zip: null })).toBeNull();
    expect(await findBuildingByAddress(db, { address: '3 Lanark Rd', city: 'Boston', zip: null })).toBeNull();
  });
});

describe('isBostonLocality', () => {
  it('accepts Boston and its neighborhoods in any case, rejects other cities', () => {
    for (const city of ['Boston', 'boston', 'BOSTON ', 'Allston', 'Jamaica Plain', 'Hyde Park', 'Dorchester']) expect(isBostonLocality(city)).toBe(true);
    for (const city of ['New Haven', 'Cambridge', 'Westville', '', null]) expect(isBostonLocality(city)).toBe(false);
  });
});
```

`recordsBuildingsRoute.test.ts` — the POST:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { POST } from '../../pages/api/buildings';

const suite = sqliteAvailable ? describe : describe.skip;

function createContext(db: TestD1Database, body: unknown, contentType: string | null = 'application/json'): APIContext {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  const request = new Request('https://ratemyplace.org/api/buildings', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { request, locals: { user: { id: 'user-1' }, runtime: { env: { DB: db } } } } as unknown as APIContext;
}

interface BuildingRow { id: string; slug: string; source: string; street_key: string | null; st_num_lo: number | null; st_num_hi: number | null; google_place_id: string | null; latitude: number | null; longitude: number | null }

async function rows(db: TestD1Database): Promise<BuildingRow[]> {
  const { results } = await db.prepare('SELECT id, slug, source, street_key, st_num_lo, st_num_hi, google_place_id, latitude, longitude FROM buildings ORDER BY id').all<BuildingRow>();
  return results;
}

suite('POST /api/buildings with seeded dedupe', () => {
  let db: TestD1Database;
  beforeEach(async () => {
    db = createRecordsTestDb();
    await db.prepare("INSERT INTO users (id, email) VALUES ('user-1', 'u@example.com')").run();
    await insertBuilding(db, { id: 'seed-1', address: '23-27 Lanark Rd', slug: '23-27-lanark-rd-boston', source: 'seed', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27, parcel_id: '1', latitude: null, longitude: null });
  });

  it('415 on a non-JSON body and 400 on a non-object body', async () => {
    expect((await POST(createContext(db, 'x', 'text/plain'))).status).toBe(415);
    expect((await POST(createContext(db, 'null'))).status).toBe(400);
  });

  it('a Google place inside a seeded range lands on the seeded row and stamps place id and coordinates', async () => {
    const res = await POST(createContext(db, { placeId: 'gp-1', streetAddress: '25 Lanark Rd', neighborhood: 'Brighton', city: 'Boston', state: 'MA', zipCode: '02135', latitude: 42.34, longitude: -71.15 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ building: { id: 'seed-1', slug: '23-27-lanark-rd-boston' }, created: false });
    const [seed] = await rows(db);
    expect(seed.google_place_id).toBe('gp-1');
    expect(seed.latitude).toBe(42.34);
    expect(seed.longitude).toBe(-71.15);
  });

  it('a manual entry with a comma-less city tail lands on the seeded row', async () => {
    const res = await POST(createContext(db, { streetAddress: '27 Lanark Road Boston', city: 'Boston', state: 'MA', zipCode: null }));
    expect(res.status).toBe(200);
    expect((await res.json()).building.id).toBe('seed-1');
    expect((await rows(db)).length).toBe(1);
  });

  it('a Boston address with no seeded match is created with its key columns', async () => {
    const res = await POST(createContext(db, { placeId: 'gp-2', streetAddress: '5 Oak St', city: 'Dorchester', state: 'MA', zipCode: '02122', latitude: 42.3, longitude: -71.06 }));
    expect(res.status).toBe(201);
    const created = (await rows(db)).find((r) => r.id !== 'seed-1');
    expect(created).toMatchObject({ source: 'user', street_key: 'OAK ST', st_num_lo: 5, st_num_hi: 5, slug: '5-oak-st-dorchester' });
  });

  it('a non-Boston address keeps the old behaviour and still gets key columns', async () => {
    const res = await POST(createContext(db, { streetAddress: '1 Elm St', city: 'New Haven', state: 'CT', zipCode: '06511' }));
    expect(res.status).toBe(201);
    const created = (await rows(db)).find((r) => r.id !== 'seed-1');
    expect(created).toMatchObject({ street_key: 'ELM ST', st_num_lo: 1, st_num_hi: 1 });
  });

  it('a second exact manual entry still dedupes by address and city', async () => {
    await POST(createContext(db, { streetAddress: '1 Elm St', city: 'New Haven', state: 'CT', zipCode: null }));
    const res = await POST(createContext(db, { streetAddress: '1 elm st', city: 'new haven', state: 'CT', zipCode: null }));
    expect(res.status).toBe(200);
    expect((await rows(db)).length).toBe(2);
  });

  it('a slug collision gets -2, -3', async () => {
    await insertBuilding(db, { id: 'taken', address: '9 Pine St', slug: '9-pine-st-cambridge', city: 'Cambridge' });
    const res = await POST(createContext(db, { streetAddress: '9 Pine St.', city: 'Cambridge', state: 'MA', zipCode: null }));
    expect(res.status).toBe(201);
    expect((await res.json()).building.slug).toBe('9-pine-st-cambridge-2');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run recordsDedupe recordsBuildingsRoute`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/locality.ts`: split the set into `BOSTON_NEIGHBORHOODS` (the eleven Boston names plus multi-word `'hydepark'`, `'jamaicaplain'`, `'southboston'`, `'eastboston'`, `'westroxbury'`, `'southend'`, `'northend'`, `'backbay'`, `'beaconhill'`, `'missionhill'`, `'westend'` in the module's `normalize()` form, which strips non-alphanumerics) and `NEW_HAVEN_NEIGHBORHOODS`; keep `KNOWN_NEIGHBORHOODS = new Set([...BOSTON_NEIGHBORHOODS, ...NEW_HAVEN_NEIGHBORHOODS])` for `displayLocality`; add

```ts
/** "Boston" or one of its neighborhoods, as Google Places and manual entry both spell the city. */
export function isBostonLocality(city: string | null | undefined): boolean {
  if (!city) return false;
  const key = normalize(city);
  return key === 'boston' || BOSTON_NEIGHBORHOODS.has(key);
}
```

`src/lib/records/dedupe.ts`:

```ts
// Reviewer dedupe onto existing (mostly seeded) Boston buildings, design spec Section 5.
// The same precedence as the seed's matcher: key the address, find every row on that street
// whose range contains it under the parity rule, break a tie with the ZIP, and refuse to
// guess — a null here means "create a row", never "merge onto the nearest".
import { isBostonLocality } from '../locality';
import { addressKey } from './identity';
import { rangeContains } from './seed/match';
import { zip5 } from './seed/sam';
import type { RecordsDb } from './types';

export interface DedupeInput {
  address: string;
  city: string | null;
  zip: string | null;
}

export interface DedupeHit {
  id: string;
  slug: string;
}

interface CandidateRow {
  id: string;
  slug: string;
  source: 'user' | 'seed';
  st_num_lo: number | null;
  st_num_hi: number | null;
  zip_code: string | null;
  created_at: number;
}

export async function findBuildingByAddress(db: RecordsDb, input: DedupeInput): Promise<DedupeHit | null> {
  if (!isBostonLocality(input.city)) return null;
  const key = addressKey(input.address);
  if (!key) return null;

  const { results } = await db
    .prepare(
      "SELECT id, slug, source, st_num_lo, st_num_hi, zip_code, created_at FROM buildings WHERE city = 'Boston' AND street_key = ? AND st_num_lo IS NOT NULL AND st_num_hi IS NOT NULL",
    )
    .bind(key.streetKey)
    .all<CandidateRow>();

  let contained = results.filter((row) => rangeContains({ numLo: row.st_num_lo as number, numHi: row.st_num_hi as number }, key));
  if (contained.length > 1) {
    // More than one row contains the number. Either they are different buildings (Boston
    // repeats street names across neighborhoods: two "15 Gordon St" parcels) and only the
    // ZIP can separate them, or they are twins on one ZIP (a user row and its seeded
    // double) and the user-first sort below picks the page that already has the reviews.
    const zip = zip5(input.zip);
    const zipsSeen = new Set(contained.map((row) => zip5(row.zip_code)));
    if (zip) contained = contained.filter((row) => zip5(row.zip_code) === zip);
    else if (zipsSeen.size > 1) return null;
    if (contained.length === 0) return null;
  }
  if (contained.length === 0) return null;

  contained.sort((a, b) => (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1) || a.created_at - b.created_at);
  return { id: contained[0].id, slug: contained[0].slug };
}
```

Behaviour the tests pin: two rows on different ZIPs need a ZIP that names exactly one, else `null`; two rows on the same ZIP (twins) resolve without a ZIP, user row first; a ZIP naming neither is `null`.

`src/pages/api/buildings.ts` POST:

1. After the auth check and before the rate limit, add the 415 guard (same code as `corrections.ts:28-36`).
2. After `request.json()`, add the body-shape guard returning `400 { error: 'Street address and city are required' }`.
3. Replace the dedupe block (`if (placeId) {...} else {...}`) with:

```ts
// Google-sourced: the place id is exact.
if (placeId) {
  const existing = await db.prepare('SELECT id, slug FROM buildings WHERE google_place_id = ?').bind(placeId).first<{ id: string; slug: string }>();
  if (existing) return found(existing);
}
// Boston, any source: land on the seeded (or earlier user) page for this address so one
// building never gets two pages. Writes the place id and coordinates the seeded row lacks.
const seeded = await findBuildingByAddress(db, { address: cleanAddress, city: cleanCity, zip: cleanZip });
if (seeded) {
  await db
    .prepare(
      'UPDATE buildings SET google_place_id = COALESCE(google_place_id, ?), latitude = COALESCE(latitude, ?), longitude = COALESCE(longitude, ?), updated_at = unixepoch() WHERE id = ?',
    )
    .bind(placeId || null, cleanLatitude, cleanLongitude, seeded.id)
    .run();
  return found(seeded);
}
// Manual entry anywhere: exact (address, city), case-insensitive, as before.
if (!placeId) {
  const existing = await db.prepare('SELECT id, slug FROM buildings WHERE LOWER(address) = LOWER(?) AND LOWER(city) = LOWER(?) LIMIT 1').bind(cleanAddress, cleanCity).first<{ id: string; slug: string }>();
  if (existing) return found(existing);
}
```

with a local `const found = (building: { id: string; slug: string }) => new Response(JSON.stringify({ building, created: false }), { headers: { 'Content-Type': 'application/json' } });`.

4. Slug: keep the body rule, trim the city part's hyphens too, and loop:

```ts
const base = `${addressBody}-${cityBody}`;
let slug = base;
for (let n = 2; await db.prepare('SELECT 1 AS taken FROM buildings WHERE slug = ?').bind(slug).first(); n += 1) {
  slug = `${base}-${n}`;
}
```

5. INSERT: add `street_key, st_num_lo, st_num_hi` (from `const key = addressKey(cleanAddress);` → `key?.streetKey ?? null`, `key?.numLo ?? null`, `key?.numHi ?? null`). `source` keeps its default `'user'`.

Import `findBuildingByAddress` from `../../lib/records/dedupe` and `addressKey` from `../../lib/records/identity`. Remove the now-unused `escapeLikePattern` import only if `GET` no longer uses it (it does — keep it).

- [ ] **Step 4: Run**

Run: `npx vitest run recordsDedupe recordsBuildingsRoute recordsSeedMatch locality && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/locality.ts src/lib/records/dedupe.ts src/pages/api/buildings.ts src/lib/__tests__/recordsDedupe.test.ts src/lib/__tests__/recordsBuildingsRoute.test.ts
git commit -m "feat(buildings): reviewer dedupe onto seeded Boston pages; key columns on create

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Sitemap index, chunks, and robots.txt

**Files:**
- Create: `src/lib/sitemap.ts`, `src/pages/sitemap.xml.ts`, `src/pages/sitemaps/static.xml.ts`, `src/pages/sitemaps/buildings-[n].xml.ts`, `src/pages/robots.txt.ts`
- Test: `src/lib/__tests__/recordsSitemap.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import {
  SITEMAP_CHUNK,
  STATIC_SITEMAP_PATHS,
  buildingChunkCount,
  buildingSitemapEntries,
  landlordSitemapEntries,
  renderSitemapIndex,
  renderUrlSet,
  toLastmod,
} from '../sitemap';

const suite = sqliteAvailable ? describe : describe.skip;
const SITE = 'https://ratemyplace.org';

async function review(db: TestD1Database, buildingId: string, createdAt: number, status = 'approved'): Promise<void> {
  await db.prepare('INSERT INTO reviews (id, building_id, status, created_at) VALUES (?, ?, ?, ?)').bind(`${buildingId}-${createdAt}`, buildingId, status, createdAt).run();
}

async function pull(db: TestD1Database, buildingId: string, retrievedAt: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason, retrieved_at) VALUES (?, ?, 'boston', 's', 'l', 'q', 'ok', 0, NULL, NULL, NULL, 'seed', ?)",
    )
    .bind(`${buildingId}-${retrievedAt}`, buildingId, retrievedAt)
    .run();
}

suite('sitemap', () => {
  it('includes Boston parcels and reviewed buildings elsewhere, excludes the rest', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', slug: 'a', parcel_id: '1' });
    await insertBuilding(db, { id: 'b', slug: 'b', parcel_id: null });
    await insertBuilding(db, { id: 'c', slug: 'c', city: 'New Haven', parcel_id: null });
    await insertBuilding(db, { id: 'd', slug: 'd', city: 'New Haven', parcel_id: null });
    await review(db, 'c', 1_700_000_000);
    await review(db, 'd', 1_700_000_000, 'pending');
    const slugs = (await buildingSitemapEntries(db, 1)).map((e) => e.slug);
    expect(slugs).toEqual(['a', 'c']);
  });

  it('lastmod is the latest of updated_at, the last pull, and the last approved review', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', slug: 'a', parcel_id: '1' });
    await db.prepare("UPDATE buildings SET updated_at = 1_600_000_000 WHERE id = 'a'").run();
    await pull(db, 'a', 1_650_000_000);
    await review(db, 'a', 1_700_000_000);
    await review(db, 'a', 1_800_000_000, 'pending');
    const [entry] = await buildingSitemapEntries(db, 1);
    expect(entry.lastmod).toBe(1_700_000_000);
  });

  it('chunks by SITEMAP_CHUNK in a stable order', async () => {
    const db = createRecordsTestDb();
    for (let i = 0; i < 5; i += 1) await insertBuilding(db, { id: `b${i}`, slug: `b${i}`, parcel_id: String(i) });
    expect(SITEMAP_CHUNK).toBe(10_000);
    expect(await buildingChunkCount(db)).toBe(1);
    expect((await buildingSitemapEntries(db, 2)).length).toBe(0);
  });

  it('lists landlords with an approved review only', async () => {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO landlords (id, name, slug) VALUES ('l1', 'A', 'a'), ('l2', 'B', 'b')").run();
    await insertBuilding(db, { id: 'x', slug: 'x' });
    await db.prepare("UPDATE buildings SET landlord_id = 'l1' WHERE id = 'x'").run();
    await review(db, 'x', 1_700_000_000);
    expect((await landlordSitemapEntries(db)).map((e) => e.slug)).toEqual(['a']);
  });

  it('renders valid XML with escaped locations and ISO dates', () => {
    expect(toLastmod(1_700_000_000)).toBe('2023-11-14');
    const index = renderSitemapIndex(SITE, ['static.xml', 'buildings-1.xml']);
    expect(index).toContain('<sitemapindex');
    expect(index).toContain(`<loc>${SITE}/sitemaps/buildings-1.xml</loc>`);
    const urlset = renderUrlSet([{ loc: `${SITE}/building/a&b`, lastmod: 1_700_000_000 }, { loc: `${SITE}/about`, lastmod: null }]);
    expect(urlset).toContain('<loc>https://ratemyplace.org/building/a&amp;b</loc>');
    expect(urlset).toContain('<lastmod>2023-11-14</lastmod>');
    expect(urlset).not.toContain('<lastmod></lastmod>');
  });

  it('allowlists only public static pages', () => {
    expect(STATIC_SITEMAP_PATHS).toEqual(['/', '/about', '/contact', '/guidelines', '/map', '/methodology', '/privacy', '/search', '/terms']);
    for (const path of STATIC_SITEMAP_PATHS) expect(path).not.toMatch(/admin|auth|profile|review|api/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run recordsSitemap`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/sitemap.ts`**

```ts
// Sitemap data and rendering, design spec Section 6. Included: an allowlist of static
// pages; every Boston building with a parcel; any other building, and any landlord, with an
// approved review. Excluded by construction: auth, profile, admin, review forms, property
// managers (their pages carry the named-party threshold and are reachable from buildings).
import type { RecordsDb } from './records/types';

export const STATIC_SITEMAP_PATHS: readonly string[] = ['/', '/about', '/contact', '/guidelines', '/map', '/methodology', '/privacy', '/search', '/terms'];
export const SITEMAP_CHUNK = 10_000;

export interface BuildingSitemapEntry {
  slug: string;
  /** Unix seconds: the latest of updated_at, the last record pull, and the last approved review. */
  lastmod: number;
}

const BUILDING_FROM = `
  FROM buildings b
  LEFT JOIN (SELECT building_id, MAX(retrieved_at) AS last_pull FROM record_pulls GROUP BY building_id) rp ON rp.building_id = b.id
  LEFT JOIN (SELECT building_id, MAX(created_at) AS last_review FROM reviews WHERE status = 'approved' GROUP BY building_id) rv ON rv.building_id = b.id
  WHERE (b.city = 'Boston' AND b.parcel_id IS NOT NULL) OR rv.last_review IS NOT NULL`;

export async function buildingChunkCount(db: RecordsDb): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n ${BUILDING_FROM}`).first<{ n: number }>();
  return Math.max(1, Math.ceil((row?.n ?? 0) / SITEMAP_CHUNK));
}

/** Chunk `n` (1-based) of the building URLs, ordered by id so chunk membership is stable between requests. */
export async function buildingSitemapEntries(db: RecordsDb, n: number): Promise<BuildingSitemapEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT b.slug, MAX(b.updated_at, COALESCE(rp.last_pull, 0), COALESCE(rv.last_review, 0)) AS lastmod ${BUILDING_FROM} ORDER BY b.id LIMIT ? OFFSET ?`,
    )
    .bind(SITEMAP_CHUNK, (n - 1) * SITEMAP_CHUNK)
    .all<BuildingSitemapEntry>();
  return results;
}

export interface LandlordSitemapEntry {
  slug: string;
  lastmod: number;
}

export async function landlordSitemapEntries(db: RecordsDb): Promise<LandlordSitemapEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT l.slug, MAX(r.created_at) AS lastmod
       FROM landlords l
       JOIN buildings b ON b.landlord_id = l.id
       JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
       GROUP BY l.id ORDER BY l.id`,
    )
    .all<LandlordSitemapEntry>();
  return results;
}

export function toLastmod(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export interface UrlEntry {
  loc: string;
  lastmod: number | null;
}

export function renderUrlSet(entries: readonly UrlEntry[]): string {
  const body = entries
    .map((e) => `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${toLastmod(e.lastmod)}</lastmod>` : ''}</url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function renderSitemapIndex(siteUrl: string, files: readonly string[]): string {
  const body = files.map((f) => `  <sitemap><loc>${escapeXml(`${siteUrl}/sitemaps/${f}`)}</loc></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export const SITEMAP_HEADERS = { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };

export function siteUrlFrom(env: { SITE_URL?: string } | undefined): string {
  return (env?.SITE_URL || 'https://ratemyplace.org').replace(/\/+$/, '');
}
```

- [ ] **Step 4: The routes**

`src/pages/sitemap.xml.ts`:

```ts
import type { APIContext } from 'astro';
import { getDB } from '../lib/db';
import { getEnv } from '../lib/runtime';
import { SITEMAP_HEADERS, buildingChunkCount, renderSitemapIndex, siteUrlFrom } from '../lib/sitemap';

export async function GET(context: APIContext): Promise<Response> {
  const site = siteUrlFrom(getEnv(context));
  try {
    const chunks = await buildingChunkCount(getDB(context));
    const files = ['static.xml', ...Array.from({ length: chunks }, (_, i) => `buildings-${i + 1}.xml`)];
    return new Response(renderSitemapIndex(site, files), { headers: SITEMAP_HEADERS });
  } catch {
    // D1 down: still answer with the static file so the index is never a 500 to a crawler.
    return new Response(renderSitemapIndex(site, ['static.xml']), { headers: SITEMAP_HEADERS });
  }
}
```

`src/pages/sitemaps/static.xml.ts`: static paths (lastmod null) plus `landlordSitemapEntries` mapped to `${site}/landlord/${slug}`; on a DB error render the static paths alone.

`src/pages/sitemaps/buildings-[n].xml.ts`: parse `context.params.n` as a positive integer (else 404); `buildingSitemapEntries(db, n)`; empty → 404; render `${site}/building/${slug}` with lastmod; on a DB error return 503 with `Retry-After: 300`.

`src/pages/robots.txt.ts`:

```ts
import type { APIContext } from 'astro';
import { getEnv } from '../lib/runtime';
import { siteUrlFrom } from '../lib/sitemap';

export function GET(context: APIContext): Response {
  const site = siteUrlFrom(getEnv(context));
  const body = ['User-agent: *', 'Allow: /', 'Disallow: /admin/', 'Disallow: /api/', 'Disallow: /auth/', 'Disallow: /profile', 'Disallow: /review/', 'Disallow: /dispute', '', `Sitemap: ${site}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
```

Check `getEnv` tolerates a missing runtime in tests (it reads `context.locals.runtime.env`); if a route test is added, pass `runtime: { env: { DB: db, SITE_URL: 'https://ratemyplace.org' } }`.

- [ ] **Step 5: Run and look**

Run: `npx vitest run recordsSitemap && npm run check && npm run build`. Then with the dev server on the seeded local D1: `curl -s localhost:4321/sitemap.xml` shows `static.xml` and four `buildings-N.xml` entries (38k rows / 10k); `curl -s localhost:4321/sitemaps/buildings-1.xml | head` shows building URLs with `lastmod`; `/sitemaps/buildings-9.xml` is 404; `/robots.txt` names the index.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sitemap.ts src/pages/sitemap.xml.ts src/pages/sitemaps src/pages/robots.txt.ts src/lib/__tests__/recordsSitemap.test.ts
git commit -m "feat(seo): chunked sitemap index from D1 and robots.txt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Docs, policy text, strategy, spec amendment, roadmap

No new behaviour; every edit names the code that now exists.

**Files:** `src/pages/methodology.astro`, `src/pages/privacy.astro`, `AGENTS.md`, `src/lib/AGENTS.md`, `MASTER.md`, `docs/runbooks/records-scheduler.md`, `ops/growth/STRATEGY.md`, `.planning/milestones/v1.6.0-ROADMAP.md`, `.planning/milestones/v1.7.0-ROADMAP.md`, `docs/superpowers/specs/2026-09-08-boston-coverage-design.md`.

- [ ] **Step 1: Methodology** — in the "Public records are not scored" card (line ~578), add a third paragraph after the 311 one:

> How often records refresh: a building with a review, a saved follower, or a reader's records request is re-pulled about monthly. Every other Boston building is pulled once in a city-wide pass and refreshed about yearly. Every value on the panel shows its own retrieval date, so a reader never has to guess which rule applied.

Do not change any h2 wording (`methodologyContents.test.ts` pins them). Run `npx vitest run methodologyContents`.

- [ ] **Step 2: Privacy** — in the "Public Records" list add:

> `<li><strong>Requesting a building's records:</strong> Pressing "Get this building's city records" stores the building and the time of the request, not who pressed it. The rate limiter that protects the button keeps your IP address for one hour, as it does for every public form on the site.</li>`

- [ ] **Step 3: Root `AGENTS.md`** — (a) in "Turnstile and email" make the list read `signup, signin, forgot-password, contact, disputes, bug reports, reviews, record corrections, and the public records request (`/api/records/request`)`; (b) in the "Two admin paths pull synchronously" trap replace "and the reader-facing button, which enqueues rather than pulls, arrives in C3" with "and the reader-facing button (`src/pages/api/records/request.ts`) enqueues a `button` row rather than pulling"; (c) add a trap: "**Search is not reviewed-only any more, but browse and the map are.** `buildingSearchWhere` / `buildingSearchSelect` / `BUILDING_SEARCH_ORDER` in `src/lib/searchSql.ts` are the only spelling of the query-mode buildings query; `recordsSearchParity.test.ts` fails if either call site stops using them or if the browse-mode and landlord `HAVING COUNT(r.id) > 0` guards change count."; (d) add a trap: "**`/sitemap.xml`, `/sitemaps/*.xml`, and `/robots.txt` are D1-backed routes** in `src/pages/`, not files in `public/`. The static-page allowlist is `STATIC_SITEMAP_PATHS` in `src/lib/sitemap.ts`; a new public page is not in the sitemap until it is added there."

- [ ] **Step 4: `src/lib/AGENTS.md`** — under `records/`: add bullets for `coverage.ts` (the page-state table; `DEEPER_SOURCE_IDS` lives here and the scheduler re-exports it), `request.ts` (limits 3/h per IP, 300/day), `dedupe.ts` (precedence: place id → Boston address key + parity range + ZIP tiebreak, user row before seeded twin → exact address/city), and `stripTrailingLocality` (called only by `addressKey`); change the `searchQuery.ts` line from aspiration to fact ("consumed by `searchSql.ts`"). Add a top-level bullet for `searchSql.ts`, `buildingMeta.ts`, and `sitemap.ts`.

- [ ] **Step 5: `MASTER.md`** — under "Public building records", replace "Pulls are admin-triggered. Nothing is fetched from a city API on a public page view." with "Pulls are admin-triggered, reader-requested (a button that enqueues one pull for the scheduled Worker), or scheduled. Nothing is fetched from a city API on a public page view." Move sub-project C from **Planned** to **Built today** with one bullet: "Every whole-building rental parcel in Boston (38,208 pages) is seeded from the assessor; search returns them after reviewed buildings; a sitemap lists them; a companion Cron Worker fills in the deeper sources city-wide and refreshes the buildings people follow, review, or ask about."

- [ ] **Step 6: Runbook** — add a section `## Turning the city-wide fill on for the first time` between "First deploy" and "Reading the admin panel":

> The Worker ships paused. Once the C3 site release is live (search, the records button, the sitemap), turn the fill on once, deliberately: open `/admin/records`, confirm the fixture line reads "All checks passed" with today's date, then press **Resume fill**. Within a minute `records_drain` lines start showing `pulled: 1` and `fillPaused: false`. Watch three numbers on the first day: **Completed (24 h)** should climb toward about 1,440; **Oldest pending** should stay under an hour; and `SELECT source_id, status, COUNT(*) FROM record_pulls WHERE retrieved_at >= unixepoch() - 86400 GROUP BY 1, 2` should show errors well under half of attempts for every source. If the 06:00 planner pauses the fill and emails, read the email before resuming — see below.

- [ ] **Step 7: `ops/growth/STRATEGY.md`** — append to the decision log:

> ### 2026-09-09: the reader-first deferral is lifted for Boston
>
> The condition set on 2026-09-06 is met. Sub-project C is live: a page for each of the 38,208 whole-building rental parcels in Boston, each carrying the assessor's facts, each in search and in the sitemap, each able to ask the city for its deeper records at a reader's request. A reader arriving with a Boston address now finds something there.
>
> What changes: reader acquisition for Boston addresses is in scope. Address-intent search and the sitemap are the first channels, because they cost nothing per visit. What does not change: no content farms, no neighborhood pages written for crawlers, and the map stays reviewed-only. Outside Boston the rule above still holds.
>
> See `docs/superpowers/specs/2026-09-08-boston-coverage-design.md`.

- [ ] **Step 8: Roadmaps** — v1.7: line 67 becomes `- **C3 — shipped <date>** (PR #<n>). Public page states and the records button (`POST /api/records/request`), the follower enqueue on save, search over every Boston building with reviewed results first, reviewer dedupe onto seeded pages, the sitemap index and `robots.txt`, seeded-page metadata, and the docs and strategy text. The pause flag is cleared by the owner per the runbook after this release.`; line 62 becomes `- **C2 — shipped 2026-09-09** (PR #28).` Update the "Relationship to v1.6.0" paragraph: Phase 29's sitemap is built here; the strategy deferral is lifted (decision log 2026-09-09). v1.6: mark the Phase 29 "public-only sitemap" row as delivered by v1.7 Phase 32 with a pointer, and amend line 240 so "neighborhood content farms" stays out of scope while the "reader acquisition deferral" reference points at the 2026-09-09 decision.

- [ ] **Step 9: Spec amendment** — under Section 4, 5 and 6 add a `> **Amended <date>, as built (C3):**` block recording the five as-built decisions listed at the top of this plan, the copy constants' home (`display.ts`), the `RecordsRequestState` table, and that the sitemap's static list omits property-manager pages.

- [ ] **Step 10: Full verification and commit**

```bash
npm test && npm run check && npm run build
```

All green, then:

```bash
git add src/pages/methodology.astro src/pages/privacy.astro AGENTS.md src/lib/AGENTS.md MASTER.md docs/runbooks/records-scheduler.md ops/growth/STRATEGY.md .planning/milestones/v1.6.0-ROADMAP.md .planning/milestones/v1.7.0-ROADMAP.md docs/superpowers/specs/2026-09-08-boston-coverage-design.md
git commit -m "docs: C3 as built — policy text, traps, runbook first unpause, strategy deferral lifted

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Done when

- `npm test`, `npm run check`, `npm run build` are clean on `feat/boston-coverage-c3`.
- On the local seeded D1: a seeded page shows the facts strip, four "Not retrieved yet" rows, the records button, the no-reviews card, and the records-page `<title>`; pressing the button (Turnstile passes locally with no secret) yields the "Records requested" line and one `button` row in `records_queue`; a second press does not add a row; a page with a pending `button` row shows the line and no button.
- `/search?q=1027+comm+ave` returns Commonwealth Avenue buildings with the seeded line; a reviewed building sorts above seeded ones for the same query; `/search` browse and `/map` are unchanged.
- Signing in and creating a review at "25 Lanark Rd, Boston" lands on the existing `27-lanark-road-boston` page rather than creating a row.
- `/sitemap.xml` lists `static.xml` plus four building chunks; `/robots.txt` names it.
- PR opened against `main` with the owner's post-merge checklist: deploy the Worker (still pending from C2: token permission, secrets, `records:worker:deploy`), verify Turnstile on the production button, then turn the fill on per the runbook.
