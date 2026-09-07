# Building Records (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cited, dated public-records panel to Boston building pages, fed by admin-triggered pulls from City of Boston open data, with a correction path whose only resolution is a re-pull.

**Architecture:** A new `src/lib/records/` module owns everything: typed record kinds, a CKAN SQL client, an address identity builder, one `RecordSource` per Boston dataset, a Worker-callable `pullBuildingRecords`, a read-side `getBuildingRecords`, and pure display helpers. Provenance is a `record_pulls` row per source run; records are generic rows with typed JSON payloads validated on read. The public panel is a server-rendered Astro component; the correction form and admin queue are React islands following the disputes pattern.

**Tech Stack:** Astro 5 SSR, React 18 islands, Cloudflare D1 (SQLite), TypeScript strict, Vitest with `node:sqlite` via the existing `TestD1Database` helper, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-06-building-records-design.md`

**Branch:** work on `feat/building-records` off `main`. Commit after every task. Never push to `main` directly.

---

## Facts verified against the live Boston API on 2026-09-06

These override the brief where they differ. The adapters are written to them.

| Fact | Consequence |
|---|---|
| FY2026 assessor stores ranged addresses as `ST_NUM` = `23`, `ST_NUM2` = `27`, `ST_NAME` = `Lanark RD` (mixed case). Exact `filters` on `datastore_search` return nothing for Lanark. | All sources use `datastore_search_sql` with `upper()` comparisons. Parcel resolution matches `ST_NUM` or `ST_NUM2`. |
| Street suffixes are short and uppercase in assessor, permits, and enforcement (`AV`, `RD`, `ST`). 311 `location` uses `Rd`/`Ave` free text: `23 Lanark Rd  Brighton  MA  02135` (double spaces). | Identity builds short-suffix forms for exact matches and both short and long forms for `LIKE` matches. |
| Permits `parcel_id` is numeric (leading zero dropped). Lanark has 0 permits by parcel and by address. `55-65 Lanark RD` has 14 by address. | Permits query by numeric parcel OR address forms. |
| Violations and enforcement key on `violation_street` = `Lanark` (bare name) and `violation_stno` = `23`. Enforcement for Lanark returns 3 rows across 2 case numbers (one case has two codes), contact `1505 COMMONWEALTH  AV`, 2008. Violations: none. | Source key for both is `case_no:code`. |
| RentSmart has a `parcel` column. Lanark returns 4 rows (3 Housing Complaints 2025 to 2026, 1 Sanitation). | RentSmart queries by parcel. |
| 311 legacy yearly resources 2011 to 2026 share one schema. The new-system resource has a different schema (`case_id`, `street_number`, `street_name`, `case_topic`, `assigned_department`). No Inspectional Services cases exist in the new system yet. | One 311 source runs 17 queries; classification rules differ per system. |
| Assessment history columns drift: FY2024 has no `ST_NUM2`; FY2023 has `OWNER MAIL ADDRESS` combined; FY2022 and FY2021 use `MAIL_ADDRESS`, `MAIL_ZIPCODE`, `ZIPCODE`. Values are formatted `6,720,200`, `6780500`, or `$6,649,200.00 `. `PID` is stable across years for Lanark. | Per-year column map and a money parser that strips everything but digits and dot. |
| Dataset page slugs: `property-assessment`, `approved-building-permits`, `building-and-property-violations1`, `public-works-violations`, `311-service-requests`, `rentsmart`. | `pageUrl` on each source. |
| Lanark FY2026: `TOTAL_VALUE` 6,720,200; `LAND_VALUE` 1,620,500; `BLDG_VALUE` 5,099,700; mail `PO BOX 35006`, addressee `C/O ATT <person>`; `LU` `A`; `YR_BUILT` 1920; `YR_REMODEL` 1980; `GROSS_AREA` 34650; `LIVING_AREA` 27720. | Fixture values. |
| `audit_logs` has a `CHECK` on `action_type`. New action types require a table rebuild (the 0028 pattern). | Migration 0030 rebuilds `audit_logs` adding `records_pulled` and `record_correction_resolved`. |

## File structure

| Path | Responsibility |
|---|---|
| `migrations/0029_building_records.sql` | `parcel_id`, `sam_id` on buildings; `record_pulls`, `building_records`, `record_corrections` |
| `migrations/0030_audit_records_actions.sql` | Rebuild `audit_logs` with two new action types |
| `src/lib/records/types.ts` | Kinds, payloads, `RecordSource`, `RecordsDb`, `PullSummary`, `SourceError` |
| `src/lib/records/ckan.ts` | `ckanSql`, `sqlLiteral`, `parseMoney`, `parseIntOrNull`, timeout, row cap |
| `src/lib/records/identity.ts` | `buildIdentity` from a buildings row: numbers, suffix forms, address forms, parcel forms |
| `src/lib/records/sources/boston/assessor.ts` | `resolveParcel`, `assessorSource(year)`, `ASSESSOR_YEARS` |
| `src/lib/records/sources/boston/permits.ts` | Permits source |
| `src/lib/records/sources/boston/violations.ts` | ISD violations source |
| `src/lib/records/sources/boston/enforcement.ts` | Public Works code enforcement source |
| `src/lib/records/sources/boston/serviceRequests.ts` | 311 legacy years plus new system, classification lists |
| `src/lib/records/sources/boston/rentsmart.ts` | RentSmart source |
| `src/lib/records/jurisdictions.ts` | `sourcesForCity` |
| `src/lib/records/pull.ts` | `pullBuildingRecords` (Worker-callable, no HTTP) |
| `src/lib/records/query.ts` | `getBuildingRecords`, `validatePayload` |
| `src/lib/records/display.ts` | Pure display helpers and copy constants |
| `src/lib/records/corrections.ts` | Correction validation, resolutions, `diffRecordSnapshots` |
| `src/pages/api/admin/buildings/[id]/records/pull.ts` | Admin pull endpoint |
| `src/pages/api/records/corrections.ts` | Public correction POST |
| `src/pages/api/admin/records/corrections/index.ts` | Admin list |
| `src/pages/api/admin/records/corrections/[id].ts` | Admin PATCH resolve |
| `src/pages/api/admin/records/corrections/[id]/repull.ts` | Admin POST re-pull with diff |
| `src/components/BuildingRecords.astro` | Public panel |
| `src/components/records/RecordCorrectionForm.tsx` | Public correction island |
| `src/components/admin/RecordsPullButton.tsx` | Per-building pull control, mounted inside `BuildingsTable` |
| `src/components/admin/RecordCorrectionsQueue.tsx` | Admin queue island |
| `src/pages/admin/records.astro` | Admin page |
| `src/lib/__tests__/helpers/sqliteD1.ts` | Add `batch` and `exec` |
| `src/lib/__tests__/helpers/records/*.json`, `fixtureFetch.ts`, `recordsDb.ts` | Recorded responses, fake fetch, schema bootstrap |
| `scripts/records-fixture-check.ts` | Live Lanark check, run by hand |

---

### Task 1: Extend the SQLite D1 test helper with `batch` and `exec`

**Files:**
- Modify: `src/lib/__tests__/helpers/sqliteD1.ts`
- Test: `src/lib/__tests__/sqliteD1Helper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/sqliteD1Helper.test.ts
import { describe, it, expect } from 'vitest';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';

const suite = sqliteAvailable ? describe : describe.skip;

suite('TestD1Database.batch', () => {
  it('runs statements in one transaction and rolls back on failure', async () => {
    const raw = createMemoryDatabase();
    const db = new TestD1Database(raw);
    db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');

    await db.batch([db.prepare('INSERT INTO t (id) VALUES (?)').bind('a')]);
    const first = await db.prepare('SELECT COUNT(*) AS n FROM t').first<{ n: number }>();
    expect(first?.n).toBe(1);

    await expect(
      db.batch([
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('b'),
        db.prepare('INSERT INTO t (id) VALUES (?)').bind('a'), // duplicate PK
      ]),
    ).rejects.toThrow();
    const after = await db.prepare('SELECT COUNT(*) AS n FROM t').first<{ n: number }>();
    expect(after?.n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/sqliteD1Helper.test.ts`
Expected: FAIL with `db.exec is not a function`

- [ ] **Step 3: Add `exec` and `batch` to `TestD1Database`**

Replace the `TestD1Database` class at the bottom of `src/lib/__tests__/helpers/sqliteD1.ts` with:

```ts
export class TestD1Database {
  constructor(private readonly database: SQLiteDatabase) {}

  prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  /** Schema bootstrap for tests. Not part of the D1 surface. */
  exec(sql: string): void {
    this.database.exec(sql);
  }

  /** Mirrors D1's batch: all statements in one transaction, all-or-nothing. */
  async batch(statements: TestD1Statement[]): Promise<Array<{ success: boolean }>> {
    this.database.exec('BEGIN');
    try {
      const results: Array<{ success: boolean }> = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/sqliteD1Helper.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/helpers/sqliteD1.ts src/lib/__tests__/sqliteD1Helper.test.ts
git commit -m "test: add batch and exec to the SQLite D1 test helper"
```

---

### Task 2: Migrations 0029 and 0030

**Files:**
- Create: `migrations/0029_building_records.sql`
- Create: `migrations/0030_audit_records_actions.sql`
- Create: `src/lib/__tests__/helpers/recordsDb.ts`
- Test: `src/lib/__tests__/recordsMigrations.test.ts`

- [ ] **Step 1: Write the schema bootstrap helper**

```ts
// src/lib/__tests__/helpers/recordsDb.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryDatabase, TestD1Database } from './sqliteD1';

/**
 * Minimal schema for records tests: the parent tables the 0029/0030 migrations
 * reference, then the real migration files. Keeps tests honest about the SQL
 * that ships without applying all 30 migrations.
 */
export function createRecordsTestDb(): TestD1Database {
  const db = new TestD1Database(createMemoryDatabase());
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, is_admin INTEGER DEFAULT 0);
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      landlord_id TEXT,
      property_manager_id TEXT,
      address TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      neighborhood TEXT,
      city TEXT,
      state TEXT,
      zip_code TEXT,
      year_built INTEGER,
      unit_count INTEGER,
      building_type TEXT,
      owner_name TEXT,
      owner_entity TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rate_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      admin_user_id TEXT NOT NULL,
      admin_ip TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('building_updated')),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('review','dispute','landlord','building','manager','verification','user','bug_report')),
      entity_id TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      notes TEXT
    );
  `);
  for (const file of ['0029_building_records.sql', '0030_audit_records_actions.sql']) {
    db.exec(readFileSync(join(process.cwd(), 'migrations', file), 'utf8'));
  }
  return db;
}

export async function insertBuilding(
  db: TestD1Database,
  overrides: Partial<{ id: string; address: string; slug: string; city: string; zip_code: string; parcel_id: string | null }> = {},
): Promise<string> {
  const id = overrides.id ?? 'bldg-lanark';
  await db
    .prepare('INSERT INTO buildings (id, address, slug, city, state, zip_code, parcel_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      id,
      overrides.address ?? '23-27 Lanark Rd, Boston, MA 02135',
      overrides.slug ?? id,
      overrides.city ?? 'Boston',
      'MA',
      overrides.zip_code ?? '02135',
      overrides.parcel_id ?? null,
    )
    .run();
  return id;
}
```

- [ ] **Step 2: Write the failing migration test**

```ts
// src/lib/__tests__/recordsMigrations.test.ts
import { describe, it, expect } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const suite = sqliteAvailable ? describe : describe.skip;

suite('migrations 0029 and 0030', () => {
  it('adds parcel_id to buildings and creates the three records tables', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { parcel_id: '2102098000' });
    const row = await db.prepare('SELECT parcel_id, sam_id FROM buildings').first<{ parcel_id: string; sam_id: string | null }>();
    expect(row).toEqual({ parcel_id: '2102098000', sam_id: null });

    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('record_pulls','building_records','record_corrections') ORDER BY name")
      .all<{ name: string }>();
    expect(tables.results.map((t) => t.name)).toEqual(['building_records', 'record_corrections', 'record_pulls']);
  });

  it('rejects an unknown pull status and a duplicate record key', async () => {
    const db = createRecordsTestDb();
    const buildingId = await insertBuilding(db);
    await expect(
      db.prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status) VALUES ('p1', ?, 'boston', 'r1', 'Assessor', 'q', 'weird')").bind(buildingId).run(),
    ).rejects.toThrow();

    await db.prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status) VALUES ('p1', ?, 'boston', 'r1', 'Assessor', 'q', 'ok')").bind(buildingId).run();
    await db.prepare("INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload) VALUES ('r1', ?, 'p1', 'permit', 'A1', '{}')").bind(buildingId).run();
    await expect(
      db.prepare("INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload) VALUES ('r2', ?, 'p1', 'permit', 'A1', '{}')").bind(buildingId).run(),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('accepts the two new audit action types', async () => {
    const db = createRecordsTestDb();
    for (const action of ['records_pulled', 'record_correction_resolved']) {
      await db
        .prepare("INSERT INTO audit_logs (admin_user_id, admin_ip, action_type, entity_type, entity_id) VALUES ('admin', '1.1.1.1', ?, 'building', 'b1')")
        .bind(action)
        .run();
    }
    const count = await db.prepare('SELECT COUNT(*) AS n FROM audit_logs').first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsMigrations.test.ts`
Expected: FAIL with `ENOENT ... migrations/0029_building_records.sql`

- [ ] **Step 4: Write migration 0029**

```sql
-- migrations/0029_building_records.sql
-- Public building records (spec: docs/superpowers/specs/2026-09-06-building-records-design.md)
--
-- parcel_id is the join key across City of Boston datasets. Stored in the 10-digit
-- form with the leading zero; adapters that need the numeric form strip it.
-- sam_id is Boston's address id, used by the violations and enforcement feeds.
ALTER TABLE buildings ADD COLUMN parcel_id TEXT;
ALTER TABLE buildings ADD COLUMN sam_id TEXT;
CREATE INDEX IF NOT EXISTS idx_buildings_parcel_id ON buildings(parcel_id);

-- One row per source run. Insert-only. This is the provenance for every record.
CREATE TABLE IF NOT EXISTS record_pulls (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  jurisdiction TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_label TEXT NOT NULL,
  query TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','empty','error')),
  row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  triggered_by TEXT REFERENCES users(id),
  correction_id TEXT,
  retrieved_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_record_pulls_building ON record_pulls(building_id, source_id, retrieved_at);

-- One row per record. payload is JSON validated on read against the kind's type.
CREATE TABLE IF NOT EXISTS building_records (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  pull_id TEXT NOT NULL REFERENCES record_pulls(id),
  kind TEXT NOT NULL CHECK (kind IN ('assessment','permit','violation','enforcement_ticket','service_request','rentsmart')),
  source_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (building_id, kind, source_key)
);
CREATE INDEX IF NOT EXISTS idx_building_records_building_kind ON building_records(building_id, kind);

-- Public "report a record error" submissions. The only resolution is a re-pull.
CREATE TABLE IF NOT EXISTS record_corrections (
  id TEXT PRIMARY KEY,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  record_kind TEXT,
  claim TEXT NOT NULL,
  contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolution TEXT CHECK (resolution IN ('repulled_unchanged','repulled_updated','source_mismatch_noted')),
  resolution_notes TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_record_corrections_status ON record_corrections(status, created_at);
```

- [ ] **Step 5: Write migration 0030**

Copy the full `CREATE TABLE audit_logs_v3 ... CREATE INDEX` block from `migrations/0028_audit_expand_action_types.sql`, rename `audit_logs_v3` to `audit_logs_v4` throughout, and add two entries to the `action_type` list. The file is:

```sql
-- migrations/0030_audit_records_actions.sql
-- Add the two audit action types the public-records feature writes:
--   records_pulled              (entity 'building')  admin ran a record pull
--   record_correction_resolved  (entity 'building')  admin closed a correction
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt (0014/0028 pattern).
--
-- PRODUCTION NOTE: apply with `wrangler d1 execute --remote --file`, never
-- `migrations apply --remote`. Back up audit_logs first and verify row count after.

CREATE TABLE IF NOT EXISTS audit_logs_v4 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    admin_user_id TEXT NOT NULL,
    admin_ip TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN (
        'review_approved', 'review_rejected', 'review_flagged', 'review_pending',
        'review_deleted',
        'dispute_resolved', 'dispute_dismissed', 'dispute_upheld', 'dispute_partially_valid',
        'landlord_created', 'landlord_updated', 'landlord_deleted',
        'building_updated', 'building_deleted', 'buildings_bulk_deleted',
        'manager_created', 'manager_updated',
        'verification_approved', 'verification_rejected',
        'admin_granted', 'admin_revoked',
        'bug_report_updated',
        -- public records (migration 0030)
        'records_pulled', 'record_correction_resolved'
    )),
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'review', 'dispute', 'landlord', 'building',
        'manager', 'verification', 'user', 'bug_report'
    )),
    entity_id TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    notes TEXT
);

INSERT INTO audit_logs_v4 (
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
)
SELECT
    id, created_at, admin_user_id, admin_ip, action_type,
    entity_type, entity_id, old_value, new_value, notes
FROM audit_logs;

DROP TABLE audit_logs;

ALTER TABLE audit_logs_v4 RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_admin ON audit_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsMigrations.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Apply locally and commit**

Run: `npx wrangler d1 migrations apply ratemyplace-db --local`
Expected: `0029_building_records.sql` and `0030_audit_records_actions.sql` listed as applied.

```bash
git add migrations/0029_building_records.sql migrations/0030_audit_records_actions.sql src/lib/__tests__/helpers/recordsDb.ts src/lib/__tests__/recordsMigrations.test.ts
git commit -m "feat(records): migrations for building records, pulls, corrections, audit actions"
```

---

### Task 3: Record types and the CKAN SQL client

**Files:**
- Create: `src/lib/records/types.ts`
- Create: `src/lib/records/ckan.ts`
- Test: `src/lib/__tests__/recordsCkan.test.ts`

- [ ] **Step 1: Write the types module**

```ts
// src/lib/records/types.ts
export type RecordKind =
  | 'assessment'
  | 'permit'
  | 'violation'
  | 'enforcement_ticket'
  | 'service_request'
  | 'rentsmart';

export const RECORD_KINDS: readonly RecordKind[] = [
  'assessment', 'permit', 'violation', 'enforcement_ticket', 'service_request', 'rentsmart',
];

export interface AssessmentPayload {
  fiscalYear: string;
  parcelId: string | null;
  owner: string | null;
  mailAddressee: string | null;
  mailStreet: string | null;
  mailCity: string | null;
  mailState: string | null;
  mailZip: string | null;
  landUse: string | null;
  landUseDescription: string | null;
  yearBuilt: number | null;
  yearRemodel: number | null;
  grossArea: number | null;
  livingArea: number | null;
  residentialUnits: number | null;
  commercialUnits: number | null;
  totalValue: number | null;
  landValue: number | null;
  buildingValue: number | null;
  condominium: boolean;
}

export interface PermitPayload {
  permitNumber: string;
  workType: string | null;
  permitType: string | null;
  description: string | null;
  comments: string | null;
  applicant: string | null;
  declaredValuation: number | null;
  totalFees: number | null;
  issuedDate: string | null;
  expirationDate: string | null;
  status: string | null;
  occupancyType: string | null;
  address: string | null;
}

export interface ViolationPayload {
  caseNumber: string;
  code: string | null;
  value: string | null;
  description: string | null;
  status: string | null;
  statusDate: string | null;
  address: string | null;
  contactAddress: string | null;
  samId: string | null;
}

export interface EnforcementTicketPayload extends ViolationPayload {
  ticketNumber: string | null;
}

export type ServiceRequestClassification = 'housing' | 'other';

export interface ServiceRequestPayload {
  caseId: string;
  system: 'legacy' | 'new';
  openedAt: string | null;
  closedAt: string | null;
  status: string | null;
  closureReason: string | null;
  title: string | null;
  subject: string | null;
  reason: string | null;
  type: string | null;
  location: string | null;
  source: string | null;
  classification: ServiceRequestClassification;
}

export interface RentSmartPayload {
  rowId: string;
  date: string | null;
  violationType: string | null;
  description: string | null;
  address: string | null;
  parcel: string | null;
}

export type RecordPayload =
  | AssessmentPayload
  | PermitPayload
  | ViolationPayload
  | EnforcementTicketPayload
  | ServiceRequestPayload
  | RentSmartPayload;

export interface RecordRow {
  kind: RecordKind;
  sourceKey: string;
  payload: RecordPayload;
  sourceUrl?: string;
}

export interface SourceResult {
  /** The exact SQL (or JSON array of SQL strings) sent. Stored verbatim as provenance. */
  query: string;
  rows: RecordRow[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BuildingIdentity {
  buildingId: string;
  /** Individual street numbers, e.g. ['23','27'] for '23-27'. */
  numbers: string[];
  /** The hyphenated range as written, e.g. '23-27', or null. */
  rangeForm: string | null;
  /** Uppercase street with short suffix, e.g. 'LANARK RD'. */
  streetShort: string;
  /** Uppercase street with long suffix, e.g. 'LANARK ROAD'. Equal to streetShort when no suffix. */
  streetLong: string;
  /** Uppercase street name without suffix, e.g. 'LANARK'. */
  streetBase: string;
  /** Every '<number> <streetShort>' form, uppercase. */
  addressFormsShort: string[];
  /** Every '<number> <streetLong>' form, uppercase. */
  addressFormsLong: string[];
  /** 10-digit parcel id with leading zero, or null. */
  parcelId: string | null;
  /** Parcel id with leading zero stripped, or null. */
  parcelNumeric: string | null;
  condominium: boolean;
  zip: string | null;
}

export interface RecordSource {
  /** CKAN resource id (later: other stable identifiers). Stored as record_pulls.source_id. */
  id: string;
  label: string;
  /** Human-readable dataset page, rendered as the "Source" link. */
  pageUrl: string;
  /** Kinds this source owns. A successful run replaces these rows for the building. */
  kinds: RecordKind[];
  /** When set, the source owns only rows with this source_key (assessor fiscal years). */
  ownsSourceKey?: string;
  run(identity: BuildingIdentity, fetchImpl: FetchLike): Promise<SourceResult>;
}

export class SourceError extends Error {
  constructor(message: string, public readonly query: string) {
    super(message);
    this.name = 'SourceError';
  }
}

export interface PullSourceSummary {
  sourceId: string;
  label: string;
  status: 'ok' | 'empty' | 'error';
  rowCount: number;
  error?: string;
}

export interface PullSummary {
  buildingId: string;
  jurisdiction: string;
  parcelId: string | null;
  condominium: boolean;
  sources: PullSourceSummary[];
}

/** The subset of D1Database the records module uses. TestD1Database satisfies it too. */
export interface RecordsStatement {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface RecordsPreparedStatement extends RecordsStatement {
  bind(...values: unknown[]): RecordsPreparedStatement;
}
export interface RecordsDb {
  prepare(sql: string): RecordsPreparedStatement;
  batch(statements: RecordsPreparedStatement[]): Promise<unknown>;
}
```

- [ ] **Step 2: Write the failing CKAN client test**

```ts
// src/lib/__tests__/recordsCkan.test.ts
import { describe, it, expect } from 'vitest';
import { ckanSql, sqlLiteral, parseMoney, parseIntOrNull, ROW_CAP } from '../records/ckan';
import { SourceError } from '../records/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('sqlLiteral', () => {
  it('quotes and doubles embedded single quotes', () => {
    expect(sqlLiteral("O'BRIEN ST")).toBe("'O''BRIEN ST'");
  });
});

describe('parseMoney / parseIntOrNull', () => {
  it('handles every assessor value format seen in the wild', () => {
    expect(parseMoney('6,720,200')).toBe(6720200);
    expect(parseMoney('6780500')).toBe(6780500);
    expect(parseMoney('$6,649,200.00 ')).toBe(6649200);
    expect(parseMoney('$36,500.00')).toBe(36500);
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseIntOrNull('1920')).toBe(1920);
    expect(parseIntOrNull(null)).toBeNull();
    expect(parseIntOrNull('abc')).toBeNull();
  });
});

