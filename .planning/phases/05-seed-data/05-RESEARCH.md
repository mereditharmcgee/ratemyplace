# Phase 5: Seed Data - Research

**Researched:** 2026-02-27
**Domain:** Cloudflare D1 (local SQLite via wrangler), TypeScript scripting with tsx, PBKDF2-SHA256 password hashing, scoring.ts aggregation logic
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- TypeScript script at `scripts/db-seed.ts`, run via `npx tsx` (matches Phase 4 pattern)
- npm scripts: `db:seed` and `db:setup` (`db:fresh` + `db:seed`)
- `db:seed` fails with a clear error if data already exists — forces user to run `db:fresh` first (no silent appending or auto-wiping)
- Seed data is fully deterministic — same buildings, reviews, scores every run (E2E tests can assert on specific values)
- Use actual `scoring.ts` logic (importable TypeScript, not re-implemented) to compute `building_scores` and `landlord_scores` rows
- After seeding, verify scores by re-computing from seeded reviews and comparing against stored values
- Exit code 1 if score verification fails
- Review scores follow a realistic bell curve (most 2.5–3.5, few outliers at 1 and 5)
- At least one building has 20+ reviews; at least one has 0 reviews
- All test users share password `TestPassword123!`
- Passwords stored as PBKDF2-SHA256 hashes (via project's `hashPassword()` function, NOT bcrypt — IMPORTANT: the ROADMAP/success criteria says "bcrypt" but the actual auth system uses PBKDF2-SHA256)
- Use real Boston neighborhoods and plausible addresses (Allston, Back Bay, Dorchester, etc.)
- Review text should be realistic varied-length paragraphs

### Claude's Discretion

- Landlord name mix (company names vs individual names)
- Test user email format and exact role assignments
- Whether test users have pre-loaded review activity
- Console output style (match Phase 4 or simpler summary)
- Exact data volume increase above minimum criteria (30 buildings, 10 landlords, 100+ reviews, 10 disputes)
- Script structure (single file or split into data definitions + insertion logic)

</user_constraints>

<research_summary>
## Summary

Phase 5 delivers `scripts/db-seed.ts` — a TypeScript seeding script that populates local D1 with realistic Boston rental data. The script is a pure Node.js CLI tool (like Phase 4 scripts) that executes all inserts via the wrangler CLI, then uses the importable `scoring.ts` logic to compute and verify aggregate score rows.

**Critical finding on password hashing:** The ROADMAP success criterion says "bcrypt password hashes" but the project does NOT use bcrypt. The actual production auth system (`src/lib/password.ts`) uses PBKDF2-SHA256 via Web Crypto API with the `hashPassword()` function. This function is importable in a tsx script because it uses `globalThis.crypto` (available in Node.js 18+). Pre-computing hashes at script authoring time and hardcoding the hash strings is simpler and avoids any Web Crypto environment issues — but calling `hashPassword('TestPassword123!')` directly in the seed script is also viable since Node.js 18+ ships global Web Crypto.

**Key architectural insight:** All data insertions must go through `wrangler d1 execute --local --command` (the established Phase 4 pattern). The seed script cannot use Cloudflare Worker runtime bindings (no `env.DB`) — it shells out to wrangler like `db-reset.ts` and `db-migrate.ts` do.

**Scoring approach:** `calculateAggregatedScores()` and `calculateBuildingAverages()` in `src/lib/scoring.ts` are pure TypeScript functions with no runtime dependencies. They can be imported directly in `db-seed.ts` using `import { calculateBuildingAverages, calculateLandlordAverages } from '../src/lib/scoring'`. The seed script computes scores from the seeded reviews in-memory, then inserts rows into `building_scores` and `landlord_scores`. Verification re-queries the database and re-computes to confirm stored values match.

**Insert strategy:** For 100+ reviews across 30 buildings, individual `--command` calls per row are the safest approach (proven pattern from Phase 4). Each INSERT is a separate wrangler call. Total runtime will be approximately 2–4 minutes for ~160 inserts (acceptable for a developer one-time setup).

**Determinism:** All IDs and data are hardcoded as constants in the script — no random generation. This is the critical requirement for E2E test assertability. The seed script is a static data file, not a generator.
</research_summary>

<standard_stack>
## Standard Stack

This phase introduces no new npm dependencies. Everything uses what is already installed.

### Core (already in project)
| Tool | Version | Purpose |
|------|---------|---------|
| tsx | 4.21.0 | Run TypeScript scripts directly |
| wrangler | 4.50.0 | D1 database CLI — the only interface for local D1 |
| node `child_process` | built-in | Shell out to wrangler via execSync |
| `src/lib/scoring.ts` | project | Import `calculateBuildingAverages`, `calculateLandlordAverages`, `calculateAggregatedScores` directly |
| `src/lib/password.ts` | project | Import `hashPassword` for PBKDF2-SHA256 password generation |

### Critical: Password Hashing Reality

The ROADMAP success criterion uses the word "bcrypt" but the project **does not use bcrypt**. The actual hashing function is in `src/lib/password.ts`:
- Algorithm: PBKDF2-SHA256 with 100,000 iterations
- Salt: 16 random bytes
- Output format: `base64(salt)$base64(hash)` (two base64 segments separated by `$`)
- API: `await hashPassword('TestPassword123!')` returns a string in that format

`hashPassword` uses `crypto.subtle` (Web Crypto API), which is available globally in Node.js 18+ (`globalThis.crypto`). tsx runs on Node.js 18+, so the import works directly. However, because the output is non-deterministic (random salt), the hash must be **computed once at script authoring time and hardcoded** to maintain seed determinism.

**Practical approach for determinism:** Call `hashPassword` once offline, capture the output, hardcode it in the script. The hash verifies correctly against `TestPassword123!` when `verifyPassword` is called. This is how it works in the E2E fixture (Phase 6 will call the signin API, which calls `verifyPassword` internally).

**Alternative:** If determinism of the hash itself matters less than code simplicity, compute it fresh each run — the test users' IDs, emails, and capabilities are deterministic; the hash just needs to verify correctly for the fixed password. E2E tests sign in through the UI form, not by reading the hash. So computing fresh is acceptable.

### No New Installs Needed
All tooling is already in devDependencies.
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended File Structure
```
scripts/
├── db-reset.ts          # Phase 4: drops all tables
├── db-migrate.ts        # Phase 4: applies migrations
├── db-fresh.ts          # Phase 4: reset + migrate + verify
└── db-seed.ts           # Phase 5: inserts all seed data + score computation
```

No additional files needed. The seed script is self-contained — data definitions and insertion logic in one file. The file will be long (~400-600 lines) but organized into clearly separated sections (data constants, insert helpers, score computation, verification).

### Pattern 1: Guard Check — Fail if Data Already Exists
**What:** Before inserting anything, check if data already exists and fail with a clear message.
**When:** First thing `db:seed` does.

```typescript
function checkEmpty(): void {
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "SELECT COUNT(*) as count FROM users" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const count = JSON.parse(raw)[0].results[0].count as number;
  if (count > 0) {
    console.error(`\n  ${RED}✗ Database already contains data (${count} users found).${RESET}`);
    console.error(`  ${RED}  Run \`npm run db:fresh\` first to reset.${RESET}\n`);
    process.exit(1);
  }
}
```

### Pattern 2: Individual --command Inserts (established Phase 4 pattern)
**What:** Each row is inserted via a separate `execSync` call with `--command`.
**Why:** The `--file` approach has known wrangler 4.x FK validation bugs. `--command` is reliable.

```typescript
function insert(sql: string): void {
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}
```

**Important:** For text content with quotes (review text, landlord names), use single quotes inside the SQL string and ensure the string does not contain single quotes (apostrophes). Alternative: escape single quotes with `''` in SQL. This must be handled in data definitions — no apostrophes in review text strings, or escape them.

**Better approach for complex text:** Write all INSERT statements to a temp SQL file and use `--file`. This avoids shell escaping issues with review text. The FK validation bug only affects DROP TABLE statements, not INSERT statements — `--file` is safe for inserts.

```typescript
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function batchInsert(statements: string[]): void {
  const sql = statements.join(';\n') + ';';
  const tmp = join(tmpdir(), `seed-batch-${Date.now()}.sql`);
  writeFileSync(tmp, sql, 'utf8');
  try {
    execSync(
      `npx wrangler d1 execute ratemyplace-db --local --file "${tmp}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } finally {
    unlinkSync(tmp);
  }
}
```

**Recommendation:** Use `--file` for all INSERT batches. This avoids shell escaping completely. The FK bug does not apply to INSERT statements.

### Pattern 3: Data Constants as Static Objects
**What:** All seed data defined as TypeScript constant arrays at top of script.
**Why:** Determinism — same data every run.

```typescript
const LANDLORDS = [
  { id: 'landlord-001', name: 'Allston Management Group LLC', slug: 'allston-management-group', ... },
  { id: 'landlord-002', name: 'Back Bay Properties Inc', slug: 'back-bay-properties', ... },
  ...
] as const;

const BUILDINGS = [
  { id: 'building-001', landlord_id: 'landlord-001', address: '123 Brighton Ave', neighborhood: 'Allston', ... },
  ...
] as const;

const USERS = [
  { id: 'user-test-001', email: 'user@test.ratemyplace.local', email_verified: 1, is_admin: 0, hashed_password: 'PRECOMPUTED_HASH' },
  { id: 'user-admin-001', email: 'admin@test.ratemyplace.local', email_verified: 1, is_admin: 1, hashed_password: 'PRECOMPUTED_HASH' },
  { id: 'user-pending-001', email: 'pending@test.ratemyplace.local', email_verified: 0, is_admin: 0, hashed_password: 'PRECOMPUTED_HASH' },
] as const;
```

### Pattern 4: Score Computation from In-Memory Review Data
**What:** After inserting all reviews, compute aggregate scores using imported `scoring.ts` functions on the in-memory review data objects.
**Why:** Guarantees consistency with production scoring logic; no risk of drift.

```typescript
import { calculateBuildingAverages, calculateLandlordAverages } from '../src/lib/scoring.js';

function computeAndInsertBuildingScores(): void {
  for (const building of BUILDINGS) {
    const buildingReviews = REVIEWS.filter(r => r.building_id === building.id);

    if (buildingReviews.length === 0) {
      // Don't insert a row for buildings with 0 reviews
      // (building_scores rows are only created when reviews exist)
      continue;
    }

    const averages = calculateBuildingAverages(buildingReviews);

    batchInsert([`
      INSERT INTO building_scores (
        building_id, review_count, avg_overall, avg_unit, avg_building, avg_landlord,
        pct_would_recommend, pct_pest_issues, pct_heat_issues, pct_water_issues, pct_deposit_issues, updated_at
      ) VALUES (
        '${building.id}', ${buildingReviews.length},
        ${averages.avg_overall ?? 'NULL'}, ${averages.avg_unit ?? 'NULL'},
        ${averages.avg_building ?? 'NULL'}, ${averages.avg_landlord ?? 'NULL'},
        ${averages.pct_would_recommend ?? 'NULL'}, ${averages.pct_pest_issues ?? 'NULL'},
        ${averages.pct_heat_issues ?? 'NULL'}, ${averages.pct_water_issues ?? 'NULL'},
        ${averages.pct_deposit_issues ?? 'NULL'}, ${Math.floor(Date.now() / 1000)}
      )
    `]);
  }
}
```

**Important schema mismatch to resolve:** The `building_scores` table schema (from migration 0001) has columns `avg_building_quality`, `avg_maintenance`, `avg_pest_control`, etc. (12 per-field averages), BUT `calculateBuildingAverages()` returns `avg_unit`, `avg_building`, `avg_landlord` (domain-level aggregates). The production building page uses both — it reads per-field columns from the table but falls back to computed domain scores from reviews. For seed data, the simplest approach is to populate the domain-level aggregates only (`avg_overall`, and the percentage columns), leaving the per-field columns null. The building page code at `src/pages/building/[slug].astro` lines 57-66 falls back to `calculateBuildingAverages(reviews)` if domain scores aren't in the table, so this is safe. Alternatively, compute per-field averages manually.

**Actual building_scores columns** (from PRAGMA table_info):
- `building_id`, `review_count`, `avg_overall`, `avg_building_quality`, `avg_maintenance`, `avg_pest_control`, `avg_safety`, `avg_noise`, `avg_landlord_responsiveness`, `avg_landlord_communication`, `avg_landlord_fairness`, `avg_lease_clarity`, `avg_deposit_handling`, `avg_rent_value`, `avg_amenities`, `pct_would_recommend`, `pct_pest_issues`, `pct_heat_issues`, `pct_water_issues`, `pct_deposit_issues`, `updated_at`

**Actual landlord_scores columns** (from PRAGMA table_info):
- `landlord_id`, `building_count`, `review_count`, `avg_overall`, `avg_landlord_responsiveness`, `avg_landlord_communication`, `avg_landlord_fairness`, `avg_lease_clarity`, `avg_deposit_handling`, `pct_would_recommend`, `pct_deposit_issues`, `updated_at`

Note: `building_scores` does NOT have domain-level `avg_unit`, `avg_building`, `avg_landlord` columns — only the legacy per-field averages. The planner must decide which columns to populate.

### Pattern 5: Score Verification by Re-query and Re-compute
**What:** After inserting scores, re-query `building_scores` from D1 and re-compute from review data, compare.
**When:** End of seed script; exit 1 on mismatch.

```typescript
function verifyScores(): boolean {
  let allMatch = true;

  for (const building of BUILDINGS) {
    const buildingReviews = REVIEWS.filter(r => r.building_id === building.id);
    if (buildingReviews.length === 0) continue;

    const raw = execSync(
      `npx wrangler d1 execute ratemyplace-db --local --command "SELECT * FROM building_scores WHERE building_id = '${building.id}'" --json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const stored = JSON.parse(raw)[0].results[0];
    const expected = calculateBuildingAverages(buildingReviews);

    // Compare avg_overall (most important)
    const storedOverall = stored?.avg_overall ?? null;
    const expectedOverall = expected.avg_overall ?? null;

    if (Math.abs((storedOverall ?? 0) - (expectedOverall ?? 0)) > 0.01) {
      console.error(`  ${RED}✗ Score mismatch for ${building.address}: stored=${storedOverall}, expected=${expectedOverall}${RESET}`);
      allMatch = false;
    }
  }

  return allMatch;
}
```

### Pattern 6: Review Status Requirement — All Reviews Must Be 'approved'
**What:** All seeded reviews must have `status = 'approved'` so they appear in building pages and E2E tests.
**Why:** The building page query filters `WHERE r.status = 'approved'`. Pending reviews won't show up.

```typescript
// All REVIEWS objects must have:
status: 'approved'
```

### Pattern 7: db:setup = db:fresh + db:seed in package.json
```json
"db:setup": "npm run db:fresh && npm run db:seed"
```

This is the simplest implementation — chain two npm scripts. The `&&` ensures `db:setup` fails if `db:fresh` fails.

### Pattern 8: Insertion Order (FK Dependencies)
Insert in this order to avoid FK violations:
1. `users` (no FK dependencies)
2. `landlords` (no FK dependencies)
3. `buildings` (FK: landlord_id → landlords.id)
4. `reviews` (FK: user_id → users.id, building_id → buildings.id)
5. `disputes` (FK: review_id → reviews.id)
6. `building_scores` (FK: building_id → buildings.id)
7. `landlord_scores` (FK: landlord_id → landlords.id)

</architecture_patterns>

<data_design>
## Data Design

### Complete Schema Reference for Seeded Tables

**users** (10 columns):
- `id TEXT` (primary key — use readable IDs like `'user-test-001'` for determinism)
- `email TEXT UNIQUE NOT NULL`
- `email_verified INTEGER NOT NULL DEFAULT 0` (1 = verified, 0 = unverified)
- `hashed_password TEXT NOT NULL` (PBKDF2-SHA256 hash of `TestPassword123!`)
- `created_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `updated_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `google_id TEXT` (null for test users)
- `name TEXT` (optional)
- `avatar_url TEXT` (null for test users)
- `is_admin INTEGER DEFAULT 0` (1 for admin user)

**3 required test users:**
- User 1: `user@test.ratemyplace.local`, `email_verified=1`, `is_admin=0` — regular verified user
- User 2: `admin@test.ratemyplace.local`, `email_verified=1`, `is_admin=1` — admin user
- User 3: `pending@test.ratemyplace.local`, `email_verified=0`, `is_admin=0` — unverified user (third type for testing unverified-user flows)

Additional users can be added to be authors of the 100+ reviews (so reviews span multiple users, not all from one account).

**landlords** (13 columns):
- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `slug TEXT UNIQUE NOT NULL`
- `description TEXT`
- `website TEXT`
- `phone TEXT`
- `email TEXT`
- `created_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `updated_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `admin_notes TEXT` (can be null)
- `owner_entity TEXT` (can be null)
- `total_units INTEGER` (can be null)
- `verified INTEGER DEFAULT 0`

**10 required landlords.** A realistic Boston landlord mix:
- 4–5 LLC/company names (e.g., "Allston Management Group LLC", "Harbor Property Group LLC")
- 3–4 individual names (e.g., "Michael Chen", "Patricia O'Brien" — but avoid apostrophes in SQL strings, use "Patricia OBrien")
- 1–2 larger property management companies (e.g., "Urban Realty Partners")

**buildings** (22 columns after all migrations):
- `id TEXT PRIMARY KEY`
- `landlord_id TEXT REFERENCES landlords(id)` (FK — must reference a seeded landlord ID, or be null)
- `address TEXT NOT NULL`
- `slug TEXT UNIQUE NOT NULL`
- `neighborhood TEXT`
- `city TEXT` (all "Boston")
- `state TEXT` (all "MA")
- `zip_code TEXT`
- `latitude REAL`
- `longitude REAL`
- `year_built INTEGER`
- `unit_count INTEGER`
- `building_type TEXT`
- `created_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `updated_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `google_place_id TEXT` (null — optional)
- `property_manager_id TEXT` (null for simplicity)
- `admin_notes TEXT` (null)
- `public_info TEXT` (null)
- `owner_name TEXT` (null)
- `owner_entity TEXT` (null)
- `owner_website TEXT` (null)

**30 required buildings.** Spread across Boston neighborhoods: Allston (6), Back Bay (4), Dorchester (4), Jamaica Plain (4), South End (4), Fenway/Kenmore (3), Brighton (3), Roxbury (2). Each building linked to one of the 10 landlords. At least 3–5 buildings with NO landlord_id (null) to represent buildings where landlord is unknown.

**reviews** (94 columns — the full reviews table including all 27 score fields):

Key fields for seed data:
- `id TEXT PRIMARY KEY` (deterministic ID like `'review-001'`)
- `user_id TEXT NOT NULL` (references one of the seeded users)
- `building_id TEXT NOT NULL` (references one of the seeded buildings)
- `move_in_year INTEGER NOT NULL` (2018–2024 range for realism)
- `move_in_season TEXT NOT NULL` ('winter'|'spring'|'summer'|'fall')
- `move_out_year INTEGER` (null if current tenant)
- `move_out_season TEXT` (null if current tenant)
- `is_current_tenant INTEGER NOT NULL DEFAULT 0`
- `unit_type TEXT NOT NULL` ('studio'|'1br'|'2br'|'3br'|'4br+'|'house')
- `rent_amount INTEGER` (Boston range: 1400–3500 for studios to 3br)
- **27 survey score fields** (all `INTEGER CHECK BETWEEN 1 AND 5`): unit_structural, unit_plumbing, unit_electrical, unit_climate, unit_ventilation, unit_pests, unit_mold, unit_appliances, unit_layout, unit_accuracy, building_common_areas, building_security, building_exterior, building_noise_neighbors, building_noise_external, building_mail, building_laundry, building_parking, building_trash, landlord_maintenance, landlord_communication, landlord_professionalism, landlord_lease_clarity, landlord_privacy, landlord_deposit, landlord_rent_practices, landlord_non_retaliation
- `overall_score REAL` (computed from domain scores via `calculateOverallScore`)
- `status TEXT NOT NULL DEFAULT 'pending'` — **must be 'approved'** for reviews to appear in UI
- `comments TEXT` (review text — varied length, realistic)
- `would_recommend_new TEXT` ('yes' or 'no' — this is the field scoring.ts checks)
- `had_pests INTEGER DEFAULT 0` (boolean flags for issue tracking)
- `had_heat_issues INTEGER NOT NULL DEFAULT 0`
- `had_water_issues INTEGER NOT NULL DEFAULT 0`
- `had_security_deposit_issues INTEGER NOT NULL DEFAULT 0`

**100+ required reviews.** Distribution:
- 1 building with 25 reviews (to satisfy STRESS-01 requirement for 20+ reviews)
- 1 building with 0 reviews (required by success criteria)
- Remaining 28 buildings: distribute remaining reviews (approximately 75+ reviews across 28 buildings)
- Suggested volumes: one building with 25, one with 15, two with 10, four with 8, five with 6, five with 5, four with 3, four with 2, four with 1, five with 0 (leaving one explicit 0-review building)
- Total: 25+15+20+32+30+20+12+8+5 = feasible to reach 120–130 reviews for stress test headroom

**Score distribution for bell curve:**
- Most reviews (70%): all 27 scores in 2–4 range (weighted toward 3)
- Mid tier (20%): some scores at 4–5, some at 1–2
- Outliers (10%): extreme — either all 4–5 (great building) or all 1–2 (terrible building)
- At least one building's set of reviews should produce an overall score near 4.5+ (for "good" end of range)
- At least one building should produce an overall score near 2.0 or below (for "bad" end)
- At least one building should have scores spanning 1–5 individually (varied opinions within building)

**disputes** (14 columns):
- `id TEXT PRIMARY KEY`
- `review_id TEXT NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE`
- `landlord_name TEXT NOT NULL`
- `landlord_email TEXT NOT NULL`
- `landlord_phone TEXT NOT NULL`
- `dispute_reasons TEXT NOT NULL` (JSON array string, e.g. `'["inaccurate_information"]'`)
- `dispute_explanation TEXT`
- `status TEXT NOT NULL DEFAULT 'pending'` ('pending'|'resolved')
- `resolution_outcome TEXT` (null for pending disputes)
- `resolution_notes TEXT` (null for pending disputes)
- `resolved_at INTEGER` (null for pending disputes)
- `resolved_by TEXT REFERENCES users(id)` (null for pending)
- `created_at INTEGER NOT NULL DEFAULT (unixepoch())`
- `updated_at INTEGER NOT NULL DEFAULT (unixepoch())`

**10 required disputes.** Mix of pending and resolved:
- 7 with `status = 'pending'`
- 3 with `status = 'resolved'` (with `resolution_outcome` set to one of: 'uphold', 'dismiss', 'partially_valid'; `resolved_by` referencing admin user ID; `resolved_at` set to a timestamp)

Each dispute references a different `review_id` (unique constraint on `review_id`).

### Slug Generation Pattern

Slugs must be URL-safe and unique. Convention from existing buildings:
- Convert address to lowercase
- Replace spaces with hyphens
- Remove special characters
- Add numeric suffix if needed for uniqueness
- Example: "123 Brighton Ave" → "123-brighton-ave"

For deterministic slugs, hardcode them in the constant array.

### ID Generation Pattern

Production code uses `generateIdFromEntropySize(10)` from lucia — generates a 16-character alphanumeric random string. For seed data, use **hardcoded readable IDs**:
- Users: `'user-test-01'`, `'user-admin-01'`, `'user-pending-01'`, `'user-04'` through `'user-08'` (additional review authors)
- Landlords: `'landlord-01'` through `'landlord-10'`
- Buildings: `'building-01'` through `'building-30'`
- Reviews: `'review-001'` through `'review-NNN'`
- Disputes: `'dispute-01'` through `'dispute-10'`

These readable IDs make E2E tests easy to write (`expect(page).toHaveURL('/building/123-brighton-ave')`) and make debugging seed data simple.

### Unix Timestamps

All timestamps stored as Unix epoch integers (`unixepoch()` in SQLite). For seed data, use hardcoded timestamps representing spread-out dates:
- `created_at`: Use values like `1700000000` (2023-11-14) for buildings, spread reviews from `1680000000` to `1740000000` (2023-03 to 2025-02)
- `updated_at`: Same as `created_at` for seed simplicity

Node.js approach: `Math.floor(Date.now() / 1000)` for "now", or hardcode specific values.

</data_design>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Score computation | Re-implement weighted average logic | Import from `src/lib/scoring.ts` | Single source of truth; avoids drift with production |
| Password hashing | Implement PBKDF2 from scratch | Import `hashPassword` from `src/lib/password.ts` OR pre-compute hash | `password.ts` is already tested and production-correct |
| ID generation | Random UUIDs | Hardcoded readable string IDs | Determinism required; readable IDs improve E2E test debuggability |
| Slug generation | Complex slugification library | Hardcode slugs in data constants | Determinism required; no runtime generation needed |
| Batch SQL execution | Custom SQL file parser | `wrangler d1 execute --file` (for inserts) | Proven pattern; avoids shell escaping issues with text content |
| Score aggregation table update | Track scores in a separate state file | Re-compute from REVIEWS constant in-memory | Reviews are already in-memory as constants; no re-query needed for computation |

</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Review Text Contains Single Quotes (Apostrophes)
**What goes wrong:** SQL syntax error when inserting review text with apostrophes (`'s`, `don't`, etc.).
**Why it happens:** SQL strings are delimited by single quotes; an apostrophe inside breaks the string.
**How to avoid:** Two options:
  1. Write review text without apostrophes in seed data (simplest)
  2. Escape apostrophes as `''` in SQL strings
  3. Use `--file` for inserts (still must escape in SQL files)
**Warning signs:** `SQLITE_ERROR: unrecognized token` during INSERT.

### Pitfall 2: Hashing Password at Runtime Breaks Determinism
**What goes wrong:** Each run of `db:seed` produces a different `hashed_password` for test users (because PBKDF2 uses a random salt). This doesn't break functionality but means the stored hash changes every seed.
**Why it happens:** `hashPassword()` generates a new random salt each invocation.
**Impact:** Low — E2E tests sign in through the API (which calls `verifyPassword`), so the exact hash doesn't matter as long as it validates. The password is always `TestPassword123!`.
**How to avoid:** Accept non-deterministic hashes (fine for this use case), OR pre-compute hashes offline and hardcode the strings.
**Recommendation:** Pre-compute hashes offline to keep the script fully deterministic. Run once: `node -e "import('./src/lib/password.ts').then(m=>m.hashPassword('TestPassword123!')).then(console.log)"`.

### Pitfall 3: Reviews in 'pending' Status Are Invisible in UI
**What goes wrong:** Seeded reviews don't appear on building pages; stress tests and E2E tests see empty pages.
**Why it happens:** Building page queries `WHERE r.status = 'approved'`. Default status is `'pending'`.
**How to avoid:** All seed reviews must explicitly set `status = 'approved'`.
**Warning signs:** Building page shows "No reviews yet" despite reviews in database.

### Pitfall 4: building_scores Column Names Don't Match scoring.ts Return Values
**What goes wrong:** Attempting to insert `avg_unit`, `avg_building`, `avg_landlord` columns that don't exist in `building_scores`.
**Why it happens:** The `building_scores` table schema (from migration 0001) uses per-field column names like `avg_building_quality`, `avg_maintenance` etc., but `calculateBuildingAverages()` returns domain-level `avg_unit`, `avg_building`, `avg_landlord`.
**How to avoid:** Compute per-field averages manually from the review data objects, OR populate only `avg_overall` and the percentage columns (the building page falls back to real-time calculation for missing domain scores).
**The building page fallback** (lines 57-66 of `src/pages/building/[slug].astro`) means partial population of `building_scores` is fine — the page recalculates if domain scores are missing. For STRESS-04 verification though, the seed must pre-compute `avg_overall` correctly.

### Pitfall 5: FK Constraint on disputes.review_id (UNIQUE)
**What goes wrong:** Attempting to insert two disputes that reference the same `review_id` fails with UNIQUE constraint violation.
**Why it happens:** `disputes.review_id` has `UNIQUE` constraint — one dispute per review.
**How to avoid:** Each of the 10 seeded disputes must reference a different review ID.

### Pitfall 6: disputes.resolved_by References Non-Existent User
**What goes wrong:** FK violation when inserting resolved disputes with `resolved_by` = admin user ID before users are inserted.
**Why it happens:** FK `resolved_by TEXT REFERENCES users(id)` — if user doesn't exist yet, insert fails.
**How to avoid:** Insert users before disputes (already covered by insertion order: users first, disputes last).

### Pitfall 7: building_scores Row for Zero-Review Buildings
**What goes wrong:** Inserting a `building_scores` row for a building with 0 reviews creates a confusing state.
**Why it happens:** Nothing stops you from inserting a row with `review_count = 0`.
**How to avoid:** Skip `building_scores` insert for buildings with 0 reviews. The building page handles the null case (no `building_scores` row → no score displayed). This satisfies the "0 reviews" empty state requirement for STRESS-02.

### Pitfall 8: Timestamp Column Type Confusion
**What goes wrong:** Passing string dates (`'2024-01-01'`) to timestamp columns that expect Unix epoch integers.
**Why it happens:** All timestamp columns are `INTEGER NOT NULL DEFAULT (unixepoch())` — they store Unix timestamps, not ISO date strings.
**How to avoid:** Use integer Unix timestamps: `1700000000` (November 2023) etc. Or use SQLite function in the SQL: `unixepoch('2024-01-01')`.

### Pitfall 9: move_out_year_new Is TEXT, Not INTEGER
**What goes wrong:** Inserting integer year (e.g., `2023`) into `move_out_year_new TEXT` column causes type mismatch.
**Why it happens:** Migration 0004 added `move_out_year_new TEXT` — it accepts the string `'current'` or a year as text.
**How to avoid:** Insert as text: `'2023'` or `'current'`. Note: `move_out_year INTEGER` (from migration 0001) is a different column — both exist.

### Pitfall 10: Wrangler --file Path on Windows
**What goes wrong:** Temp file path with backslashes (`C:\Users\...`) fails in wrangler on Windows.
**Why it happens:** Wrangler (node/cross-platform) may not handle Windows paths correctly in all contexts.
**How to avoid:** Use `tmpdir()` from `os` module and normalize the path. Alternatively, write temp file to the project root or a known forward-slash path. From Phase 4 experience: `--command` is reliable on Windows; `--file` may need path escaping.
**Recommendation:** Test `--file` approach with a temp file first. If path issues arise, fall back to individual `--command` calls for inserts (slower but proven).

### Pitfall 11: scoring.ts Recency Weighting Affects Score Computation
**What goes wrong:** Seeded scores in `building_scores` don't match what the UI shows when it re-computes from reviews.
**Why it happens:** `calculateAggregatedScores()` applies recency weighting (`getRecencyWeight(reviewYear, currentYear)`). Reviews seeded with `move_out_year` in 2018 get 0.85 weight vs 1.0 for 2024 reviews.
**Impact:** The stored `avg_overall` reflects the recency-weighted calculation. When the page re-computes using `calculateBuildingAverages(reviews)`, it also applies recency weighting — so they should match IF the current year is the same. But because the seed runs today (2026) and the reviews have hardcoded years, both code paths use the same `new Date().getFullYear()` = 2026. They will match.
**Warning:** STRESS-04 verifies that UI scores match stored scores. If the building page re-computes live (because domain columns aren't stored), both computations use the same input and should agree. Only a mismatch could occur if the seeded `building_scores.avg_overall` was computed at a different time than when STRESS-04 runs — they're both computed against the same hardcoded data on the same day, so this is fine.

</common_pitfalls>

<code_examples>
## Code Examples

### Pre-Computing Test User Password Hash
Run this once at script authoring time, then hardcode the output:
```bash
# In the project directory
node --input-type=module << 'EOF'
import { encodeBase64 } from '@oslojs/encoding';

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

// Use a FIXED salt for determinism (seed-specific)
const salt = new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);
const encoder = new TextEncoder();
const passwordData = encoder.encode('TestPassword123!');

