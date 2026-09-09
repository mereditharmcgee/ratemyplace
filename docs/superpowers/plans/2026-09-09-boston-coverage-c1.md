# Boston Coverage C1: Migration, Address Keys, Seed Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship migration 0031, the address-key and search-term helpers, and an idempotent seed script that turns the FY2026 assessor plus SAM address points into about 38,400 Boston building rows with an assessor provenance row and assessment record each, matching the Boston buildings already in production onto their parcels first.

**Architecture:** Pure, unit-tested modules under `src/lib/records/seed/` do every transformation on plain objects (filter, collapse, format, match, emit SQL). A thin script `scripts/records-seed-boston.ts` downloads the two datasets through a new CKAN paging helper, caches them as JSON, runs the modules, writes SQL batch files, and applies them with `wrangler d1 execute --remote --file`. Nothing in the site's request path changes in C1.

**Tech Stack:** TypeScript, Vitest with the `node:sqlite` `TestD1Database` double (`src/lib/__tests__/helpers/`), Cloudflare D1 (SQLite), data.boston.gov CKAN `datastore_search` (paged) and the existing `datastore_search_sql` helper, `tsx` for scripts, `wrangler` CLI.

**Spec:** `docs/superpowers/specs/2026-09-08-boston-coverage-design.md`. Two amendments this plan makes to it (Task 14 records them in the spec): `record_pulls` gains a nullable `trigger_reason` column because `triggered_by` is a foreign key to `users` and cannot hold `'seed'`; and neighborhood comes from SAM's `MAILING_NEIGHBORHOOD` first, falling back to the assessor `CITY` column.