describe('ckanSql', () => {
  it('returns records and caps rows', async () => {
    const records = Array.from({ length: ROW_CAP + 5 }, (_, i) => ({ n: i }));
    const fetchImpl = async () => jsonResponse({ success: true, result: { records } });
    const rows = await ckanSql<{ n: number }>('SELECT 1', fetchImpl);
    expect(rows).toHaveLength(ROW_CAP);
  });

  it('throws SourceError carrying the query on HTTP failure', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 });
    await expect(ckanSql('SELECT 2', fetchImpl)).rejects.toMatchObject({ name: 'SourceError', query: 'SELECT 2' });
  });

  it('throws SourceError with the CKAN error message when success is false', async () => {
    const fetchImpl = async () => jsonResponse({ success: false, error: { info: { orig: ['column "ZIPCODE" does not exist'] } } }, 409);
    await expect(ckanSql('SELECT 3', fetchImpl)).rejects.toThrow(/does not exist/);
  });

  it('sends the SQL url-encoded to the datastore_search_sql endpoint', async () => {
    let seen = '';
    const fetchImpl = async (input: string) => { seen = input; return jsonResponse({ success: true, result: { records: [] } }); };
    await ckanSql("SELECT * FROM \"abc\" WHERE x = 'y'", fetchImpl);
    expect(seen.startsWith('https://data.boston.gov/api/3/action/datastore_search_sql?sql=')).toBe(true);
    expect(decodeURIComponent(seen.split('sql=')[1])).toBe("SELECT * FROM \"abc\" WHERE x = 'y'");
  });

  it('is a SourceError, not a bare Error, when fetch itself rejects', async () => {
    const fetchImpl = async () => { throw new TypeError('network down'); };
    const err = await ckanSql('SELECT 4', fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.message).toContain('network down');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsCkan.test.ts`
Expected: FAIL with `Cannot find module '../records/ckan'`

- [ ] **Step 4: Write the CKAN client**

```ts
// src/lib/records/ckan.ts
import { SourceError, type FetchLike } from './types';

export const CKAN_SQL_ENDPOINT = 'https://data.boston.gov/api/3/action/datastore_search_sql';
export const FETCH_TIMEOUT_MS = 10_000;
export const ROW_CAP = 500;

/** Quote a string for embedding in CKAN SQL. Doubles single quotes. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** '6,720,200' | '6780500' | '$6,649,200.00 ' -> integer dollars; null when absent. */
export function parseMoney(value: string | null | undefined): number | null {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, '');
  if (cleaned === '') return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function parseIntOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

interface CkanEnvelope<T> {
  success: boolean;
  result?: { records?: T[] };
  error?: unknown;
}

function describeError(error: unknown): string {
  try {
    return JSON.stringify(error).slice(0, 300);
  } catch {
    return String(error);
  }
}

/**
 * Run one SQL statement against Boston's CKAN datastore. Always resolves to at
 * most ROW_CAP rows or throws a SourceError that carries the query for provenance.
 */
export async function ckanSql<T>(sql: string, fetchImpl: FetchLike): Promise<T[]> {
  const url = `${CKAN_SQL_ENDPOINT}?sql=${encodeURIComponent(sql)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (err) {
      throw new SourceError(`fetch failed: ${err instanceof Error ? err.message : String(err)}`, sql);
    }
    let body: CkanEnvelope<T>;
    try {
      body = (await response.json()) as CkanEnvelope<T>;
    } catch {
      throw new SourceError(`HTTP ${response.status} with non-JSON body`, sql);
    }
    if (!response.ok || !body.success) {
      throw new SourceError(`HTTP ${response.status}: ${describeError(body.error ?? 'request failed')}`, sql);
    }
    return (body.result?.records ?? []).slice(0, ROW_CAP);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsCkan.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/records/types.ts src/lib/records/ckan.ts src/lib/__tests__/recordsCkan.test.ts
git commit -m "feat(records): record types and CKAN SQL client"
```

---

### Task 4: Building identity (address forms and parcel forms)

**Files:**
- Create: `src/lib/records/identity.ts`
- Test: `src/lib/__tests__/recordsIdentity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/recordsIdentity.test.ts
import { describe, it, expect } from 'vitest';
import { buildIdentity, toCanonicalParcel, toNumericParcel } from '../records/identity';

const base = { id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null };

describe('buildIdentity', () => {
  it('splits a ranged address into numbers, keeps the range, and normalizes the suffix', () => {
    const id = buildIdentity(base);
    expect(id.numbers).toEqual(['23', '27']);
    expect(id.rangeForm).toBe('23-27');
    expect(id.streetShort).toBe('LANARK RD');
    expect(id.streetLong).toBe('LANARK ROAD');
    expect(id.streetBase).toBe('LANARK');
    expect(id.addressFormsShort).toEqual(['23 LANARK RD', '27 LANARK RD', '23-27 LANARK RD']);
    expect(id.addressFormsLong).toEqual(['23 LANARK ROAD', '27 LANARK ROAD', '23-27 LANARK ROAD']);
    expect(id.zip).toBe('02135');
    expect(id.parcelId).toBeNull();
    expect(id.condominium).toBe(false);
  });

  it('maps Ave and Avenue to AV, the assessor spelling', () => {
    const id = buildIdentity({ ...base, address: '1066 Commonwealth Ave, Boston, MA 02215' });
    expect(id.streetShort).toBe('COMMONWEALTH AV');
    expect(id.streetLong).toBe('COMMONWEALTH AVENUE');
    expect(id.numbers).toEqual(['1066']);
    expect(id.rangeForm).toBeNull();
  });

  it('strips unit suffixes and handles a street with no suffix', () => {
    const id = buildIdentity({ ...base, address: '5 Ayr Rd Apt 2, Boston, MA' });
    expect(id.streetShort).toBe('AYR RD');
    const noSuffix = buildIdentity({ ...base, address: '10 Broadway, Boston, MA' });
    expect(noSuffix.streetShort).toBe('BROADWAY');
    expect(noSuffix.streetLong).toBe('BROADWAY');
    expect(noSuffix.streetBase).toBe('BROADWAY');
  });

  it('carries parcel forms when the building already has one', () => {
    const id = buildIdentity({ ...base, parcel_id: '0100001000' });
    expect(id.parcelId).toBe('0100001000');
    expect(id.parcelNumeric).toBe('100001000');
  });

  it('throws on an address it cannot parse', () => {
    expect(() => buildIdentity({ ...base, address: 'Lanark Road' })).toThrow(/parse/i);
  });
});

describe('parcel helpers', () => {
  it('canonical form keeps ten digits with a leading zero; numeric strips it', () => {
    expect(toCanonicalParcel('100001000')).toBe('0100001000');
    expect(toCanonicalParcel('2102098000')).toBe('2102098000');
    expect(toNumericParcel('0100001000')).toBe('100001000');
    expect(toCanonicalParcel('12ab')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsIdentity.test.ts`
Expected: FAIL with `Cannot find module '../records/identity'`

- [ ] **Step 3: Write the identity module**

```ts
// src/lib/records/identity.ts
import { parseStreetAddress, normalizeStreetName } from '../enrichment/helpers';
import type { BuildingIdentity } from './types';

export interface BuildingRowForIdentity {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  parcel_id: string | null;
  sam_id: string | null;
}

/** Short (assessor/permits/enforcement) and long (311 free text) suffix spellings. */
const SUFFIXES: Array<[short: string, long: string]> = [
  ['AV', 'AVENUE'], ['ST', 'STREET'], ['RD', 'ROAD'], ['DR', 'DRIVE'], ['PL', 'PLACE'],
  ['TER', 'TERRACE'], ['CT', 'COURT'], ['LN', 'LANE'], ['BLVD', 'BOULEVARD'], ['PKWY', 'PARKWAY'],
  ['HWY', 'HIGHWAY'], ['SQ', 'SQUARE'], ['CIR', 'CIRCLE'], ['PK', 'PARK'], ['WAY', 'WAY'],
];

const SUFFIX_ALIASES: Record<string, string> = {
  AVE: 'AV', AVENUE: 'AV', AV: 'AV',
  ST: 'ST', STREET: 'ST',
  RD: 'RD', ROAD: 'RD',
  DR: 'DR', DRIVE: 'DR',
  PL: 'PL', PLACE: 'PL',
  TER: 'TER', TERR: 'TER', TERRACE: 'TER',
  CT: 'CT', COURT: 'CT',
  LN: 'LN', LANE: 'LN',
  BLVD: 'BLVD', BOULEVARD: 'BLVD',
  PKWY: 'PKWY', PARKWAY: 'PKWY',
  HWY: 'HWY', HIGHWAY: 'HWY',
  SQ: 'SQ', SQUARE: 'SQ',
  CIR: 'CIR', CIRCLE: 'CIR',
  PK: 'PK', PARK: 'PK',
  WAY: 'WAY',
};

export function toCanonicalParcel(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).trim();
  if (!/^\d{9,10}$/.test(digits)) return null;
  return digits.padStart(10, '0');
}

export function toNumericParcel(value: string | null | undefined): string | null {
  const canonical = toCanonicalParcel(value);
  return canonical ? String(Number.parseInt(canonical, 10)) : null;
}

function splitStreet(streetUpper: string): { base: string; short: string | null; long: string | null } {
  const words = streetUpper.replace(/\./g, '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return { base: streetUpper, short: null, long: null };
  const last = words[words.length - 1];
  const short = SUFFIX_ALIASES[last];
  if (!short) return { base: streetUpper, short: null, long: null };
  const long = SUFFIXES.find(([s]) => s === short)?.[1] ?? short;
  return { base: words.slice(0, -1).join(' '), short, long };
}

export function buildIdentity(building: BuildingRowForIdentity): BuildingIdentity {
  const parsed = parseStreetAddress(building.address.trim());
  if (!parsed) throw new Error(`Could not parse street address: ${building.address}`);

  const numberToken = parsed.number.toUpperCase();
  const numbers = numberToken.split('-').map((n) => n.replace(/[A-Z]$/, '')).filter(Boolean);
  const rangeForm = numbers.length > 1 ? numbers.join('-') : null;

  const streetUpper = normalizeStreetName(parsed.street);
  const { base, short, long } = splitStreet(streetUpper);
  const streetShort = short ? `${base} ${short}` : base;
  const streetLong = long ? `${base} ${long}` : base;

  const numberForms = rangeForm ? [...numbers, rangeForm] : numbers;
  const parcelId = toCanonicalParcel(building.parcel_id);

  return {
    buildingId: building.id,
    numbers,
    rangeForm,
    streetShort,
    streetLong,
    streetBase: base,
    addressFormsShort: numberForms.map((n) => `${n} ${streetShort}`),
    addressFormsLong: numberForms.map((n) => `${n} ${streetLong}`),
    parcelId,
    parcelNumeric: toNumericParcel(parcelId),
    condominium: false,
    zip: building.zip_code,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsIdentity.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/records/identity.ts src/lib/__tests__/recordsIdentity.test.ts
git commit -m "feat(records): building identity with address and parcel forms"
```

---

### Task 5: Fixture fetch helper and the assessor source

**Files:**
- Create: `src/lib/__tests__/helpers/records/fixtureFetch.ts`
- Create: `src/lib/__tests__/helpers/records/assessor-fy2026-lanark.json`
- Create: `src/lib/__tests__/helpers/records/assessor-fy2026-condo.json`
- Create: `src/lib/__tests__/helpers/records/assessor-fy2021-lanark.json`
- Create: `src/lib/records/sources/boston/assessor.ts`
- Test: `src/lib/__tests__/recordsAssessor.test.ts`

- [ ] **Step 1: Write the fake fetch**

The fake routes on the resource id found inside the SQL and, optionally, on a substring of the SQL, so one resource can answer differently for a by-address and a by-parcel query.

```ts
// src/lib/__tests__/helpers/records/fixtureFetch.ts
import type { FetchLike } from '../../../records/types';

export interface FixtureRoute {
  /** CKAN resource id the SQL must reference. */
  resourceId: string;
  /** Optional substring the SQL must also contain. */
  sqlIncludes?: string;
  records?: unknown[];
  /** When set, respond with this HTTP status and a CKAN error envelope. */
  errorStatus?: number;
  errorMessage?: string;
}

export function fixtureFetch(routes: FixtureRoute[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl: FetchLike = async (input: string) => {
    const sql = decodeURIComponent(input.split('sql=')[1] ?? '');
    calls.push(sql);
    const route = routes.find((r) => sql.includes(r.resourceId) && (!r.sqlIncludes || sql.includes(r.sqlIncludes)));
    if (!route) {
      return new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });
    }
    if (route.errorStatus) {
      return new Response(
        JSON.stringify({ success: false, error: { info: { orig: [route.errorMessage ?? 'error'] } } }),
        { status: route.errorStatus },
      );
    }
    return new Response(JSON.stringify({ success: true, result: { records: route.records ?? [] } }), { status: 200 });
  };
  return Object.assign(impl, { calls });
}
```

- [ ] **Step 2: Write the three assessor fixtures**

`src/lib/__tests__/helpers/records/assessor-fy2026-lanark.json` (one row, values verified live 2026-09-06):

```json
[
  {
    "PID": "2102098000", "ST_NUM": "23", "ST_NUM2": "27", "ST_NAME": "Lanark RD", "CITY": "BRIGHTON", "ZIP_CODE": "02135",
    "LU": "A", "LU_DESC": "APT 7-30 UNITS", "OWNER": "LANARK ROAD LLC MASS LLC",
    "MAIL_ADDRESSEE": "C/O ATT <person>", "MAIL_STREET_ADDRESS": "PO BOX 35006", "MAIL_CITY": "BOSTON", "MAIL_STATE": "MA", "MAIL_ZIP_CODE": "02135",
    "RES_UNITS": null, "COM_UNITS": null, "GROSS_AREA": "34650", "LIVING_AREA": "27720",
    "LAND_VALUE": "1,620,500", "BLDG_VALUE": "5,099,700", "TOTAL_VALUE": "6,720,200",
    "YR_BUILT": "1920", "YR_REMODEL": "1980", "NUM_BLDGS": "1"
  }
]
```

`src/lib/__tests__/helpers/records/assessor-fy2026-condo.json` (55 Lanark: a CM master row plus CD unit rows, trimmed to the columns the resolver reads):

```json
[
  { "PID": "2102110000", "ST_NUM": "55", "ST_NUM2": "65", "ST_NAME": "Lanark RD", "LU": "CM", "OWNER": "GRAND LANARK CONDO TR" },
  { "PID": "2102110002", "ST_NUM": "55", "ST_NUM2": null, "ST_NAME": "Lanark RD", "LU": "CD", "OWNER": "SRIVATSA SRINI" },
  { "PID": "2102110004", "ST_NUM": "55", "ST_NUM2": null, "ST_NAME": "Lanark RD", "LU": "CD", "OWNER": "MATTCAM LLC" }
]
```

`src/lib/__tests__/helpers/records/assessor-fy2021-lanark.json` (legacy column names and dollar formatting):

```json
[
  {
    "PID": "2102098000", "ST_NUM": "23  27", "ST_NAME": "LANARK RD", "ZIPCODE": "02135",
    "LU": "A", "LU_DESC": "APT 7-30 UNITS", "OWNER": "LANARK ROAD LLC MASS LLC",
    "MAIL_ADDRESSEE": "C/O ATT <person>", "MAIL_ADDRESS": "PO BOX 35006", "MAIL_CITY": "BOSTON", "MAIL_STATE": "MA", "MAIL_ZIPCODE": "02135",
    "RES_UNITS": null, "COM_UNITS": null, "GROSS_AREA": "34650", "LIVING_AREA": "27720",
    "LAND_VALUE": "$1,488,900.00 ", "BLDG_VALUE": "$5,160,300.00 ", "TOTAL_VALUE": "$6,649,200.00 ",
    "YR_BUILT": "1920", "YR_REMODEL": "1980"
  }
]
```

- [ ] **Step 3: Write the failing assessor test**

```ts
// src/lib/__tests__/recordsAssessor.test.ts
import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { resolveParcel, assessorSource, ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import type { AssessmentPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import condo2026 from './helpers/records/assessor-fy2026-condo.json';
import lanark2021 from './helpers/records/assessor-fy2021-lanark.json';

const lanark = buildIdentity({ id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null });
const FY2021_RESOURCE_ID = 'c4b7331e-e213-45a5-adda-052e4dd31d41';

describe('resolveParcel', () => {
  it('finds a whole-building parcel by ST_NUM or ST_NUM2 with case-folded street', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]);
    const result = await resolveParcel(lanark, fetchImpl);
    expect(result).toEqual({ parcelId: '2102098000', condominium: false, candidates: 1 });
    expect(fetchImpl.calls[0]).toContain(`upper("ST_NAME") = 'LANARK RD'`);
    expect(fetchImpl.calls[0]).toContain(`"ST_NUM" IN ('23','27','23-27')`);
    expect(fetchImpl.calls[0]).toContain(`"ST_NUM2" IN ('23','27')`);
  });

  it('reports a condominium when only CD and CM rows match, and stores no parcel', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: condo2026 }]);
    const fiftyFive = buildIdentity({ id: 'b2', address: '55 Lanark Rd, Boston, MA', city: 'Boston', state: 'MA', zip_code: null, parcel_id: null, sam_id: null });
    expect(await resolveParcel(fiftyFive, fetchImpl)).toEqual({ parcelId: null, condominium: true, candidates: 3 });
  });

  it('returns no parcel and the candidate count when several whole-building rows match', async () => {
    const two = [
      { ...lanark2026[0], PID: '1' },
      { ...lanark2026[0], PID: '2' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: two }]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({ parcelId: null, condominium: false, candidates: 2 });
  });

  it('returns zero candidates when nothing matches', async () => {
    const fetchImpl = fixtureFetch([]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({ parcelId: null, condominium: false, candidates: 0 });
  });
});

describe('assessorSource', () => {
  const withParcel = { ...lanark, parcelId: '2102098000', parcelNumeric: '2102098000' };

  it('has six fiscal years, newest first, each owning its own source key', () => {
    expect(ASSESSOR_YEARS.map((y) => y.fiscalYear)).toEqual(['FY2026', 'FY2025', 'FY2024', 'FY2023', 'FY2022', 'FY2021']);
    expect(assessorSource(ASSESSOR_YEARS[0]).ownsSourceKey).toBe('FY2026');
    expect(assessorSource(ASSESSOR_YEARS[0]).kinds).toEqual(['assessment']);
  });

  it('maps a modern row to an AssessmentPayload with parsed numbers', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]);
    const result = await assessorSource(ASSESSOR_YEARS[0]).run(withParcel, fetchImpl);
    expect(result.query).toContain(`"PID" IN ('2102098000')`);
    expect(result.rows).toHaveLength(1);
    const payload = result.rows[0].payload as AssessmentPayload;
    expect(result.rows[0].sourceKey).toBe('FY2026');
    expect(payload).toMatchObject({
      fiscalYear: 'FY2026', parcelId: '2102098000', owner: 'LANARK ROAD LLC MASS LLC',
      mailAddressee: 'C/O ATT <person>', mailStreet: 'PO BOX 35006', mailCity: 'BOSTON', mailState: 'MA', mailZip: '02135',
      landUse: 'A', landUseDescription: 'APT 7-30 UNITS', yearBuilt: 1920, yearRemodel: 1980,
      grossArea: 34650, livingArea: 27720, residentialUnits: null, commercialUnits: null,
      totalValue: 6720200, landValue: 1620500, buildingValue: 5099700, condominium: false,
    });
  });

  it('maps a legacy FY2021 row through its column map', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, records: lanark2021 }]);
    const year = ASSESSOR_YEARS.find((y) => y.fiscalYear === 'FY2021')!;
    const result = await assessorSource(year).run(withParcel, fetchImpl);
    const payload = result.rows[0].payload as AssessmentPayload;
    expect(payload).toMatchObject({ fiscalYear: 'FY2021', mailStreet: 'PO BOX 35006', mailZip: '02135', totalValue: 6649200, landValue: 1488900 });
  });

  it('queries both parcel forms when the parcel has a leading zero', async () => {
    const fetchImpl = fixtureFetch([]);
    const zero = { ...lanark, parcelId: '0100001000', parcelNumeric: '100001000' };
    const result = await assessorSource(ASSESSOR_YEARS[0]).run(zero, fetchImpl);
    expect(result.query).toContain(`"PID" IN ('0100001000','100001000')`);
    expect(result.rows).toEqual([]);
  });

  it('emits a single owner-less condominium row for the current year and nothing for history', async () => {
    const fetchImpl = fixtureFetch([]);
    const condo = { ...lanark, condominium: true };
    const current = await assessorSource(ASSESSOR_YEARS[0]).run(condo, fetchImpl);
    expect(current.rows).toHaveLength(1);
    expect((current.rows[0].payload as AssessmentPayload)).toMatchObject({ condominium: true, owner: null, parcelId: null });
    const history = await assessorSource(ASSESSOR_YEARS[1]).run(condo, fetchImpl);
    expect(history.rows).toEqual([]);
    expect(fetchImpl.calls).toEqual([]);
  });

  it('treats a missing-column error as empty, and rethrows any other error', async () => {
    const missing = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 409, errorMessage: 'column "ZIPCODE" does not exist' }]);
    const year = ASSESSOR_YEARS.find((y) => y.fiscalYear === 'FY2021')!;
    expect((await assessorSource(year).run(withParcel, missing)).rows).toEqual([]);

    const outage = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 503, errorMessage: 'gateway' }]);
    await expect(assessorSource(year).run(withParcel, outage)).rejects.toThrow(/503/);
  });

  it('throws when the parcel is unresolved and the building is not a condominium', async () => {
    await expect(assessorSource(ASSESSOR_YEARS[0]).run(lanark, fixtureFetch([]))).rejects.toThrow(/parcel/i);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsAssessor.test.ts`
Expected: FAIL with `Cannot find module '../records/sources/boston/assessor'`

- [ ] **Step 5: Write the assessor source**

```ts
// src/lib/records/sources/boston/assessor.ts
import { ckanSql, parseIntOrNull, parseMoney, sqlLiteral } from '../../ckan';
import { toCanonicalParcel } from '../../identity';
import { SourceError, type AssessmentPayload, type BuildingIdentity, type FetchLike, type RecordSource, type SourceResult } from '../../types';

export const FY2026_RESOURCE_ID = 'ee73430d-96c0-423e-ad21-c4cfb54c8961';
export const ASSESSOR_PAGE_URL = 'https://data.boston.gov/dataset/property-assessment';

/** Column names that drift between fiscal years. Fixed columns are referenced directly. */
export interface AssessorColumns {
  mailAddressee: string | null;
  mailStreet: string | null;
  /** FY2023 only: one combined "OWNER MAIL ADDRESS" column. */
  mailCombined: string | null;
  mailCity: string | null;
  mailState: string | null;
  mailZip: string | null;
}

export interface AssessorYear {
  fiscalYear: string;
  resourceId: string;
  columns: AssessorColumns;
}

const MODERN: AssessorColumns = {
  mailAddressee: 'MAIL_ADDRESSEE', mailStreet: 'MAIL_STREET_ADDRESS', mailCombined: null,
  mailCity: 'MAIL_CITY', mailState: 'MAIL_STATE', mailZip: 'MAIL_ZIP_CODE',
};
const FY2023: AssessorColumns = {
  mailAddressee: null, mailStreet: null, mailCombined: 'OWNER MAIL ADDRESS',
  mailCity: null, mailState: null, mailZip: null,
};
const LEGACY: AssessorColumns = {
  mailAddressee: 'MAIL_ADDRESSEE', mailStreet: 'MAIL_ADDRESS', mailCombined: null,
  mailCity: 'MAIL_CITY', mailState: 'MAIL_STATE', mailZip: 'MAIL_ZIPCODE',
};

/** Newest first. The first entry is the current year and resolves parcels. */
export const ASSESSOR_YEARS: AssessorYear[] = [
  { fiscalYear: 'FY2026', resourceId: FY2026_RESOURCE_ID, columns: MODERN },
  { fiscalYear: 'FY2025', resourceId: '6b7e460e-33f6-4e61-80bc-1bef2e73ac54', columns: MODERN },
  { fiscalYear: 'FY2024', resourceId: 'a9eb19ad-da79-4f7b-9e3b-6b13e66f8285', columns: MODERN },
  { fiscalYear: 'FY2023', resourceId: '1000d81c-5bb5-49e8-a9ab-44cd042f1db2', columns: FY2023 },
  { fiscalYear: 'FY2022', resourceId: '4b99718b-d064-471b-9b24-517ae5effecc', columns: LEGACY },
  { fiscalYear: 'FY2021', resourceId: 'c4b7331e-e213-45a5-adda-052e4dd31d41', columns: LEGACY },
];

type Row = Record<string, string | null>;

const FIXED_COLUMNS = ['PID', 'OWNER', 'LU', 'LU_DESC', 'YR_BUILT', 'YR_REMODEL', 'GROSS_AREA', 'LIVING_AREA', 'RES_UNITS', 'COM_UNITS', 'TOTAL_VALUE', 'LAND_VALUE', 'BLDG_VALUE'];

function selectList(columns: AssessorColumns): string {
  const names = [...FIXED_COLUMNS, ...Object.values(columns).filter((c): c is string => Boolean(c))];
  return names.map((c) => `"${c}"`).join(',');
}

function parcelInList(identity: BuildingIdentity): string {
  const forms = Array.from(new Set([identity.parcelId, identity.parcelNumeric].filter((p): p is string => Boolean(p))));
  return forms.map(sqlLiteral).join(',');
}

function inList(values: string[]): string {
  return values.map(sqlLiteral).join(',');
}

export interface ParcelResolution {
  parcelId: string | null;
  condominium: boolean;
  candidates: number;
}

/**
 * Resolve a street address to a parcel using the current fiscal year.
 * One whole-building row (LU not CD/CM) wins. Only CD/CM rows means a condominium.
 * Several whole-building rows is ambiguous: no parcel, caller reports the count.
 */
export async function resolveParcel(identity: BuildingIdentity, fetchImpl: FetchLike): Promise<ParcelResolution> {
  const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
  const sql =
    `SELECT "PID","ST_NUM","ST_NUM2","ST_NAME","LU","OWNER" FROM "${FY2026_RESOURCE_ID}" ` +
    `WHERE upper("ST_NAME") = ${sqlLiteral(identity.streetShort)} ` +
    `AND ("ST_NUM" IN (${inList(numberForms)}) OR "ST_NUM2" IN (${inList(identity.numbers)})) LIMIT 100`;
  const rows = await ckanSql<Row>(sql, fetchImpl);
  const whole = rows.filter((r) => r.LU !== 'CD' && r.LU !== 'CM');
  if (whole.length === 1) {
    return { parcelId: toCanonicalParcel(whole[0].PID), condominium: false, candidates: 1 };
  }
  if (whole.length === 0 && rows.length > 0) {
    return { parcelId: null, condominium: true, candidates: rows.length };
  }
  return { parcelId: null, condominium: false, candidates: whole.length };
}

function condominiumPayload(fiscalYear: string): AssessmentPayload {
  return {
    fiscalYear, parcelId: null, owner: null, mailAddressee: null, mailStreet: null, mailCity: null, mailState: null, mailZip: null,
    landUse: 'CD', landUseDescription: 'CONDOMINIUM', yearBuilt: null, yearRemodel: null, grossArea: null, livingArea: null,
    residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null, buildingValue: null, condominium: true,
  };
}

function mapRow(row: Row, year: AssessorYear): AssessmentPayload {
  const c = year.columns;
  const pick = (col: string | null): string | null => (col && row[col] != null && String(row[col]).trim() !== '' ? String(row[col]).trim() : null);
  let mailStreet = pick(c.mailStreet);
  let mailCity = pick(c.mailCity);
  let mailState = pick(c.mailState);
  let mailZip = pick(c.mailZip);
  if (c.mailCombined) {
    // "PO BOX 35006 C/O ATT <person>, BOSTON, MA 02135"
    const combined = pick(c.mailCombined) ?? '';
    const parts = combined.split(',').map((p) => p.trim());
    mailStreet = parts[0] || null;
    mailCity = parts[1] || null;
    const stateZip = (parts[2] ?? '').split(/\s+/);
    mailState = stateZip[0] || null;
    mailZip = stateZip[1] || null;
  }
  return {
    fiscalYear: year.fiscalYear,
    parcelId: toCanonicalParcel(row.PID),
    owner: pick('OWNER'),
    mailAddressee: pick(c.mailAddressee),
    mailStreet, mailCity, mailState, mailZip,
    landUse: pick('LU'),
    landUseDescription: pick('LU_DESC'),
    yearBuilt: parseIntOrNull(row.YR_BUILT),
    yearRemodel: parseIntOrNull(row.YR_REMODEL),
    grossArea: parseIntOrNull(row.GROSS_AREA),
    livingArea: parseIntOrNull(row.LIVING_AREA),
    residentialUnits: parseIntOrNull(row.RES_UNITS),
    commercialUnits: parseIntOrNull(row.COM_UNITS),
    totalValue: parseMoney(row.TOTAL_VALUE),
    landValue: parseMoney(row.LAND_VALUE),
    buildingValue: parseMoney(row.BLDG_VALUE),
    condominium: false,
  };
}

export function assessorSource(year: AssessorYear): RecordSource {
  const isCurrent = year.fiscalYear === ASSESSOR_YEARS[0].fiscalYear;
  return {
    id: year.resourceId,
    label: `Property Assessment ${year.fiscalYear}`,
    pageUrl: ASSESSOR_PAGE_URL,
    kinds: ['assessment'],
    ownsSourceKey: year.fiscalYear,
    async run(identity, fetchImpl): Promise<SourceResult> {
      if (!identity.parcelId) {
        if (identity.condominium) {
          return isCurrent
            ? { query: 'condominium: no parcel query', rows: [{ kind: 'assessment', sourceKey: year.fiscalYear, payload: condominiumPayload(year.fiscalYear), sourceUrl: ASSESSOR_PAGE_URL }] }
            : { query: 'condominium: history skipped', rows: [] };
        }
        throw new SourceError('Parcel not resolved for this building', 'no query');
      }
      const sql = `SELECT ${selectList(year.columns)} FROM "${year.resourceId}" WHERE "PID" IN (${parcelInList(identity)}) LIMIT 5`;
      let rows: Row[];
      try {
        rows = await ckanSql<Row>(sql, fetchImpl);
      } catch (err) {
        if (err instanceof SourceError && /column .* does not exist/i.test(err.message)) {
          return { query: sql, rows: [] };
        }
        throw err;
      }
      return {
        query: sql,
        rows: rows.slice(0, 1).map((row) => ({
          kind: 'assessment' as const,
          sourceKey: year.fiscalYear,
          payload: mapRow(row, year),
          sourceUrl: ASSESSOR_PAGE_URL,
        })),
      };
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsAssessor.test.ts`
Expected: PASS (11 tests). If `resolveJsonModule` complaints appear on the JSON imports, the repo tsconfig already enables it for Astro; confirm with `npm run check`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/records/sources/boston/assessor.ts src/lib/__tests__/helpers/records/ src/lib/__tests__/recordsAssessor.test.ts
git commit -m "feat(records): Boston assessor source with parcel resolution and fiscal-year history"
```

---

### Task 6: Permits source

**Files:**
- Create: `src/lib/records/sources/boston/permits.ts`
- Create: `src/lib/__tests__/helpers/records/permits-positive.json`
- Test: `src/lib/__tests__/recordsPermits.test.ts`

- [ ] **Step 1: Write the fixture**

Shape copied from a live permit row; address and parcel changed to the 55-65 Lanark positive control.

```json
[
  {
    "permitnumber": "A1000569", "worktype": "INTEXT", "permittypedescr": "Amendment to a Long Form",
    "description": "Interior/Exterior Work", "comments": "Install new wheelchair lift.", "applicant": "Patrick Sharkey",
    "declared_valuation": "$36,500.00", "total_fees": "$390.00", "issued_date": "2021-01-28T16:29:26",
    "expiration_date": "2021-07-28T04:00:00", "status": "Closed", "occupancytype": "Mixed",
    "address": "55-65 Lanark RD", "city": "Boston", "state": "MA", "zip": "02135", "parcel_id": 2102110000
  },
  {
    "permitnumber": "E123", "worktype": "ELECTRICAL", "permittypedescr": "Electrical Permit",
    "description": "Electrical", "comments": null, "applicant": "Jane Spark",
    "declared_valuation": "$1,200.00", "total_fees": "$50.00", "issued_date": "2019-05-02T09:00:00",
    "expiration_date": null, "status": "Open", "occupancytype": "Multi",
    "address": "55 Lanark RD", "city": "Boston", "state": "MA", "zip": "02135", "parcel_id": 2102110000
  },
  {
    "permitnumber": "E123", "worktype": "ELECTRICAL", "permittypedescr": "Electrical Permit",
    "description": "duplicate row for dedupe test", "comments": null, "applicant": "Jane Spark",
    "declared_valuation": "$1,200.00", "total_fees": "$50.00", "issued_date": "2019-05-02T09:00:00",
    "expiration_date": null, "status": "Open", "occupancytype": "Multi",
    "address": "55 Lanark RD", "city": "Boston", "state": "MA", "zip": "02135", "parcel_id": 2102110000
  }
]
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/__tests__/recordsPermits.test.ts
import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { permitsSource, PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import type { PermitPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import positive from './helpers/records/permits-positive.json';

const fiftyFive = {
  ...buildIdentity({ id: 'b2', address: '55-65 Lanark Rd, Boston, MA', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: '2102110000', sam_id: null }),
};

describe('permitsSource', () => {
  it('queries by numeric parcel and every address form, both suffix spellings', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(fiftyFive, fetchImpl);
    expect(result.query).toContain('"parcel_id" = 2102110000');
    expect(result.query).toContain(`upper("address") LIKE '55 LANARK RD%'`);
    expect(result.query).toContain(`upper("address") LIKE '55-65 LANARK ROAD%'`);
    expect(result.query).toContain('ORDER BY "issued_date" DESC');
  });

  it('maps rows, parses money, and deduplicates on permit number', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(fiftyFive, fetchImpl);
    expect(result.rows.map((r) => r.sourceKey)).toEqual(['A1000569', 'E123']);
    const first = result.rows[0].payload as PermitPayload;
    expect(first).toMatchObject({
      permitNumber: 'A1000569', permitType: 'Amendment to a Long Form', declaredValuation: 36500, totalFees: 390,
      issuedDate: '2021-01-28T16:29:26', status: 'Closed', address: '55-65 Lanark RD',
    });
    expect(result.rows[0].kind).toBe('permit');
  });

  it('omits the parcel clause when the building has no parcel', async () => {
    const noParcel = { ...fiftyFive, parcelId: null, parcelNumeric: null };
    const fetchImpl = fixtureFetch([]);
    const result = await permitsSource.run(noParcel, fetchImpl);
    expect(result.query).not.toContain('parcel_id');
    expect(result.rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsPermits.test.ts`
Expected: FAIL with `Cannot find module '../records/sources/boston/permits'`

- [ ] **Step 4: Write the permits source**

```ts
// src/lib/records/sources/boston/permits.ts
import { ckanSql, parseMoney, sqlLiteral } from '../../ckan';
import type { BuildingIdentity, PermitPayload, RecordSource, SourceResult } from '../../types';

export const PERMITS_RESOURCE_ID = '6ddcd912-32a0-43df-9908-63574f8c7e77';
export const PERMITS_PAGE_URL = 'https://data.boston.gov/dataset/approved-building-permits';
/** Earliest issued_date in the dataset (metadata says 2009; the data goes back to 2006). */
export const PERMIT_COVERAGE_START = 'September 2006';

type Row = Record<string, string | number | null>;

const COLUMNS = ['permitnumber', 'worktype', 'permittypedescr', 'description', 'comments', 'applicant', 'declared_valuation', 'total_fees', 'issued_date', 'expiration_date', 'status', 'occupancytype', 'address', 'parcel_id'];

/** `upper("col") LIKE '<form>%'` for every short and long address form. */
export function addressLikeClauses(column: string, identity: BuildingIdentity): string[] {
  const forms = Array.from(new Set([...identity.addressFormsShort, ...identity.addressFormsLong]));
  return forms.map((f) => `upper("${column}") LIKE ${sqlLiteral(`${f}%`)}`);
}

function str(v: string | number | null | undefined): string | null {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

export const permitsSource: RecordSource = {
  id: PERMITS_RESOURCE_ID,
  label: 'Approved Building Permits',
  pageUrl: PERMITS_PAGE_URL,
  kinds: ['permit'],
  async run(identity, fetchImpl): Promise<SourceResult> {
    const clauses = addressLikeClauses('address', identity);
    if (identity.parcelNumeric && /^\d+$/.test(identity.parcelNumeric)) {
      clauses.unshift(`"parcel_id" = ${identity.parcelNumeric}`);
    }
    const sql =
      `SELECT ${COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${PERMITS_RESOURCE_ID}" ` +
      `WHERE ${clauses.join(' OR ')} ORDER BY "issued_date" DESC LIMIT 500`;
    const rows = await ckanSql<Row>(sql, fetchImpl);
    const seen = new Set<string>();
    const out: SourceResult['rows'] = [];
    for (const row of rows) {
      const permitNumber = str(row.permitnumber);
      if (!permitNumber || seen.has(permitNumber)) continue;
      seen.add(permitNumber);
      const payload: PermitPayload = {
        permitNumber,
        workType: str(row.worktype),
        permitType: str(row.permittypedescr),
        description: str(row.description),
        comments: str(row.comments),
        applicant: str(row.applicant),
        declaredValuation: parseMoney(str(row.declared_valuation)),
        totalFees: parseMoney(str(row.total_fees)),
        issuedDate: str(row.issued_date),
        expirationDate: str(row.expiration_date),
        status: str(row.status),
        occupancyType: str(row.occupancytype),
        address: str(row.address),
      };
      out.push({ kind: 'permit', sourceKey: permitNumber, payload, sourceUrl: PERMITS_PAGE_URL });
    }
    return { query: sql, rows: out };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsPermits.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/records/sources/boston/permits.ts src/lib/__tests__/helpers/records/permits-positive.json src/lib/__tests__/recordsPermits.test.ts
git commit -m "feat(records): Boston permits source"
```

---

### Task 7: Violations and code-enforcement sources

Both feeds share one row shape (`case_no`, `code`, `status`, `status_dttm`, `violation_stno`, `violation_street`, `violation_suffix`, `contact_addr1`, `sam_id`); enforcement adds `ticket_no`. One shared builder, two sources.

**Files:**
- Create: `src/lib/records/sources/boston/violationFeeds.ts`
- Create: `src/lib/records/sources/boston/violations.ts`
- Create: `src/lib/records/sources/boston/enforcement.ts`
- Create: `src/lib/__tests__/helpers/records/enforcement-lanark.json`
- Test: `src/lib/__tests__/recordsViolations.test.ts`

- [ ] **Step 1: Write the fixture (three real Lanark rows, verified live 2026-09-06)**

```json
[
  { "case_no": "CE7067", "ticket_no": "T1", "status_dttm": "2008-08-30 09:42:00", "status": "Closed", "code": "1", "value": "50", "description": "Improper storage trash: res", "violation_stno": "23", "violation_street": "Lanark", "violation_suffix": "RD", "violation_city": "Brighton", "violation_zip": "02135", "contact_addr1": "1505 COMMONWEALTH  AV", "sam_id": "83763" },
  { "case_no": "CE7067", "ticket_no": "T1", "status_dttm": "2008-08-30 09:42:00", "status": "Closed", "code": "9a", "value": "50", "description": "Illegal dumping < 1 cubic yd", "violation_stno": "23", "violation_street": "Lanark", "violation_suffix": "RD", "violation_city": "Brighton", "violation_zip": "02135", "contact_addr1": "1505 COMMONWEALTH  AV", "sam_id": "83763" },
  { "case_no": "CE5252", "ticket_no": "T2", "status_dttm": "2008-08-05 09:15:00", "status": "Closed", "code": "9b", "value": "100", "description": "Illegal dumping 1-5 cubic yd.:", "violation_stno": "23", "violation_street": "Lanark", "violation_suffix": "RD", "violation_city": "Brighton", "violation_zip": "02135", "contact_addr1": "1505 COMMONWEALTH  AV", "sam_id": "83763" }
]
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/__tests__/recordsViolations.test.ts
import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { violationsSource, VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import { enforcementSource, ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import type { EnforcementTicketPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import enforcementLanark from './helpers/records/enforcement-lanark.json';

const lanark = buildIdentity({ id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: '2102098000', sam_id: null });

describe('enforcementSource', () => {
  it('queries by bare street name and every number form', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementLanark }]);
    const result = await enforcementSource.run(lanark, fetchImpl);
    expect(result.query).toContain(`upper("violation_street") = 'LANARK'`);
    expect(result.query).toContain(`"violation_stno" IN ('23','27','23-27')`);
    expect(result.query).toContain('ORDER BY "status_dttm" DESC');
  });

  it('keys rows on case number plus code so one case with two codes keeps both', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementLanark }]);
    const result = await enforcementSource.run(lanark, fetchImpl);
    expect(result.rows.map((r) => r.sourceKey)).toEqual(['CE7067:1', 'CE7067:9a', 'CE5252:9b']);
    const payload = result.rows[0].payload as EnforcementTicketPayload;
    expect(payload).toMatchObject({
      caseNumber: 'CE7067', ticketNumber: 'T1', code: '1', description: 'Improper storage trash: res', status: 'Closed',
      statusDate: '2008-08-30 09:42:00', address: '23 Lanark RD', contactAddress: '1505 COMMONWEALTH  AV', samId: '83763',
    });
    expect(result.rows[0].kind).toBe('enforcement_ticket');
  });
});

describe('violationsSource', () => {
  it('uses the violations resource, the violation kind, and no ticket number', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [{ ...enforcementLanark[0], ticket_no: undefined }] }]);
    const result = await violationsSource.run(lanark, fetchImpl);
    expect(result.query).toContain(VIOLATIONS_RESOURCE_ID);
    expect(result.rows[0].kind).toBe('violation');
    expect('ticketNumber' in result.rows[0].payload).toBe(false);
  });

  it('returns empty for Lanark when the feed has nothing', async () => {
    const result = await violationsSource.run(lanark, fixtureFetch([]));
    expect(result.rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsViolations.test.ts`
Expected: FAIL with `Cannot find module`

- [ ] **Step 4: Write the shared builder and both sources**

```ts
// src/lib/records/sources/boston/violationFeeds.ts
import { ckanSql, sqlLiteral } from '../../ckan';
import type { BuildingIdentity, EnforcementTicketPayload, RecordKind, RecordSource, SourceResult, ViolationPayload } from '../../types';

type Row = Record<string, string | null | undefined>;

const SHARED_COLUMNS = ['case_no', 'status_dttm', 'status', 'code', 'value', 'description', 'violation_stno', 'violation_street', 'violation_suffix', 'contact_addr1', 'sam_id'];

function str(v: string | null | undefined): string | null {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

function violationAddress(row: Row): string | null {
  const parts = [str(row.violation_stno), str(row.violation_street), str(row.violation_suffix)].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

export function baseViolationPayload(row: Row): ViolationPayload {
  return {
    caseNumber: str(row.case_no) ?? 'unknown',
    code: str(row.code),
    value: str(row.value),
    description: str(row.description),
    status: str(row.status),
    statusDate: str(row.status_dttm),
    address: violationAddress(row),
    contactAddress: str(row.contact_addr1),
    samId: str(row.sam_id),
  };
}

export interface ViolationFeedConfig {
  resourceId: string;
  label: string;
  pageUrl: string;
  kind: RecordKind;
  withTicketNumber: boolean;
}

export function violationFeedSource(config: ViolationFeedConfig): RecordSource {
  const columns = config.withTicketNumber ? [...SHARED_COLUMNS, 'ticket_no'] : SHARED_COLUMNS;
  return {
    id: config.resourceId,
    label: config.label,
    pageUrl: config.pageUrl,
    kinds: [config.kind],
    async run(identity: BuildingIdentity, fetchImpl): Promise<SourceResult> {
      const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
      const sql =
        `SELECT ${columns.map((c) => `"${c}"`).join(',')} FROM "${config.resourceId}" ` +
        `WHERE upper("violation_street") = ${sqlLiteral(identity.streetBase)} ` +
        `AND "violation_stno" IN (${numberForms.map(sqlLiteral).join(',')}) ` +
        `ORDER BY "status_dttm" DESC LIMIT 500`;
      const rows = await ckanSql<Row>(sql, fetchImpl);
      const seen = new Set<string>();
      const out: SourceResult['rows'] = [];
      for (const row of rows) {
        const base = baseViolationPayload(row);
        const sourceKey = `${base.caseNumber}:${base.code ?? ''}`;
        if (seen.has(sourceKey)) continue;
        seen.add(sourceKey);
        const payload: ViolationPayload | EnforcementTicketPayload = config.withTicketNumber
          ? { ...base, ticketNumber: str(row.ticket_no) }
          : base;
        out.push({ kind: config.kind, sourceKey, payload, sourceUrl: config.pageUrl });
      }
      return { query: sql, rows: out };
    },
  };
}
```

```ts
// src/lib/records/sources/boston/violations.ts
import { violationFeedSource } from './violationFeeds';

export const VIOLATIONS_RESOURCE_ID = '800a2663-1d6a-46e7-9356-bedb70f5332c';
export const VIOLATIONS_PAGE_URL = 'https://data.boston.gov/dataset/building-and-property-violations1';

export const violationsSource = violationFeedSource({
  resourceId: VIOLATIONS_RESOURCE_ID,
  label: 'Building and Property Violations',
  pageUrl: VIOLATIONS_PAGE_URL,
  kind: 'violation',
  withTicketNumber: false,
});
```

```ts
// src/lib/records/sources/boston/enforcement.ts
import { violationFeedSource } from './violationFeeds';

export const ENFORCEMENT_RESOURCE_ID = '90ed3816-5e70-443c-803d-9a71f44470be';
export const ENFORCEMENT_PAGE_URL = 'https://data.boston.gov/dataset/public-works-violations';

export const enforcementSource = violationFeedSource({
  resourceId: ENFORCEMENT_RESOURCE_ID,
  label: 'Public Works Code Enforcement',
  pageUrl: ENFORCEMENT_PAGE_URL,
  kind: 'enforcement_ticket',
  withTicketNumber: true,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsViolations.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/records/sources/boston/violationFeeds.ts src/lib/records/sources/boston/violations.ts src/lib/records/sources/boston/enforcement.ts src/lib/__tests__/helpers/records/enforcement-lanark.json src/lib/__tests__/recordsViolations.test.ts
git commit -m "feat(records): Boston violations and code-enforcement sources"
```

---

### Task 8: 311 service-requests source

**Files:**
- Create: `src/lib/records/sources/boston/serviceRequests.ts`
- Create: `src/lib/__tests__/helpers/records/311-2024-lanark.json`
- Create: `src/lib/__tests__/helpers/records/311-new-lanark.json`
- Test: `src/lib/__tests__/recordsServiceRequests.test.ts`

- [ ] **Step 1: Write the fixtures**

`311-2024-lanark.json`: five real rows plus one synthetic Housing row to exercise classification.

```json
[
  { "case_enquiry_id": "101005238959", "open_dt": "2024-01-06 12:20:00", "closed_dt": null, "case_status": "Open", "closure_reason": null, "case_title": "Schedule a Bulk Item Pickup", "subject": "Public Works Department", "reason": "Sanitation", "type": "Schedule a Bulk Item Pickup", "location": "23 Lanark Rd  Brighton  MA  02135", "source": "Constituent Call" },
  { "case_enquiry_id": "101005577502", "open_dt": "2024-07-21 07:49:30.757", "closed_dt": null, "case_status": "Open", "closure_reason": null, "case_title": "Schedule Bulk Item Pickup", "subject": "Public Works Department", "reason": "Sanitation", "type": "Schedule a Bulk Item Pickup SS", "location": "23 Lanark Rd  Brighton  MA  02135", "source": "Self Service" },
  { "case_enquiry_id": "101005650794", "open_dt": "2024-08-31 22:31:23.187", "closed_dt": "2024-09-03 10:12:23.37", "case_status": "Closed", "closure_reason": "Case Closed", "case_title": "Abandoned Vehicles", "subject": "Transportation - Traffic Division", "reason": "Enforcement & Abandoned Vehicles", "type": "Abandoned Vehicles", "location": "23-27 Lanark Rd  Brighton  MA  02135", "source": "Employee Generated" },
  { "case_enquiry_id": "101005740377", "open_dt": "2024-10-21 10:29:53.583", "closed_dt": null, "case_status": "Open", "closure_reason": null, "case_title": "Schedule Bulk Item Pickup", "subject": "Public Works Department", "reason": "Sanitation", "type": "Schedule a Bulk Item Pickup SS", "location": "23 Lanark Rd  Brighton  MA  02135", "source": "Self Service" },
  { "case_enquiry_id": "101005778262", "open_dt": "2024-11-13 05:58:00.103", "closed_dt": null, "case_status": "Open", "closure_reason": null, "case_title": "Parking Enforcement", "subject": "Transportation - Traffic Division", "reason": "Enforcement & Abandoned Vehicles", "type": "Parking Enforcement", "location": "23-27 Lanark Rd  Brighton  MA  02135", "source": "Employee Generated" },
  { "case_enquiry_id": "101009999999", "open_dt": "2024-12-01 08:00:00", "closed_dt": "2024-12-20 08:00:00", "case_status": "Closed", "closure_reason": "Case Resolved", "case_title": "Heat - Excessive  Insufficient", "subject": "Inspectional Services", "reason": "Housing", "type": "Heat - Excessive  Insufficient", "location": "27 Lanark Rd  Brighton  MA  02135", "source": "Constituent Call" }
]
```

`311-new-lanark.json`: one synthetic new-system row routed to Inspectional Services.

```json
[
  { "case_id": "BCS-00300001", "open_date": "2026-08-01 10:00:00+00", "close_date": null, "case_status": "Open", "closure_reason": null, "case_topic": "Unsatisfactory Living Conditions", "service_name": "Unsatisfactory Living Conditions", "assigned_department": "Inspectional Services Department (ISD)", "full_address": "27 Lanark Rd, Boston, MA 02135", "street_number": "27", "street_name": "Lanark Rd", "report_source": "BOS311" }
]
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/__tests__/recordsServiceRequests.test.ts
import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { serviceRequestsSource, LEGACY_311_RESOURCES, NEW_311_RESOURCE_ID, HOUSING_REASONS, classifyLegacy, classifyNew } from '../records/sources/boston/serviceRequests';
import type { ServiceRequestPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import legacy2024 from './helpers/records/311-2024-lanark.json';
import newSystem from './helpers/records/311-new-lanark.json';

const lanark = buildIdentity({ id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: '2102098000', sam_id: null });
const R2024 = 'dff4d804-5031-443a-8409-8344efd0e5c8';

describe('serviceRequestsSource', () => {
  it('covers sixteen legacy years and the new system', () => {
    expect(LEGACY_311_RESOURCES.map((r) => r.year)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011]);
    expect(serviceRequestsSource.id).toBe(NEW_311_RESOURCE_ID);
    expect(serviceRequestsSource.kinds).toEqual(['service_request']);
  });

  it('runs one query per resource and stores them all as a JSON array', async () => {
    const fetchImpl = fixtureFetch([]);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    expect(fetchImpl.calls).toHaveLength(17);
    const queries = JSON.parse(result.query) as string[];
    expect(queries).toHaveLength(17);
    expect(queries.some((q) => q.includes(R2024) && q.includes(`upper("location") LIKE '23-27 LANARK RD%'`) && q.includes(`'27 LANARK ROAD%'`))).toBe(true);
    expect(queries.some((q) => q.includes(NEW_311_RESOURCE_ID) && q.includes(`upper("street_name") IN ('LANARK RD','LANARK ROAD')`) && q.includes(`"street_number" IN ('23','27','23-27')`))).toBe(true);
  });

  it('maps legacy and new rows, classifies housing, and deduplicates on case id', async () => {
    const fetchImpl = fixtureFetch([
      { resourceId: R2024, records: legacy2024 },
      { resourceId: LEGACY_311_RESOURCES.find((r) => r.year === 2023)!.resourceId, records: [legacy2024[0]] }, // same case id again
      { resourceId: NEW_311_RESOURCE_ID, records: newSystem },
    ]);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    expect(result.rows).toHaveLength(7);
    const byKey = Object.fromEntries(result.rows.map((r) => [r.sourceKey, r.payload as ServiceRequestPayload]));
    expect(byKey['101005238959']).toMatchObject({ system: 'legacy', classification: 'other', reason: 'Sanitation', openedAt: '2024-01-06 12:20:00', status: 'Open' });
    expect(byKey['101009999999']).toMatchObject({ classification: 'housing', reason: 'Housing', closedAt: '2024-12-20 08:00:00' });
    expect(byKey['BCS-00300001']).toMatchObject({ system: 'new', classification: 'housing', title: 'Unsatisfactory Living Conditions', location: '27 Lanark Rd, Boston, MA 02135' });
  });

  it('fails the whole source if any year fails, so stale rows are kept rather than half-replaced', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: R2024, errorStatus: 503, errorMessage: 'gateway' }]);
    await expect(serviceRequestsSource.run(lanark, fetchImpl)).rejects.toThrow(/503/);
  });
});

describe('classification lists', () => {
  it('publishes the housing reasons and classifies by them', () => {
    expect(HOUSING_REASONS).toEqual(['Housing', 'Building', 'Code Enforcement']);
    expect(classifyLegacy('Housing')).toBe('housing');
    expect(classifyLegacy('Street Cleaning')).toBe('other');
    expect(classifyLegacy(null)).toBe('other');
    expect(classifyNew('Inspectional Services Department (ISD)')).toBe('housing');
    expect(classifyNew('Public Works Department (PWD)')).toBe('other');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsServiceRequests.test.ts`
Expected: FAIL with `Cannot find module`

- [ ] **Step 4: Write the source**

```ts
// src/lib/records/sources/boston/serviceRequests.ts
import { ckanSql, sqlLiteral } from '../../ckan';
import type { BuildingIdentity, RecordSource, ServiceRequestClassification, ServiceRequestPayload, SourceResult } from '../../types';
import { addressLikeClauses } from './permits';

export const NEW_311_RESOURCE_ID = '254adca6-64ab-4c5c-9fc0-a6da622be185';
export const SERVICE_REQUESTS_PAGE_URL = 'https://data.boston.gov/dataset/311-service-requests';

/** Legacy yearly resources, newest first. Verified from package_show on 2026-09-06. */
export const LEGACY_311_RESOURCES: Array<{ year: number; resourceId: string }> = [
  { year: 2026, resourceId: '1a0b420d-99f1-4887-9851-990b2a5a6e17' },
  { year: 2025, resourceId: '9d7c2214-4709-478a-a2e8-fb2020a5bb94' },
  { year: 2024, resourceId: 'dff4d804-5031-443a-8409-8344efd0e5c8' },
  { year: 2023, resourceId: 'e6013a93-1321-4f2a-bf91-8d8a02f1e62f' },
  { year: 2022, resourceId: '81a7b022-f8fc-4da5-80e4-b160058ca207' },
  { year: 2021, resourceId: 'f53ebccd-bc61-49f9-83db-625f209c95f5' },
  { year: 2020, resourceId: '6ff6a6fd-3141-4440-a880-6f60a37fe789' },
  { year: 2019, resourceId: 'ea2e4696-4a2d-429c-9807-d02eb92e0222' },
  { year: 2018, resourceId: '2be28d90-3a90-4af1-a3f6-f28c1e25880a' },
  { year: 2017, resourceId: '30022137-709d-465e-baae-ca155b51927d' },
  { year: 2016, resourceId: 'b7ea6b1b-3ca4-4c5b-9713-6dc1db52379a' },
  { year: 2015, resourceId: 'c9509ab4-6f6d-4b97-979a-0cf2a10c922b' },
  { year: 2014, resourceId: 'bdae89c8-d4ce-40e9-a6e1-a5203953a2e0' },
  { year: 2013, resourceId: '407c5cd0-f764-4a41-adf8-054ff535049e' },
  { year: 2012, resourceId: '382e10d9-1864-40ba-bef6-4eea3c75463c' },
  { year: 2011, resourceId: '94b499d9-712a-4d2a-b790-7ceec5c9c4b1' },
];

/**
 * Published classification list. A legacy case whose `reason` is in this list is
 * "housing-related"; everything else (parking, trash pickup, streetlights) is "other".
 * This is a fact about the list, not a judgment. Linked from the public panel.
 */
export const HOUSING_REASONS: readonly string[] = ['Housing', 'Building', 'Code Enforcement'];

/** New-system cases are housing-related when routed to Inspectional Services. */
export const HOUSING_DEPARTMENT_PREFIX = 'Inspectional Services';

export function classifyLegacy(reason: string | null): ServiceRequestClassification {
  return reason && HOUSING_REASONS.includes(reason) ? 'housing' : 'other';
}

export function classifyNew(department: string | null): ServiceRequestClassification {
  return department && department.startsWith(HOUSING_DEPARTMENT_PREFIX) ? 'housing' : 'other';
}

type Row = Record<string, string | null | undefined>;

function str(v: string | null | undefined): string | null {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

const LEGACY_COLUMNS = ['case_enquiry_id', 'open_dt', 'closed_dt', 'case_status', 'closure_reason', 'case_title', 'subject', 'reason', 'type', 'location', 'source'];
const NEW_COLUMNS = ['case_id', 'open_date', 'close_date', 'case_status', 'closure_reason', 'case_topic', 'service_name', 'assigned_department', 'full_address', 'report_source'];

function legacySql(resourceId: string, identity: BuildingIdentity): string {
  return `SELECT ${LEGACY_COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${resourceId}" WHERE ${addressLikeClauses('location', identity).join(' OR ')} LIMIT 500`;
}

function newSql(identity: BuildingIdentity): string {
  const numberForms = identity.rangeForm ? [...identity.numbers, identity.rangeForm] : identity.numbers;
  const streets = Array.from(new Set([identity.streetShort, identity.streetLong])).map(sqlLiteral).join(',');
  return `SELECT ${NEW_COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${NEW_311_RESOURCE_ID}" WHERE upper("street_name") IN (${streets}) AND "street_number" IN (${numberForms.map(sqlLiteral).join(',')}) LIMIT 500`;
}

function mapLegacy(row: Row): ServiceRequestPayload | null {
  const caseId = str(row.case_enquiry_id);
  if (!caseId) return null;
  const reason = str(row.reason);
  return {
    caseId, system: 'legacy',
    openedAt: str(row.open_dt), closedAt: str(row.closed_dt), status: str(row.case_status), closureReason: str(row.closure_reason),
    title: str(row.case_title), subject: str(row.subject), reason, type: str(row.type), location: str(row.location), source: str(row.source),
    classification: classifyLegacy(reason),
  };
}

function mapNew(row: Row): ServiceRequestPayload | null {
  const caseId = str(row.case_id);
  if (!caseId) return null;
  const department = str(row.assigned_department);
  return {
    caseId, system: 'new',
    openedAt: str(row.open_date), closedAt: str(row.close_date), status: str(row.case_status), closureReason: str(row.closure_reason),
    title: str(row.case_topic), subject: department, reason: department, type: str(row.service_name), location: str(row.full_address), source: str(row.report_source),
    classification: classifyNew(department),
  };
}

export const serviceRequestsSource: RecordSource = {
  id: NEW_311_RESOURCE_ID,
  label: '311 Service Requests',
  pageUrl: SERVICE_REQUESTS_PAGE_URL,
  kinds: ['service_request'],
  async run(identity, fetchImpl): Promise<SourceResult> {
    const queries: string[] = [];
    const seen = new Set<string>();
    const out: SourceResult['rows'] = [];
    const push = (payload: ServiceRequestPayload | null) => {
      if (!payload || seen.has(payload.caseId)) return;
      seen.add(payload.caseId);
      out.push({ kind: 'service_request', sourceKey: payload.caseId, payload, sourceUrl: SERVICE_REQUESTS_PAGE_URL });
    };
    for (const { resourceId } of LEGACY_311_RESOURCES) {
      const sql = legacySql(resourceId, identity);
      queries.push(sql);
      for (const row of await ckanSql<Row>(sql, fetchImpl)) push(mapLegacy(row));
    }
    const sql = newSql(identity);
    queries.push(sql);
    for (const row of await ckanSql<Row>(sql, fetchImpl)) push(mapNew(row));
    return { query: JSON.stringify(queries), rows: out };
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsServiceRequests.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/records/sources/boston/serviceRequests.ts src/lib/__tests__/helpers/records/311-2024-lanark.json src/lib/__tests__/helpers/records/311-new-lanark.json src/lib/__tests__/recordsServiceRequests.test.ts
git commit -m "feat(records): Boston 311 source with published housing classification"
```

---

### Task 9: RentSmart source and the jurisdiction map

**Files:**
- Create: `src/lib/records/sources/boston/rentsmart.ts`
- Create: `src/lib/records/jurisdictions.ts`
- Create: `src/lib/__tests__/helpers/records/rentsmart-lanark.json`
- Test: `src/lib/__tests__/recordsJurisdictions.test.ts`

- [ ] **Step 1: Write the fixture (four real rows)**

```json
[
  { "_id": 90001, "date": "2026-07-17 13:56:00+00", "violation_type": "Housing Complaints", "description": "Unsatisfactory Living Conditions", "address": "23-27 Lanark Rd, 02135", "parcel": "2102098000" },
  { "_id": 90002, "date": "2026-07-14 18:52:00+00", "violation_type": "Housing Complaints", "description": "Maintenance Complaint - Residential", "address": "23-27 Lanark Rd, 02135", "parcel": "2102098000" },
  { "_id": 90003, "date": "2025-12-27 16:50:00+00", "violation_type": "Housing Complaints", "description": "Heat - Excessive, Insufficient", "address": "23-27 Lanark Rd, 02135", "parcel": "2102098000" },
  { "_id": 90004, "date": "2024-09-01 02:31:23.187+00", "violation_type": "Sanitation Requests", "description": "Abandoned Vehicles", "address": "23-27 Lanark Rd, 02135", "parcel": "2102098000" }
]
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/__tests__/recordsJurisdictions.test.ts
import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { rentsmartSource, RENTSMART_RESOURCE_ID } from '../records/sources/boston/rentsmart';
import { sourcesForCity, jurisdictionForCity } from '../records/jurisdictions';
import type { RentSmartPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import rentsmartLanark from './helpers/records/rentsmart-lanark.json';

const lanark = buildIdentity({ id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: '2102098000', sam_id: null });

describe('rentsmartSource', () => {
  it('queries by parcel forms and maps rows keyed on the CKAN row id', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: RENTSMART_RESOURCE_ID, records: rentsmartLanark }]);
    const result = await rentsmartSource.run(lanark, fetchImpl);
    expect(result.query).toContain(`"parcel" IN ('2102098000')`);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0].sourceKey).toBe('90001');
    expect(result.rows[0].payload as RentSmartPayload).toMatchObject({ violationType: 'Housing Complaints', description: 'Unsatisfactory Living Conditions', parcel: '2102098000' });
  });

  it('returns empty without a query when the building has no parcel', async () => {
    const fetchImpl = fixtureFetch([]);
    const result = await rentsmartSource.run({ ...lanark, parcelId: null, parcelNumeric: null }, fetchImpl);
    expect(result.rows).toEqual([]);
    expect(fetchImpl.calls).toEqual([]);
  });
});

describe('jurisdictions', () => {
  it('Boston has eleven sources: six assessor years, permits, violations, enforcement, 311, RentSmart', () => {
    const sources = sourcesForCity('Boston, MA');
    expect(sources).toHaveLength(11);
    expect(sources.filter((s) => s.kinds.includes('assessment'))).toHaveLength(6);
    expect(sources.map((s) => s.label)).toContain('RentSmart');
    expect(jurisdictionForCity('boston')).toBe('boston');
  });

  it('every other city, including New Haven, has none', () => {
    expect(sourcesForCity('New Haven, CT')).toEqual([]);
    expect(sourcesForCity(null)).toEqual([]);
    expect(jurisdictionForCity('Cambridge')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsJurisdictions.test.ts`
Expected: FAIL with `Cannot find module`

- [ ] **Step 4: Write RentSmart and the jurisdiction map**

```ts
// src/lib/records/sources/boston/rentsmart.ts
import { ckanSql, sqlLiteral } from '../../ckan';
import type { RecordSource, RentSmartPayload, SourceResult } from '../../types';

export const RENTSMART_RESOURCE_ID = 'dc615ff7-2ff3-416a-922b-f0f334f085d0';
export const RENTSMART_PAGE_URL = 'https://data.boston.gov/dataset/rentsmart';

type Row = Record<string, string | number | null | undefined>;

function str(v: string | number | null | undefined): string | null {
  return v == null || String(v).trim() === '' ? null : String(v).trim();
}

export const rentsmartSource: RecordSource = {
  id: RENTSMART_RESOURCE_ID,
  label: 'RentSmart',
  pageUrl: RENTSMART_PAGE_URL,
  kinds: ['rentsmart'],
  async run(identity, fetchImpl): Promise<SourceResult> {
    const forms = Array.from(new Set([identity.parcelId, identity.parcelNumeric].filter((p): p is string => Boolean(p))));
    if (forms.length === 0) return { query: 'no parcel: RentSmart skipped', rows: [] };
    const sql = `SELECT "_id","date","violation_type","description","address","parcel" FROM "${RENTSMART_RESOURCE_ID}" WHERE "parcel" IN (${forms.map(sqlLiteral).join(',')}) ORDER BY "date" DESC LIMIT 500`;
    const rows = await ckanSql<Row>(sql, fetchImpl);
    return {
      query: sql,
      rows: rows.flatMap((row) => {
        const rowId = str(row._id);
        if (!rowId) return [];
        const payload: RentSmartPayload = {
          rowId, date: str(row.date), violationType: str(row.violation_type), description: str(row.description), address: str(row.address), parcel: str(row.parcel),
        };
        return [{ kind: 'rentsmart' as const, sourceKey: rowId, payload, sourceUrl: RENTSMART_PAGE_URL }];
      }),
    };
  },
};
```

```ts
// src/lib/records/jurisdictions.ts
import type { RecordSource } from './types';
import { ASSESSOR_YEARS, assessorSource } from './sources/boston/assessor';
import { permitsSource } from './sources/boston/permits';
import { violationsSource } from './sources/boston/violations';
import { enforcementSource } from './sources/boston/enforcement';
import { serviceRequestsSource } from './sources/boston/serviceRequests';
import { rentsmartSource } from './sources/boston/rentsmart';

export type Jurisdiction = 'boston';

const BOSTON_SOURCES: RecordSource[] = [
  ...ASSESSOR_YEARS.map(assessorSource),
  permitsSource,
  violationsSource,
  enforcementSource,
  serviceRequestsSource,
  rentsmartSource,
];

/** Same normalization as enrichment/dispatcher: strip a trailing state, lowercase. */
export function jurisdictionForCity(city: string | null): Jurisdiction | null {
  if (!city) return null;
  const key = city.replace(/,\s*[A-Z]{2}$/, '').trim().toLowerCase();
  return key === 'boston' ? 'boston' : null;
}

export function sourcesForCity(city: string | null): RecordSource[] {
  return jurisdictionForCity(city) === 'boston' ? BOSTON_SOURCES : [];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsJurisdictions.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/records/sources/boston/rentsmart.ts src/lib/records/jurisdictions.ts src/lib/__tests__/helpers/records/rentsmart-lanark.json src/lib/__tests__/recordsJurisdictions.test.ts
git commit -m "feat(records): RentSmart source and jurisdiction map"
```

---

### Task 10: The pull function (Worker-callable)

**Files:**
- Create: `src/lib/records/pull.ts`
- Test: `src/lib/__tests__/recordsPull.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/recordsPull.test.ts
import { describe, it, expect } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { pullBuildingRecords } from '../records/pull';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { RENTSMART_RESOURCE_ID } from '../records/sources/boston/rentsmart';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import condo2026 from './helpers/records/assessor-fy2026-condo.json';
import enforcementLanark from './helpers/records/enforcement-lanark.json';
import rentsmartLanark from './helpers/records/rentsmart-lanark.json';
import permitsPositive from './helpers/records/permits-positive.json';

const suite = sqliteAvailable ? describe : describe.skip;

async function loadBuilding(db: ReturnType<typeof createRecordsTestDb>, id: string) {
  return db.prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?').bind(id).first<{ id: string; address: string; city: string | null; state: string | null; zip_code: string | null; parcel_id: string | null; sam_id: string | null }>();
}

suite('pullBuildingRecords', () => {
  it('resolves the parcel, writes it to buildings, and stores rows with one pull per source', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db);
    const fetchImpl = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
      { resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementLanark },
      { resourceId: RENTSMART_RESOURCE_ID, records: rentsmartLanark },
    ]);
    const building = (await loadBuilding(db, id))!;
    const summary = await pullBuildingRecords(db, building, { fetchImpl, triggeredBy: 'admin-1' });

    expect(summary.parcelId).toBe('2102098000');
    expect(summary.condominium).toBe(false);
    expect(summary.sources).toHaveLength(11);
    const byLabel = Object.fromEntries(summary.sources.map((s) => [s.label, s]));
    expect(byLabel['Property Assessment FY2026']).toMatchObject({ status: 'ok', rowCount: 1 });
    expect(byLabel['Property Assessment FY2025']).toMatchObject({ status: 'empty', rowCount: 0 });
    expect(byLabel['Public Works Code Enforcement']).toMatchObject({ status: 'ok', rowCount: 3 });
    expect(byLabel['Building and Property Violations']).toMatchObject({ status: 'empty' });
    expect(byLabel['RentSmart']).toMatchObject({ status: 'ok', rowCount: 4 });

    const updated = await loadBuilding(db, id);
    expect(updated?.parcel_id).toBe('2102098000');
    expect(updated?.sam_id).toBe('83763');

    const pulls = await db.prepare('SELECT source_label, status, row_count, triggered_by, query FROM record_pulls WHERE building_id = ? ORDER BY rowid').bind(id).all<{ source_label: string; status: string; row_count: number; triggered_by: string; query: string }>();
    expect(pulls.results).toHaveLength(11);
    expect(pulls.results.every((p) => p.triggered_by === 'admin-1')).toBe(true);
    expect(pulls.results.find((p) => p.source_label === 'Public Works Code Enforcement')?.query).toContain('LANARK');

    const records = await db.prepare('SELECT kind, COUNT(*) AS n FROM building_records WHERE building_id = ? GROUP BY kind ORDER BY kind').bind(id).all<{ kind: string; n: number }>();
    expect(records.results).toEqual([
      { kind: 'assessment', n: 1 },
      { kind: 'enforcement_ticket', n: 3 },
      { kind: 'rentsmart', n: 4 },
    ]);
  });

  it('re-pull replaces a source\'s rows without duplicating, and one fiscal year never removes another', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102098000' });
    const building = (await loadBuilding(db, id))!;
    const fy2025 = '6b7e460e-33f6-4e61-80bc-1bef2e73ac54';

    const first = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
      { resourceId: fy2025, records: lanark2026 },
      { resourceId: PERMITS_RESOURCE_ID, records: permitsPositive },
    ]);
    await pullBuildingRecords(db, building, { fetchImpl: first, triggeredBy: 'admin-1' });

    const second = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
      // FY2025 now returns nothing; permits returns only one row
      { resourceId: PERMITS_RESOURCE_ID, records: [permitsPositive[0]] },
    ]);
    await pullBuildingRecords(db, building, { fetchImpl: second, triggeredBy: 'admin-1' });

    const rows = await db.prepare('SELECT kind, source_key FROM building_records WHERE building_id = ? ORDER BY kind, source_key').bind(id).all<{ kind: string; source_key: string }>();
    // The empty FY2025 pull clears only FY2025; FY2026 survives; permits shrank to one.
    expect(rows.results).toEqual([
      { kind: 'assessment', source_key: 'FY2026' },
      { kind: 'permit', source_key: 'A1000569' },
    ]);

    const pullCount = await db.prepare('SELECT COUNT(*) AS n FROM record_pulls WHERE building_id = ?').bind(id).first<{ n: number }>();
    expect(pullCount?.n).toBe(22);
  });

  it('a failing source records error, keeps its prior rows, and does not stop the others', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102098000' });
    const building = (await loadBuilding(db, id))!;

    await pullBuildingRecords(db, building, {
      fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }, { resourceId: PERMITS_RESOURCE_ID, records: permitsPositive }]),
      triggeredBy: 'admin-1',
    });
    const summary = await pullBuildingRecords(db, building, {
      fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }, { resourceId: PERMITS_RESOURCE_ID, errorStatus: 503, errorMessage: 'gateway' }]),
      triggeredBy: 'admin-1',
    });

    const permits = summary.sources.find((s) => s.label === 'Approved Building Permits');
    expect(permits?.status).toBe('error');
    expect(permits?.error).toMatch(/503/);
    expect(summary.sources.find((s) => s.label === 'RentSmart')?.status).toBe('empty');

    const kept = await db.prepare("SELECT COUNT(*) AS n FROM building_records WHERE building_id = ? AND kind = 'permit'").bind(id).first<{ n: number }>();
    expect(kept?.n).toBe(2);
    const errorPull = await db.prepare("SELECT error_message, row_count FROM record_pulls WHERE building_id = ? AND status = 'error'").bind(id).first<{ error_message: string; row_count: number }>();
    expect(errorPull).toMatchObject({ row_count: 0 });
    expect(errorPull?.error_message).toMatch(/503/);
  });

  it('records a condominium: no parcel written, one owner-less assessment row, history skipped', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { address: '55 Lanark Rd, Boston, MA 02135' });
    const building = (await loadBuilding(db, id))!;
    const summary = await pullBuildingRecords(db, building, { fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: condo2026 }]), triggeredBy: 'admin-1' });
    expect(summary).toMatchObject({ parcelId: null, condominium: true });
    expect((await loadBuilding(db, id))?.parcel_id).toBeNull();
    const assessments = await db.prepare("SELECT payload FROM building_records WHERE building_id = ? AND kind = 'assessment'").bind(id).all<{ payload: string }>();
    expect(assessments.results).toHaveLength(1);
    expect(JSON.parse(assessments.results[0].payload)).toMatchObject({ condominium: true, owner: null });
  });

  it('marks every source as error when the parcel is ambiguous and writes nothing', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db);
    const building = (await loadBuilding(db, id))!;
    const two = [{ ...lanark2026[0], PID: '1000000001' }, { ...lanark2026[0], PID: '1000000002' }];
    const summary = await pullBuildingRecords(db, building, { fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: two }]), triggeredBy: 'admin-1' });
    expect(summary.sources).toHaveLength(11);
    expect(summary.sources.every((s) => s.status === 'error')).toBe(true);
    expect(summary.sources[0].error).toMatch(/2 parcels match/);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM building_records WHERE building_id = ?').bind(id).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it('returns no sources for a city outside Boston', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { address: '12 Chapel St, New Haven, CT', city: 'New Haven' });
    const building = (await loadBuilding(db, id))!;
    const fetchImpl = fixtureFetch([]);
    const summary = await pullBuildingRecords(db, building, { fetchImpl, triggeredBy: 'admin-1' });
    expect(summary).toMatchObject({ jurisdiction: 'none', sources: [] });
    expect(fetchImpl.calls).toEqual([]);
  });

  it('stamps the correction id on every pull row when given', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { parcel_id: '2102098000' });
    const building = (await loadBuilding(db, id))!;
    await pullBuildingRecords(db, building, { fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]), triggeredBy: 'admin-1', correctionId: 'corr-1' });
    const n = await db.prepare("SELECT COUNT(*) AS n FROM record_pulls WHERE building_id = ? AND correction_id = 'corr-1'").bind(id).first<{ n: number }>();
    expect(n?.n).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsPull.test.ts`
Expected: FAIL with `Cannot find module '../records/pull'`

- [ ] **Step 3: Write the pull function**

```ts
// src/lib/records/pull.ts
import { buildIdentity, type BuildingRowForIdentity } from './identity';
import { jurisdictionForCity, sourcesForCity } from './jurisdictions';
import { resolveParcel } from './sources/boston/assessor';
import { SourceError, type FetchLike, type PullSourceSummary, type PullSummary, type RecordSource, type RecordsDb, type RecordsPreparedStatement, type SourceResult } from './types';