const passwordKey = await crypto.subtle.importKey('raw', passwordData, 'PBKDF2', false, ['deriveBits']);
const derivedBits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
  passwordKey, KEY_LENGTH * 8
);
const hashArray = new Uint8Array(derivedBits);
const result = `${encodeBase64(salt)}$${encodeBase64(hashArray)}`;
console.log(result);
EOF
```
Note: Using a fixed salt makes the hash deterministic AND verifiable by `verifyPassword`. The `verifyPassword` function extracts the salt from the stored hash string. This is correct PBKDF2 usage — the salt does not need to be random for seed data, only for production signup.

### Guard Check Pattern
```typescript
function assertDatabaseEmpty(): void {
  process.stdout.write(`  ${BOLD}Checking database is empty${RESET}... `);
  try {
    const raw = execSync(
      `npx wrangler d1 execute ratemyplace-db --local --command "SELECT COUNT(*) as count FROM users" --json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const count = (JSON.parse(raw)[0].results[0] as { count: number }).count;
    if (count > 0) {
      console.log(`${RED}✗${RESET}`);
      console.error(`\n  ${RED}Database already has data (${count} users). Run \`npm run db:fresh\` first.${RESET}\n`);
      process.exit(1);
    }
    console.log(`${GREEN}✓${RESET}`);
  } catch (err: any) {
    console.log(`${RED}✗${RESET}`);
    console.error(`\n  ${RED}Failed to check database: ${err.message}${RESET}\n`);
    process.exit(1);
  }
}
```

### Batch Insert via --file (recommended for text-heavy content)
```typescript
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function executeSqlFile(statements: string[]): void {
  const sql = statements.join(';\n') + ';\n';
  // Use forward-slash path to avoid Windows wrangler path issues
  const tmp = join(tmpdir(), `rmp-seed-${Date.now()}.sql`).replace(/\\/g, '/');
  writeFileSync(tmp, sql, 'utf8');
  try {
    execSync(
      `npx wrangler d1 execute ratemyplace-db --local --file "${tmp}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (err: any) {
    throw new Error(`SQL batch failed: ${err.stderr?.toString() || err.message}`);
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}
```

### Single-Row Insert via --command (for data without text content)
```typescript
function wranglerExec(sql: string): void {
  const escaped = sql
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${escaped}" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
}
```

### Score Computation and Insert Pattern
```typescript
import { calculateBuildingAverages, calculateLandlordAverages } from '../src/lib/scoring.js';

function insertBuildingScores(): void {
  process.stdout.write(`  ${BOLD}Computing and inserting building scores${RESET}... `);
  const inserts: string[] = [];

  for (const b of BUILDINGS) {
    const bReviews = REVIEWS.filter(r => r.building_id === b.id && r.status === 'approved');
    if (bReviews.length === 0) continue;

    const avgs = calculateBuildingAverages(bReviews);
    const now = Math.floor(Date.now() / 1000);

    inserts.push(`
      INSERT INTO building_scores (
        building_id, review_count, avg_overall,
        pct_would_recommend, pct_pest_issues, pct_heat_issues,
        pct_water_issues, pct_deposit_issues, updated_at
      ) VALUES (
        '${b.id}', ${bReviews.length}, ${avgs.avg_overall ?? 'NULL'},
        ${avgs.pct_would_recommend ?? 'NULL'}, ${avgs.pct_pest_issues ?? 'NULL'},
        ${avgs.pct_heat_issues ?? 'NULL'}, ${avgs.pct_water_issues ?? 'NULL'},
        ${avgs.pct_deposit_issues ?? 'NULL'}, ${now}
      )
    `.trim());
  }

  try {
    executeSqlFile(inserts);
    console.log(`${GREEN}✓${RESET}`);
  } catch (err: any) {
    console.log(`${RED}✗${RESET}`);
    console.error(`  ${RED}${err.message}${RESET}`);
    process.exit(1);
  }
}
```

### Review Data Object Shape (minimum required fields for scoring.ts)
```typescript
// REVIEWS constant — each entry must have these fields for calculateBuildingAverages to work:
const REVIEWS = [
  {
    id: 'review-001',
    user_id: 'user-test-01',
    building_id: 'building-01',
    status: 'approved',
    // 27 survey fields (all must be present for full score calculation):
    unit_structural: 4, unit_plumbing: 3, unit_electrical: 4, unit_climate: 3,
    unit_ventilation: 3, unit_pests: 4, unit_mold: 4, unit_appliances: 3,
    unit_layout: 4, unit_accuracy: 3,
    building_common_areas: 3, building_security: 4, building_exterior: 3,
    building_noise_neighbors: 3, building_noise_external: 2, building_mail: 4,
    building_laundry: 3, building_parking: null, building_trash: 3,
    landlord_maintenance: 3, landlord_communication: 4, landlord_professionalism: 4,
    landlord_lease_clarity: 3, landlord_privacy: 4, landlord_deposit: 3,
    landlord_rent_practices: 3, landlord_non_retaliation: 4,
    // For recency weighting in calculateAggregatedScores:
    move_out_year: 2023, // or null for current tenant
    created_at: 1700000000,
    // For pct_would_recommend:
    would_recommend_new: 'yes',
    // For issue percentage tracking:
    had_pests: 0, had_heat_issues: 0, had_water_issues: 0, had_security_deposit_issues: 0,
    // Other required fields for INSERT:
    move_in_year: 2021, move_in_season: 'fall', move_out_season: 'summer',
    is_current_tenant: 0, unit_type: '1br', rent_amount: 1800,
    overall_score: 3.4, comments: 'Good apartment overall...', move_out_year_new: '2023',
  },
  // ... more reviews
] as const; // Note: 'as const' causes issues with null values — use typed array instead
```

### script Structure Overview
```typescript
// scripts/db-seed.ts
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { calculateBuildingAverages, calculateLandlordAverages } from '../src/lib/scoring.js';

// ANSI colors (same as Phase 4 scripts)
const GREEN = '\x1b[32m'; const RED = '\x1b[31m'; const BOLD = '\x1b[1m'; const RESET = '\x1b[0m';

// ─── Seed Data Constants ────────────────────────────────────────────
const TEST_PASSWORD_HASH = 'AAECBAUGB...'; // Pre-computed PBKDF2 hash of 'TestPassword123!'
const USERS = [...];
const LANDLORDS = [...];
const BUILDINGS = [...];
const REVIEWS = [...]; // 100+ entries
const DISPUTES = [...]; // 10 entries

// ─── Helpers ───────────────────────────────────────────────────────
function assertDatabaseEmpty(): void {...}
function executeSqlFile(statements: string[]): void {...}
function run(label: string, fn: () => void): void {...} // fail-fast with ANSI output

// ─── Insert Functions ───────────────────────────────────────────────
function insertUsers(): void {...}
function insertLandlords(): void {...}
function insertBuildings(): void {...}
function insertReviews(): void {...}
function insertDisputes(): void {...}
function insertBuildingScores(): void {...}
function insertLandlordScores(): void {...}

// ─── Verification ───────────────────────────────────────────────────
function verifyScores(): boolean {...}

// ─── Main ───────────────────────────────────────────────────────────
console.log(`\n  ${BOLD}Seed local database${RESET}\n`);
assertDatabaseEmpty();
run('Insert users', insertUsers);
run('Insert landlords', insertLandlords);
run('Insert buildings', insertBuildings);
run('Insert reviews', insertReviews);
run('Insert disputes', insertDisputes);
run('Compute and insert building scores', insertBuildingScores);
run('Compute and insert landlord scores', insertLandlordScores);

const ok = verifyScores();
if (!ok) {
  console.error(`\n  ${RED}✗ Score verification failed — seed data may be incorrect${RESET}\n`);
  process.exit(1);
}

console.log(`\n  ${GREEN}✓ Seed complete — database ready${RESET}\n`);
console.log(`  Test credentials: user@test.ratemyplace.local / TestPassword123!`);
console.log(`  Admin credentials: admin@test.ratemyplace.local / TestPassword123!\n`);
process.exit(0);
```

### package.json Additions
```json
"db:seed": "npx tsx scripts/db-seed.ts",
"db:setup": "npm run db:fresh && npm run db:seed"
```

</code_examples>

<open_questions>
## Open Questions

1. **building_scores per-field columns vs domain aggregate columns**
   - What we know: `building_scores` has 12 legacy per-field columns (`avg_building_quality`, `avg_maintenance`, etc.) plus `avg_overall`. The current `calculateBuildingAverages()` returns only `avg_overall`, `avg_unit`, `avg_building`, `avg_landlord`, and percentage columns. These domain aggregates don't map to the schema columns.
   - What's unclear: Should the seed script populate all 12 per-field averages, or only `avg_overall` and percentages? The building page falls back to live calculation if domain scores are missing, so STRESS-04 score verification would still work.
   - Recommendation for planner: Populate only `avg_overall`, `review_count`, and percentage columns in `building_scores`. Leave per-field columns as NULL. The building page will use `calculateBuildingAverages(reviews)` for domain scores, and both code paths use the same logic, so STRESS-04 verification will still pass. This avoids needing to manually compute 12 per-field averages.

2. **Whether to use --file or --command for large INSERT batches**
   - What we know: `--command` is proven safe on Windows (Phase 4). `--file` avoids shell escaping for text content but had path issues on Windows in Phase 4 for DROP statements.
   - What's unclear: Whether `--file` path issues extend to INSERT batches (the FK validation bug was specific to DROP statements in multi-statement files).
   - Recommendation for planner: Use `--file` for INSERT batches but with robust temp file path handling. If `--file` fails on Windows, fallback to `--command` with apostrophe-free review text.

3. **Whether the seed script should insert reviews with non-null `created_at` values, or rely on SQLite DEFAULT**
   - What we know: `created_at INTEGER NOT NULL DEFAULT (unixepoch())` — if not specified, SQLite sets to now.
   - What's unclear: For recency weighting tests, having reviews from specific years (2019–2024) is useful. This requires explicit `created_at` values in INSERT.
   - Recommendation for planner: Always explicitly set `created_at` using hardcoded Unix timestamps. This ensures deterministic recency weighting for STRESS-04.

4. **Number of additional non-test users for review authorship**
   - What we know: 3 test users required. Reviews need `user_id` — if all 100+ reviews come from 3 users, it's unrealistic but functional.
   - What's unclear: Whether Phase 7/8 E2E tests care about review authorship distribution.
   - Recommendation for planner: Add 3–5 additional "reviewer" users (non-test, just seed authors) so reviews appear to come from multiple distinct tenants. These extra users don't need known passwords.

</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- `migrations/0001_initial.sql` through `migrations/0015_password_reset_tokens.sql` — complete schema
- `PRAGMA table_info` against live local D1 — verified actual column names and types for: users, reviews, buildings, landlords, building_scores, landlord_scores, disputes
- `src/lib/scoring.ts` — read completely; confirmed: `calculateBuildingAverages`, `calculateLandlordAverages`, `calculateAggregatedScores`, `calculateDomainScores` are all pure TypeScript importable functions
- `src/lib/password.ts` — confirmed PBKDF2-SHA256 (NOT bcrypt); `hashPassword()` uses `crypto.subtle`; output format is `base64(salt)$base64(hash)`
- `src/pages/api/auth/signup.ts` — confirmed `generateIdFromEntropySize(10)` from lucia for production IDs
- `scripts/db-reset.ts`, `scripts/db-fresh.ts` — confirmed Phase 4 patterns: `execSync`, ANSI colors, `--command` per operation, `run()` step helper
- `package.json` — confirmed `tsx` 4.21.0, `wrangler` 4.50.0 installed; existing npm scripts
- `src/pages/building/[slug].astro` lines 45–66 — confirmed building_scores query + fallback to live `calculateBuildingAverages` calculation
- `.planning/phases/04-database-foundation/04-01-SUMMARY.md` — confirmed `--file` bug with DROP TABLE; `--command` is reliable
- `.planning/phases/05-seed-data/05-CONTEXT.md` — all user decisions
- `CLAUDE.md` — project conventions

### Secondary (MEDIUM confidence)
- `src/lib/scoring.ts` `getRecencyWeight` function — understood recency weighting implications; confirmed both seed-time and runtime computations will use same year (2026)
- `src/pages/building/[slug].astro` fallback logic — understood that missing `avg_unit`/`avg_building`/`avg_landlord` columns in `building_scores` causes live recomputation, which is acceptable

### Tertiary (needs validation before assuming)
- Whether `wrangler d1 execute --file` works reliably with INSERT statements on Windows (tested --file for DROP in Phase 4 and found issues; INSERT has not been tested)
- Whether tsx/Node.js can import `../src/lib/scoring.ts` in a script (likely yes — tsx handles TypeScript imports transparently; no Worker runtime is needed since scoring.ts has no Cloudflare bindings)
- Pre-computed PBKDF2 hash must be validated by actually calling `verifyPassword` against it before hardcoding

</sources>

<metadata>
## Metadata

**Research scope:**
- Core: D1 seeding via wrangler CLI, PBKDF2 password hashing, scoring.ts import in Node.js context
- Schema: Complete review of all 15 migrations; verified live column names via PRAGMA
- Data design: Building/review distribution for success criteria and downstream phase needs
- Pitfalls: SQL injection through text, FK order, status field, score column mismatch, Windows paths

**Confidence breakdown:**
- Standard stack: HIGH — all tools confirmed installed and working
- Architecture: HIGH — Phase 4 patterns proven; only --file for inserts is unverified on Windows
- Data design: HIGH — schema fully read from live DB; scoring.ts logic fully understood
- Code examples: HIGH — derived from working Phase 4 patterns; scoring.ts function signatures confirmed
- Password hashing: HIGH — password.ts read completely; PBKDF2 confirmed; bcrypt is not used (roadmap wording is incorrect)

**Critical corrections from source documents:**
- The ROADMAP success criteria says "correct bcrypt password hashes" — this is WRONG. The project uses PBKDF2-SHA256 via `src/lib/password.ts`. The seed script must use `hashPassword()` from that module.
- `building_scores` does NOT have `avg_unit`, `avg_building`, `avg_landlord` columns — only per-field legacy averages and `avg_overall`. The planner must decide which columns to populate.

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (30 days — wrangler CLI and scoring logic are stable)
</metadata>

---

*Phase: 05-seed-data*
*Research completed: 2026-02-27*
*Ready for planning: yes*