**Facts verified live on 2026-09-09 that the code below relies on:**
- Assessor FY2026 resource `ee73430d-96c0-423e-ad21-c4cfb54c8961`. `ST_NAME` is mixed case with an abbreviated suffix (`Chelsea ST`, `PRINCETON ST`), `ST_NUM`/`ST_NUM2` are strings, `RES_UNITS` is often null on R2/R3, `CITY` is a postal district in caps (`EAST BOSTON`), `BLDG_SEQ` is a string.
- SAM CSV resource `6d6cfc99-6f26-4974-bbb3-17b5dbad49a9`, 399,457 rows. Columns used: `SAM_ADDRESS_ID`, `RELATIONSHIP_TYPE` (`'1'` = the building's primary address, `'2'` = a unit), `PARCEL_ID` (10 digits with leading zero), `MAILING_NEIGHBORHOOD`, `ZIP_CODE`, `POINT_X` (longitude), `POINT_Y` (latitude), `UNIT`.
- `datastore_search` returns at most 32,000 rows per request; `fields` and `filters` (JSON, array value = IN) are honored.
- Lanark fixture: parcel `2102098000`, SAM id `83763`, `23-27 Lanark Rd`, Brighton, 02135, lon `-71.1458`, lat `42.33909`.

**Conventions for every task:** TDD (failing test, run it, implement, run it, commit). Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Run `npm test` before every commit. No `any`. Every CKAN identifier is a code constant. Run commands from the worktree root `C:\Users\mmcge\ratemyplace-boston\.worktrees\building-records` on branch `feat/boston-coverage-c1` (create it from `origin/main` after merging the spec branch, or from `feat/boston-coverage-spec`).

---

## File map

| File | Responsibility |
|---|---|
| `migrations/0031_boston_coverage.sql` | Create: buildings columns and indexes, `records_queue`, `app_settings`, `record_pulls.trigger_reason` |
| `src/lib/__tests__/helpers/recordsDb.ts` | Modify: stub gains `latitude`, `longitude`, `google_place_id`; migrations list gains 0031 |
| `src/lib/records/identity.ts` | Modify: export `splitSuffix`, `streetKey`, `addressKey`, `SUFFIX_SPELLINGS` |
| `src/lib/searchQuery.ts` | Create: `normalizeSearchQuery` |
| `src/lib/records/ckan.ts` | Modify: add `CKAN_SEARCH_ENDPOINT`, `fetchAllRows` paging helper |
| `src/lib/records/sources/boston/assessor.ts` | Modify: export `assessmentFromRow` (the former `mapRow`) and `MODERN_COLUMNS` |
| `src/lib/records/seed/types.ts` | Create: `AssessorRow`, `SamRow`, `SamPoint`, `SeedBuilding`, `ExistingBuilding` |
| `src/lib/records/seed/filters.ts` | Create: land-use allowlist, `isSeedParcelRow` |
| `src/lib/records/seed/format.ts` | Create: `formatSeedAddress`, `seedSlug`, `buildingTypeFor`, `titleCaseNeighborhood` |
| `src/lib/records/seed/sam.ts` | Create: `indexSamByParcel` |
| `src/lib/records/seed/collapse.ts` | Create: `collapseAssessorRows` → `SeedBuilding[]` |
| `src/lib/records/seed/match.ts` | Create: `matchExistingBuildings` |
| `src/lib/records/seed/sql.ts` | Create: `seedStatements` emitting SQL strings |
| `scripts/records-seed-boston.ts` | Create: download, cache, orchestrate, write batches, apply |
| `scripts/records-fixture-check.ts` | Modify: SAM check for the Lanark parcel |
| `package.json` | Modify: `records:seed` script |
| `.gitignore` | Modify: `.cache/` |
| `migrations/AGENTS.md`, `src/lib/AGENTS.md`, spec | Modify: document 0031, the seed module, the two amendments |

---

### Task 1: Migration 0031 and the test-db helper

**Files:**
- Create: `migrations/0031_boston_coverage.sql`
- Modify: `src/lib/__tests__/helpers/recordsDb.ts`
- Test: `src/lib/__tests__/migration0031.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/migration0031.test.ts
import { describe, expect, it } from 'vitest';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

describe('migration 0031 (Boston coverage)', () => {
  it('adds source, street key, and number range to buildings with a user default', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { id: 'b1' });
    const row = await db
      .prepare('SELECT source, street_key, st_num_lo, st_num_hi FROM buildings WHERE id = ?')
      .bind(id)
      .first<{ source: string; street_key: string | null; st_num_lo: number | null; st_num_hi: number | null }>();
    expect(row).toEqual({ source: 'user', street_key: null, st_num_lo: null, st_num_hi: null });
  });

  it('rejects a source outside user/seed', async () => {
    const db = createRecordsTestDb();
    await expect(async () =>
      db.prepare("INSERT INTO buildings (id, address, slug, city, source) VALUES ('b2', '1 A St', 'b2', 'Boston', 'import')").run(),
    ).rejects.toThrow(/CHECK/);
  });

  it('creates records_queue with one pending row per building and a reason check', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b1', 'button', 0)").run();
    await expect(async () =>
      db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b1', 'fill', 2)").run(),
    ).rejects.toThrow(/UNIQUE/);
    await expect(async () =>
      db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b1', 'view', 0)").run(),
    ).rejects.toThrow(/CHECK|UNIQUE/);
  });

  it('allows a second pending row once the first is done', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b1' });
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority, done_at) VALUES ('b1', 'fill', 2, 1)").run();
    await db.prepare("INSERT INTO records_queue (building_id, reason, priority) VALUES ('b1', 'button', 0)").run();
    const n = await db.prepare("SELECT COUNT(*) AS n FROM records_queue WHERE building_id = 'b1'").first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it('creates app_settings and record_pulls.trigger_reason', async () => {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO app_settings (key, value) VALUES ('records_fill_paused', '1')").run();
    const setting = await db.prepare("SELECT value FROM app_settings WHERE key = 'records_fill_paused'").first<{ value: string }>();
    expect(setting?.value).toBe('1');
    await insertBuilding(db, { id: 'b1' });
    await db
      .prepare(
        "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, triggered_by, trigger_reason) VALUES ('p1', 'b1', 'boston', 'src', 'Src', 'q', 'ok', 1, NULL, 'seed')",
      )
      .run();
    const pull = await db.prepare("SELECT trigger_reason FROM record_pulls WHERE id = 'p1'").first<{ trigger_reason: string }>();
    expect(pull?.trigger_reason).toBe('seed');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run migration0031`
Expected: FAIL with "no such column: source" (the migration does not exist yet).

- [ ] **Step 3: Write the migration**

```sql
-- migrations/0031_boston_coverage.sql
-- Boston coverage, sub-project C (spec: docs/superpowers/specs/2026-09-08-boston-coverage-design.md)
--
-- PRODUCTION NOTE: the ALTER TABLE ... ADD COLUMN statements are not idempotent (SQLite
-- has no IF NOT EXISTS for columns). Apply once with `wrangler d1 execute --remote --file`,
-- never `migrations apply --remote`. See migrations/AGENTS.md.

-- Which pipeline created the row. Seeded rows come from the assessor bulk download.
ALTER TABLE buildings ADD COLUMN source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','seed'));
-- Normalized street name plus abbreviated suffix, e.g. 'LANARK RD', and the house-number
-- range (equal for a single number). Populated by the seed for Boston rows and by the
-- building-creation endpoint for anything created afterwards. Reviewer dedupe and the
-- seed's existing-row matching both look up on (city, street_key) then range-contain.
ALTER TABLE buildings ADD COLUMN street_key TEXT;
ALTER TABLE buildings ADD COLUMN st_num_lo INTEGER;
ALTER TABLE buildings ADD COLUMN st_num_hi INTEGER;
CREATE INDEX IF NOT EXISTS idx_buildings_street ON buildings(city, street_key);

-- Why a pull ran, for pulls with no admin behind them. triggered_by stays a users(id)
-- foreign key (0029); a seed or queue pull leaves it NULL and says why here.
ALTER TABLE record_pulls ADD COLUMN trigger_reason TEXT;

-- One row per pending pull. A building has at most one pending row; finished rows are
-- kept (button rows forever, as the record that a reader asked; refresh/fill rows 90 days).
CREATE TABLE IF NOT EXISTS records_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('button','follower','refresh','fill')),
  priority INTEGER NOT NULL,
  requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
  locked_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  done_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_queue_pending_building ON records_queue(building_id) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_records_queue_pending ON records_queue(priority, requested_at) WHERE done_at IS NULL;

-- Small operator switches. First key: records_fill_paused ('1' or '0').
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

- [ ] **Step 4: Update the test helper**

In `src/lib/__tests__/helpers/recordsDb.ts`, add three columns to the stub `buildings` table (after `building_type TEXT,`):

```ts
      latitude REAL,
      longitude REAL,
      google_place_id TEXT,
```

and change `applyRecordsMigrations` to:

```ts
export function applyRecordsMigrations(db: TestD1Database): void {
  for (const file of ['0029_building_records.sql', '0030_audit_records_actions.sql', '0031_boston_coverage.sql']) {
    db.exec(readFileSync(join(process.cwd(), 'migrations', file), 'utf8'));
  }
}
```

Remove the two throwaway lines in the last test (`const cols = ...` and its `expect`); they were a placeholder while writing and add nothing.

- [ ] **Step 5: Run the test and the whole suite**

Run: `npx vitest run migration0031` then `npm test`
Expected: PASS; full suite green (every records test now runs on 0031 as well).

- [ ] **Step 6: Apply locally and commit**

Run: `npx wrangler d1 migrations apply ratemyplace-db --local`
Expected: `0031_boston_coverage.sql` applied.

```bash
git add migrations/0031_boston_coverage.sql src/lib/__tests__/helpers/recordsDb.ts src/lib/__tests__/migration0031.test.ts
git commit -m "feat(records): migration 0031 for Boston coverage (queue, settings, address keys)"
```

---

### Task 2: `splitSuffix`, `streetKey`, `addressKey` in identity.ts

**Files:**
- Modify: `src/lib/records/identity.ts`
- Test: `src/lib/__tests__/addressKey.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/addressKey.test.ts
import { describe, expect, it } from 'vitest';
import { addressKey, splitSuffix, streetKey } from '../records/identity';

describe('splitSuffix', () => {
  it('splits a known suffix and returns its spellings', () => {
    expect(splitSuffix('Commonwealth Avenue')).toEqual({ base: 'COMMONWEALTH', spellings: ['AV', 'AVE', 'AVENUE'] });
  });
  it('keeps a street with no suffix', () => {
    expect(splitSuffix('The Fenway')).toEqual({ base: 'THE FENWAY', spellings: null });
  });
  it('abbreviates a leading directional only when a name follows', () => {
    expect(splitSuffix('West Broadway')).toEqual({ base: 'W BROADWAY', spellings: null });
    expect(splitSuffix('North St')).toEqual({ base: 'NORTH', spellings: ['ST', 'STREET'] });
  });
});

describe('streetKey', () => {
  it('uses the assessor spelling of the suffix', () => {
    expect(streetKey('Lanark Road')).toBe('LANARK RD');
    expect(streetKey('Lanark Rd')).toBe('LANARK RD');
    expect(streetKey('LANARK RD')).toBe('LANARK RD');
  });
  it('drops units and punctuation', () => {
    expect(streetKey('Beacon St., Apt 3')).toBe('BEACON ST');
  });
});

describe('addressKey', () => {
  it('parses a single number', () => {
    expect(addressKey('1027 Commonwealth Avenue')).toEqual({ streetKey: 'COMMONWEALTH AV', numLo: 1027, numHi: 1027 });
  });
  it('parses a range', () => {
    expect(addressKey('23-27 Lanark Rd')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 27 });
  });
  it('drops a letter suffix on the number', () => {
    expect(addressKey('12A Beacon St')).toEqual({ streetKey: 'BEACON ST', numLo: 12, numHi: 12 });
  });
  it('orders a reversed range', () => {
    expect(addressKey('27-23 Lanark Rd')).toEqual({ streetKey: 'LANARK RD', numLo: 23, numHi: 27 });
  });
  it('returns null when there is no number or the street is degenerate', () => {
    expect(addressKey('Lanark Rd')).toBeNull();
    expect(addressKey('5 Ave')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run addressKey`
Expected: FAIL, `splitSuffix` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/records/identity.ts`, export the suffix table and add the three functions after `splitStreet` (keep `splitStreet` and `normalizeStreet` as they are):

```ts
export { SUFFIX_SPELLINGS };

/** Public form of the normalize-then-split step: uppercase, unit- and punctuation-free, suffix split off. */
export function splitSuffix(street: string): { base: string; spellings: readonly string[] | null } {
  return splitStreet(normalizeStreet(street));
}

/**
 * The lookup key shared by seeded rows and reviewer dedupe: base name plus the assessor's
 * spelling of the suffix ('LANARK RD'), or the bare base when there is no suffix.
 */
export function streetKey(street: string): string {
  const { base, spellings } = splitSuffix(street);
  return spellings ? `${base} ${spellings[0]}` : base;
}

export interface AddressKey {
  streetKey: string;
  numLo: number;
  numHi: number;
}

/**
 * Street key plus house-number range for one address line. A lettered number ('12A')
 * keys on its digits; a range is ordered low to high. Null when there is no leading
 * number or the street is degenerate (the same rule buildIdentity throws on).
 */
export function addressKey(address: string): AddressKey | null {
  const parsed = parseStreetAddress(address.trim());
  if (!parsed) return null;
  const numbers = parsed.number
    .toUpperCase()
    .split('-')
    .map((p) => Number.parseInt(p.replace(/[A-Z]+$/, ''), 10))
    .filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return null;
  const { base, spellings } = splitSuffix(parsed.street);
  if (!base || (!spellings && SUFFIX_ROW_BY_SPELLING.has(base)) || /^[^A-Z0-9]/.test(base)) return null;
  return {
    streetKey: spellings ? `${base} ${spellings[0]}` : base,
    numLo: Math.min(...numbers),
    numHi: Math.max(...numbers),
  };
}
```

Note: `SUFFIX_SPELLINGS` is declared with `const` above; the `export { SUFFIX_SPELLINGS }` line re-exports it without changing the declaration.

- [ ] **Step 4: Run tests**

Run: `npx vitest run addressKey identity`
Expected: PASS, and the existing identity tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/records/identity.ts src/lib/__tests__/addressKey.test.ts
git commit -m "feat(records): streetKey and addressKey for seed matching and reviewer dedupe"
```

---

### Task 3: `normalizeSearchQuery`

**Files:**
- Create: `src/lib/searchQuery.ts`
- Test: `src/lib/__tests__/searchQuery.test.ts`

The search page (C3) will AND one `LIKE` clause per term. This task ships only the pure term splitter with suffix expansion to the long spelling, because stored addresses use long spellings ("Commonwealth Avenue").

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/searchQuery.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeSearchQuery } from '../searchQuery';

describe('normalizeSearchQuery', () => {
  it('splits on whitespace and expands suffix abbreviations to the long spelling', () => {
    expect(normalizeSearchQuery('1027 comm ave')).toEqual(['1027', 'comm', 'avenue']);
    expect(normalizeSearchQuery('Lanark Rd')).toEqual(['lanark', 'road']);
  });
  it('strips punctuation and collapses spaces', () => {
    expect(normalizeSearchQuery('  Beacon St., #3 ')).toEqual(['beacon', 'street', '3']);
  });
  it('keeps a hyphenated range as one term', () => {
    expect(normalizeSearchQuery('23-27 Lanark')).toEqual(['23-27', 'lanark']);
  });
  it('returns an empty list for an empty or punctuation-only query', () => {
    expect(normalizeSearchQuery('')).toEqual([]);
    expect(normalizeSearchQuery('...')).toEqual([]);
  });
  it('caps the number of terms at 8', () => {
    expect(normalizeSearchQuery('a b c d e f g h i j')).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run searchQuery`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/searchQuery.ts
import { SUFFIX_SPELLINGS } from './records/identity';

/** Longest spelling per row: 'AVE' -> 'avenue'. Stored addresses use the long form. */
const LONG_SPELLING = new Map<string, string>(
  SUFFIX_SPELLINGS.flatMap((row) => {
    const longest = row.reduce((a, b) => (b.length > a.length ? b : a)).toLowerCase();
    return row.map((spelling) => [spelling.toLowerCase(), longest] as const);
  }),
);

const MAX_TERMS = 8;

/**
 * Turns a free-text search into lowercase terms for one LIKE clause each. Punctuation
 * other than the hyphen inside a house-number range is dropped; a suffix abbreviation
 * becomes its long spelling so 'comm ave' matches 'Commonwealth Avenue'.
 */
export function normalizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .map((term) => LONG_SPELLING.get(term) ?? term)
    .slice(0, MAX_TERMS);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run searchQuery`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/searchQuery.ts src/lib/__tests__/searchQuery.test.ts
git commit -m "feat(search): normalizeSearchQuery splits terms and expands suffix abbreviations"
```

---

### Task 4: CKAN paging helper `fetchAllRows`

**Files:**
- Modify: `src/lib/records/ckan.ts`
- Test: `src/lib/__tests__/ckanPaging.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/ckanPaging.test.ts
import { describe, expect, it } from 'vitest';
import { CKAN_SEARCH_ENDPOINT, fetchAllRows } from '../records/ckan';
import type { FetchLike } from '../records/types';

function fakeCkan(total: number, pageSize: number): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = Number(url.searchParams.get('limit'));
    const records = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ _id: offset + i + 1 }));
    return new Response(JSON.stringify({ success: true, result: { records, total } }), { status: 200 });
  };
  return { fetchImpl, urls };
}

describe('fetchAllRows', () => {
  it('pages through a resource until a short page and concatenates the rows', async () => {
    const { fetchImpl, urls } = fakeCkan(7, 3);
    const rows = await fetchAllRows<{ _id: number }>('res-1', { fields: ['_id'], pageSize: 3 }, fetchImpl);
    expect(rows.map((r) => r._id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(`${CKAN_SEARCH_ENDPOINT}?`);
    expect(urls[0]).toContain('resource_id=res-1');
    expect(urls[0]).toContain('fields=_id');
    expect(urls[2]).toContain('offset=6');
  });

  it('sends filters as JSON and stops after an exact multiple of the page size', async () => {
    const { fetchImpl, urls } = fakeCkan(6, 3);
    const rows = await fetchAllRows<{ _id: number }>('res-1', { pageSize: 3, filters: { LU: ['A', 'R2'] } }, fetchImpl);
    expect(rows).toHaveLength(6);
    expect(urls).toHaveLength(3); // third call returns 0 rows and ends the loop
    expect(decodeURIComponent(urls[0])).toContain('filters={"LU":["A","R2"]}');
  });

  it('throws on a non-success response with the resource in the message', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({ success: false, error: { message: 'nope' } }), { status: 409 });
    await expect(fetchAllRows('res-2', {}, fetchImpl)).rejects.toThrow(/res-2/);
  });

  it('reports progress per page', async () => {
    const { fetchImpl } = fakeCkan(4, 2);
    const seen: number[] = [];
    await fetchAllRows('res-1', { pageSize: 2, onPage: (count) => seen.push(count) }, fetchImpl);
    expect(seen).toEqual([2, 4]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run ckanPaging`
Expected: FAIL, `fetchAllRows` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/records/ckan.ts`:

```ts
export const CKAN_SEARCH_ENDPOINT = 'https://data.boston.gov/api/3/action/datastore_search';
/** data.boston.gov caps datastore_search at 32,000 rows per request (verified 2026-09-09). */
export const CKAN_MAX_PAGE = 32_000;

export interface FetchAllRowsOptions {
  /** Columns to return; omit for all. Always name them: `_full_text` alone doubles the payload. */
  fields?: string[];
  /** Equality filters; an array value means IN. Sent as CKAN's JSON `filters` parameter. */
  filters?: Record<string, string | string[]>;
  pageSize?: number;
  onPage?: (rowsSoFar: number) => void;
}

/**
 * Bulk download of one datastore resource through the paged `datastore_search` action.
 * Used by the seed script, never by a request handler. `filters` and `fields` are
 * parameters, not interpolated SQL, so nothing here needs sqlLiteral.
 */
export async function fetchAllRows<T>(resourceId: string, options: FetchAllRowsOptions, fetchImpl: FetchLike): Promise<T[]> {
  const pageSize = options.pageSize ?? CKAN_MAX_PAGE;
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const params = new URLSearchParams({ resource_id: resourceId, limit: String(pageSize), offset: String(offset) });
    if (options.fields) params.set('fields', options.fields.join(','));
    if (options.filters) params.set('filters', JSON.stringify(options.filters));
    const response = await fetchImpl(`${CKAN_SEARCH_ENDPOINT}?${params.toString()}`, { method: 'GET' });
    const body = (await response.json()) as { success?: boolean; result?: { records?: T[] }; error?: { message?: string } };
    if (!response.ok || !body.success || !body.result?.records) {
      throw new Error(`CKAN datastore_search failed for ${resourceId} at offset ${offset}: ${body.error?.message ?? response.status}`);
    }
    rows.push(...body.result.records);
    options.onPage?.(rows.length);
    if (body.result.records.length < pageSize) break;
  }
  return rows;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run ckanPaging ckan`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/records/ckan.ts src/lib/__tests__/ckanPaging.test.ts
git commit -m "feat(records): fetchAllRows pages a CKAN resource for bulk downloads"
```

---

### Task 5: Export `assessmentFromRow` from the assessor adapter

**Files:**
- Modify: `src/lib/records/sources/boston/assessor.ts`
- Test: `src/lib/__tests__/assessmentFromRow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/assessmentFromRow.test.ts
import { describe, expect, it } from 'vitest';
import { ASSESSOR_YEARS, MODERN_COLUMNS, assessmentFromRow } from '../records/sources/boston/assessor';

describe('assessmentFromRow', () => {
  it('maps a modern assessor row to the assessment payload', () => {
    const payload = assessmentFromRow(
      {
        PID: '2102098000', OWNER: 'LANARK ROAD LLC', LU: 'A', LU_DESC: 'APT 7-30 UNITS', YR_BUILT: '1925', YR_REMODEL: null,
        GROSS_AREA: '12000', LIVING_AREA: '10000', RES_UNITS: '12', COM_UNITS: '0', TOTAL_VALUE: '3500000.00', LAND_VALUE: '1000000', BLDG_VALUE: '2500000',
        MAIL_ADDRESSEE: null, MAIL_STREET_ADDRESS: '1 Main St', MAIL_CITY: 'Boston', MAIL_STATE: 'MA', MAIL_ZIP_CODE: '02135',
      },
      ASSESSOR_YEARS[0],
    );
    expect(payload.fiscalYear).toBe('FY2026');
    expect(payload.parcelId).toBe('2102098000');
    expect(payload.owner).toBe('LANARK ROAD LLC');
    expect(payload.residentialUnits).toBe(12);
    expect(payload.totalValue).toBe(3500000);
    expect(payload.mailStreet).toBe('1 Main St');
    expect(payload.condominium).toBe(false);
  });

  it('exposes the modern column map the seed selects with', () => {
    expect(MODERN_COLUMNS.mailStreet).toBe('MAIL_STREET_ADDRESS');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run assessmentFromRow`
Expected: FAIL, `assessmentFromRow` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/records/sources/boston/assessor.ts`: change `const MODERN_COLUMNS` to `export const MODERN_COLUMNS`; rename `function mapRow(row: Row, year: AssessorYear)` to `export function assessmentFromRow(row: Record<string, unknown>, year: AssessorYear): AssessmentPayload` and update its one call site inside `assessorSource` (`payload: assessmentFromRow(row, year)`). Also export the fixed column list so the seed selects exactly what the adapter reads:

```ts
export const ASSESSOR_FIXED_COLUMNS: readonly string[] = FIXED_COLUMNS;
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run assessmentFromRow assessor records`
Expected: PASS, nothing else changes behavior.

- [ ] **Step 5: Commit**

```bash
git add src/lib/records/sources/boston/assessor.ts src/lib/__tests__/assessmentFromRow.test.ts
git commit -m "refactor(records): export assessmentFromRow and the assessor column lists for the seed"
```

---

### Task 6: Seed types and the land-use filter

**Files:**
- Create: `src/lib/records/seed/types.ts`
- Create: `src/lib/records/seed/filters.ts`
- Test: `src/lib/__tests__/seedFilters.test.ts`

- [ ] **Step 1: Write the types (no test; they are shapes)**

```ts
// src/lib/records/seed/types.ts
import type { AssessmentPayload } from '../types';

/** One assessor row as CKAN returns it: strings, numbers, or null; never assume which. */
export type AssessorRow = Record<string, unknown>;

/** The SAM columns the seed reads. */
export interface SamRow {
  SAM_ADDRESS_ID: string | number | null;
  RELATIONSHIP_TYPE: string | number | null;
  PARCEL_ID: string | number | null;
  MAILING_NEIGHBORHOOD: string | null;
  ZIP_CODE: string | number | null;
  POINT_X: string | number | null;
  POINT_Y: string | number | null;
  UNIT: string | null;
}

/** What the seed keeps from SAM for one parcel: its primary address point. */
export interface SamPoint {
  samId: string;
  latitude: number;
  longitude: number;
  neighborhood: string | null;
  zip: string | null;
}

/** One building to write, fully derived, before any SQL. */
export interface SeedBuilding {
  parcelId: string;
  address: string;
  streetKey: string;
  numLo: number;
  numHi: number;
  neighborhood: string | null;
  zip: string | null;
  unitCount: number | null;
  yearBuilt: number | null;
  buildingType: string;
  latitude: number | null;
  longitude: number | null;
  samId: string | null;
  assessment: AssessmentPayload;
}

/** A production building row as the script loads it. */
export interface ExistingBuilding {
  id: string;
  address: string;
  slug: string;
  parcel_id: string | null;
  latitude: number | null;
  longitude: number | null;
}
```

- [ ] **Step 2: Write the failing filter test**

```ts
// src/lib/__tests__/seedFilters.test.ts
import { describe, expect, it } from 'vitest';
import { HOUSING_A_DESCRIPTIONS, SEED_LAND_USES, isSeedParcelRow } from '../records/seed/filters';

describe('isSeedParcelRow', () => {
  it('accepts every R2, R3, R4, and RC row regardless of description', () => {
    for (const lu of ['R2', 'R3', 'R4', 'RC']) {
      expect(isSeedParcelRow({ LU: lu, LU_DESC: 'ANYTHING' })).toBe(true);
    }
  });
  it('accepts A only for the housing descriptions', () => {
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'APT 7-30 UNITS' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'SUBSD HOUSING S- 8' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'ROOMING HOUSE' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'DAY CARE CENTER' })).toBe(false);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'ELDERLY HOME' })).toBe(false);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: 'RES PARKING LOT' })).toBe(false);
  });
  it('rejects condos, single-family, and land', () => {
    for (const lu of ['CD', 'CM', 'R1', 'RL', 'C', null]) {
      expect(isSeedParcelRow({ LU: lu, LU_DESC: 'APT 7-30 UNITS' })).toBe(false);
    }
  });
  it('trims and upper-cases before comparing', () => {
    expect(isSeedParcelRow({ LU: ' r3 ', LU_DESC: 'three-fam dwelling' })).toBe(true);
    expect(isSeedParcelRow({ LU: 'A', LU_DESC: ' luxury apartment ' })).toBe(true);
  });
  it('publishes the lists the filter uses', () => {
    expect(SEED_LAND_USES).toEqual(['A', 'R2', 'R3', 'R4', 'RC']);
    expect(HOUSING_A_DESCRIPTIONS).toContain('APT 100+ UNITS');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run seedFilters`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/records/seed/filters.ts
import { textOrNull } from '../ckan';
import type { AssessorRow } from './types';

/** Land-use codes the seed downloads. R1 (single-family), CD/CM (condos), RL (land) are out of scope. */
export const SEED_LAND_USES = ['A', 'R2', 'R3', 'R4', 'RC'] as const;

/**
 * 'A' is the assessor's catch-all for apartment-class parcels. Only these descriptions are
 * housing. Excluded on purpose (verified against the FY2026 list on 2026-09-08):
 * DORMITORY bd, DORM /Residence Hall, DAY CARE CENTER, RES PARKING LOT, RES PARKING GARAGE,
 * RECTORY, CONVENT, LODGING SUITES, ELDERLY HOME (nursing homes).
 */
export const HOUSING_A_DESCRIPTIONS = [
  'APT 7-30 UNITS',
  'APT 31-99 UNITS',
  'APT 100+ UNITS',
  'LUXURY APARTMENT',
  'SUBSD HOUSING S- 8',
  'SUBSD HOUSING S-202',
  'SUBSD HOUSING S-231D',
  'ROOMING HOUSE',
] as const;

const HOUSING_A = new Set<string>(HOUSING_A_DESCRIPTIONS);
const ALWAYS = new Set<string>(['R2', 'R3', 'R4', 'RC']);

function norm(value: unknown): string {
  return (textOrNull(value) ?? '').trim().toUpperCase();
}

/** Whether one assessor row belongs in the seed. Pure; the row shape is whatever CKAN returned. */
export function isSeedParcelRow(row: Pick<AssessorRow, 'LU' | 'LU_DESC'>): boolean {
  const lu = norm(row.LU);
  if (ALWAYS.has(lu)) return true;
  if (lu === 'A') return HOUSING_A.has(norm(row.LU_DESC));
  return false;
}
```

Check `textOrNull` in `ckan.ts` accepts `unknown` (it does: `textOrNull(value: unknown)`).

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run seedFilters`
Expected: PASS.

```bash
git add src/lib/records/seed/types.ts src/lib/records/seed/filters.ts src/lib/__tests__/seedFilters.test.ts
git commit -m "feat(records): seed types and the land-use filter"
```

---

### Task 7: Address, slug, type, and neighborhood formatting

**Files:**
- Create: `src/lib/records/seed/format.ts`
- Test: `src/lib/__tests__/seedFormat.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/seedFormat.test.ts
import { describe, expect, it } from 'vitest';
import { buildingTypeFor, formatSeedAddress, seedSlug, titleCaseNeighborhood } from '../records/seed/format';

describe('formatSeedAddress', () => {
  it('spells the suffix out and title-cases the street', () => {
    expect(formatSeedAddress('23', '27', 'Lanark RD')).toBe('23-27 Lanark Road');
    expect(formatSeedAddress('1027', null, 'COMMONWEALTH AV')).toBe('1027 Commonwealth Avenue');
    expect(formatSeedAddress('432', null, 'Chelsea ST')).toBe('432 Chelsea Street');
  });
  it('keeps a directional and a single-letter street readable', () => {
    expect(formatSeedAddress('10', null, 'W BROADWAY')).toBe('10 W Broadway');
    expect(formatSeedAddress('6', '10', 'A ST')).toBe('6-10 A Street');
  });
  it('drops an equal or empty second number', () => {
    expect(formatSeedAddress('5', '5', 'Park ST')).toBe('5 Park Street');
    expect(formatSeedAddress('5', '', 'Park ST')).toBe('5 Park Street');
  });
  it('returns null without a number or street', () => {
    expect(formatSeedAddress(null, null, 'Park ST')).toBeNull();
    expect(formatSeedAddress('5', null, '')).toBeNull();
  });
});

describe('seedSlug', () => {
  it('follows the existing address-city convention', () => {
    expect(seedSlug('23-27 Lanark Road', new Set())).toBe('23-27-lanark-road-boston');
  });
  it('suffixes on collision and records the slug it took', () => {
    const taken = new Set(['5-park-street-boston']);
    expect(seedSlug('5 Park Street', taken)).toBe('5-park-street-boston-2');
    expect(taken.has('5-park-street-boston-2')).toBe(true);
    expect(seedSlug('5 Park Street', taken)).toBe('5-park-street-boston-3');
  });
});

describe('buildingTypeFor', () => {
  it('maps land use to the site building types', () => {
    expect(buildingTypeFor('R2')).toBe('two_family');
    expect(buildingTypeFor('R3')).toBe('three_family');
    expect(buildingTypeFor('R4')).toBe('apartment');
    expect(buildingTypeFor('A')).toBe('apartment');
    expect(buildingTypeFor('RC')).toBe('mixed_use');
  });
});

describe('titleCaseNeighborhood', () => {
  it('title-cases and nulls plain Boston', () => {
    expect(titleCaseNeighborhood('EAST BOSTON')).toBe('East Boston');
    expect(titleCaseNeighborhood('Jamaica Plain')).toBe('Jamaica Plain');
    expect(titleCaseNeighborhood('BOSTON')).toBeNull();
    expect(titleCaseNeighborhood(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run seedFormat`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/records/seed/format.ts
import { textOrNull } from '../ckan';
import { splitSuffix } from '../identity';

function titleWord(word: string): string {
  if (word.length <= 1) return word.toUpperCase();
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * The assessor stores '23' + '27' + 'Lanark RD'; pages read '23-27 Lanark Road'. The
 * suffix is spelled out from the identity table so the seed and the normalizer agree.
 * A leading directional stays as the assessor wrote it ('W Broadway').
 */
export function formatSeedAddress(stNum: unknown, stNum2: unknown, stName: unknown): string | null {
  const lo = textOrNull(stNum)?.trim();
  const hi = textOrNull(stNum2)?.trim();
  const street = textOrNull(stName)?.trim();
  if (!lo || !street) return null;
  const { base, spellings } = splitSuffix(street);
  if (!base) return null;
  const longest = spellings ? spellings.reduce((a, b) => (b.length > a.length ? b : a)) : null;
  const words = base.split(' ').map(titleWord);
  if (longest) words.push(titleWord(longest));
  const number = hi && hi !== lo ? `${lo}-${hi}` : lo;
  return `${number} ${words.join(' ')}`;
}

/** Same rule as POST /api/buildings, with in-batch collision handling. Adds the chosen slug to `taken`. */
export function seedSlug(address: string, taken: Set<string>): string {
  const base = `${address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-boston`;
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

const BUILDING_TYPE_BY_LU: Record<string, string> = {
  R2: 'two_family',
  R3: 'three_family',
  R4: 'apartment',
  A: 'apartment',
  RC: 'mixed_use',
};

export function buildingTypeFor(landUse: string): string {
  return BUILDING_TYPE_BY_LU[landUse.trim().toUpperCase()] ?? 'apartment';
}

/** 'EAST BOSTON' -> 'East Boston'; plain Boston carries no neighborhood. */
export function titleCaseNeighborhood(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const titled = text.split(/\s+/).map(titleWord).join(' ');
  return titled === 'Boston' ? null : titled;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run seedFormat`
Expected: PASS.

```bash
git add src/lib/records/seed/format.ts src/lib/__tests__/seedFormat.test.ts
git commit -m "feat(records): seed address, slug, type, and neighborhood formatting"
```

---

### Task 8: SAM index by parcel

**Files:**
- Create: `src/lib/records/seed/sam.ts`
- Test: `src/lib/__tests__/seedSam.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/seedSam.test.ts
import { describe, expect, it } from 'vitest';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel } from '../records/seed/sam';
import type { SamRow } from '../records/seed/types';

const row = (o: Partial<SamRow>): SamRow => ({
  SAM_ADDRESS_ID: '1', RELATIONSHIP_TYPE: '1', PARCEL_ID: '2102098000', MAILING_NEIGHBORHOOD: 'Brighton', ZIP_CODE: '02135',
  POINT_X: '-71.1458', POINT_Y: '42.33909', UNIT: null, ...o,
});

describe('indexSamByParcel', () => {
  it('keeps the primary address point with the lowest SAM id per parcel', () => {
    const index = indexSamByParcel([
      row({ SAM_ADDRESS_ID: '262632', RELATIONSHIP_TYPE: '2', UNIT: '1' }),
      row({ SAM_ADDRESS_ID: '83763' }),
      row({ SAM_ADDRESS_ID: '90000', MAILING_NEIGHBORHOOD: 'Allston' }),
    ]);
    expect(index.get('2102098000')).toEqual({ samId: '83763', latitude: 42.33909, longitude: -71.1458, neighborhood: 'Brighton', zip: '02135' });
  });
  it('falls back to a unit row when a parcel has no primary point', () => {
    const index = indexSamByParcel([row({ SAM_ADDRESS_ID: '5', RELATIONSHIP_TYPE: '2', UNIT: '3' })]);
    expect(index.get('2102098000')?.samId).toBe('5');
  });
  it('canonicalizes numeric parcel ids and skips rows without one or without coordinates', () => {
    const index = indexSamByParcel([
      row({ PARCEL_ID: 2102098000 }),
      row({ SAM_ADDRESS_ID: '2', PARCEL_ID: null }),
      row({ SAM_ADDRESS_ID: '3', PARCEL_ID: '0100037000', POINT_X: null }),
    ]);
    expect([...index.keys()]).toEqual(['2102098000']);
  });
  it('names the resource and the fields it downloads', () => {
    expect(SAM_RESOURCE_ID).toBe('6d6cfc99-6f26-4974-bbb3-17b5dbad49a9');
    expect(SAM_FIELDS).toContain('POINT_Y');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run seedSam`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/records/seed/sam.ts
import { textOrNull } from '../ckan';
import { toCanonicalParcel } from '../identity';
import type { SamPoint, SamRow } from './types';

/** Live Street Address Management (SAM) Addresses, CSV datastore resource. Verified 2026-09-09. */
export const SAM_RESOURCE_ID = '6d6cfc99-6f26-4974-bbb3-17b5dbad49a9';
export const SAM_PAGE_URL = 'https://data.boston.gov/dataset/live-street-address-management-sam-addresses';
export const SAM_FIELDS = ['SAM_ADDRESS_ID', 'RELATIONSHIP_TYPE', 'PARCEL_ID', 'MAILING_NEIGHBORHOOD', 'ZIP_CODE', 'POINT_X', 'POINT_Y', 'UNIT'] as const;

function num(value: unknown): number | null {
  const text = textOrNull(value);
  if (text === null) return null;
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * One point per parcel: the building's own address (RELATIONSHIP_TYPE 1) with the lowest
 * SAM id, or, when a parcel only has unit rows, the lowest unit row. Rows without a
 * canonical parcel id or a coordinate are skipped.
 */
export function indexSamByParcel(rows: Iterable<SamRow>): Map<string, SamPoint> {
  const best = new Map<string, { primary: boolean; id: number; point: SamPoint }>();
  for (const row of rows) {
    const parcel = toCanonicalParcel(textOrNull(row.PARCEL_ID));
    const samId = textOrNull(row.SAM_ADDRESS_ID);
    const longitude = num(row.POINT_X);
    const latitude = num(row.POINT_Y);
    if (!parcel || !samId || longitude === null || latitude === null) continue;
    const primary = textOrNull(row.RELATIONSHIP_TYPE) === '1';
    const id = Number.parseInt(samId, 10);
    const current = best.get(parcel);
    const better = !current || (primary && !current.primary) || (primary === current.primary && id < current.id);
    if (!better) continue;
    best.set(parcel, {
      primary,
      id,
      point: { samId, latitude, longitude, neighborhood: textOrNull(row.MAILING_NEIGHBORHOOD), zip: textOrNull(row.ZIP_CODE) },
    });
  }
  return new Map([...best].map(([parcel, entry]) => [parcel, entry.point]));
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run seedSam`
Expected: PASS.

```bash
git add src/lib/records/seed/sam.ts src/lib/__tests__/seedSam.test.ts
git commit -m "feat(records): index SAM address points by parcel for the seed"
```

---

### Task 9: Collapse assessor rows into `SeedBuilding`s

**Files:**
- Create: `src/lib/records/seed/collapse.ts`
- Test: `src/lib/__tests__/seedCollapse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/seedCollapse.test.ts
import { describe, expect, it } from 'vitest';
import { ASSESSOR_SEED_FIELDS, collapseAssessorRows } from '../records/seed/collapse';
import type { AssessorRow, SamPoint } from '../records/seed/types';

const base: AssessorRow = {
  PID: '2102098000', BLDG_SEQ: '1', ST_NUM: '23', ST_NUM2: '27', ST_NAME: 'Lanark RD', CITY: 'BRIGHTON', ZIP_CODE: '02135',
  LU: 'A', LU_DESC: 'APT 7-30 UNITS', OWNER: 'LANARK ROAD LLC', YR_BUILT: '1925', YR_REMODEL: null, GROSS_AREA: '12000', LIVING_AREA: '10000',
  RES_UNITS: '12', COM_UNITS: '0', TOTAL_VALUE: '3500000', LAND_VALUE: '1000000', BLDG_VALUE: '2500000',
  MAIL_ADDRESSEE: null, MAIL_STREET_ADDRESS: '1 Main St', MAIL_CITY: 'Boston', MAIL_STATE: 'MA', MAIL_ZIP_CODE: '02135',
};
const sam = new Map<string, SamPoint>([['2102098000', { samId: '83763', latitude: 42.33909, longitude: -71.1458, neighborhood: 'Brighton', zip: '02135' }]]);

describe('collapseAssessorRows', () => {
  it('builds one SeedBuilding with SAM coordinates and neighborhood', () => {
    const { buildings, skipped } = collapseAssessorRows([base], sam);
    expect(skipped).toEqual([]);
    expect(buildings).toHaveLength(1);
    const b = buildings[0];
    expect(b.parcelId).toBe('2102098000');
    expect(b.address).toBe('23-27 Lanark Road');
    expect(b.streetKey).toBe('LANARK RD');
    expect(b.numLo).toBe(23);
    expect(b.numHi).toBe(27);
    expect(b.neighborhood).toBe('Brighton');
    expect(b.zip).toBe('02135');
    expect(b.unitCount).toBe(12);
    expect(b.yearBuilt).toBe(1925);
    expect(b.buildingType).toBe('apartment');
    expect(b.latitude).toBe(42.33909);
    expect(b.samId).toBe('83763');
    expect(b.assessment.fiscalYear).toBe('FY2026');
    expect(b.assessment.owner).toBe('LANARK ROAD LLC');
  });

  it('collapses BLDG_SEQ rows of one parcel, summing units and keeping the first row', () => {
    const { buildings } = collapseAssessorRows(
      [
        { ...base, BLDG_SEQ: '2', RES_UNITS: '4', YR_BUILT: '1990' },
        { ...base, BLDG_SEQ: '1', RES_UNITS: '8' },
      ],
      sam,
    );
    expect(buildings).toHaveLength(1);
    expect(buildings[0].unitCount).toBe(12);
    expect(buildings[0].yearBuilt).toBe(1925);
  });

  it('infers units for R2 and R3 when the assessor leaves them blank', () => {
    const { buildings } = collapseAssessorRows([{ ...base, PID: '0100037000', LU: 'R3', RES_UNITS: null }], new Map());
    expect(buildings[0].unitCount).toBe(3);
    expect(buildings[0].buildingType).toBe('three_family');
  });

  it('falls back to the assessor CITY and zip without a SAM point', () => {
    const { buildings } = collapseAssessorRows([{ ...base, PID: '0100037000' }], new Map());
    expect(buildings[0].neighborhood).toBe('Brighton');
    expect(buildings[0].latitude).toBeNull();
    expect(buildings[0].samId).toBeNull();
    expect(buildings[0].zip).toBe('02135');
  });

  it('skips rows that fail the filter or cannot be addressed, with a reason', () => {
    const { buildings, skipped } = collapseAssessorRows(
      [
        { ...base, PID: '1', LU: 'CD' },
        { ...base, PID: '2', ST_NUM: null },
        { ...base, PID: '3', ST_NAME: 'AVE' },
        { ...base, PID: 'abc' },
      ],
      new Map(),
    );
    expect(buildings).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['land_use', 'no_address', 'no_address', 'no_parcel']);
  });

  it('names the assessor fields to download', () => {
    expect(ASSESSOR_SEED_FIELDS).toEqual(expect.arrayContaining(['PID', 'BLDG_SEQ', 'ST_NUM', 'ST_NUM2', 'ST_NAME', 'CITY', 'ZIP_CODE', 'LU', 'LU_DESC', 'MAIL_STREET_ADDRESS']));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run seedCollapse`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/records/seed/collapse.ts
import { parseIntOrNull, textOrNull } from '../ckan';
import { addressKey, toCanonicalParcel } from '../identity';
import { ASSESSOR_FIXED_COLUMNS, ASSESSOR_YEARS, MODERN_COLUMNS, assessmentFromRow } from '../sources/boston/assessor';
import { isSeedParcelRow } from './filters';
import { buildingTypeFor, formatSeedAddress, titleCaseNeighborhood } from './format';
import type { AssessorRow, SamPoint, SeedBuilding } from './types';

/** Everything the adapter reads plus the address and district columns the seed needs. */
export const ASSESSOR_SEED_FIELDS: readonly string[] = Array.from(
  new Set([
    ...ASSESSOR_FIXED_COLUMNS,
    ...Object.values(MODERN_COLUMNS).filter((c): c is string => Boolean(c)),
    'BLDG_SEQ', 'ST_NUM', 'ST_NUM2', 'ST_NAME', 'CITY', 'ZIP_CODE',
  ]),
);

export type SkipReason = 'land_use' | 'no_parcel' | 'no_address';

export interface CollapseResult {
  buildings: SeedBuilding[];
  skipped: Array<{ pid: string | null; reason: SkipReason }>;
}

const IMPLIED_UNITS: Record<string, number> = { R2: 2, R3: 3 };

function seq(row: AssessorRow): number {
  return parseIntOrNull(textOrNull(row.BLDG_SEQ)) ?? 1;
}

function zip5(value: unknown): string | null {
  const text = textOrNull(value)?.replace(/\D/g, '');
  return text ? text.padStart(5, '0').slice(0, 5) : null;
}

/**
 * Filters, then collapses the assessor's one-row-per-building-per-parcel into one
 * SeedBuilding per parcel: lowest BLDG_SEQ row supplies the address, year, and assessment;
 * residential units are summed across rows. Pure; the row order is not assumed.
 */
export function collapseAssessorRows(rows: Iterable<AssessorRow>, sam: ReadonlyMap<string, SamPoint>): CollapseResult {
  const byParcel = new Map<string, AssessorRow[]>();
  const skipped: CollapseResult['skipped'] = [];
  for (const row of rows) {
    const pid = toCanonicalParcel(textOrNull(row.PID));
    if (!pid) {
      skipped.push({ pid: textOrNull(row.PID), reason: 'no_parcel' });
      continue;
    }
    if (!isSeedParcelRow(row)) {
      skipped.push({ pid, reason: 'land_use' });
      continue;
    }
    const list = byParcel.get(pid) ?? [];
    list.push(row);
    byParcel.set(pid, list);
  }

  const buildings: SeedBuilding[] = [];
  for (const [pid, list] of byParcel) {
    list.sort((a, b) => seq(a) - seq(b));
    const first = list[0];
    const address = formatSeedAddress(first.ST_NUM, first.ST_NUM2, first.ST_NAME);
    const key = address ? addressKey(address) : null;
    if (!address || !key) {
      skipped.push({ pid, reason: 'no_address' });
      continue;
    }
    const landUse = (textOrNull(first.LU) ?? '').trim().toUpperCase();
    const summed = list.map((r) => parseIntOrNull(textOrNull(r.RES_UNITS))).filter((n): n is number => n !== null);
    const unitCount = summed.length > 0 ? summed.reduce((a, b) => a + b, 0) : (IMPLIED_UNITS[landUse] ?? null);
    const point = sam.get(pid) ?? null;
    buildings.push({
      parcelId: pid,
      address,
      streetKey: key.streetKey,
      numLo: key.numLo,
      numHi: key.numHi,
      neighborhood: titleCaseNeighborhood(point?.neighborhood ?? textOrNull(first.CITY)),
      zip: point?.zip ? zip5(point.zip) : zip5(first.ZIP_CODE),
      unitCount,
      yearBuilt: parseIntOrNull(textOrNull(first.YR_BUILT)),
      buildingType: buildingTypeFor(landUse),
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      samId: point?.samId ?? null,
      assessment: assessmentFromRow(first, ASSESSOR_YEARS[0]),
    });
  }
  return { buildings, skipped };
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run seedCollapse`
Expected: PASS.

```bash
git add src/lib/records/seed/collapse.ts src/lib/__tests__/seedCollapse.test.ts
git commit -m "feat(records): collapse assessor rows into seed buildings"
```

---

### Task 10: Match existing production buildings onto parcels

**Files:**
- Create: `src/lib/records/seed/match.ts`
- Test: `src/lib/__tests__/seedMatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/seedMatch.test.ts
import { describe, expect, it } from 'vitest';
import { matchExistingBuildings } from '../records/seed/match';
import type { ExistingBuilding, SeedBuilding } from '../records/seed/types';

const seed = (o: Partial<SeedBuilding>): SeedBuilding => ({
  parcelId: '2102098000', address: '23-27 Lanark Road', streetKey: 'LANARK RD', numLo: 23, numHi: 27, neighborhood: 'Brighton', zip: '02135',
  unitCount: 12, yearBuilt: 1925, buildingType: 'apartment', latitude: 42.3, longitude: -71.1, samId: '83763',
  assessment: { fiscalYear: 'FY2026' } as SeedBuilding['assessment'], ...o,
});
const existing = (o: Partial<ExistingBuilding>): ExistingBuilding => ({ id: 'b1', address: '23 Lanark Rd', slug: '23-lanark-rd-boston', parcel_id: null, latitude: null, longitude: null, ...o });

describe('matchExistingBuildings', () => {
  it('matches a number inside a seeded range on the same street key', () => {
    const result = matchExistingBuildings([existing({})], [seed({})]);
    expect(result.matched).toEqual([{ building: existing({}), parcel: seed({}) }]);
    expect(result.unmatched).toEqual([]);
  });
  it('matches a range that the parcel range contains', () => {
    const result = matchExistingBuildings([existing({ address: '23-25 Lanark Rd' })], [seed({})]);
    expect(result.matched).toHaveLength(1);
  });
  it('keeps an existing parcel id that agrees and reports one that disagrees', () => {
    const agree = matchExistingBuildings([existing({ parcel_id: '2102098000' })], [seed({})]);
    expect(agree.matched).toHaveLength(1);
    const disagree = matchExistingBuildings([existing({ parcel_id: '0100037000' })], [seed({})]);
    expect(disagree.matched).toEqual([]);
    expect(disagree.conflicts).toEqual([{ building: existing({ parcel_id: '0100037000' }), parcel: seed({}) }]);
  });
  it('reports an address with no parcel, an unparseable address, and an overlapping-but-not-contained range', () => {
    const result = matchExistingBuildings(
      [existing({ id: 'x', address: '99 Lanark Rd' }), existing({ id: 'y', address: 'Lanark Rd' }), existing({ id: 'z', address: '21-25 Lanark Rd' })],
      [seed({})],
    );
    expect(result.matched).toEqual([]);
    expect(result.unmatched.map((u) => [u.building.id, u.reason])).toEqual([['x', 'no_parcel_for_address'], ['y', 'unparseable_address'], ['z', 'range_overlaps_parcel_boundary']]);
  });
  it('reports two parcels claiming one address as ambiguous', () => {
    const result = matchExistingBuildings([existing({ address: '25 Lanark Rd' })], [seed({}), seed({ parcelId: '2102099000', numLo: 25, numHi: 25 })]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched[0].reason).toBe('ambiguous');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run seedMatch`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/records/seed/match.ts
import { addressKey } from '../identity';
import type { ExistingBuilding, SeedBuilding } from './types';

export type UnmatchedReason = 'unparseable_address' | 'no_parcel_for_address' | 'range_overlaps_parcel_boundary' | 'ambiguous';

export interface MatchResult {
  matched: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
  /** The existing row already carries a different parcel id; never overwritten, listed for a human. */
  conflicts: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
  unmatched: Array<{ building: ExistingBuilding; reason: UnmatchedReason }>;
}

/**
 * Existing production rows onto seeded parcels, by street key and range containment.
 * Nothing is guessed: a partial overlap, two candidate parcels, or a disagreeing parcel id
 * is reported, not resolved.
 */
export function matchExistingBuildings(existing: readonly ExistingBuilding[], parcels: readonly SeedBuilding[]): MatchResult {
  const byStreet = new Map<string, SeedBuilding[]>();
  for (const parcel of parcels) {
    const list = byStreet.get(parcel.streetKey) ?? [];
    list.push(parcel);
    byStreet.set(parcel.streetKey, list);
  }
  const result: MatchResult = { matched: [], conflicts: [], unmatched: [] };
  for (const building of existing) {
    const key = addressKey(building.address);
    if (!key) {
      result.unmatched.push({ building, reason: 'unparseable_address' });
      continue;
    }
    const candidates = byStreet.get(key.streetKey) ?? [];
    const contained = candidates.filter((p) => p.numLo <= key.numLo && key.numHi <= p.numHi);
    if (contained.length > 1) {
      result.unmatched.push({ building, reason: 'ambiguous' });
      continue;
    }
    if (contained.length === 0) {
      const overlapping = candidates.some((p) => p.numLo <= key.numHi && key.numLo <= p.numHi);
      result.unmatched.push({ building, reason: overlapping ? 'range_overlaps_parcel_boundary' : 'no_parcel_for_address' });
      continue;
    }
    const parcel = contained[0];
    if (building.parcel_id && building.parcel_id !== parcel.parcelId) {
      result.conflicts.push({ building, parcel });
      continue;
    }
    result.matched.push({ building, parcel });
  }
  return result;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run seedMatch`
Expected: PASS.

```bash
git add src/lib/records/seed/match.ts src/lib/__tests__/seedMatch.test.ts
git commit -m "feat(records): match existing Boston buildings onto seeded parcels"
```

---

### Task 11: SQL statement emitter

**Files:**
- Create: `src/lib/records/seed/sql.ts`
- Test: `src/lib/__tests__/seedSql.test.ts`

The emitter returns SQL strings with literals inlined (the file is applied by `wrangler d1 execute --file`, which has no parameter binding). Every string value goes through one `lit()` function that doubles single quotes; every number is validated finite. The test executes the emitted SQL against the test D1 to prove it is valid and idempotent.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/seedSql.test.ts
import { describe, expect, it } from 'vitest';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { SEED_TRIGGER_REASON, lit, seedStatements } from '../records/seed/sql';
import type { ExistingBuilding, SeedBuilding } from '../records/seed/types';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const parcel: SeedBuilding = {
  parcelId: '2102098000', address: "23-27 O'Lanark Road", streetKey: 'LANARK RD', numLo: 23, numHi: 27, neighborhood: 'Brighton', zip: '02135',
  unitCount: 12, yearBuilt: 1925, buildingType: 'apartment', latitude: 42.33909, longitude: -71.1458, samId: '83763',
  assessment: {
    fiscalYear: 'FY2026', parcelId: '2102098000', owner: "O'BRIEN LLC", mailAddressee: null, mailStreet: '1 Main St', mailCity: 'Boston', mailState: 'MA', mailZip: '02135',
    landUse: 'A', landUseDescription: 'APT 7-30 UNITS', yearBuilt: 1925, yearRemodel: null, grossArea: 12000, livingArea: 10000,
    residentialUnits: 12, commercialUnits: 0, totalValue: 3500000, landValue: 1000000, buildingValue: 2500000, condominium: false,
  },
};

async function apply(db: ReturnType<typeof createRecordsTestDb>, statements: string[]): Promise<void> {
  for (const sql of statements) await db.prepare(sql).run();
}

describe('lit', () => {
  it('doubles single quotes and renders null', () => {
    expect(lit("O'Brien")).toBe("'O''Brien'");
    expect(lit(null)).toBe('NULL');
    expect(lit(12)).toBe('12');
    expect(() => lit(Number.NaN)).toThrow();
  });
});

describe('seedStatements', () => {
  it('creates a seeded building, its assessor pull, and its assessment record', async () => {
    const db = createRecordsTestDb();
    const statements = seedStatements({ created: [{ parcel, slug: '23-27-olanark-road-boston' }], matched: [] });
    expect(statements).toHaveLength(3);
    await apply(db, statements);
    const b = await db.prepare("SELECT id, address, slug, city, neighborhood, zip_code, source, parcel_id, sam_id, street_key, st_num_lo, st_num_hi, unit_count, year_built, building_type, latitude FROM buildings WHERE parcel_id = '2102098000'").first<Record<string, unknown>>();
    expect(b).toMatchObject({ id: 'seed-2102098000', address: "23-27 O'Lanark Road", slug: '23-27-olanark-road-boston', city: 'Boston', neighborhood: 'Brighton', zip_code: '02135', source: 'seed', sam_id: '83763', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27, unit_count: 12, year_built: 1925, building_type: 'apartment', latitude: 42.33909 });
    const pull = await db.prepare("SELECT id, source_id, source_label, status, row_count, triggered_by, trigger_reason FROM record_pulls WHERE building_id = 'seed-2102098000'").first<Record<string, unknown>>();
    expect(pull).toMatchObject({ id: 'seed-FY2026-2102098000', source_id: FY2026_RESOURCE_ID, source_label: 'Property Assessment FY2026', status: 'ok', row_count: 1, triggered_by: null, trigger_reason: SEED_TRIGGER_REASON });
    const record = await db.prepare("SELECT kind, source_key, payload FROM building_records WHERE building_id = 'seed-2102098000'").first<{ kind: string; source_key: string; payload: string }>();
    expect(record?.kind).toBe('assessment');
    expect(record?.source_key).toBe('FY2026');
    expect(JSON.parse(record!.payload).owner).toBe("O'BRIEN LLC");
  });

  it('is idempotent and updates assessor fields without touching address or slug on re-run', async () => {
    const db = createRecordsTestDb();
    await apply(db, seedStatements({ created: [{ parcel, slug: 'first-slug' }], matched: [] }));
    const again = { ...parcel, address: 'renamed', unitCount: 13, assessment: { ...parcel.assessment, totalValue: 1 } };
    await apply(db, seedStatements({ created: [{ parcel: again, slug: 'second-slug' }], matched: [] }));
    const b = await db.prepare("SELECT address, slug, unit_count FROM buildings WHERE id = 'seed-2102098000'").first<Record<string, unknown>>();
    expect(b).toEqual({ address: "23-27 O'Lanark Road", slug: 'first-slug', unit_count: 13 });
    const pulls = await db.prepare("SELECT COUNT(*) AS n FROM record_pulls WHERE building_id = 'seed-2102098000'").first<{ n: number }>();
    expect(pulls?.n).toBe(1);
    const record = await db.prepare("SELECT payload FROM building_records WHERE building_id = 'seed-2102098000'").first<{ payload: string }>();
    expect(JSON.parse(record!.payload).totalValue).toBe(1);
  });

  it('updates a matched existing building in place and gives it provenance', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { id: 'b1', address: '23 Lanark Rd' });
    const building: ExistingBuilding = { id, address: '23 Lanark Rd', slug: 'b1', parcel_id: null, latitude: 1, longitude: 2 };
    const statements = seedStatements({ created: [], matched: [{ building, parcel }] });
    await apply(db, statements);
    const b = await db.prepare("SELECT address, parcel_id, sam_id, street_key, st_num_lo, st_num_hi, latitude, longitude, source FROM buildings WHERE id = 'b1'").first<Record<string, unknown>>();
    expect(b).toEqual({ address: '23 Lanark Rd', parcel_id: '2102098000', sam_id: '83763', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 23, latitude: 42.33909, longitude: -71.1458, source: 'user' });
    const pull = await db.prepare("SELECT id FROM record_pulls WHERE building_id = 'b1'").first<{ id: string }>();
    expect(pull?.id).toBe('seed-FY2026-b1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run seedSql`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/records/seed/sql.ts
import { ASSESSOR_PAGE_URL, ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../sources/boston/assessor';
import type { ExistingBuilding, SeedBuilding } from './types';

export const SEED_TRIGGER_REASON = 'seed';
const CURRENT_YEAR = ASSESSOR_YEARS[0];

export interface SeedPlan {
  created: Array<{ parcel: SeedBuilding; slug: string }>;
  matched: Array<{ building: ExistingBuilding; parcel: SeedBuilding }>;
}

/**
 * SQL literal for a file applied with `wrangler d1 execute --file`, which binds nothing.
 * Strings double their quotes; numbers must be finite; null renders as NULL.
 */
export function lit(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in seed SQL: ${value}`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function pullStatement(buildingId: string): string {
  const pullId = `seed-${CURRENT_YEAR.fiscalYear}-${buildingId.replace(/^seed-/, '')}`;
  return (
    'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason) VALUES (' +
    [lit(pullId), lit(buildingId), lit('boston'), lit(FY2026_RESOURCE_ID), lit(`Property Assessment ${CURRENT_YEAR.fiscalYear}`), lit(`seed: bulk ${CURRENT_YEAR.fiscalYear} assessor download`), lit('ok'), '1', 'NULL', 'NULL', 'NULL', lit(SEED_TRIGGER_REASON)].join(', ') +
    ') ON CONFLICT(id) DO NOTHING;'
  );
}

function recordStatement(buildingId: string, parcel: SeedBuilding): string {
  const pullId = `seed-${CURRENT_YEAR.fiscalYear}-${buildingId.replace(/^seed-/, '')}`;
  return (
    'INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, source_url) VALUES (' +
    [lit(`${pullId}-assessment`), lit(buildingId), lit(pullId), lit('assessment'), lit(parcel.assessment.fiscalYear), lit(JSON.stringify(parcel.assessment)), lit(ASSESSOR_PAGE_URL)].join(', ') +
    ') ON CONFLICT(building_id, kind, source_key) DO UPDATE SET payload = excluded.payload, pull_id = excluded.pull_id;'
  );
}

function createStatement(parcel: SeedBuilding, slug: string): string {
  const id = `seed-${parcel.parcelId}`;
  return (
    'INSERT INTO buildings (id, address, slug, neighborhood, city, state, zip_code, latitude, longitude, year_built, unit_count, building_type, parcel_id, sam_id, source, street_key, st_num_lo, st_num_hi) VALUES (' +
    [lit(id), lit(parcel.address), lit(slug), lit(parcel.neighborhood), lit('Boston'), lit('MA'), lit(parcel.zip), lit(parcel.latitude), lit(parcel.longitude), lit(parcel.yearBuilt), lit(parcel.unitCount), lit(parcel.buildingType), lit(parcel.parcelId), lit(parcel.samId), lit('seed'), lit(parcel.streetKey), lit(parcel.numLo), lit(parcel.numHi)].join(', ') +
    // Address and slug are stable once published; everything the assessor owns refreshes.
    ') ON CONFLICT(id) DO UPDATE SET neighborhood = COALESCE(buildings.neighborhood, excluded.neighborhood), zip_code = COALESCE(buildings.zip_code, excluded.zip_code), latitude = COALESCE(buildings.latitude, excluded.latitude), longitude = COALESCE(buildings.longitude, excluded.longitude), year_built = excluded.year_built, unit_count = excluded.unit_count, building_type = excluded.building_type, sam_id = COALESCE(buildings.sam_id, excluded.sam_id), street_key = excluded.street_key, st_num_lo = excluded.st_num_lo, st_num_hi = excluded.st_num_hi, updated_at = unixepoch();'
  );
}

function matchStatement(building: ExistingBuilding, parcel: SeedBuilding): string {
  const { numLo, numHi } = addressRangeOf(building.address, parcel);
  return (
    'UPDATE buildings SET ' +
    [
      `parcel_id = ${lit(parcel.parcelId)}`,
      `sam_id = COALESCE(sam_id, ${lit(parcel.samId)})`,
      `street_key = ${lit(parcel.streetKey)}`,
      `st_num_lo = ${lit(numLo)}`,
      `st_num_hi = ${lit(numHi)}`,
      `latitude = COALESCE(latitude, ${lit(parcel.latitude)})`,
      `longitude = COALESCE(longitude, ${lit(parcel.longitude)})`,
      'updated_at = unixepoch()',
    ].join(', ') +
    ` WHERE id = ${lit(building.id)};`
  );
}

/** An existing row keeps its own number range (it may be one number inside the parcel's range). */
function addressRangeOf(address: string, parcel: SeedBuilding): { numLo: number; numHi: number } {
  const match = /^(\d+)(?:-(\d+))?/.exec(address.trim());
  if (!match) return { numLo: parcel.numLo, numHi: parcel.numHi };
  const lo = Number.parseInt(match[1], 10);
  const hi = match[2] ? Number.parseInt(match[2], 10) : lo;
  return { numLo: Math.min(lo, hi), numHi: Math.max(lo, hi) };
}

/** Three statements per building, in an order that satisfies the foreign keys. */
export function seedStatements(plan: SeedPlan): string[] {
  const statements: string[] = [];
  for (const { building, parcel } of plan.matched) {
    statements.push(matchStatement(building, parcel), pullStatement(building.id), recordStatement(building.id, parcel));
  }
  for (const { parcel, slug } of plan.created) {
    const id = `seed-${parcel.parcelId}`;
    statements.push(createStatement(parcel, slug), pullStatement(id), recordStatement(id, parcel));
  }
  return statements;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run seedSql`
Expected: PASS (the test D1 double runs the upserts; if `ON CONFLICT ... DO UPDATE` with `excluded` fails in `node:sqlite`, it is a helper limitation, not a D1 one; D1's SQLite supports it. Report it rather than weakening the SQL).

```bash
git add src/lib/records/seed/sql.ts src/lib/__tests__/seedSql.test.ts
git commit -m "feat(records): emit idempotent seed SQL for buildings, pulls, and assessments"
```

---

### Task 12: The seed script

**Files:**
- Create: `scripts/records-seed-boston.ts`
- Modify: `package.json` (add `"records:seed": "npx tsx scripts/records-seed-boston.ts"`)
- Modify: `.gitignore` (add `.cache/`)

No unit test; every transformation it calls is tested above. Verification is a dry run against the local D1 in Step 3.

- [ ] **Step 1: Write the script**

```ts
// scripts/records-seed-boston.ts
/**
 * Seed a page for every whole-building rental parcel in Boston.
 * Spec: docs/superpowers/specs/2026-09-08-boston-coverage-design.md, Section 1.
 *
 * Usage:
 *   npm run records:seed -- --dry-run           # download (cached), compute, print the summary, write nothing
 *   npm run records:seed -- --write             # also write SQL batch files under .cache/seed/
 *   npm run records:seed -- --apply --local     # write and apply to the local D1
 *   npm run records:seed -- --apply --remote    # write and apply to production D1 (needs CLOUDFLARE_API_TOKEN)
 *
 * Idempotent: re-running updates assessor-owned fields and never creates a twin. Downloads
 * are cached in .cache/ for a day; pass --refresh to re-download.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchAllRows } from '../src/lib/records/ckan';
import { SEED_LAND_USES } from '../src/lib/records/seed/filters';
import { ASSESSOR_SEED_FIELDS, collapseAssessorRows } from '../src/lib/records/seed/collapse';
import { seedSlug } from '../src/lib/records/seed/format';
import { matchExistingBuildings } from '../src/lib/records/seed/match';
import { SAM_FIELDS, SAM_RESOURCE_ID, indexSamByParcel } from '../src/lib/records/seed/sam';
import { seedStatements } from '../src/lib/records/seed/sql';
import type { AssessorRow, ExistingBuilding, SamRow } from '../src/lib/records/seed/types';
import { FY2026_RESOURCE_ID } from '../src/lib/records/sources/boston/assessor';
import type { FetchLike } from '../src/lib/records/types';

const args = new Set(process.argv.slice(2));
const flag = (name: string): boolean => args.has(`--${name}`);
const CACHE_DIR = join(process.cwd(), '.cache');
const SEED_DIR = join(CACHE_DIR, 'seed');
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STATEMENTS_PER_FILE = 2000;
const DB_NAME = 'ratemyplace-db';
const fetchImpl: FetchLike = (input, init) => fetch(input, init);

function log(line: string): void {
  console.log(line);
}

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${name}.json`);
  if (!flag('refresh') && existsSync(path) && Date.now() - statSync(path).mtimeMs < CACHE_MAX_AGE_MS) {
    log(`  using cached ${name}`);
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  }
  const value = await load();
  writeFileSync(path, JSON.stringify(value));
  return value;
}

function wranglerJson<T>(commandArgs: string[]): T[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--json', ...commandArgs], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  const start = out.indexOf('[');
  const parsed = JSON.parse(out.slice(start)) as Array<{ results: T[] }>;
  return parsed.flatMap((r) => r.results);
}

function target(): '--local' | '--remote' {
  if (flag('remote')) return '--remote';
  return '--local';
}

async function main(): Promise<void> {
  const dryRun = !flag('write') && !flag('apply');
  log(`\nSeed Boston buildings (${dryRun ? 'dry run' : flag('apply') ? `apply ${target()}` : 'write files'})\n`);

  const assessor = await cached('assessor-fy2026', () =>
    fetchAllRows<AssessorRow>(FY2026_RESOURCE_ID, { fields: [...ASSESSOR_SEED_FIELDS], filters: { LU: [...SEED_LAND_USES] }, onPage: (n) => log(`  assessor rows: ${n}`) }, fetchImpl),
  );
  const sam = await cached('sam-addresses', () =>
    fetchAllRows<SamRow>(SAM_RESOURCE_ID, { fields: [...SAM_FIELDS], onPage: (n) => log(`  SAM rows: ${n}`) }, fetchImpl),
  );
  log(`  downloaded ${assessor.length} assessor rows and ${sam.length} SAM rows`);

  const samIndex = indexSamByParcel(sam);
  const { buildings, skipped } = collapseAssessorRows(assessor, samIndex);
  const skippedByReason = skipped.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {});
  log(`  ${buildings.length} seed buildings; skipped ${JSON.stringify(skippedByReason)}`);
  log(`  ${buildings.filter((b) => b.latitude === null).length} without a SAM coordinate`);

  const existing = wranglerJson<ExistingBuilding>([target(), '--command', "SELECT id, address, slug, parcel_id, latitude, longitude FROM buildings WHERE city = 'Boston'"]);
  const takenSlugs = new Set(wranglerJson<{ slug: string }>([target(), '--command', 'SELECT slug FROM buildings']).map((r) => r.slug));
  const match = matchExistingBuildings(existing, buildings);
  log(`  existing Boston rows: ${existing.length}; matched ${match.matched.length}, conflicts ${match.conflicts.length}, unmatched ${match.unmatched.length}`);
  for (const c of match.conflicts) log(`    CONFLICT ${c.building.id} ${c.building.address} has parcel ${c.building.parcel_id}, seed says ${c.parcel.parcelId}`);
  for (const u of match.unmatched) log(`    UNMATCHED ${u.building.id} ${u.building.address}: ${u.reason}`);

  // A parcel that an existing row now owns is not created a second time.
  const ownedParcels = new Set(match.matched.map((m) => m.parcel.parcelId));
  const created = buildings
    .filter((b) => !ownedParcels.has(b.parcelId))
    .map((parcel) => ({ parcel, slug: seedSlug(parcel.address, takenSlugs) }));
  log(`  to create: ${created.length}; to update in place: ${match.matched.length}`);

  if (dryRun) {
    log('\nDry run complete. Nothing written.');
    return;
  }

  const statements = seedStatements({ created, matched: match.matched });
  mkdirSync(SEED_DIR, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_FILE) {
    const path = join(SEED_DIR, `seed-boston-${String(files.length + 1).padStart(3, '0')}.sql`);
    writeFileSync(path, statements.slice(i, i + STATEMENTS_PER_FILE).join('\n') + '\n');
    files.push(path);
  }
  log(`  wrote ${statements.length} statements to ${files.length} files under .cache/seed/`);

  if (!flag('apply')) return;
  for (const [index, path] of files.entries()) {
    log(`  applying ${index + 1}/${files.length} ${target()}`);
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, target(), '--file', path], { stdio: 'inherit', shell: true });
  }
  const after = wranglerJson<{ n: number }>([target(), '--command', "SELECT COUNT(*) AS n FROM buildings WHERE source = 'seed'"]);
  log(`\nDone. Seeded buildings in ${target()} database: ${after[0]?.n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Wire the script and ignore the cache**

In `package.json` scripts add `"records:seed": "npx tsx scripts/records-seed-boston.ts"` after `records:check`. Add a line `.cache/` to `.gitignore`.

- [ ] **Step 3: Dry run against the local database**

Run: `npx wrangler d1 migrations apply ratemyplace-db --local` (0031 must be applied), then `npm run records:seed -- --dry-run`
Expected: the two downloads (a few minutes the first time; SAM is 13 pages), then a summary with roughly 38,400 seed buildings, a skipped breakdown dominated by `land_use` (the excluded A descriptions), and the local seed data's Boston rows listed as matched or unmatched. Nothing written.

- [ ] **Step 4: Apply locally and spot-check**

Run: `npm run records:seed -- --apply --local`
Then: `npx wrangler d1 execute ratemyplace-db --local --command "SELECT COUNT(*) FROM buildings WHERE source='seed'; SELECT address, slug, neighborhood, unit_count FROM buildings WHERE parcel_id='2102098000'; SELECT COUNT(*) FROM building_records WHERE kind='assessment';"`
Expected: about 38,400 seeded rows; the Lanark parcel present as `23-27 Lanark Road`, Brighton; one assessment record per seeded building. Re-run `--apply --local` once more and confirm the count does not change.

- [ ] **Step 5: Commit**

```bash
git add scripts/records-seed-boston.ts package.json .gitignore
git commit -m "feat(records): seed script for Boston whole-building parcels"
```

---

### Task 13: Fixture check covers SAM

**Files:**
- Modify: `scripts/records-fixture-check.ts`

- [ ] **Step 1: Add the SAM check**

Add the imports at the top of the file:

```ts
import { fetchAllRows } from '../src/lib/records/ckan';
import { indexSamByParcel, SAM_FIELDS, SAM_RESOURCE_ID } from '../src/lib/records/seed/sam';
import type { SamRow } from '../src/lib/records/seed/types';
```

and, where the other checks run for the Lanark fixture, add:

```ts
  // SAM: the seed's coordinate and neighborhood source. Filtered to the fixture parcel so
  // the check is one request, not the 400,000-row download.
  const samRows = await fetchAllRows<SamRow>(SAM_RESOURCE_ID, { fields: [...SAM_FIELDS], filters: { PARCEL_ID: '2102098000' } }, fetchImpl);
  const samPoint = indexSamByParcel(samRows).get('2102098000');
  check(
    'SAM primary point for Lanark: id 83763, Brighton, inside Boston',
    samPoint?.samId === '83763' && samPoint.neighborhood === 'Brighton' && samPoint.latitude > 42.2 && samPoint.latitude < 42.4 && samPoint.longitude > -71.2 && samPoint.longitude < -70.9,
    JSON.stringify(samPoint ?? null),
  );
```

- [ ] **Step 2: Run it**

Run: `npm run records:check`
Expected: every existing line still PASS plus `PASS SAM primary point for Lanark: id 83763, Brighton, inside Boston`.

- [ ] **Step 3: Commit**

```bash
git add scripts/records-fixture-check.ts
git commit -m "chore(records): fixture check covers the SAM address resource"
```

---

### Task 14: Docs and spec amendments

**Files:**
- Modify: `migrations/AGENTS.md`
- Modify: `src/lib/AGENTS.md`
- Modify: `docs/superpowers/specs/2026-09-08-boston-coverage-design.md`
- Modify: `AGENTS.md` (root) traps list

- [ ] **Step 1: migrations/AGENTS.md**

Change the count line to "31 migrations, `0001` through `0031`." In the production-hazard section, after the 0029/0030 paragraph, add:

```markdown
**`0031` (Boston coverage) is the same kind of hazard.** It adds five columns with
`ALTER TABLE ... ADD COLUMN` (`buildings.source`, `street_key`, `st_num_lo`, `st_num_hi`,
`record_pulls.trigger_reason`) and creates `records_queue` and `app_settings`. Apply once
with `wrangler d1 execute --remote --file`, before running the seed script. Not yet applied
to production as of this writing; update this line when it is.
```

Add to the schema table:

```markdown
| `records_queue` | Pending record pulls, one pending row per building, with reason and priority; drained by the records-scheduler Worker (sub-project C) |
| `app_settings` | Operator switches, e.g. `records_fill_paused` |
```

- [ ] **Step 2: src/lib/AGENTS.md**

Under the `records/` section add:

```markdown
- **`seed/` is the bulk pipeline, not a request path.** `scripts/records-seed-boston.ts`
  downloads the assessor and SAM resources once (`fetchAllRows` in `ckan.ts`), and the
  pure modules under `records/seed/` filter, collapse, format, match, and emit SQL. Every
  string in the emitted SQL goes through `lit()`; the file is applied with
  `wrangler d1 execute --file`, which binds nothing. Seeded rows have `source = 'seed'`
  and deterministic ids (`seed-<parcel>`), so re-running is an upsert.
- **`addressKey` / `streetKey` in `identity.ts`** are the lookup keys for seed matching and
  reviewer dedupe: base street name plus the assessor spelling of the suffix, and a
  house-number range. A change to the suffix table changes both, on purpose.
```

- [ ] **Step 3: Spec amendment**

In `docs/superpowers/specs/2026-09-08-boston-coverage-design.md`, under Section 2 after the `app_settings` paragraph, add:

```markdown
> **Amended 2026-09-09, as built (C1):** `record_pulls.triggered_by` is a foreign key to
> `users` (0029), so it cannot carry `'seed'` or `'queue:<reason>'`. Migration 0031 adds a
> nullable `record_pulls.trigger_reason TEXT` for that; `triggered_by` stays the admin
> user id or NULL. Seed pulls write `trigger_reason = 'seed'`; the Worker (C2) writes
> `'queue:<reason>'`.
```

and under Section 1's Building row table note:

```markdown
> **Amended 2026-09-09, as built (C1):** neighborhood comes from SAM's
> `MAILING_NEIGHBORHOOD` for the parcel's primary address point, falling back to the
> assessor's `CITY` column only when the parcel has no SAM point. Zip follows the same
> order. Units for R2/R3 rows the assessor leaves blank are inferred as 2 and 3.
```

- [ ] **Step 4: Root AGENTS.md traps**

Add one bullet to the traps list:

```markdown
- **Seeded buildings** (`buildings.source = 'seed'`, ids `seed-<parcel>`) come from
  `npm run records:seed`, which is idempotent and applied by hand. Never regenerate slugs
  for them; the slug is the public URL.
```

- [ ] **Step 5: Run the suite and commit**

Run: `npm test && npm run check`
Expected: green.

```bash
git add migrations/AGENTS.md src/lib/AGENTS.md AGENTS.md docs/superpowers/specs/2026-09-08-boston-coverage-design.md
git commit -m "docs: record migration 0031, the seed module, and the C1 spec amendments"
```

---

## Done when

- `npm test`, `npm run check`, `npm run build` clean.
- `npm run records:seed -- --dry-run` prints a summary near 38,400 with no conflicts for the local seed data, and `--apply --local` twice yields the same count.
- `npm run records:check` passes including the SAM line.
- PR opened against `main` titled "Boston coverage C1: migration 0031, address keys, seed pipeline". The production apply (0031, then the seed) is the owner's step after merge, per the spec's rollout order.