export interface PullOptions {
  /** The admin user id, or null when a scheduled Worker runs the pull (sub-project C). */
  triggeredBy: string | null;
  correctionId?: string | null;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: FetchLike;
}

interface RecordRowForSam { samId?: string | null }

function replaceStatements(db: RecordsDb, buildingId: string, source: RecordSource, pullId: string, result: SourceResult): RecordsPreparedStatement[] {
  const statements: RecordsPreparedStatement[] = [];
  for (const kind of source.kinds) {
    statements.push(
      source.ownsSourceKey
        ? db.prepare('DELETE FROM building_records WHERE building_id = ? AND kind = ? AND source_key = ?').bind(buildingId, kind, source.ownsSourceKey)
        : db.prepare('DELETE FROM building_records WHERE building_id = ? AND kind = ?').bind(buildingId, kind),
    );
  }
  for (const row of result.rows) {
    statements.push(
      db.prepare('INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload, source_url) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), buildingId, pullId, row.kind, row.sourceKey, JSON.stringify(row.payload), row.sourceUrl ?? null),
    );
  }
  return statements;
}

function pullRowStatement(db: RecordsDb, pullId: string, buildingId: string, jurisdiction: string, source: RecordSource, query: string, status: 'ok' | 'empty' | 'error', rowCount: number, errorMessage: string | null, options: PullOptions): RecordsPreparedStatement {
  return db
    .prepare('INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(pullId, buildingId, jurisdiction, source.id, source.label, query, status, rowCount, errorMessage, options.triggeredBy, options.correctionId ?? null);
}

/**
 * Pull every source for one building and store rows with provenance.
 * Knows nothing about HTTP. Safe to call from an API route now and a Worker later.
 */
export async function pullBuildingRecords(db: RecordsDb, building: BuildingRowForIdentity, options: PullOptions): Promise<PullSummary> {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const jurisdiction = jurisdictionForCity(building.city);
  const sources = sourcesForCity(building.city);
  if (!jurisdiction) {
    return { buildingId: building.id, jurisdiction: 'none', parcelId: null, condominium: false, sources: [] };
  }

  const identity = buildIdentity(building);
  let resolutionError: string | null = null;

  if (!identity.parcelId) {
    try {
      const resolved = await resolveParcel(identity, fetchImpl);
      if (resolved.parcelId) {
        identity.parcelId = resolved.parcelId;
        identity.parcelNumeric = String(Number.parseInt(resolved.parcelId, 10));
        await db.prepare('UPDATE buildings SET parcel_id = ?, updated_at = unixepoch() WHERE id = ?').bind(resolved.parcelId, building.id).run();
      } else if (resolved.condominium) {
        identity.condominium = true;
      } else if (resolved.candidates > 1) {
        resolutionError = `${resolved.candidates} parcels match this address; set the parcel id by hand and pull again`;
      } else {
        resolutionError = 'No assessor parcel matches this address';
      }
    } catch (err) {
      resolutionError = `Parcel resolution failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const summaries: PullSourceSummary[] = [];
  let samId: string | null = building.sam_id;

  for (const source of sources) {
    const pullId = crypto.randomUUID();
    if (resolutionError) {
      await pullRowStatement(db, pullId, building.id, jurisdiction, source, 'no query', 'error', 0, resolutionError, options).run();
      summaries.push({ sourceId: source.id, label: source.label, status: 'error', rowCount: 0, error: resolutionError });
      continue;
    }
    let result: SourceResult;
    try {
      result = await source.run(identity, fetchImpl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const query = err instanceof SourceError ? err.query : 'no query';
      await pullRowStatement(db, pullId, building.id, jurisdiction, source, query, 'error', 0, message.slice(0, 500), options).run();
      summaries.push({ sourceId: source.id, label: source.label, status: 'error', rowCount: 0, error: message.slice(0, 500) });
      continue;
    }
    const status = result.rows.length > 0 ? 'ok' : 'empty';
    await db.batch([
      pullRowStatement(db, pullId, building.id, jurisdiction, source, result.query, status, result.rows.length, null, options),
      ...replaceStatements(db, building.id, source, pullId, result),
    ]);
    summaries.push({ sourceId: source.id, label: source.label, status, rowCount: result.rows.length });

    if (!samId) {
      const withSam = result.rows.map((r) => r.payload as RecordRowForSam).find((p) => p.samId);
      if (withSam?.samId) {
        samId = withSam.samId;
        await db.prepare('UPDATE buildings SET sam_id = ? WHERE id = ? AND sam_id IS NULL').bind(samId, building.id).run();
      }
    }
  }

  return { buildingId: building.id, jurisdiction, parcelId: identity.parcelId, condominium: identity.condominium, sources: summaries };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsPull.test.ts`
Expected: PASS (7 tests). Note in the second test the FY2025 row is removed by its own empty pull (an empty pull still replaces the rows it owns), so the surviving rows are FY2026 and permit A1000569, and the pull count is 22 (11 per run).

- [ ] **Step 5: Commit**

```bash
git add src/lib/records/pull.ts src/lib/__tests__/recordsPull.test.ts
git commit -m "feat(records): Worker-callable pullBuildingRecords with per-source provenance"
```

---

### Task 11: Read side (`query.ts`) and display helpers (`display.ts`)

**Files:**
- Create: `src/lib/records/query.ts`
- Create: `src/lib/records/display.ts`
- Test: `src/lib/__tests__/recordsQuery.test.ts`
- Test: `src/lib/__tests__/recordsDisplay.test.ts`

- [ ] **Step 1: Write the failing query test**

```ts
// src/lib/__tests__/recordsQuery.test.ts
import { describe, it, expect } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { pullBuildingRecords } from '../records/pull';
import { getBuildingRecords, validatePayload } from '../records/query';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import enforcementLanark from './helpers/records/enforcement-lanark.json';

const suite = sqliteAvailable ? describe : describe.skip;

suite('getBuildingRecords', () => {
  it('returns null for a building that has never been pulled', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db);
    expect(await getBuildingRecords(db, id)).toBeNull();
  });

  it('groups validated rows by kind and attaches the latest status per source', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db);
    const building = { id, address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null };
    await pullBuildingRecords(db, building, {
      triggeredBy: 'admin-1',
      fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }, { resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementLanark }]),
    });
    const view = (await getBuildingRecords(db, id))!;
    expect(view.assessments).toHaveLength(1);
    expect(view.assessments[0].fiscalYear).toBe('FY2026');
    expect(view.enforcement).toHaveLength(3);
    expect(view.permits).toEqual([]);
    expect(view.serviceRequests).toEqual([]);
    expect(view.pulledAt).toBeGreaterThan(0);
    expect(view.sources[FY2026_RESOURCE_ID]).toMatchObject({ label: 'Property Assessment FY2026', status: 'ok' });
    expect(view.sources[ENFORCEMENT_RESOURCE_ID]).toMatchObject({ status: 'ok', pageUrl: 'https://data.boston.gov/dataset/public-works-violations' });
    expect(view.invalidKinds).toEqual([]);
    expect(view.corrections).toEqual([]);
  });

  it('reports a malformed payload as an invalid kind instead of throwing', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db);
    await db.prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count) VALUES ('p1', ?, 'boston', 'r1', 'Approved Building Permits', 'q', 'ok', 1)").bind(id).run();
    await db.prepare("INSERT INTO building_records (id, building_id, pull_id, kind, source_key, payload) VALUES ('r1', ?, 'p1', 'permit', 'X', '{\"nope\": true}')").bind(id).run();
    const view = (await getBuildingRecords(db, id))!;
    expect(view.permits).toEqual([]);
    expect(view.invalidKinds).toEqual(['permit']);
  });

  it('surfaces source-mismatch notes and nothing else from corrections', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db);
    await db.prepare("INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status) VALUES ('p1', ?, 'boston', 'r1', 'RentSmart', 'q', 'empty')").bind(id).run();
    await db.prepare("INSERT INTO record_corrections (id, building_id, record_kind, claim, status, resolution, resolution_notes, resolved_at) VALUES ('c1', ?, 'permit', 'claim', 'resolved', 'source_mismatch_noted', 'City record lags.', 1700000000)").bind(id).run();
    await db.prepare("INSERT INTO record_corrections (id, building_id, record_kind, claim, status, resolution, resolution_notes, resolved_at) VALUES ('c2', ?, 'permit', 'claim', 'resolved', 'repulled_unchanged', 'private', 1700000000)").bind(id).run();
    const view = (await getBuildingRecords(db, id))!;
    expect(view.corrections).toEqual([{ recordKind: 'permit', resolvedAt: 1700000000, notes: 'City record lags.' }]);
  });
});

describe('validatePayload', () => {
  it('accepts a shaped payload and rejects a missing required key', () => {
    expect(validatePayload('rentsmart', { rowId: '1', date: null, violationType: null, description: null, address: null, parcel: null })).not.toBeNull();
    expect(validatePayload('rentsmart', { date: null })).toBeNull();
    expect(validatePayload('assessment', { fiscalYear: 'FY2026', condominium: 'yes' })).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing display test**

```ts
// src/lib/__tests__/recordsDisplay.test.ts
import { describe, it, expect } from 'vitest';
import {
  showMailingAddress, formatDollars, formatRecordDate, permitSummary, splitServiceRequests,
  rentSmartDisagreement, ZERO_PERMITS_COPY, PANEL_FRAMING_COPY, BANNED_WORDS,
} from '../records/display';
import type { PermitPayload, RentSmartPayload, ServiceRequestPayload } from '../records/types';

describe('showMailingAddress', () => {
  it('shows for entities, never for individuals or missing owners', () => {
    expect(showMailingAddress('LANARK ROAD LLC MASS LLC')).toBe(true);
    expect(showMailingAddress('KELLEHER FAMILY LP MASS LP')).toBe(true);
    expect(showMailingAddress('GRAND LANARK CONDO TR')).toBe(true);
    expect(showMailingAddress('PASCUCCI CARLO')).toBe(false);
    expect(showMailingAddress(null)).toBe(false);
  });
});

describe('formatters', () => {
  it('formats dollars and record dates from every timestamp shape seen', () => {
    expect(formatDollars(6720200)).toBe('$6,720,200');
    expect(formatDollars(null)).toBe('Not recorded');
    expect(formatRecordDate('2008-08-30 09:42:00')).toBe('Aug 30, 2008');
    expect(formatRecordDate('2021-01-28T16:29:26')).toBe('Jan 28, 2021');
    expect(formatRecordDate('2026-07-17 13:56:00+00')).toBe('Jul 17, 2026');
    expect(formatRecordDate(null)).toBe('Date not recorded');
    expect(formatRecordDate('garbage')).toBe('Date not recorded');
  });
});

describe('permitSummary', () => {
  const permit = (n: string, date: string | null, value: number | null): PermitPayload => ({
    permitNumber: n, workType: null, permitType: null, description: null, comments: null, applicant: null,
    declaredValuation: value, totalFees: null, issuedDate: date, expirationDate: null, status: null, occupancyType: null, address: null,
  });
  it('counts, sums declared valuation, and finds the date range', () => {
    const s = permitSummary([permit('a', '2021-01-28T16:29:26', 36500), permit('b', '2019-05-02T09:00:00', 1200), permit('c', null, null)]);
    expect(s).toEqual({ count: 3, declaredTotal: 37700, earliest: '2019-05-02T09:00:00', latest: '2021-01-28T16:29:26' });
  });
  it('handles zero permits', () => {
    expect(permitSummary([])).toEqual({ count: 0, declaredTotal: 0, earliest: null, latest: null });
    expect(ZERO_PERMITS_COPY).toContain('No permitted work on record since 2006');
    expect(ZERO_PERMITS_COPY).toContain('not that no maintenance was done');
  });
});

describe('splitServiceRequests', () => {
  const sr = (id: string, c: 'housing' | 'other', opened: string): ServiceRequestPayload => ({
    caseId: id, system: 'legacy', openedAt: opened, closedAt: null, status: null, closureReason: null, title: null, subject: null, reason: null, type: null, location: null, source: null, classification: c,
  });
  it('lists housing newest first and counts the rest', () => {
    const split = splitServiceRequests([sr('1', 'other', '2024-01-01'), sr('2', 'housing', '2023-01-01'), sr('3', 'housing', '2025-01-01')]);
    expect(split.housing.map((r) => r.caseId)).toEqual(['3', '2']);
    expect(split.otherCount).toBe(1);
  });
});

describe('rentSmartDisagreement', () => {
  const rs = (t: string): RentSmartPayload => ({ rowId: t, date: null, violationType: t, description: null, address: null, parcel: null });
  it('returns a sentence only when RentSmart housing complaints exceed our housing 311 count', () => {
    expect(rentSmartDisagreement([rs('Housing Complaints'), rs('Housing Complaints')], 2)).toBeNull();
    expect(rentSmartDisagreement([rs('Housing Complaints'), rs('Housing Complaints'), rs('Sanitation Requests')], 1))
      .toBe("The city's RentSmart summary reports 2 housing complaints for this address; the 311 records above show 1.");
    expect(rentSmartDisagreement([], 0)).toBeNull();
  });
});

describe('copy', () => {
  it('panel copy contains no banned words', () => {
    const pattern = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'i');
    for (const copy of [ZERO_PERMITS_COPY, PANEL_FRAMING_COPY]) expect(copy).not.toMatch(pattern);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/recordsQuery.test.ts src/lib/__tests__/recordsDisplay.test.ts`
Expected: FAIL with `Cannot find module`

- [ ] **Step 4: Write `query.ts`**

```ts
// src/lib/records/query.ts
import { logError } from '../logger';
import { permitsSource } from './sources/boston/permits';
import { violationsSource } from './sources/boston/violations';
import { enforcementSource } from './sources/boston/enforcement';
import { serviceRequestsSource } from './sources/boston/serviceRequests';
import { rentsmartSource } from './sources/boston/rentsmart';
import { ASSESSOR_PAGE_URL } from './sources/boston/assessor';
import type {
  AssessmentPayload, EnforcementTicketPayload, PermitPayload, RecordKind, RecordPayload, RecordsDb, RentSmartPayload, ServiceRequestPayload, ViolationPayload,
} from './types';

export interface SourceStatus {
  sourceId: string;
  label: string;
  pageUrl: string;
  status: 'ok' | 'empty' | 'error';
  retrievedAt: number;
  errorMessage: string | null;
}

export interface CorrectionNote {
  recordKind: string | null;
  resolvedAt: number;
  notes: string;
}

export interface BuildingRecordsView {
  pulledAt: number;
  sources: Record<string, SourceStatus>;
  assessments: AssessmentPayload[];
  permits: PermitPayload[];
  violations: ViolationPayload[];
  enforcement: EnforcementTicketPayload[];
  serviceRequests: ServiceRequestPayload[];
  rentsmart: RentSmartPayload[];
  invalidKinds: RecordKind[];
  corrections: CorrectionNote[];
}

/** Required keys per kind and, for booleans, their type. Anything else is "record unavailable". */
const REQUIRED_KEYS: Record<RecordKind, string[]> = {
  assessment: ['fiscalYear', 'condominium'],
  permit: ['permitNumber'],
  violation: ['caseNumber'],
  enforcement_ticket: ['caseNumber'],
  service_request: ['caseId', 'classification', 'system'],
  rentsmart: ['rowId'],
};

export function validatePayload(kind: RecordKind, value: unknown): RecordPayload | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  for (const key of REQUIRED_KEYS[kind]) {
    if (!(key in obj)) return null;
  }
  if (kind === 'assessment' && typeof obj.condominium !== 'boolean') return null;
  if (kind === 'service_request' && obj.classification !== 'housing' && obj.classification !== 'other') return null;
  return obj as unknown as RecordPayload;
}

/** Dataset page for each source id. Assessor years all share one page. */
const PAGE_URLS: Record<string, string> = {
  [permitsSource.id]: permitsSource.pageUrl,
  [violationsSource.id]: violationsSource.pageUrl,
  [enforcementSource.id]: enforcementSource.pageUrl,
  [serviceRequestsSource.id]: serviceRequestsSource.pageUrl,
  [rentsmartSource.id]: rentsmartSource.pageUrl,
};

interface PullRow { source_id: string; source_label: string; status: 'ok' | 'empty' | 'error'; retrieved_at: number; error_message: string | null }
interface RecordRow { kind: RecordKind; payload: string }
interface CorrectionRow { record_kind: string | null; resolved_at: number; resolution_notes: string }

export async function getBuildingRecords(db: RecordsDb, buildingId: string): Promise<BuildingRecordsView | null> {
  const pulls = await db
    .prepare('SELECT source_id, source_label, status, retrieved_at, error_message FROM record_pulls WHERE building_id = ? ORDER BY retrieved_at ASC, rowid ASC')
    .bind(buildingId)
    .all<PullRow>();
  if (pulls.results.length === 0) return null;

  const sources: Record<string, SourceStatus> = {};
  let pulledAt = 0;
  for (const p of pulls.results) {
    // Later rows overwrite earlier ones, so each source ends on its latest pull.
    sources[p.source_id] = {
      sourceId: p.source_id,
      label: p.source_label,
      pageUrl: PAGE_URLS[p.source_id] ?? ASSESSOR_PAGE_URL,
      status: p.status,
      retrievedAt: p.retrieved_at,
      errorMessage: p.error_message,
    };
    pulledAt = Math.max(pulledAt, p.retrieved_at);
  }

  const view: BuildingRecordsView = {
    pulledAt, sources, assessments: [], permits: [], violations: [], enforcement: [], serviceRequests: [], rentsmart: [], invalidKinds: [], corrections: [],
  };

  const records = await db.prepare('SELECT kind, payload FROM building_records WHERE building_id = ?').bind(buildingId).all<RecordRow>();
  const invalid = new Set<RecordKind>();
  for (const row of records.results) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      parsed = null;
    }
    const payload = validatePayload(row.kind, parsed);
    if (!payload) {
      invalid.add(row.kind);
      logError('building_record_invalid_payload', { buildingId, kind: row.kind });
      continue;
    }
    switch (row.kind) {
      case 'assessment': view.assessments.push(payload as AssessmentPayload); break;
      case 'permit': view.permits.push(payload as PermitPayload); break;
      case 'violation': view.violations.push(payload as ViolationPayload); break;
      case 'enforcement_ticket': view.enforcement.push(payload as EnforcementTicketPayload); break;
      case 'service_request': view.serviceRequests.push(payload as ServiceRequestPayload); break;
      case 'rentsmart': view.rentsmart.push(payload as RentSmartPayload); break;
    }
  }
  view.invalidKinds = Array.from(invalid).sort();

  const desc = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');
  view.assessments.sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear));
  view.permits.sort((a, b) => desc(a.issuedDate, b.issuedDate));
  view.violations.sort((a, b) => desc(a.statusDate, b.statusDate));
  view.enforcement.sort((a, b) => desc(a.statusDate, b.statusDate));
  view.serviceRequests.sort((a, b) => desc(a.openedAt, b.openedAt));
  view.rentsmart.sort((a, b) => desc(a.date, b.date));

  const corrections = await db
    .prepare("SELECT record_kind, resolved_at, resolution_notes FROM record_corrections WHERE building_id = ? AND status = 'resolved' AND resolution = 'source_mismatch_noted' AND resolution_notes IS NOT NULL ORDER BY resolved_at DESC")
    .bind(buildingId)
    .all<CorrectionRow>();
  view.corrections = corrections.results.map((c) => ({ recordKind: c.record_kind, resolvedAt: c.resolved_at, notes: c.resolution_notes }));

  return view;
}
```

- [ ] **Step 5: Write `display.ts`**

```ts
// src/lib/records/display.ts
import { inferOwnerEntity } from '../enrichment/helpers';
import { PERMIT_COVERAGE_START } from './sources/boston/permits';
import type { PermitPayload, RentSmartPayload, ServiceRequestPayload } from './types';

/** Words the brief flagged as characterizations. A test asserts the panel never uses them. */
export const BANNED_WORDS: readonly string[] = ['cash-out', 'extracted', 'cross-collateralized', 'deferred maintenance', 'pattern', 'evasive', 'delay'];

export const PANEL_FRAMING_COPY =
  'These are facts from City of Boston and Commonwealth of Massachusetts records, shown as recorded. No rating is applied to them and they are not part of any score.';

export const ZERO_PERMITS_COPY =
  `No permitted work on record since ${PERMIT_COVERAGE_START.split(' ')[1]}. This means no permits were filed, not that no maintenance was done.`;

export const DECLARED_VALUATION_CAVEAT = "Declared valuation is the applicant's own estimate at filing and is a floor, not a cost.";

export const OTHER_REQUESTS_COPY = 'Other 311 requests at or near this address: parking, trash pickup, streetlights, and similar. Counted but not listed.';

export const CONDOMINIUM_COPY = 'This building is divided into individually owned condominium units. No single owner of record is shown.';

/** An individual's mailing address is usually their home. Only entities get one rendered. */
export function showMailingAddress(owner: string | null): boolean {
  if (!owner) return false;
  return inferOwnerEntity(owner) !== 'individual';
}

export function formatDollars(value: number | null): string {
  if (value == null) return 'Not recorded';
  return `$${value.toLocaleString('en-US')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Accepts '2008-08-30 09:42:00', '2021-01-28T16:29:26', '2026-07-17 13:56:00+00'. Public-record dates are exact by design. */
export function formatRecordDate(value: string | null): string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 'Date not recorded';
  const [, y, m, d] = match;
  const month = MONTHS[Number.parseInt(m, 10) - 1];
  if (!month) return 'Date not recorded';
  return `${month} ${Number.parseInt(d, 10)}, ${y}`;
}

export interface PermitSummary {
  count: number;
  declaredTotal: number;
  earliest: string | null;
  latest: string | null;
}

export function permitSummary(permits: PermitPayload[]): PermitSummary {
  const dated = permits.map((p) => p.issuedDate).filter((d): d is string => Boolean(d)).sort();
  return {
    count: permits.length,
    declaredTotal: permits.reduce((sum, p) => sum + (p.declaredValuation ?? 0), 0),
    earliest: dated[0] ?? null,
    latest: dated[dated.length - 1] ?? null,
  };
}

export function splitServiceRequests(rows: ServiceRequestPayload[]): { housing: ServiceRequestPayload[]; otherCount: number } {
  const housing = rows.filter((r) => r.classification === 'housing').sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? ''));
  return { housing, otherCount: rows.length - housing.length };
}

/**
 * RentSmart is a cross-check, not a section. Render a sentence only when the city's
 * roll-up reports more housing complaints than our 311 records show.
 */
export function rentSmartDisagreement(rows: RentSmartPayload[], housingRequestCount: number): string | null {
  const complaints = rows.filter((r) => r.violationType === 'Housing Complaints').length;
  if (complaints <= housingRequestCount) return null;
  return `The city's RentSmart summary reports ${complaints} housing complaints for this address; the 311 records above show ${housingRequestCount}.`;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/recordsQuery.test.ts src/lib/__tests__/recordsDisplay.test.ts`
Expected: PASS (5 + 7 tests)

- [ ] **Step 7: Commit**

```bash
git add src/lib/records/query.ts src/lib/records/display.ts src/lib/__tests__/recordsQuery.test.ts src/lib/__tests__/recordsDisplay.test.ts
git commit -m "feat(records): validated read side and pure display helpers"
```

---

### Task 12: Admin pull endpoint and the per-building pull control

**Files:**
- Create: `src/pages/api/admin/buildings/[id]/records/pull.ts`
- Create: `src/components/admin/RecordsPullButton.tsx`
- Modify: `src/components/admin/BuildingsTable.tsx` (mount only; the file must not grow otherwise)
- Test: `src/lib/__tests__/recordsPullRoute.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
// src/lib/__tests__/recordsPullRoute.test.ts
import type { APIContext } from 'astro';
import { describe, it, expect, vi } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';

const suite = sqliteAvailable ? describe : describe.skip;

function createContext(db: unknown, buildingId: string, body: unknown, user: { id: string; isAdmin: boolean } | null): APIContext {
  return {
    params: { id: buildingId },
    request: new Request(`https://ratemyplace.org/api/admin/buildings/${buildingId}/records/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
      body: JSON.stringify(body),
    }),
    locals: { user, runtime: { env: { DB: db } } },
    url: new URL(`https://ratemyplace.org/api/admin/buildings/${buildingId}/records/pull`),
  } as unknown as APIContext;
}

suite('POST /api/admin/buildings/[id]/records/pull', () => {
  it('refuses non-admins', async () => {
    const { POST } = await import('../../pages/api/admin/buildings/[id]/records/pull');
    const db = createRecordsTestDb();
    const id = await insertBuilding(db);
    expect((await POST(createContext(db, id, {}, { id: 'u1', isAdmin: false }))).status).toBe(403);
    expect((await POST(createContext(db, id, {}, null))).status).toBe(403);
  });

  it('404s an unknown building and 400s a malformed parcel override', async () => {
    const { POST } = await import('../../pages/api/admin/buildings/[id]/records/pull');
    const db = createRecordsTestDb();
    expect((await POST(createContext(db, 'nope', {}, { id: 'admin', isAdmin: true }))).status).toBe(404);
    const id = await insertBuilding(db);
    expect((await POST(createContext(db, id, { parcelId: '12ab' }, { id: 'admin', isAdmin: true }))).status).toBe(400);
  });

  it('runs the pull, applies a parcel override, returns the summary, and writes an audit row', async () => {
    vi.stubGlobal('fetch', fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]));
    try {
      const { POST } = await import('../../pages/api/admin/buildings/[id]/records/pull');
      const db = createRecordsTestDb();
      const id = await insertBuilding(db);
      const response = await POST(createContext(db, id, { parcelId: '2102098000' }, { id: 'admin', isAdmin: true }));
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { parcelId: string; sources: Array<{ status: string }> } };
      expect(body.data.parcelId).toBe('2102098000');
      expect(body.data.sources).toHaveLength(11);

      const audit = await db.prepare("SELECT action_type, entity_type, entity_id, admin_user_id FROM audit_logs").first<{ action_type: string; entity_type: string; entity_id: string; admin_user_id: string }>();
      expect(audit).toEqual({ action_type: 'records_pulled', entity_type: 'building', entity_id: id, admin_user_id: 'admin' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsPullRoute.test.ts`
Expected: FAIL with `Cannot find module '../../pages/api/admin/buildings/[id]/records/pull'`

- [ ] **Step 3: Write the endpoint**

```ts
// src/pages/api/admin/buildings/[id]/records/pull.ts
import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../../lib/db';
import { createAuditLog } from '../../../../../../lib/audit';
import { getClientIP } from '../../../../../../lib/rateLimit';
import { logError } from '../../../../../../lib/logger';
import { pullBuildingRecords } from '../../../../../../lib/records/pull';
import { toCanonicalParcel } from '../../../../../../lib/records/identity';
import type { BuildingRowForIdentity } from '../../../../../../lib/records/identity';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * POST /api/admin/buildings/:id/records/pull
 * Body (optional): { parcelId?: string }  — admin override when resolution is ambiguous.
 * Runs every source for the building, stores rows with provenance, audits, returns the summary.
 */
export const POST: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }
  const buildingId = context.params.id;
  if (!buildingId) return json({ error: 'Building ID required' }, 400);

  let parcelOverride: string | null = null;
  const contentType = context.request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = (await context.request.json().catch(() => ({}))) as { parcelId?: unknown };
    if (body.parcelId !== undefined && body.parcelId !== null && body.parcelId !== '') {
      parcelOverride = toCanonicalParcel(typeof body.parcelId === 'string' ? body.parcelId : null);
      if (!parcelOverride) {
        return json({ error: 'Validation failed', details: [{ field: 'parcelId', message: 'Parcel id must be 9 or 10 digits.' }] }, 400);
      }
    }
  }

  const db = getDB(context);
  try {
    if (parcelOverride) {
      await db.prepare('UPDATE buildings SET parcel_id = ?, updated_at = unixepoch() WHERE id = ?').bind(parcelOverride, buildingId).run();
    }
    const building = await db
      .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
      .bind(buildingId)
      .first<BuildingRowForIdentity>();
    if (!building) return json({ error: 'Building not found' }, 404);

    const summary = await pullBuildingRecords(db, building, { triggeredBy: context.locals.user.id });

    await createAuditLog(db, {
      adminUserId: context.locals.user.id,
      adminIp: getClientIP(context),
      actionType: 'records_pulled',
      entityType: 'building',
      entityId: buildingId,
      newValue: {
        parcelId: summary.parcelId,
        condominium: summary.condominium,
        sources: summary.sources.map((s) => ({ label: s.label, status: s.status, rowCount: s.rowCount })),
      },
      notes: parcelOverride ? `parcel override ${parcelOverride}` : undefined,
    });

    return json({ data: summary }, 200);
  } catch (error) {
    logError('records_pull_failed', { endpoint: 'admin/records/pull', buildingId, error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Failed to pull records' }, 500);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsPullRoute.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the pull control component**

```tsx
// src/components/admin/RecordsPullButton.tsx
import { useState } from 'react';

interface SourceSummary { label: string; status: 'ok' | 'empty' | 'error'; rowCount: number; error?: string }
interface PullSummary { parcelId: string | null; condominium: boolean; jurisdiction: string; sources: SourceSummary[] }

interface Props {
  buildingId: string;
  city: string | null;
}

const STATUS_CLASS: Record<SourceSummary['status'], string> = {
  ok: 'text-green-700',
  empty: 'text-gray-500',
  error: 'text-red-700',
};

/** "Pull records" for one building. Kept out of BuildingsTable so that file does not grow. */
export default function RecordsPullButton({ buildingId, city }: Props) {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<PullSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parcelOverride, setParcelOverride] = useState('');

  const isBoston = (city ?? '').replace(/,\s*[A-Z]{2}$/, '').trim().toLowerCase() === 'boston';

  const run = async () => {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const response = await fetch(`/api/admin/buildings/${buildingId}/records/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parcelOverride.trim() ? { parcelId: parcelOverride.trim() } : {}),
      });
      const data = (await response.json()) as { data?: PullSummary; error?: string; details?: Array<{ message: string }> };
      if (!response.ok || !data.data) {
        setError(data.details?.[0]?.message ?? data.error ?? 'Pull failed');
        return;
      }
      setSummary(data.data);
    } catch {
      setError('Pull failed');
    } finally {
      setRunning(false);
    }
  };

  if (!isBoston) {
    return <p className="text-xs text-gray-500">Public records are available for Boston buildings only.</p>;
  }

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="px-3 py-1 bg-teal-700 text-white rounded-[4px] text-xs font-semibold hover:bg-teal-800 disabled:opacity-50"
        >
          {running ? 'Pulling records…' : 'Pull records'}
        </button>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          Parcel id override
          <input
            type="text"
            value={parcelOverride}
            onChange={(e) => setParcelOverride(e.target.value)}
            placeholder="10 digits"
            className="border border-gray-300 rounded-[4px] px-2 py-1 text-xs w-32"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      {summary && (
        <div className="mt-2 text-xs">
          <p className="text-gray-700">
            Parcel: {summary.parcelId ?? (summary.condominium ? 'condominium (no single parcel)' : 'not resolved')}
          </p>
          <ul className="mt-1 space-y-0.5">
            {summary.sources.map((s) => (
              <li key={s.label} className={STATUS_CLASS[s.status]}>
                {s.label}: {s.status}{s.status !== 'error' ? ` (${s.rowCount} rows)` : ''}{s.error ? ` — ${s.error}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Mount it in `BuildingsTable.tsx`**

Add the import at the top of `src/components/admin/BuildingsTable.tsx`:

```tsx
import RecordsPullButton from './RecordsPullButton';
```

Find the `{/* Enrichment Results */}` comment inside the expanded-building block and insert this line immediately **before** it:

```tsx
                    <RecordsPullButton buildingId={building.id} city={building.city} />
```

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`, sign in as the local admin, open `/admin/buildings`, expand a Boston building, click **Pull records**. Expected: a per-source status list appears. Open `/admin/audit` and confirm a `records_pulled` row.

- [ ] **Step 8: Commit**

```bash
git add "src/pages/api/admin/buildings/[id]/records/pull.ts" src/components/admin/RecordsPullButton.tsx src/components/admin/BuildingsTable.tsx src/lib/__tests__/recordsPullRoute.test.ts
git commit -m "feat(records): admin pull endpoint with audit and per-building pull control"
```

---

### Task 13: The public records panel

**Files:**
- Create: `src/components/BuildingRecords.astro`
- Modify: `src/pages/building/[slug].astro` (mount below "Building details", add Turnstile script)
- Test: `src/lib/__tests__/recordsPanelCopy.test.ts`

- [ ] **Step 1: Write the failing copy-rule test**

This test reads the component source as text. It is the enforcement mechanism for the display rules that a unit test can check.

```ts
// src/lib/__tests__/recordsPanelCopy.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED_WORDS } from '../records/display';

const source = readFileSync(join(process.cwd(), 'src/components/BuildingRecords.astro'), 'utf8');

describe('BuildingRecords.astro display rules', () => {
  it('contains none of the banned characterizations', () => {
    const pattern = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'i');
    expect(source).not.toMatch(pattern);
  });

  it('never imports score colors or links to reviews and scores', () => {
    expect(source).not.toMatch(/scoring-colors/);
    expect(source).not.toMatch(/getScore(Text)?Color|getScoreBgTint/);
    expect(source).not.toMatch(/#review-|ScoreCard/);
  });

  it('routes every date and dollar value through the display helpers', () => {
    expect(source).toMatch(/formatRecordDate\(/);
    expect(source).toMatch(/formatDollars\(/);
    expect(source).not.toMatch(/toLocaleDateString/);
  });

  it('gates the mailing address and condominium owner', () => {
    expect(source).toMatch(/showMailingAddress\(/);
    expect(source).toMatch(/CONDOMINIUM_COPY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsPanelCopy.test.ts`
Expected: FAIL with `ENOENT ... BuildingRecords.astro`

- [ ] **Step 3: Write the component**

```astro
---
// src/components/BuildingRecords.astro
// Public records panel. Server-rendered from D1. Renders nothing for a building that
// has never been pulled. Every value is a field from a record or a count of records.
import { getBuildingRecords } from '../lib/records/query';
import {
  showMailingAddress, formatDollars, formatRecordDate, permitSummary, splitServiceRequests, rentSmartDisagreement,
  PANEL_FRAMING_COPY, ZERO_PERMITS_COPY, DECLARED_VALUATION_CAVEAT, OTHER_REQUESTS_COPY, CONDOMINIUM_COPY,
} from '../lib/records/display';
import { HOUSING_REASONS, HOUSING_DEPARTMENT_PREFIX, SERVICE_REQUESTS_PAGE_URL } from '../lib/records/sources/boston/serviceRequests';
import { PERMIT_COVERAGE_START, PERMITS_PAGE_URL, PERMITS_RESOURCE_ID } from '../lib/records/sources/boston/permits';
import { ASSESSOR_PAGE_URL, FY2026_RESOURCE_ID } from '../lib/records/sources/boston/assessor';
import { VIOLATIONS_PAGE_URL, VIOLATIONS_RESOURCE_ID } from '../lib/records/sources/boston/violations';
import { ENFORCEMENT_PAGE_URL, ENFORCEMENT_RESOURCE_ID } from '../lib/records/sources/boston/enforcement';
import { NEW_311_RESOURCE_ID } from '../lib/records/sources/boston/serviceRequests';
import RecordCorrectionForm from './records/RecordCorrectionForm';

interface Props {
  buildingId: string;
}
const { buildingId } = Astro.props;

const view = await getBuildingRecords(Astro.locals.runtime.env.DB, buildingId);

const asOf = (unix: number) => formatRecordDate(new Date(unix * 1000).toISOString());
const current = view?.assessments[0] ?? null;
const permits = view ? permitSummary(view.permits) : null;
const requests = view ? splitServiceRequests(view.serviceRequests) : null;
const rentSmartNote = view && requests ? rentSmartDisagreement(view.rentsmart, requests.housing.length) : null;
const statusFor = (sourceId: string) => view?.sources[sourceId] ?? null;
const unavailable = (sourceId: string, kindHasRows: boolean) => {
  const s = statusFor(sourceId);
  return s?.status === 'error' && !kindHasRows;
};
const notesFor = (kind: string) => view?.corrections.filter((c) => c.recordKind === kind || c.recordKind === null) ?? [];
---

{view && (
  <section id="public-records" class="bg-white rounded-[6px] border border-gray-200 p-6 mb-8">
    <div class="flex flex-wrap items-baseline justify-between gap-2 mb-2">
      <h2 class="text-xl font-semibold text-gray-900">Public records</h2>
      <a href="#report-record" class="text-sm text-teal-700 hover:underline">Report a record error</a>
    </div>
    <p class="text-sm text-gray-600 mb-1">{PANEL_FRAMING_COPY}</p>
    <p class="text-xs text-gray-500 mb-6">Most recent pull: {asOf(view.pulledAt)}.</p>

    {view.invalidKinds.length > 0 && (
      <p class="text-xs text-amber-700 mb-4">Some records could not be read and are not shown ({view.invalidKinds.join(', ')}).</p>
    )}

    <!-- Property -->
    <div class="mb-6">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="font-semibold text-gray-900">Property</h3>
        <span class="text-xs text-gray-500">
          {statusFor(FY2026_RESOURCE_ID) && <>as of {asOf(statusFor(FY2026_RESOURCE_ID)!.retrievedAt)} · </>}
          <a href={ASSESSOR_PAGE_URL} rel="noopener noreferrer" target="_blank" class="text-teal-700 hover:underline">Source</a>
        </span>
      </div>
      {unavailable(FY2026_RESOURCE_ID, Boolean(current)) ? (
        <p class="text-sm text-gray-500 mt-2">Record unavailable. Last attempt {asOf(statusFor(FY2026_RESOURCE_ID)!.retrievedAt)}.</p>
      ) : !current ? (
        <p class="text-sm text-gray-500 mt-2">No assessor record on file.</p>
      ) : current.condominium ? (
        <p class="text-sm text-gray-700 mt-2">{CONDOMINIUM_COPY}</p>
      ) : (
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-2">
          <dt class="text-gray-500">Parcel</dt><dd class="text-gray-900">{current.parcelId ?? 'Not recorded'}</dd>
          <dt class="text-gray-500">Owner of record</dt><dd class="text-gray-900">{current.owner ?? 'Not recorded'}</dd>
          {showMailingAddress(current.owner) && (
            <>
              <dt class="text-gray-500">Tax mailing address</dt>
              <dd class="text-gray-900">
                {[current.mailAddressee, current.mailStreet, [current.mailCity, current.mailState, current.mailZip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Not recorded'}
              </dd>
            </>
          )}
          <dt class="text-gray-500">Land use</dt><dd class="text-gray-900">{current.landUseDescription ?? current.landUse ?? 'Not recorded'}</dd>
          <dt class="text-gray-500">Year built</dt><dd class="text-gray-900">{current.yearBuilt ?? 'Not recorded'}</dd>
          <dt class="text-gray-500">Last remodel year</dt><dd class="text-gray-900">{current.yearRemodel ?? 'Not recorded'}</dd>
          <dt class="text-gray-500">Units</dt><dd class="text-gray-900">{current.residentialUnits ?? 'Not recorded'}</dd>
          <dt class="text-gray-500">Assessed value ({current.fiscalYear})</dt><dd class="text-gray-900">{formatDollars(current.totalValue)}</dd>
        </dl>
      )}
      {view.assessments.length > 1 && (
        <table class="mt-3 text-xs w-full">
          <caption class="sr-only">Assessed value by fiscal year</caption>
          <thead><tr class="text-left text-gray-500"><th class="pr-4 font-normal">Fiscal year</th><th class="font-normal">Total assessed value</th></tr></thead>
          <tbody>
            {view.assessments.map((a) => (
              <tr><td class="pr-4 text-gray-700">{a.fiscalYear}</td><td class="text-gray-900">{formatDollars(a.totalValue)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      {notesFor('assessment').map((n) => <p class="text-xs text-gray-600 mt-2">A correction was filed on this record on {asOf(n.resolvedAt)}. The source has not updated. {n.notes}</p>)}
    </div>

    <!-- Permits -->
    <div class="mb-6">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="font-semibold text-gray-900">Building permits</h3>
        <span class="text-xs text-gray-500">
          {view.sources[PERMITS_RESOURCE_ID] && <>as of {asOf(view.sources[PERMITS_RESOURCE_ID].retrievedAt)} · </>}
          <a href={PERMITS_PAGE_URL} rel="noopener noreferrer" target="_blank" class="text-teal-700 hover:underline">Source</a>
        </span>
      </div>
      {unavailable(PERMITS_RESOURCE_ID, view.permits.length > 0) ? (
        <p class="text-sm text-gray-500 mt-2">Record unavailable. Last attempt {asOf(view.sources[PERMITS_RESOURCE_ID].retrievedAt)}.</p>
      ) : permits!.count === 0 ? (
        <p class="text-sm text-gray-700 mt-2">{ZERO_PERMITS_COPY}</p>
      ) : (
        <>
          <p class="text-sm text-gray-700 mt-2">
            {permits!.count} permit{permits!.count === 1 ? '' : 's'} on record from {PERMIT_COVERAGE_START}
            {permits!.earliest && <> (earliest {formatRecordDate(permits!.earliest)}, latest {formatRecordDate(permits!.latest)})</>}.
            Total declared valuation {formatDollars(permits!.declaredTotal)}.
          </p>
          <p class="text-xs text-gray-500">{DECLARED_VALUATION_CAVEAT}</p>
          <ul class="mt-2 divide-y divide-gray-100 text-sm">
            {view.permits.map((p) => (
              <li class="py-1.5 grid grid-cols-[7rem_1fr_auto] gap-2">
                <span class="text-gray-500">{formatRecordDate(p.issuedDate)}</span>
                <span class="text-gray-900">{p.permitType ?? p.workType ?? 'Permit'}{p.description ? ` · ${p.description}` : ''}</span>
                <span class="text-gray-500">{p.status ?? ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {notesFor('permit').map((n) => <p class="text-xs text-gray-600 mt-2">A correction was filed on this record on {asOf(n.resolvedAt)}. The source has not updated. {n.notes}</p>)}
    </div>

    <!-- Violations -->
    <div class="mb-6">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="font-semibold text-gray-900">Violations</h3>
        <span class="text-xs text-gray-500">
          {view.sources[VIOLATIONS_RESOURCE_ID] && <>as of {asOf(view.sources[VIOLATIONS_RESOURCE_ID].retrievedAt)} · </>}
          <a href={VIOLATIONS_PAGE_URL} rel="noopener noreferrer" target="_blank" class="text-teal-700 hover:underline">Source</a>
        </span>
      </div>
      {unavailable(VIOLATIONS_RESOURCE_ID, view.violations.length > 0) ? (
        <p class="text-sm text-gray-500 mt-2">Record unavailable. Last attempt {asOf(view.sources[VIOLATIONS_RESOURCE_ID].retrievedAt)}.</p>
      ) : view.violations.length === 0 ? (
        <p class="text-sm text-gray-700 mt-2">No violations on record.</p>
      ) : (
        <ul class="mt-2 divide-y divide-gray-100 text-sm">
          {[...view.violations.filter((v) => v.status === 'Open'), ...view.violations.filter((v) => v.status !== 'Open')].map((v) => (
            <li class="py-1.5 grid grid-cols-[7rem_1fr_auto] gap-2">
              <span class="text-gray-500">{formatRecordDate(v.statusDate)}</span>
              <span class="text-gray-900">{v.code ? `${v.code} · ` : ''}{v.description ?? 'Violation'}</span>
              <span class="text-gray-500">{v.status ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
      {notesFor('violation').map((n) => <p class="text-xs text-gray-600 mt-2">A correction was filed on this record on {asOf(n.resolvedAt)}. The source has not updated. {n.notes}</p>)}
    </div>

    <!-- Code enforcement -->
    <div class="mb-6">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="font-semibold text-gray-900">Code enforcement</h3>
        <span class="text-xs text-gray-500">
          {view.sources[ENFORCEMENT_RESOURCE_ID] && <>as of {asOf(view.sources[ENFORCEMENT_RESOURCE_ID].retrievedAt)} · </>}
          <a href={ENFORCEMENT_PAGE_URL} rel="noopener noreferrer" target="_blank" class="text-teal-700 hover:underline">Source</a>
        </span>
      </div>
      {unavailable(ENFORCEMENT_RESOURCE_ID, view.enforcement.length > 0) ? (
        <p class="text-sm text-gray-500 mt-2">Record unavailable. Last attempt {asOf(view.sources[ENFORCEMENT_RESOURCE_ID].retrievedAt)}.</p>
      ) : view.enforcement.length === 0 ? (
        <p class="text-sm text-gray-700 mt-2">No code enforcement tickets on record.</p>
      ) : (
        <ul class="mt-2 divide-y divide-gray-100 text-sm">
          {view.enforcement.map((t) => (
            <li class="py-1.5 grid grid-cols-[7rem_1fr_auto] gap-2">
              <span class="text-gray-500">{formatRecordDate(t.statusDate)}</span>
              <span class="text-gray-900">{t.description ?? 'Ticket'}</span>
              <span class="text-gray-500">{t.status ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
      {notesFor('enforcement_ticket').map((n) => <p class="text-xs text-gray-600 mt-2">A correction was filed on this record on {asOf(n.resolvedAt)}. The source has not updated. {n.notes}</p>)}
    </div>

    <!-- 311 -->
    <div class="mb-6">
      <div class="flex items-baseline justify-between gap-2">
        <h3 class="font-semibold text-gray-900">311 requests</h3>
        <span class="text-xs text-gray-500">
          {view.sources[NEW_311_RESOURCE_ID] && <>as of {asOf(view.sources[NEW_311_RESOURCE_ID].retrievedAt)} · </>}
          <a href={SERVICE_REQUESTS_PAGE_URL} rel="noopener noreferrer" target="_blank" class="text-teal-700 hover:underline">Source</a>
        </span>
      </div>
      {unavailable(NEW_311_RESOURCE_ID, view.serviceRequests.length > 0) ? (
        <p class="text-sm text-gray-500 mt-2">Record unavailable. Last attempt {asOf(view.sources[NEW_311_RESOURCE_ID].retrievedAt)}.</p>
      ) : (
        <>
          <p class="text-sm text-gray-700 mt-2">
            {requests!.housing.length} housing-related request{requests!.housing.length === 1 ? '' : 's'}, {requests!.otherCount} other.
          </p>
          <details class="text-xs text-gray-500 mt-1">
            <summary class="cursor-pointer">How requests are classified</summary>
            <p class="mt-1">A request is housing-related when the city files it under {HOUSING_REASONS.join(', ')}, or routes it to {HOUSING_DEPARTMENT_PREFIX}. {OTHER_REQUESTS_COPY}</p>
          </details>
          {requests!.housing.length > 0 && (
            <ul class="mt-2 divide-y divide-gray-100 text-sm">
              {requests!.housing.map((r) => (
                <li class="py-1.5 grid grid-cols-[7rem_1fr_auto] gap-2">
                  <span class="text-gray-500">{formatRecordDate(r.openedAt)}</span>
                  <span class="text-gray-900">{r.type ?? r.title ?? 'Request'}</span>
                  <span class="text-gray-500">{r.status ?? ''}{r.closedAt ? ` ${formatRecordDate(r.closedAt)}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {rentSmartNote && <p class="text-xs text-gray-600 mt-2">{rentSmartNote}</p>}
      {notesFor('service_request').map((n) => <p class="text-xs text-gray-600 mt-2">A correction was filed on this record on {asOf(n.resolvedAt)}. The source has not updated. {n.notes}</p>)}
    </div>

    <div id="report-record" class="border-t border-gray-200 pt-4">
      <h3 class="font-semibold text-gray-900 mb-1">Report a record error</h3>
      <p class="text-sm text-gray-600 mb-3">If a record above does not match the city's own data, tell us which one. We re-pull it from the primary source. We never edit a value by hand.</p>
      <RecordCorrectionForm client:load buildingId={buildingId} />
    </div>
  </section>
)}
```

- [ ] **Step 4: Mount in the building page**

In `src/pages/building/[slug].astro`, add to the frontmatter imports:

```astro
import BuildingRecords from '../../components/BuildingRecords.astro';
```

Immediately after the closing `</div>` of the "Building Details" card (the line after `</dl>` that closes `<div class="bg-white rounded-[6px] border border-gray-200 p-6 mb-8">`), add:

```astro
        <BuildingRecords buildingId={building.id} />
```

At the bottom of the file, before the existing `<script>` block, add the Turnstile loader the correction form needs:

```astro
<script is:inline src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

- [ ] **Step 5: Create a stub for the form so the page compiles, then run the copy test**

Create `src/components/records/RecordCorrectionForm.tsx` with a stub (replaced in Task 15):

```tsx
// src/components/records/RecordCorrectionForm.tsx
interface Props { buildingId: string }
export default function RecordCorrectionForm({ buildingId }: Props) {
  return <p className="text-sm text-gray-500" data-building-id={buildingId}>Correction form coming in Task 15.</p>;
}
```

Run: `npx vitest run src/lib/__tests__/recordsPanelCopy.test.ts`
Expected: PASS (4 tests)

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`. Open a Boston building page you pulled in Task 12. Expected: a "Public records" card below "Building details" with Property, Building permits, Violations, Code enforcement, and 311 sections, each with an "as of" date and a Source link. Open a building that has not been pulled: no panel. Check at 375px width that the three-column lists wrap without horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add src/components/BuildingRecords.astro src/components/records/RecordCorrectionForm.tsx "src/pages/building/[slug].astro" src/lib/__tests__/recordsPanelCopy.test.ts
git commit -m "feat(records): public records panel on the building page"
```

---

### Task 14: Correction validation and the public correction endpoint

**Files:**
- Create: `src/lib/records/corrections.ts`
- Create: `src/pages/api/records/corrections.ts`
- Test: `src/lib/__tests__/recordsCorrections.test.ts`
- Test: `src/lib/__tests__/recordsCorrectionsRoute.test.ts`

- [ ] **Step 1: Write the failing validation test**

```ts
// src/lib/__tests__/recordsCorrections.test.ts
import { describe, it, expect } from 'vitest';
import { validateCorrectionBody, CORRECTION_KINDS, CORRECTION_RESOLUTIONS, diffRecordSnapshots } from '../records/corrections';

describe('validateCorrectionBody', () => {
  const good = { buildingId: 'b1', recordKind: 'permit', claim: 'The permit list is missing the 2019 roof permit, number ALT123.', contactEmail: 'a@b.co' };

  it('accepts a good body, including "panel" and no email', () => {
    expect(validateCorrectionBody(good)).toEqual([]);
    expect(validateCorrectionBody({ ...good, recordKind: 'panel', contactEmail: undefined })).toEqual([]);
  });

  it('rejects bad kinds, short and long claims, and malformed emails', () => {
    expect(validateCorrectionBody({ ...good, recordKind: 'score' }).map((e) => e.field)).toEqual(['recordKind']);
    expect(validateCorrectionBody({ ...good, claim: 'too short' }).map((e) => e.field)).toEqual(['claim']);
    expect(validateCorrectionBody({ ...good, claim: 'x'.repeat(1001) }).map((e) => e.field)).toEqual(['claim']);
    expect(validateCorrectionBody({ ...good, contactEmail: 'nope' }).map((e) => e.field)).toEqual(['contactEmail']);
    expect(validateCorrectionBody({}).map((e) => e.field)).toEqual(['buildingId', 'recordKind', 'claim']);
  });

  it('publishes the allowed kinds and resolutions', () => {
    expect(CORRECTION_KINDS).toContain('panel');
    expect(CORRECTION_KINDS).toContain('assessment');
    expect(CORRECTION_RESOLUTIONS).toEqual(['repulled_unchanged', 'repulled_updated', 'source_mismatch_noted']);
  });
});

describe('diffRecordSnapshots', () => {
  it('reports added, removed, and changed rows by kind and source key', () => {
    const before = [
      { kind: 'permit', source_key: 'A', payload: '{"status":"Open"}' },
      { kind: 'permit', source_key: 'B', payload: '{"status":"Open"}' },
    ];
    const after = [
      { kind: 'permit', source_key: 'A', payload: '{"status":"Closed"}' },
      { kind: 'permit', source_key: 'C', payload: '{"status":"Open"}' },
    ];
    expect(diffRecordSnapshots(before, after)).toEqual({
      added: [{ kind: 'permit', source_key: 'C' }],
      removed: [{ kind: 'permit', source_key: 'B' }],
      changed: [{ kind: 'permit', source_key: 'A' }],
    });
  });
});
```

- [ ] **Step 2: Write the failing endpoint test**

```ts
// src/lib/__tests__/recordsCorrectionsRoute.test.ts
import type { APIContext } from 'astro';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) => (token === 'good' ? { success: true } : { success: false, error: 'Bot verification failed. Please try again.' })),
}));

const suite = sqliteAvailable ? describe : describe.skip;

function createContext(db: unknown, body: unknown, options: { contentType?: string; ip?: string } = {}): APIContext {
  const headers: Record<string, string> = { 'Content-Type': options.contentType ?? 'application/json', 'CF-Connecting-IP': options.ip ?? '203.0.113.10' };
  const request = new Request('https://ratemyplace.org/api/records/corrections', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return {
    request,
    locals: { user: null, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
    url: new URL(request.url),
  } as unknown as APIContext;
}

const goodBody = { buildingId: 'bldg-lanark', recordKind: 'permit', claim: 'The 2019 roof permit ALT123 is missing from the list.', contactEmail: 'Filer@Example.com', turnstileToken: 'good' };

suite('POST /api/records/corrections', () => {
  let POST: (c: APIContext) => Promise<Response>;
  beforeEach(async () => {
    ({ POST } = await import('../../pages/api/records/corrections'));
  });

  it('rejects non-JSON before reading the body', async () => {
    const db = createRecordsTestDb();
    const response = await POST(createContext(db, 'x=y', { contentType: 'application/x-www-form-urlencoded' }));
    expect(response.status).toBe(415);
  });

  it('rate limits at three per hour per IP, fail-closed', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db);
    for (let i = 0; i < 3; i++) expect((await POST(createContext(db, goodBody))).status).toBe(201);
    const fourth = await POST(createContext(db, goodBody));
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get('Retry-After')).toBeTruthy();
  });

  it('requires Turnstile, then validation, then the building', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db);
    expect((await POST(createContext(db, { ...goodBody, turnstileToken: 'bad' }))).status).toBe(400);
    const invalid = await POST(createContext(db, { ...goodBody, claim: 'short' }, { ip: '203.0.113.11' }));
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { details: Array<{ field: string }> }).details[0].field).toBe('claim');
    expect((await POST(createContext(db, { ...goodBody, buildingId: 'missing' }, { ip: '203.0.113.12' }))).status).toBe(404);
  });

  it('stores the claim, the kind (null for panel), and a lowercased email, and returns an id', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db);
    const response = await POST(createContext(db, { ...goodBody, recordKind: 'panel' }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { id: string } };
    const row = await db.prepare('SELECT building_id, record_kind, claim, contact_email, status FROM record_corrections WHERE id = ?').bind(body.data.id).first();
    expect(row).toEqual({ building_id: 'bldg-lanark', record_kind: null, claim: goodBody.claim, contact_email: 'filer@example.com', status: 'pending' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/recordsCorrections.test.ts src/lib/__tests__/recordsCorrectionsRoute.test.ts`
Expected: FAIL with `Cannot find module`

- [ ] **Step 4: Write `corrections.ts`**

```ts
// src/lib/records/corrections.ts
import { isValidEmail, type ValidationError } from '../validation';
import { RECORD_KINDS } from './types';

/** What a filer can point at: any record kind, or the whole panel. */
export const CORRECTION_KINDS: readonly string[] = [...RECORD_KINDS, 'panel'];

export type CorrectionResolution = 'repulled_unchanged' | 'repulled_updated' | 'source_mismatch_noted';
export const CORRECTION_RESOLUTIONS: readonly CorrectionResolution[] = ['repulled_unchanged', 'repulled_updated', 'source_mismatch_noted'];

export const CLAIM_MIN = 20;
export const CLAIM_MAX = 1000;

export function validateCorrectionBody(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const { buildingId, recordKind, claim, contactEmail } = body;

  if (!buildingId || typeof buildingId !== 'string' || !buildingId.trim()) {
    errors.push({ field: 'buildingId', message: 'Building is required.' });
  }
  if (typeof recordKind !== 'string' || !CORRECTION_KINDS.includes(recordKind)) {
    errors.push({ field: 'recordKind', message: 'Choose which record is wrong.' });
  }
  if (typeof claim !== 'string' || claim.trim().length < CLAIM_MIN) {
    errors.push({ field: 'claim', message: `Tell us what is wrong in at least ${CLAIM_MIN} characters.` });
  } else if (claim.length > CLAIM_MAX) {
    errors.push({ field: 'claim', message: `Keep it under ${CLAIM_MAX} characters.` });
  }
  if (contactEmail !== undefined && contactEmail !== null && contactEmail !== '') {
    if (typeof contactEmail !== 'string' || !isValidEmail(contactEmail.trim())) {
      errors.push({ field: 'contactEmail', message: 'Email format is invalid.' });
    }
  }
  return errors;
}

export interface RecordSnapshot {
  kind: string;
  source_key: string;
  payload: string;
}
export interface RecordKey {
  kind: string;
  source_key: string;
}
export interface RecordDiff {
  added: RecordKey[];
  removed: RecordKey[];
  changed: RecordKey[];
}

const keyOf = (r: RecordKey) => `${r.kind}:${r.source_key}`;

/** Compare two snapshots of building_records rows so the admin sees what a re-pull did. */
export function diffRecordSnapshots(before: RecordSnapshot[], after: RecordSnapshot[]): RecordDiff {
  const beforeMap = new Map(before.map((r) => [keyOf(r), r]));
  const afterMap = new Map(after.map((r) => [keyOf(r), r]));
  const diff: RecordDiff = { added: [], removed: [], changed: [] };
  for (const [key, row] of afterMap) {
    const prior = beforeMap.get(key);
    if (!prior) diff.added.push({ kind: row.kind, source_key: row.source_key });
    else if (prior.payload !== row.payload) diff.changed.push({ kind: row.kind, source_key: row.source_key });
  }
  for (const [key, row] of beforeMap) {
    if (!afterMap.has(key)) diff.removed.push({ kind: row.kind, source_key: row.source_key });
  }
  return diff;
}
```

- [ ] **Step 5: Write the public endpoint (disputes order: content-type, rate limit, json, Turnstile, validation, logic)**

```ts
// src/pages/api/records/corrections.ts
import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../lib/db';
import { getEnv } from '../../../lib/runtime';
import { checkRateLimit, getClientIP, buildRateLimitHeaders } from '../../../lib/rateLimit';
import { verifyTurnstile } from '../../../lib/turnstile';
import { sanitizeText } from '../../../lib/validation';
import { logError } from '../../../lib/logger';
import { validateCorrectionBody } from '../../../lib/records/corrections';

const LIMIT = 3;
const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });

/**
 * POST /api/records/corrections — "Report a record error".
 * Unauthenticated JSON POST, so it wires all three: content-type guard, rate limit, Turnstile.
 * Stores nothing about the filer except the optional email.
 */
export const POST: APIRoute = async (context: APIContext) => {
  const contentType = context.request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return json({ error: 'Unsupported Media Type' }, 415);
  }

  try {
    const db = getDB(context);
    const clientIP = getClientIP(context);
    const rateLimit = await checkRateLimit(db, clientIP, 'record_correction', LIMIT, 3600);
    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many reports. Please try again later.';
      return json({ error: message }, status, buildRateLimitHeaders(rateLimit, LIMIT));
    }

    const body = (await context.request.json()) as Record<string, unknown>;

    const turnstile = await verifyTurnstile(
      typeof body.turnstileToken === 'string' ? body.turnstileToken : '',
      getEnv(context).TURNSTILE_SECRET_KEY,
      clientIP,
    );
    if (!turnstile.success) {
      return json({ error: turnstile.error || 'Bot verification failed. Please try again.' }, 400);
    }

    const errors = validateCorrectionBody(body);
    if (errors.length > 0) {
      return json({ error: 'Validation failed', details: errors }, 400);
    }

    const buildingId = String(body.buildingId).trim();
    const building = await db.prepare('SELECT id FROM buildings WHERE id = ?').bind(buildingId).first<{ id: string }>();
    if (!building) return json({ error: 'Building not found' }, 404);

    const id = crypto.randomUUID();
    const recordKind = body.recordKind === 'panel' ? null : String(body.recordKind);
    const contactEmail = typeof body.contactEmail === 'string' && body.contactEmail.trim() ? body.contactEmail.trim().toLowerCase() : null;

    await db
      .prepare('INSERT INTO record_corrections (id, building_id, record_kind, claim, contact_email) VALUES (?, ?, ?, ?, ?)')
      .bind(id, buildingId, recordKind, sanitizeText(String(body.claim)), contactEmail)
      .run();

    return json({ data: { id } }, 201, buildRateLimitHeaders(rateLimit, LIMIT));
  } catch (error) {
    logError('record_correction_submit_failed', { endpoint: 'records/corrections', error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Failed to submit report' }, 500);
  }
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/recordsCorrections.test.ts src/lib/__tests__/recordsCorrectionsRoute.test.ts`
Expected: PASS (4 + 4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/lib/records/corrections.ts src/pages/api/records/corrections.ts src/lib/__tests__/recordsCorrections.test.ts src/lib/__tests__/recordsCorrectionsRoute.test.ts
git commit -m "feat(records): public record-correction endpoint following the disputes guard order"
```

---

### Task 15: The correction form island

**Files:**
- Modify: `src/components/records/RecordCorrectionForm.tsx` (replace the Task 13 stub)

- [ ] **Step 1: Write the component**

Turnstile handling is the explicit-render pattern already used in `DisputeForm.tsx` (polls for `window.turnstile`, renders once, removes on unmount). The `Window.turnstile` global type is declared in `DisputeForm.tsx`; TypeScript merges it across files, so do not redeclare it here.

```tsx
// src/components/records/RecordCorrectionForm.tsx
import { useEffect, useRef, useState } from 'react';

interface Props {
  buildingId: string;
}

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'assessment', label: 'Property (owner, value, year built)' },
  { value: 'permit', label: 'Building permits' },
  { value: 'violation', label: 'Violations' },
  { value: 'enforcement_ticket', label: 'Code enforcement' },
  { value: 'service_request', label: '311 requests' },
  { value: 'rentsmart', label: 'RentSmart cross-check' },
  { value: 'panel', label: 'The whole panel' },
];

export default function RecordCorrectionForm({ buildingId }: Props) {
  const [recordKind, setRecordKind] = useState('');
  const [claim, setClaim] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [referenceId, setReferenceId] = useState<string | null>(null);

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const renderWidget = () => {
      if (!turnstileRef.current || !window.turnstile || widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: '0x4AAAAAACo4KpkxsacPhM2r',
        theme: 'light',
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => setTurnstileToken(null),
      });
    };
    if (window.turnstile) {
      renderWidget();
    } else {
      const interval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(interval);
          renderWidget();
        }
      }, 100);
      return () => clearInterval(interval);
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!recordKind) errors.recordKind = 'Choose which record is wrong.';
    if (claim.trim().length < 20) errors.claim = 'Tell us what is wrong in at least 20 characters.';
    if (claim.length > 1000) errors.claim = 'Keep it under 1000 characters.';
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) errors.contactEmail = 'Please enter a valid email address.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!turnstileToken) {
      setError('Please complete the bot verification below before submitting.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/records/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildingId, recordKind, claim, contactEmail: contactEmail || undefined, turnstileToken }),
      });
      const data = (await response.json()) as { data?: { id: string }; error?: string; details?: Array<{ field: string; message: string }> };
      if (!response.ok || !data.data) {
        if (data.details) setFieldErrors(Object.fromEntries(data.details.map((d) => [d.field, d.message])));
        setError(data.error ?? 'Something went wrong. Please try again.');
        if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current);
        setTurnstileToken(null);
        return;
      }
      setReferenceId(data.data.id);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (referenceId) {
    return (
      <div className="bg-teal-50 border border-teal-200 rounded-[6px] p-4 text-sm text-teal-900">
        <p className="font-medium">Report received.</p>
        <p className="mt-1">Reference {referenceId.slice(0, 8)}. We will re-pull this record from the primary source and, if you gave an email, tell you the outcome.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-w-xl" noValidate>
      {error && <div className="bg-red-50 border border-red-200 rounded-[6px] p-3 text-sm text-red-800">{error}</div>}

      <div>
        <label htmlFor="record-kind" className="block text-sm font-medium text-gray-700">Which record?</label>
        <select id="record-kind" value={recordKind} onChange={(e) => setRecordKind(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-[4px] px-3 py-2 text-sm">
          <option value="">Choose one</option>
          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {fieldErrors.recordKind && <p className="mt-1 text-xs text-red-700">{fieldErrors.recordKind}</p>}
      </div>

      <div>
        <label htmlFor="record-claim" className="block text-sm font-medium text-gray-700">What do you believe is wrong?</label>
        <textarea id="record-claim" value={claim} onChange={(e) => setClaim(e.target.value)} rows={4} maxLength={1000} className="mt-1 w-full border border-gray-300 rounded-[4px] px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-gray-500">{claim.length}/1000</p>
        {fieldErrors.claim && <p className="mt-1 text-xs text-red-700">{fieldErrors.claim}</p>}
      </div>

      <div>
        <label htmlFor="record-email" className="block text-sm font-medium text-gray-700">Email (optional, for the outcome)</label>
        <input id="record-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-[4px] px-3 py-2 text-sm" />
        {fieldErrors.contactEmail && <p className="mt-1 text-xs text-red-700">{fieldErrors.contactEmail}</p>}
      </div>

      <div ref={turnstileRef} />

      <button type="submit" disabled={loading} className="px-4 py-2 bg-teal-700 text-white rounded-[4px] text-sm font-semibold hover:bg-teal-800 disabled:opacity-50">
        {loading ? 'Sending…' : 'Send report'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run check` — expected 0 errors. Run: `npx vitest run src/lib/__tests__/recordsPanelCopy.test.ts` — expected PASS.

Browser: on a pulled building page, submit the form with a claim under 20 characters and confirm the inline error. Turnstile cannot be exercised locally or on preview (see `AGENTS.md` traps); the full submit is verified on production after deploy.

- [ ] **Step 3: Commit**

```bash
git add src/components/records/RecordCorrectionForm.tsx
git commit -m "feat(records): public record-correction form island"
```

---

### Task 16: Admin correction endpoints (list, re-pull with diff, resolve) and the outcome email

**Files:**
- Modify: `src/lib/email.ts` (add `sendRecordCorrectionOutcomeEmail`)
- Modify: `src/lib/api-types.ts` (add `RecordCorrection`)
- Create: `src/pages/api/admin/records/corrections/index.ts`
- Create: `src/pages/api/admin/records/corrections/[id]/repull.ts`
- Create: `src/pages/api/admin/records/corrections/[id].ts`
- Test: `src/lib/__tests__/recordsCorrectionAdminRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/recordsCorrectionAdminRoutes.test.ts
import type { APIContext } from 'astro';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import permitsPositive from './helpers/records/permits-positive.json';

const sendOutcome = vi.fn(async () => ({ success: true }));
vi.mock('../email', () => ({ sendRecordCorrectionOutcomeEmail: (...args: unknown[]) => sendOutcome(...args) }));

const suite = sqliteAvailable ? describe : describe.skip;
const admin = { id: 'admin', isAdmin: true };

function ctx(db: unknown, method: string, path: string, body: unknown, user: { id: string; isAdmin: boolean } | null = admin, id?: string): APIContext {
  const url = `https://ratemyplace.org${path}`;
  return {
    params: id ? { id } : {},
    request: new Request(url, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' }, body: method === 'GET' ? undefined : JSON.stringify(body) }),
    locals: { user, runtime: { env: { DB: db, RESEND_API_KEY: 'key', SITE_URL: 'https://ratemyplace.org' } } },
    url: new URL(url),
  } as unknown as APIContext;
}

async function seedCorrection(db: ReturnType<typeof createRecordsTestDb>, email: string | null = 'filer@example.com'): Promise<string> {
  await db.prepare("INSERT INTO record_corrections (id, building_id, record_kind, claim, contact_email) VALUES ('c1', 'bldg-lanark', 'permit', 'The roof permit is missing from the list.', ?)").bind(email).run();
  return 'c1';
}

suite('admin record corrections', () => {
  beforeEach(() => sendOutcome.mockClear());

  it('GET lists pending corrections with building address and slug, admin only', async () => {
    const { GET } = await import('../../pages/api/admin/records/corrections/index');
    const db = createRecordsTestDb();
    await insertBuilding(db);
    await seedCorrection(db);
    expect((await GET(ctx(db, 'GET', '/api/admin/records/corrections', null, { id: 'u', isAdmin: false }))).status).toBe(403);
    const response = await GET(ctx(db, 'GET', '/api/admin/records/corrections?status=pending', null));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string; building_address: string; building_slug: string; status: string; contact_email: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 'c1', building_address: '23-27 Lanark Rd, Boston, MA 02135', building_slug: 'bldg-lanark', status: 'pending' });
  });

  it('POST repull re-pulls with the correction id and returns a diff', async () => {
    vi.stubGlobal('fetch', fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }, { resourceId: PERMITS_RESOURCE_ID, records: permitsPositive }]));
    try {
      const { POST } = await import('../../pages/api/admin/records/corrections/[id]/repull');
      const db = createRecordsTestDb();
      await insertBuilding(db, { parcel_id: '2102098000' });
      await seedCorrection(db);
      const response = await POST(ctx(db, 'POST', '/api/admin/records/corrections/c1/repull', {}, admin, 'c1'));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { summary: { sources: unknown[] }; diff: { added: unknown[]; removed: unknown[]; changed: unknown[] } } };
      expect(body.data.summary.sources).toHaveLength(11);
      expect(body.data.diff.added.length).toBe(3); // FY2026 assessment + 2 permits
      const stamped = await db.prepare("SELECT COUNT(*) AS n FROM record_pulls WHERE correction_id = 'c1'").first<{ n: number }>();
      expect(stamped?.n).toBe(11);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('PATCH resolves, requires notes for a source mismatch, audits, emails, and refuses a second resolution', async () => {
    const { PATCH } = await import('../../pages/api/admin/records/corrections/[id]');
    const db = createRecordsTestDb();
    await insertBuilding(db);
    await seedCorrection(db);

    expect((await PATCH(ctx(db, 'PATCH', '/api/admin/records/corrections/c1', { resolution: 'source_mismatch_noted' }, admin, 'c1'))).status).toBe(400);
    expect((await PATCH(ctx(db, 'PATCH', '/api/admin/records/corrections/c1', { resolution: 'edit_it' }, admin, 'c1'))).status).toBe(400);

    const ok = await PATCH(ctx(db, 'PATCH', '/api/admin/records/corrections/c1', { resolution: 'source_mismatch_noted', notes: 'The city record lags the permit office.' }, admin, 'c1'));
    expect(ok.status).toBe(200);
    const row = await db.prepare('SELECT status, resolution, resolution_notes, resolved_by FROM record_corrections WHERE id = ?').bind('c1').first();
    expect(row).toEqual({ status: 'resolved', resolution: 'source_mismatch_noted', resolution_notes: 'The city record lags the permit office.', resolved_by: 'admin' });
    const audit = await db.prepare('SELECT action_type, entity_type, entity_id, notes FROM audit_logs').first<{ action_type: string; entity_type: string; entity_id: string; notes: string }>();
    expect(audit).toMatchObject({ action_type: 'record_correction_resolved', entity_type: 'building', entity_id: 'bldg-lanark' });
    expect(audit?.notes).toContain('c1');
    expect(sendOutcome).toHaveBeenCalledTimes(1);
    expect(sendOutcome.mock.calls[0][1]).toBe('filer@example.com');

    expect((await PATCH(ctx(db, 'PATCH', '/api/admin/records/corrections/c1', { resolution: 'repulled_unchanged' }, admin, 'c1'))).status).toBe(409);
  });

  it('PATCH sends no email when the filer gave none', async () => {
    const { PATCH } = await import('../../pages/api/admin/records/corrections/[id]');
    const db = createRecordsTestDb();
    await insertBuilding(db);
    await seedCorrection(db, null);
    expect((await PATCH(ctx(db, 'PATCH', '/api/admin/records/corrections/c1', { resolution: 'repulled_unchanged' }, admin, 'c1'))).status).toBe(200);
    expect(sendOutcome).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/recordsCorrectionAdminRoutes.test.ts`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Add the email template**

Append to `src/lib/email.ts` (after `sendReviewRejectedEmail`; reuses the module's local `escapeHtml` and `EmailResult`):

```ts
export type RecordCorrectionOutcome = 'repulled_unchanged' | 'repulled_updated' | 'source_mismatch_noted';

const RECORD_CORRECTION_COPY: Record<RecordCorrectionOutcome, { subject: string; lede: string }> = {
  repulled_unchanged: {
    subject: 'We re-checked the public record you reported',
    lede: 'We pulled the record again from the city\'s primary source. It still shows what our page shows, so nothing changed.',
  },
  repulled_updated: {
    subject: 'The public record you reported has been updated',
    lede: 'We pulled the record again from the city\'s primary source. The source had changed, and the page now reflects it.',
  },
  source_mismatch_noted: {
    subject: 'We noted a mismatch in the public record you reported',
    lede: 'We pulled the record again. The city\'s own data still disagrees with what you told us, so we have added a dated note to that section rather than editing the record by hand.',
  },
};

/**
 * Outcome of a "report a record error" submission. Sent only when the filer gave an email.
 * General terms only: no claim text is echoed back and no admin name appears.
 */
export async function sendRecordCorrectionOutcomeEmail(
  apiKey: string,
  toEmail: string,
  buildingAddress: string,
  buildingUrl: string,
  outcome: RecordCorrectionOutcome,
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }
  const resend = new Resend(apiKey);
  const copy = RECORD_CORRECTION_COPY[outcome];
  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: copy.subject,
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">${escapeHtml(copy.subject)}</h2>
  <p>You reported a public record for <strong>${escapeHtml(buildingAddress)}</strong>.</p>
  <p>${escapeHtml(copy.lede)}</p>
  <p><a href="${buildingUrl}" style="color: #0d9488;">View the building page</a></p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
  <p style="color: #999; font-size: 12px;">Sent automatically. Reach us via <a href="https://ratemyplace.org/contact" style="color: #0d9488;">ratemyplace.org/contact</a>.</p>
</body>
</html>
      `,
    });
    if (error) {
      console.error('Resend error:', error);
      return { success: false, error: error.message };
    }
    return { success: true, messageId: data?.id };
  } catch (err) {
    console.error('Email send exception:', err);
    return { success: false, error: 'Failed to send email' };
  }
}
```

- [ ] **Step 4: Add the API type**

Append to `src/lib/api-types.ts`:

```ts
// =============================================================================
// Public Records — Correction Types
// =============================================================================

export interface RecordCorrection {
  id: string;
  building_id: string;
  record_kind: string | null;
  claim: string;
  contact_email: string | null;
  status: 'pending' | 'resolved';
  resolution: 'repulled_unchanged' | 'repulled_updated' | 'source_mismatch_noted' | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
  // Joined from buildings
  building_address: string;
  building_slug: string;
}
```

- [ ] **Step 5: Write the list endpoint**

```ts
// src/pages/api/admin/records/corrections/index.ts
import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import type { RecordCorrection } from '../../../../../lib/api-types';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** GET /api/admin/records/corrections?status=pending|resolved|all (default pending) */
export const GET: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) return json({ error: 'Admin access required' }, 403);
  const status = context.url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'resolved', 'all'].includes(status)) return json({ error: 'Invalid status' }, 400);
  try {
    const db = getDB(context);
    const where = status === 'all' ? '' : 'WHERE c.status = ?';
    const stmt = db.prepare(`
      SELECT c.id, c.building_id, c.record_kind, c.claim, c.contact_email, c.status, c.resolution, c.resolution_notes,
             c.resolved_by, c.resolved_at, c.created_at, b.address AS building_address, b.slug AS building_slug
      FROM record_corrections c
      JOIN buildings b ON b.id = c.building_id
      ${where}
      ORDER BY c.created_at ASC
      LIMIT 200
    `);
    const rows = await (status === 'all' ? stmt : stmt.bind(status)).all<RecordCorrection>();
    return json({ data: rows.results }, 200);
  } catch (error) {
    logError('record_corrections_list_failed', { endpoint: 'admin/records/corrections', error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Failed to load corrections' }, 500);
  }
};
```

- [ ] **Step 6: Write the re-pull endpoint**

```ts
// src/pages/api/admin/records/corrections/[id]/repull.ts
import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../../lib/db';
import { logError } from '../../../../../../lib/logger';
import { pullBuildingRecords } from '../../../../../../lib/records/pull';
import { diffRecordSnapshots, type RecordSnapshot } from '../../../../../../lib/records/corrections';
import type { BuildingRowForIdentity } from '../../../../../../lib/records/identity';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * POST /api/admin/records/corrections/:id/repull
 * The only action a correction can trigger: re-pull from the primary source, then show the diff.
 * Not itself audited; the resolution (PATCH) is, and the pull rows carry the correction id.
 */
export const POST: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) return json({ error: 'Admin access required' }, 403);
  const correctionId = context.params.id;
  if (!correctionId) return json({ error: 'Correction ID required' }, 400);
  try {
    const db = getDB(context);
    const correction = await db.prepare('SELECT building_id FROM record_corrections WHERE id = ?').bind(correctionId).first<{ building_id: string }>();
    if (!correction) return json({ error: 'Correction not found' }, 404);
    const building = await db
      .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
      .bind(correction.building_id)
      .first<BuildingRowForIdentity>();
    if (!building) return json({ error: 'Building not found' }, 404);

    const snapshotSql = 'SELECT kind, source_key, payload FROM building_records WHERE building_id = ?';
    const before = (await db.prepare(snapshotSql).bind(building.id).all<RecordSnapshot>()).results;
    const summary = await pullBuildingRecords(db, building, { triggeredBy: context.locals.user.id, correctionId });
    const after = (await db.prepare(snapshotSql).bind(building.id).all<RecordSnapshot>()).results;

    return json({ data: { summary, diff: diffRecordSnapshots(before, after) } }, 200);
  } catch (error) {
    logError('record_correction_repull_failed', { endpoint: 'admin/records/corrections/repull', correctionId, error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Failed to re-pull records' }, 500);
  }
};
```

- [ ] **Step 7: Write the resolve endpoint**

```ts
// src/pages/api/admin/records/corrections/[id].ts
import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { getEnv, fireAndForget } from '../../../../../lib/runtime';
import { createAuditLog } from '../../../../../lib/audit';
import { getClientIP } from '../../../../../lib/rateLimit';
import { logError } from '../../../../../lib/logger';
import { sendRecordCorrectionOutcomeEmail } from '../../../../../lib/email';
import { CORRECTION_RESOLUTIONS, type CorrectionResolution } from '../../../../../lib/records/corrections';
import { sanitizeText } from '../../../../../lib/validation';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface CorrectionRow { building_id: string; contact_email: string | null; status: string; building_address: string; building_slug: string }

/**
 * PATCH /api/admin/records/corrections/:id
 * Body: { resolution, notes? }. notes is required for source_mismatch_noted (it renders publicly).
 */
export const PATCH: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) return json({ error: 'Admin access required' }, 403);
  const correctionId = context.params.id;
  if (!correctionId) return json({ error: 'Correction ID required' }, 400);

  const body = (await context.request.json().catch(() => ({}))) as { resolution?: unknown; notes?: unknown };
  const resolution = body.resolution as CorrectionResolution;
  if (!CORRECTION_RESOLUTIONS.includes(resolution)) {
    return json({ error: 'Validation failed', details: [{ field: 'resolution', message: 'Choose a resolution.' }] }, 400);
  }
  const notes = typeof body.notes === 'string' ? sanitizeText(body.notes) : '';
  if (resolution === 'source_mismatch_noted' && notes.length < 10) {
    return json({ error: 'Validation failed', details: [{ field: 'notes', message: 'A source mismatch needs a public note of at least 10 characters.' }] }, 400);
  }
  if (notes.length > 1000) {
    return json({ error: 'Validation failed', details: [{ field: 'notes', message: 'Keep notes under 1000 characters.' }] }, 400);
  }

  try {
    const db = getDB(context);
    const correction = await db
      .prepare('SELECT c.building_id, c.contact_email, c.status, b.address AS building_address, b.slug AS building_slug FROM record_corrections c JOIN buildings b ON b.id = c.building_id WHERE c.id = ?')
      .bind(correctionId)
      .first<CorrectionRow>();
    if (!correction) return json({ error: 'Correction not found' }, 404);
    if (correction.status === 'resolved') return json({ error: 'Correction has already been resolved' }, 409);

    const latestPull = await db
      .prepare('SELECT id FROM record_pulls WHERE correction_id = ? ORDER BY retrieved_at DESC LIMIT 1')
      .bind(correctionId)
      .first<{ id: string }>();

    await db
      .prepare("UPDATE record_corrections SET status = 'resolved', resolution = ?, resolution_notes = ?, resolved_by = ?, resolved_at = unixepoch() WHERE id = ?")
      .bind(resolution, notes || null, context.locals.user.id, correctionId)
      .run();

    await createAuditLog(db, {
      adminUserId: context.locals.user.id,
      adminIp: getClientIP(context),
      actionType: 'record_correction_resolved',
      entityType: 'building',
      entityId: correction.building_id,
      oldValue: { status: 'pending' },
      newValue: { status: 'resolved', resolution, pullId: latestPull?.id ?? null },
      notes: `correction ${correctionId}${notes ? `: ${notes}` : ''}`,
    });

    if (correction.contact_email) {
      const env = getEnv(context);
      if (env.RESEND_API_KEY) {
        const siteUrl = env.SITE_URL || context.url.origin;
        fireAndForget(
          context,
          sendRecordCorrectionOutcomeEmail(env.RESEND_API_KEY, correction.contact_email, correction.building_address, `${siteUrl}/building/${correction.building_slug}#public-records`, resolution),
        );
      }
    }

    return json({ data: { id: correctionId, status: 'resolved', resolution } }, 200);
  } catch (error) {
    logError('record_correction_resolve_failed', { endpoint: 'admin/records/corrections', correctionId, error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Failed to resolve correction' }, 500);
  }
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/recordsCorrectionAdminRoutes.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add src/lib/email.ts src/lib/api-types.ts src/pages/api/admin/records/ src/lib/__tests__/recordsCorrectionAdminRoutes.test.ts
git commit -m "feat(records): admin correction list, re-pull with diff, audited resolve, outcome email"
```

---

### Task 17: Admin corrections queue, page, and nav entry

**Files:**
- Create: `src/components/admin/RecordCorrectionsQueue.tsx`
- Create: `src/pages/admin/records.astro`
- Modify: `src/components/admin/AdminLayout.astro` (nav item and `currentPage` union)

- [ ] **Step 1: Write the queue island**

```tsx
// src/components/admin/RecordCorrectionsQueue.tsx
import { useEffect, useState } from 'react';
import type { RecordCorrection } from '../../lib/api-types';

interface RecordKey { kind: string; source_key: string }
interface RepullResult {
  summary: { parcelId: string | null; condominium: boolean; sources: Array<{ label: string; status: string; rowCount: number; error?: string }> };
  diff: { added: RecordKey[]; removed: RecordKey[]; changed: RecordKey[] };
}

const RESOLUTIONS: Array<{ value: string; label: string; needsNotes: boolean }> = [
  { value: 'repulled_unchanged', label: 'Re-pulled, unchanged', needsNotes: false },
  { value: 'repulled_updated', label: 'Re-pulled, updated', needsNotes: false },
  { value: 'source_mismatch_noted', label: 'Source mismatch noted (public note)', needsNotes: true },
];

const formatDate = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function RecordCorrectionsQueue() {
  const [items, setItems] = useState<RecordCorrection[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [repull, setRepull] = useState<Record<string, RepullResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [resolution, setResolution] = useState('repulled_unchanged');
  const [notes, setNotes] = useState('');

  const load = async (status: typeof statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/records/corrections?status=${status}`);
      const data = (await response.json()) as { data?: RecordCorrection[]; error?: string };
      if (!response.ok || !data.data) setError(data.error ?? 'Failed to load corrections');
      else setItems(data.data);
    } catch {
      setError('Failed to load corrections');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(statusFilter); }, [statusFilter]);

  const runRepull = async (id: string) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/admin/records/corrections/${id}/repull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = (await response.json()) as { data?: RepullResult; error?: string };
      if (!response.ok || !data.data) alert(data.error ?? 'Re-pull failed');
      else setRepull((prev) => ({ ...prev, [id]: data.data! }));
    } catch {
      alert('Re-pull failed');
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (id: string) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/admin/records/corrections/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution, notes }) });
      const data = (await response.json()) as { error?: string; details?: Array<{ message: string }> };
      if (!response.ok) {
        alert(data.details?.[0]?.message ?? data.error ?? 'Failed to resolve');
        return;
      }
      setExpanded(null);
      setNotes('');
      await load(statusFilter);
    } catch {
      alert('Failed to resolve');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-sm text-red-800">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-sm">
        {(['pending', 'resolved', 'all'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatusFilter(s)} className={`px-3 py-1 rounded-[4px] border ${statusFilter === s ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-gray-700 border-gray-300'}`}>
            {s}
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="text-sm text-gray-500">No corrections.</p>}

      {items.map((c) => {
        const isOpen = expanded === c.id;
        const result = repull[c.id];
        const needsNotes = RESOLUTIONS.find((r) => r.value === resolution)?.needsNotes ?? false;
        return (
          <div key={c.id} className="bg-white rounded-[6px] border border-gray-200 p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <a href={`/building/${c.building_slug}#public-records`} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-700 hover:underline">{c.building_address}</a>
                <p className="text-xs text-gray-500">{c.record_kind ?? 'whole panel'} · filed {formatDate(c.created_at)} · {c.status}{c.resolution ? ` (${c.resolution})` : ''}</p>
              </div>
              {c.status === 'pending' && (
                <button type="button" onClick={() => setExpanded(isOpen ? null : c.id)} className="text-sm text-teal-700 hover:underline">{isOpen ? 'Close' : 'Open'}</button>
              )}
            </div>
            <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{c.claim}</p>
            {c.resolution_notes && <p className="mt-1 text-xs text-gray-600">Note: {c.resolution_notes}</p>}

            {isOpen && (
              <div className="mt-4 border-t border-gray-200 pt-4 space-y-3">
                <button type="button" onClick={() => runRepull(c.id)} disabled={busy === c.id} className="px-3 py-1 bg-teal-700 text-white rounded-[4px] text-xs font-semibold hover:bg-teal-800 disabled:opacity-50">
                  {busy === c.id ? 'Re-pulling…' : 'Re-pull from source'}
                </button>
                {result && (
                  <div className="text-xs text-gray-700 space-y-1">
                    <p>Parcel: {result.summary.parcelId ?? (result.summary.condominium ? 'condominium' : 'not resolved')}</p>
                    <p>Added {result.diff.added.length}, removed {result.diff.removed.length}, changed {result.diff.changed.length}.</p>
                    {[...result.diff.added.map((k) => `+ ${k.kind} ${k.source_key}`), ...result.diff.removed.map((k) => `- ${k.kind} ${k.source_key}`), ...result.diff.changed.map((k) => `~ ${k.kind} ${k.source_key}`)].slice(0, 40).map((line) => <p key={line} className="font-mono">{line}</p>)}
                    {result.summary.sources.filter((s) => s.status === 'error').map((s) => <p key={s.label} className="text-red-700">{s.label}: {s.error}</p>)}
                  </div>
                )}
                <div className="space-y-2">
                  <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="border border-gray-300 rounded-[4px] px-2 py-1 text-sm">
                    {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={needsNotes ? 'Public note shown under the section (required)' : 'Private note (optional)'} className="w-full border border-gray-300 rounded-[4px] px-2 py-1 text-sm" />
                  <button type="button" onClick={() => resolve(c.id)} disabled={busy === c.id || !result} title={!result ? 'Re-pull first' : undefined} className="px-3 py-1 bg-gray-900 text-white rounded-[4px] text-xs font-semibold disabled:opacity-50">
                    Resolve
                  </button>
                  {!result && <p className="text-xs text-gray-500">Re-pull before resolving. The re-pull is the resolution; this form only records which outcome it produced.</p>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write the admin page**

```astro
---
// src/pages/admin/records.astro
import AdminLayout from '../../components/admin/AdminLayout.astro';
import RecordCorrectionsQueue from '../../components/admin/RecordCorrectionsQueue';

const user = Astro.locals.user;
if (!user) {
  return Astro.redirect('/auth/signin');
}
if (!user.isAdmin) {
  return Astro.redirect('/');
}
---

<AdminLayout title="Record corrections" currentPage="records">
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Record corrections</h1>
      <p class="text-gray-600 mt-1">Reports that a public record is wrong. The only resolution is a re-pull from the primary source.</p>
    </div>
    <RecordCorrectionsQueue client:load />
  </div>
</AdminLayout>
```

- [ ] **Step 3: Add the nav entry**

In `src/components/admin/AdminLayout.astro`:

Change the `currentPage` union to include `'records'`:

```ts
  currentPage: 'dashboard' | 'users' | 'reviews' | 'buildings' | 'landlords' | 'managers' | 'verify' | 'disputes' | 'records' | 'bugs' | 'contact' | 'audit';
```

Insert after the `disputes` entry in `navItems`:

```ts
  { id: 'records', label: 'Record corrections', href: '/admin/records', icon: 'document' },
```

- [ ] **Step 4: Verify**

Run: `npm run check` — expected 0 errors. Browser: `/admin/records` shows the queue with the "pending" filter; the nav highlights the new entry. Seed a correction via the public form on a building page (Turnstile will block locally; instead insert one with `npx wrangler d1 execute ratemyplace-db --local --command "INSERT INTO record_corrections (id, building_id, record_kind, claim) VALUES ('c-local', '<a building id>', 'permit', 'Local test claim for the admin queue.')"`), open it, re-pull, resolve as source mismatch with a note, then confirm the note renders on the building page under Building permits and a `record_correction_resolved` row appears in `/admin/audit`.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/RecordCorrectionsQueue.tsx src/pages/admin/records.astro src/components/admin/AdminLayout.astro
git commit -m "feat(records): admin record-corrections queue and nav entry"
```

---

### Task 18: Live fixture check script (run by hand, not CI)

**Files:**
- Create: `scripts/records-fixture-check.ts`
- Modify: `package.json` (add `records:check` script)

- [ ] **Step 1: Write the script**

```ts
// scripts/records-fixture-check.ts
/**
 * Live check of the Boston adapters against 23-27 Lanark Road (the brief's fixture).
 * Hits data.boston.gov. Not a test; run by hand before the first production pull and
 * whenever Boston changes a schema:   npm run records:check
 *
 * Exit 0 when every expectation holds, 1 otherwise. Prints each check.
 */
import { buildIdentity } from '../src/lib/records/identity';
import { resolveParcel } from '../src/lib/records/sources/boston/assessor';
import { sourcesForCity } from '../src/lib/records/jurisdictions';
import type { AssessmentPayload, EnforcementTicketPayload, RecordRow, ServiceRequestPayload } from '../src/lib/records/types';

const fetchImpl = (input: string, init?: RequestInit) => fetch(input, init);
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

async function main() {
  const identity = buildIdentity({ id: 'fixture', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null });

  const resolved = await resolveParcel(identity, fetchImpl);
  check('parcel resolves to 2102098000', resolved.parcelId === '2102098000', JSON.stringify(resolved));
  identity.parcelId = resolved.parcelId;
  identity.parcelNumeric = resolved.parcelId ? String(Number.parseInt(resolved.parcelId, 10)) : null;
  identity.condominium = resolved.condominium;

  const rows: RecordRow[] = [];
  for (const source of sourcesForCity('Boston')) {
    try {
      const result = await source.run(identity, fetchImpl);
      console.log(`      ${source.label}: ${result.rows.length} rows`);
      rows.push(...result.rows);
    } catch (err) {
      check(`${source.label} ran`, false, err instanceof Error ? err.message : String(err));
    }
  }

  const fy2026 = rows.find((r) => r.kind === 'assessment' && r.sourceKey === 'FY2026')?.payload as AssessmentPayload | undefined;
  check('FY2026 owner is Lanark Road LLC', /LANARK ROAD LLC/.test(fy2026?.owner ?? ''), fy2026?.owner ?? 'none');
  check('FY2026 mailing address PO BOX 35006', fy2026?.mailStreet === 'PO BOX 35006', fy2026?.mailStreet ?? 'none');
  check('FY2026 land use A', fy2026?.landUse === 'A');
  check('FY2026 remodel year 1980', fy2026?.yearRemodel === 1980);
  check('FY2026 total value 6,720,200', fy2026?.totalValue === 6720200, String(fy2026?.totalValue));
  check('six assessment years present', rows.filter((r) => r.kind === 'assessment').length === 6, String(rows.filter((r) => r.kind === 'assessment').length));

  check('zero permits', rows.filter((r) => r.kind === 'permit').length === 0);
  check('no ISD violations', rows.filter((r) => r.kind === 'violation').length === 0);

  const tickets = rows.filter((r) => r.kind === 'enforcement_ticket').map((r) => r.payload as EnforcementTicketPayload);
  const cases = new Set(tickets.map((t) => t.caseNumber));
  check('two enforcement cases, all 2008, contact 1505 Commonwealth', cases.size === 2 && tickets.every((t) => t.statusDate?.startsWith('2008') && /1505 COMMONWEALTH/.test(t.contactAddress ?? '')), `${cases.size} cases, ${tickets.length} line items`);

  const requests = rows.filter((r) => r.kind === 'service_request').map((r) => r.payload as ServiceRequestPayload);
  const housing = requests.filter((r) => r.classification === 'housing');
  check('311 total near 98 (brief, Sept 2026)', requests.length >= 90, `${requests.length} total`);
  check('311 housing-related near 4 (brief, Sept 2026)', housing.length >= 3 && housing.length <= 8, `${housing.length} housing`);

  check('RentSmart rows present', rows.some((r) => r.kind === 'rentsmart'));

  console.log(failures === 0 ? '\nBoston adapter reproduces the Lanark fixture.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, after `"ops:metrics"`, add:

```json
    "records:check": "npx tsx scripts/records-fixture-check.ts"
```

- [ ] **Step 3: Run it once**

Run: `npm run records:check`
Expected: every line `PASS` and the final sentence. If a check fails, the live dataset has moved; investigate before pulling in production. The 311 counts are tolerances because the city adds cases daily.

- [ ] **Step 4: Commit**

```bash
git add scripts/records-fixture-check.ts package.json
git commit -m "chore(records): live Lanark fixture check script"
```

---

### Task 19: Documentation that must ship in the same release

The code and the docs are not allowed to disagree (`AGENTS.md` non-negotiable 3 and the ops rules). Every edit below is text; no tests.

**Files:**
- Modify: `MASTER.md`
- Modify: `src/pages/privacy.astro`
- Modify: `src/pages/methodology.astro`
- Modify: `ops/growth/STRATEGY.md`
- Modify: `AGENTS.md`
- Modify: `migrations/AGENTS.md`
- Modify: `.planning/ROADMAP.md`
- Create: `.planning/milestones/v1.7.0-ROADMAP.md`

- [ ] **Step 1: MASTER.md**

Insert immediately before the line `## 6. Verification system`:

```markdown
### Public building records

**Built today (v1.7.0, sub-project A):**
- Boston building pages carry a "Public records" panel, server-rendered from records pulled from City of Boston open data: property assessment (current fiscal year plus five prior), approved building permits, ISD building and property violations, Public Works code enforcement, 311 service requests (2011 to present, legacy and new systems), and RentSmart as a cross-check.
- Every value is a field from a primary record or a count of such records. No ratio, comparison, grade, color, or inference is rendered. Records are not part of any score.
- Each section shows the date it was pulled and links to the dataset page. Provenance (source, exact query, timestamp, status) is stored per pull in `record_pulls`.
- Pulls are admin-triggered. Nothing is fetched on a public page view.
- Owner of record and, when the owner is an entity, the tax mailing address are shown. An individual's mailing address is never shown. Condominium buildings show no owner.
- Anyone can file "Report a record error". The only resolution is a re-pull from the primary source; when the city's data is itself wrong, a dated note is added under the section. Values are never edited by hand. Resolutions are audited.

**Planned:**
- Sub-project C: assessor-seeded pages for every whole-building residential parcel in Boston, with a scheduled refresh Worker.
- Sub-project B: Massachusetts CorpWeb entity records (LLC managers, resident agent, status) with a manual-verification flag.
- Sub-project D: a saved-query peer group and one derived indicator, published on `/methodology` before it renders.

Design: `docs/superpowers/specs/2026-09-06-building-records-design.md`.

```

- [ ] **Step 2: Privacy page**

In `src/pages/privacy.astro`, insert a new section immediately before the `<h2 ...>Your Rights</h2>` block, matching the surrounding markup (a `<section>` or `<div>` wrapper identical to the neighbouring sections):

```html
        <h2 class="text-xl font-semibold text-gray-900 mb-3">Public Records</h2>
        <p class="text-gray-700 mb-2">
          Building pages may show public records from the City of Boston and the Commonwealth of Massachusetts: property assessment, building permits, violations, code enforcement, and 311 requests. These are government records shown as recorded, with the date we retrieved them and a link to the source. They are not reviews and are not part of any score.
        </p>
        <p class="text-gray-700 mb-2">
          We show the owner of record as the city publishes it. When the owner is an individual rather than a company or trust, we do not show their mailing address.
        </p>
        <p class="text-gray-700 mb-4">
          If you report a record error, we store your description of the error and, only if you give one, your email address so we can tell you the outcome. Nothing else about you is kept.
        </p>
```

- [ ] **Step 3: Methodology page**

In `src/pages/methodology.astro`, insert immediately before the `<h2 ...>References</h2>` block, inside the same section wrapper pattern used by its neighbours:

```html
      <h2 class="text-2xl font-semibold text-gray-900 mb-4">Public records are not scored</h2>
      <p class="text-gray-700 mb-6">
        Boston building pages also show public records: assessment, permits, violations, code enforcement, and 311 requests, each dated and linked to its source. None of that data enters any score on this site. Reviews are the judgment layer; the records panel has no opinion.
      </p>
```

- [ ] **Step 4: Growth strategy decision log**

Append to the end of `ops/growth/STRATEGY.md`, and update its `Last reviewed:` line to `2026-09-06`:

```markdown

## Decision log

**2026-09-06: Public records invert the reader-first rule, deliberately.** This document
said not to spend on reader acquisition until review coverage supported it, because an
empty building page sends a reader away. The building-records milestone (v1.7.0, spec in
`docs/superpowers/specs/2026-09-06-building-records-design.md`) changes the premise: a
building page with zero reviews still shows the owner of record, permit history,
violations, and housing complaints. That is useful at zero reviews, and the person reading
it is usually the person who lives there. Sub-project A ships the panel for buildings
already on the site. Sub-project C seeds every whole-building residential parcel in Boston
and is the point at which reader acquisition becomes worth spending on. Until C ships, the
rule above still holds.
```

- [ ] **Step 5: Root AGENTS.md traps**

Append to the `## Traps` bullet list (after the Google OAuth bullet):

```markdown
- **Boston parcel ids drop their leading zero in some datasets.** `buildings.parcel_id`
  stores the 10-digit form; permits `parcel_id` is numeric. Query both forms. The FY2026
  assessor stores ranged addresses as `ST_NUM` plus `ST_NUM2` with mixed-case street
  names, so exact `filters` miss them; `src/lib/records/` uses the SQL endpoint with
  `upper()` for every source.
- **311 is sixteen yearly resources plus a new-system resource with a different schema.**
  The list lives in `src/lib/records/sources/boston/serviceRequests.ts`. A new year is a
  new resource id, not a schema change.
- **Public records are never fetched on a public page view.** The panel reads D1 only.
  Pulls are admin-triggered (`POST /api/admin/buildings/[id]/records/pull`) until the
  scheduled Worker in sub-project C.
```

- [ ] **Step 6: migrations/AGENTS.md**

Change the opening line to:

```markdown
Cloudflare D1 (SQLite). 30 migrations, `0001` through `0030`.
```

And add to the "Read this before running anything against production" section, after the `0027` paragraph:

```markdown
`0030` rebuilds `audit_logs` (the 0028 pattern) to add `records_pulled` and
`record_correction_resolved`. Apply `0029` and `0030` with
`wrangler d1 execute --remote --file`, back up `audit_logs` first, and verify the row
count after.
```

Add rows to the schema overview table:

```markdown
| `record_pulls`, `building_records` | Public-records provenance (one row per source run) and typed JSON records; `buildings.parcel_id` is the join key |
| `record_corrections` | "Report a record error" queue; resolution is a re-pull, never an edit |
```

- [ ] **Step 7: Planning**

In `.planning/ROADMAP.md`, under `## Milestones`, add after the v1.6.0 line:

```markdown
- 📝 **v1.7.0 Public Record** — Phases 31-34 (A records foundation, C Boston coverage, B entity record, D neighborhood indicator); spec approved 2026-09-06; A in implementation
```

Create `.planning/milestones/v1.7.0-ROADMAP.md`:

```markdown
# v1.7.0 "Public Record" Roadmap

**Created:** 2026-09-06
**Design:** `docs/superpowers/specs/2026-09-06-building-records-design.md`
**Plan (A):** `docs/superpowers/plans/2026-09-06-building-records.md`

Building pages gain a cited, dated public-records panel. Reviews remain the judgment
layer; the panel has no opinion.

| Phase | Sub-project | Status |
|---|---|---|
| 31 | A. Records foundation: parcel id, provenance, grade A Boston adapters, admin pull, panel, correction path | In implementation |
| 32 | C. Boston coverage: assessor seed of whole-building residential parcels, tiered enrichment, scheduled refresh Worker, sitemap tie-in | Needs spec |
| 33 | B. Entity record: CorpWeb scraper with manual-verification flag, manager names, same-mailing-address list | Needs spec |
| 34 | D. Neighborhood indicator: saved-query peer group, zero-permit peer count, one published indicator | Needs spec; gated on a processed correction |

Relationship to v1.6.0: independent of Phases 22 to 28. Phase 29 (sitemap) and Phase 30
(density pilot) both strengthen once Phase 32 lands.
```

- [ ] **Step 8: Commit**

```bash
git add MASTER.md src/pages/privacy.astro src/pages/methodology.astro ops/growth/STRATEGY.md AGENTS.md migrations/AGENTS.md .planning/ROADMAP.md .planning/milestones/v1.7.0-ROADMAP.md
git commit -m "docs: public records in MASTER, privacy, methodology, strategy, traps, planning"
```

---

### Task 20: Final verification and production rollout

- [ ] **Step 1: Full local gate**

```bash
npm run check && npm test && npm run build
```

Expected: 0 type errors; all suites green (389 existing plus the new records suites); build clean.

- [ ] **Step 2: Pre-deploy QA**

Run `/qa`. Walk: a pulled Boston building (panel present, every section has "as of" and Source), an unpulled building (no panel), a condominium building after a pull (Property shows the condominium sentence and no owner), a building whose owner is an individual (no mailing address line), the correction form validation, `/admin/records`, `/admin/audit`. Check 375, 768, and 1280 px. Confirm nothing in the panel uses a score color.

- [ ] **Step 3: Open the pull request**

Push `feat/building-records` and open a PR to `main` titled `feat: public building records (v1.7.0 sub-project A)`. The description links the spec and plan and lists the two migrations that must be applied by hand before merge. Do not merge without the owner's click; `main` auto-deploys.

- [ ] **Step 4: Apply migrations to production (owner action, gated)**

Per `migrations/AGENTS.md`: back up `audit_logs`, then

```bash
npx wrangler d1 execute ratemyplace-db --remote --file migrations/0029_building_records.sql
npx wrangler d1 execute ratemyplace-db --remote --file migrations/0030_audit_records_actions.sql
```

Verify `audit_logs` row count unchanged and `PRAGMA table_info(buildings)` shows `parcel_id` and `sam_id`. Record in `migrations/AGENTS.md` that 0029 and 0030 were applied out of band, with the date.

- [ ] **Step 5: Merge, then pull Lanark first**

After deploy: `npm run records:check` against live data, then in `/admin/buildings` pull the Lanark building and compare the panel to the brief's section 6 by eye. Then pull the remaining Boston buildings one at a time from the admin table. Submit one real "Report a record error" on production to exercise Turnstile, resolve it in `/admin/records`, and confirm the outcome email arrives.

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| Schema (0029), buildings columns, three tables, kinds union | 2, 3 |
| Audit action types | 2 (0030) |
| `RecordSource` contract, 10 s timeout, 500 cap, dedupe | 3, 6, 7, 8, 9 |
| Identity: ranged numbers, hyphen form, both parcel forms, exact street | 4 |
| Condo detection, no parcel, owner-less assessment row, history skipped | 5, 10 |
| Assessment history with per-year column map; missing columns are empty | 5 |
| Permits by parcel and address forms; 311 sixteen years plus new system; published classification | 6, 8 |
| Replace scope per source; fiscal years own their own row; error keeps prior rows; pulls insert-only | 10 |
| Worker-callable boundary (no HTTP in `pull.ts`) | 10 |
| Read validation renders "record unavailable" | 11, 13 |
| Display rules (mailing-address gate, condo, banned words, no score colors, no review links, no `OVERALL_COND`) | 11, 13 |
| Panel placement, header, six sections, per-section "as of" and Source, RentSmart as cross-check | 13 |
| Admin pull endpoint with audit; per-building control; parcel override for ambiguity | 12 |
| Correction form fields and bounds; endpoint guard order; rate limit 3/hour; optional email only | 14, 15 |
| Admin queue; re-pull with diff; three resolutions; notes render only for source mismatch; audit; outcome email | 16, 17 |
| Offline Lanark fixture; live script by hand | 5 to 10, 18 |
| Docs: MASTER, privacy, methodology, strategy, traps, planning | 19 |
| Rollout order | 20 |

Type consistency checked: `BuildingRowForIdentity` (Task 4) is what the pull endpoint (12) and re-pull endpoint (16) select; `RecordsDb` (3) is satisfied by both `D1Database` and `TestD1Database` (1); `PullSummary.sources[].label` (3) is what `RecordsPullButton` (12) and the queue (17) render; `validatePayload` (11) is what `getBuildingRecords` (11) and the panel (13) rely on; `CORRECTION_RESOLUTIONS` (14) is what the PATCH route (16) validates and the email type (16) mirrors.

