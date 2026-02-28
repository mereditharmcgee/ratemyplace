/**
 * Seed Data Script for RateMyPlace Boston
 *
 * Populates the local D1 database with deterministic test data:
 *   - 8 users (3 test users + 5 reviewer users)
 *   - 10 landlords (realistic Boston mix of LLC/individual names)
 *   - 30 buildings (spread across 8 Boston neighborhoods)
 *
 * All IDs, slugs, and content are hardcoded for determinism.
 * The password hash is pre-computed (PBKDF2-SHA256) so no async work is needed.
 *
 * Guard: Exits with code 1 if the database already contains data.
 *        Run `npm run db:fresh` first to start clean.
 *
 * Run: npm run db:seed
 * Run directly: npx tsx scripts/db-seed.ts
 *
 * Plan 02 will extend this script with reviews, disputes, and score computation.
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── ANSI color constants (matching Phase 4 script style) ──────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Run a SELECT query against the local D1 database and return results.
 * Uses --command --json flags (same pattern as db-fresh.ts).
 */
function wranglerQuery(sql: string): any[] {
  const escaped = sql.replace(/"/g, '\\"');
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "${escaped}" --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return JSON.parse(raw)[0].results;
}

/**
 * Write INSERT statements to a temp SQL file and execute via wrangler --file.
 * Using --file avoids shell escaping issues with text-heavy content.
 * Replaces backslashes in temp path for Windows compatibility.
 */
function executeSqlBatch(statements: string[]): void {
  const sql = statements.join(';\n') + ';\n';
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

/**
 * Step runner: prints label, runs fn, prints green check on success.
 * On failure, prints red X with error details and exits with code 1.
 * Matches the Phase 4 pattern from db-fresh.ts.
 */
function run(label: string, fn: () => void): void {
  process.stdout.write(`  ${YELLOW}…${RESET} ${label}`);
  try {
    fn();
    process.stdout.write(`\r  ${GREEN}✓${RESET} ${label}\n`);
  } catch (err: any) {
    process.stdout.write(`\r  ${RED}✗${RESET} ${label}\n`);
    console.error(`\n  ${RED}Error: ${err.message}${RESET}\n`);
    process.exit(1);
  }
}

/**
 * Guard: check if the database already has data.
 * If count > 0, exit with code 1 and tell user to run db:fresh first.
 * If the query fails (table doesn't exist), treat as empty and continue.
 */
function assertDatabaseEmpty(): void {
  try {
    const rows = wranglerQuery('SELECT COUNT(*) as count FROM users');
    const count = rows[0]?.count ?? 0;
    if (count > 0) {
      console.error(`\n  ${RED}✗ Database already has data (${count} users found).${RESET}`);
      console.error(`  ${YELLOW}Run \`npm run db:fresh\` first to reset the database, then re-run db:seed.${RESET}\n`);
      process.exit(1);
    }
  } catch (_err) {
    // Table doesn't exist (database wiped, not yet migrated) — treat as empty
    // The next step (insertUsers) will fail if migrations haven't been run
  }
}

/**
 * Escape single quotes for safe SQL string insertion.
 * Doubles single quotes: ' -> ''
 */
function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

// ─── Data Constants ────────────────────────────────────────────────────────────

/**
 * Pre-computed PBKDF2-SHA256 hash of 'TestPassword123!' with a fixed salt.
 * Salt: 'seed-data-fixed!' (bytes [115,101,101,100,45,100,97,116,97,45,102,105,120,101,100,33])
 * Parameters: 100,000 iterations, SHA-256, 32-byte key
 * Format: base64(salt)$base64(hash)
 *
 * Verified to pass verifyPassword('TestPassword123!', hash) from src/lib/password.ts.
 * Using a hardcoded hash ensures full determinism (same hash every run).
 * Do NOT call hashPassword() at runtime — it uses a random salt.
 */
const TEST_PASSWORD_HASH = 'c2VlZC1kYXRhLWZpeGVkIQ==$zPq112lY6xQgERHp7qyvo1/GPu4jFFXq6S5DOIiupXg=';

// Fixed timestamps for determinism
const CREATED_AT_DEFAULT = 1700000000; // November 2023
const UPDATED_AT_DEFAULT = 1700000000;

// ─── Users ─────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  name: string;
  email_verified: number;
  is_admin: number;
}

const USERS: User[] = [
  // 3 named test users (per success criteria)
  { id: 'user-test-01', email: 'user@test.ratemyplace.local', name: 'Test User', email_verified: 1, is_admin: 0 },
  { id: 'user-admin-01', email: 'admin@test.ratemyplace.local', name: 'Admin User', email_verified: 1, is_admin: 1 },
  { id: 'user-pending-01', email: 'pending@test.ratemyplace.local', name: 'Pending User', email_verified: 0, is_admin: 0 },
  // 5 additional reviewer users for realistic review data (Plan 02)
  { id: 'user-04', email: 'reviewer1@test.ratemyplace.local', name: 'Sarah Chen', email_verified: 1, is_admin: 0 },
  { id: 'user-05', email: 'reviewer2@test.ratemyplace.local', name: 'Marcus Williams', email_verified: 1, is_admin: 0 },
  { id: 'user-06', email: 'reviewer3@test.ratemyplace.local', name: 'Emily Rodriguez', email_verified: 1, is_admin: 0 },
  { id: 'user-07', email: 'reviewer4@test.ratemyplace.local', name: 'James OBrien', email_verified: 1, is_admin: 0 },
  { id: 'user-08', email: 'reviewer5@test.ratemyplace.local', name: 'Priya Patel', email_verified: 1, is_admin: 0 },
];

// ─── Landlords ─────────────────────────────────────────────────────────────────

interface Landlord {
  id: string;
  name: string;
  slug: string;
  description: string;
  phone?: string;
  email?: string;
  website?: string;
  verified: number;
}

const LANDLORDS: Landlord[] = [
  // 5 LLC/company names
  {
    id: 'landlord-01',
    name: 'Allston Management Group LLC',
    slug: 'allston-management-group-llc',
    description: 'Property management company specializing in Allston and Brighton rentals. Manages over 200 units across 40 buildings.',
    phone: '617-555-0101',
    email: 'info@allstonmgmt.example.com',
    website: 'https://allstonmgmt.example.com',
    verified: 1,
  },
  {
    id: 'landlord-02',
    name: 'Harbor Property Group LLC',
    slug: 'harbor-property-group-llc',
    description: 'Full-service property management serving Back Bay, South End, and Fenway neighborhoods since 1998.',
    phone: '617-555-0102',
    email: 'contact@harborproperty.example.com',
    website: 'https://harborproperty.example.com',
    verified: 1,
  },
  {
    id: 'landlord-03',
    name: 'Commonwealth Housing Partners',
    slug: 'commonwealth-housing-partners',
    description: 'Residential housing company focused on affordable and market-rate units in Jamaica Plain and Roxbury.',
    phone: '617-555-0103',
    email: 'leasing@commonwealthhousing.example.com',
    verified: 1,
  },
  {
    id: 'landlord-04',
    name: 'Dorchester Realty Associates',
    slug: 'dorchester-realty-associates',
    description: 'Family-owned real estate firm managing triple-deckers and apartment buildings throughout Dorchester.',
    phone: '617-555-0104',
    email: 'office@dorchesterrealty.example.com',
    verified: 1,
  },
  {
    id: 'landlord-05',
    name: 'Fenway Property Management',
    slug: 'fenway-property-management',
    description: 'Boutique property management company serving the Fenway-Kenmore area with a focus on student and young professional housing.',
    phone: '617-555-0105',
    email: 'info@fenwayproperty.example.com',
    website: 'https://fenwayproperty.example.com',
    verified: 1,
  },
  // 3 individual names (no apostrophes)
  {
    id: 'landlord-06',
    name: 'Michael Chen',
    slug: 'michael-chen',
    description: 'Independent landlord owning several multi-family properties in Allston and Brighton. Responsive and professional management style.',
    phone: '617-555-0106',
    verified: 1,
  },
  {
    id: 'landlord-07',
    name: 'Patricia OBrien',
    slug: 'patricia-obrien',
    description: 'Local landlord with 15 years of experience managing residential properties in South Boston and Dorchester.',
    phone: '617-555-0107',
    email: 'pobrien.rentals@example.com',
    verified: 0,
  },
  {
    id: 'landlord-08',
    name: 'Robert Sullivan',
    slug: 'robert-sullivan',
    description: 'Second-generation Boston landlord managing inherited triple-deckers in Jamaica Plain and Roxbury. Maintenance-focused approach.',
    phone: '617-555-0108',
    verified: 0,
  },
  // 2 larger property management companies
  {
    id: 'landlord-09',
    name: 'Urban Realty Partners',
    slug: 'urban-realty-partners',
    description: 'Large-scale property management company operating over 1,000 units across Greater Boston with 24/7 maintenance support.',
    phone: '617-555-0109',
    email: 'leasing@urbanrealty.example.com',
    website: 'https://urbanrealty.example.com',
    verified: 1,
  },
  {
    id: 'landlord-10',
    name: 'Bay State Property Group',
    slug: 'bay-state-property-group',
    description: 'Regional property management company serving Eastern Massachusetts with a portfolio of apartment complexes and condo buildings.',
    phone: '617-555-0110',
    email: 'info@baystateproperty.example.com',
    website: 'https://baystateproperty.example.com',
    verified: 1,
  },
];

// ─── Buildings ─────────────────────────────────────────────────────────────────

interface Building {
  id: string;
  landlord_id: string | null;
  address: string;
  slug: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  year_built: number;
  unit_count: number;
  building_type: string;
  created_at: number;
  updated_at: number;
}

const BUILDINGS: Building[] = [
  // ── Allston (6 buildings) ──────────────────────────────────────────────────
  {
    id: 'building-01',
    landlord_id: 'landlord-01',
    address: '12 Brighton Ave',
    slug: '12-brighton-ave',
    neighborhood: 'Allston',
    city: 'Boston',
    state: 'MA',
    zip_code: '02134',
    year_built: 1965,
    unit_count: 24,
    building_type: 'apartment',
    created_at: 1690000000,
    updated_at: 1690000000,
  },
  {
    id: 'building-02',
    landlord_id: 'landlord-01',
    address: '45 Comm Ave',
    slug: '45-comm-ave',
    neighborhood: 'Allston',
    city: 'Boston',
    state: 'MA',
    zip_code: '02134',
    year_built: 1920,
    unit_count: 12,
    building_type: 'apartment',
    created_at: 1691000000,
    updated_at: 1691000000,
  },
  {
    id: 'building-03',
    landlord_id: 'landlord-06',
    address: '78 Linden St',
    slug: '78-linden-st',
    neighborhood: 'Allston',
    city: 'Boston',
    state: 'MA',
    zip_code: '02134',
    year_built: 1895,
    unit_count: 3,
    building_type: 'triple-decker',
    created_at: 1692000000,
    updated_at: 1692000000,
  },
  {
    id: 'building-04',
    landlord_id: 'landlord-06',
    address: '201 Harvard Ave',
    slug: '201-harvard-ave',
    neighborhood: 'Allston',
    city: 'Boston',
    state: 'MA',
    zip_code: '02134',
    year_built: 1958,
    unit_count: 18,
    building_type: 'apartment',
    created_at: 1693000000,
    updated_at: 1693000000,
  },
  {
    id: 'building-05',
    landlord_id: null,
    address: '340 Western Ave',
    slug: '340-western-ave',
    neighborhood: 'Allston',
    city: 'Boston',
    state: 'MA',
    zip_code: '02134',
    year_built: 1910,
    unit_count: 6,
    building_type: 'triple-decker',
    created_at: 1694000000,
    updated_at: 1694000000,
  },
  {
    id: 'building-06',
    landlord_id: 'landlord-09',
    address: '15 Gordon St',
    slug: '15-gordon-st',
    neighborhood: 'Allston',
    city: 'Boston',
    state: 'MA',
    zip_code: '02134',
    year_built: 1985,
    unit_count: 36,
    building_type: 'apartment',
    created_at: 1695000000,
    updated_at: 1695000000,
  },
  // ── Back Bay (4 buildings) ─────────────────────────────────────────────────
  {
    id: 'building-07',
    landlord_id: 'landlord-02',
    address: '210 Commonwealth Ave',
    slug: '210-commonwealth-ave',
    neighborhood: 'Back Bay',
    city: 'Boston',
    state: 'MA',
    zip_code: '02116',
    year_built: 1890,
    unit_count: 8,
    building_type: 'brownstone',
    created_at: 1696000000,
    updated_at: 1696000000,
  },
  {
    id: 'building-08',
    landlord_id: 'landlord-02',
    address: '88 Marlborough St',
    slug: '88-marlborough-st',
    neighborhood: 'Back Bay',
    city: 'Boston',
    state: 'MA',
    zip_code: '02116',
    year_built: 1895,
    unit_count: 6,
    building_type: 'brownstone',
    created_at: 1697000000,
    updated_at: 1697000000,
  },
  {
    id: 'building-09',
    landlord_id: 'landlord-10',
    address: '500 Boylston St',
    slug: '500-boylston-st',
    neighborhood: 'Back Bay',
    city: 'Boston',
    state: 'MA',
    zip_code: '02116',
    year_built: 2005,
    unit_count: 60,
    building_type: 'condo',
    created_at: 1698000000,
    updated_at: 1698000000,
  },
  {
    id: 'building-10',
    landlord_id: null,
    address: '34 Newbury St',
    slug: '34-newbury-st',
    neighborhood: 'Back Bay',
    city: 'Boston',
    state: 'MA',
    zip_code: '02116',
    year_built: 1898,
    unit_count: 4,
    building_type: 'brownstone',
    created_at: 1699000000,
    updated_at: 1699000000,
  },
  // ── Dorchester (4 buildings) ───────────────────────────────────────────────
  {
    id: 'building-11',
    landlord_id: 'landlord-04',
    address: '123 Dorchester Ave',
    slug: '123-dorchester-ave',
    neighborhood: 'Dorchester',
    city: 'Boston',
    state: 'MA',
    zip_code: '02125',
    year_built: 1905,
    unit_count: 3,
    building_type: 'triple-decker',
    created_at: 1700000000,
    updated_at: 1700000000,
  },
  {
    id: 'building-12',
    landlord_id: 'landlord-04',
    address: '456 Adams St',
    slug: '456-adams-st',
    neighborhood: 'Dorchester',
    city: 'Boston',
    state: 'MA',
    zip_code: '02122',
    year_built: 1912,
    unit_count: 3,
    building_type: 'triple-decker',
    created_at: 1701000000,
    updated_at: 1701000000,
  },
  {
    id: 'building-13',
    landlord_id: 'landlord-07',
    address: '789 Blue Hill Ave',
    slug: '789-blue-hill-ave',
    neighborhood: 'Dorchester',
    city: 'Boston',
    state: 'MA',
    zip_code: '02124',
    year_built: 1935,
    unit_count: 12,
    building_type: 'apartment',
    created_at: 1702000000,
    updated_at: 1702000000,
  },
  {
    id: 'building-14',
    landlord_id: null,
    address: '22 Bowdoin St',
    slug: '22-bowdoin-st',
    neighborhood: 'Dorchester',
    city: 'Boston',
    state: 'MA',
    zip_code: '02122',
    year_built: 1918,
    unit_count: 6,
    building_type: 'triple-decker',
    created_at: 1703000000,
    updated_at: 1703000000,
  },
  // ── Jamaica Plain (4 buildings) ────────────────────────────────────────────
  {
    id: 'building-15',
    landlord_id: 'landlord-03',
    address: '55 Centre St',
    slug: '55-centre-st',
    neighborhood: 'Jamaica Plain',
    city: 'Boston',
    state: 'MA',
    zip_code: '02130',
    year_built: 1900,
    unit_count: 3,
    building_type: 'triple-decker',
    created_at: 1704000000,
    updated_at: 1704000000,
  },
  {
    id: 'building-16',
    landlord_id: 'landlord-03',
    address: '180 Jamaica Plain Way',
    slug: '180-jamaica-plain-way',
    neighborhood: 'Jamaica Plain',
    city: 'Boston',
    state: 'MA',
    zip_code: '02130',
    year_built: 1970,
    unit_count: 20,
    building_type: 'apartment',
    created_at: 1705000000,
    updated_at: 1705000000,
  },
  {
    id: 'building-17',
    landlord_id: 'landlord-08',
    address: '300 South St',
    slug: '300-south-st',
    neighborhood: 'Jamaica Plain',
    city: 'Boston',
    state: 'MA',
    zip_code: '02130',
    year_built: 1908,
    unit_count: 3,
    building_type: 'triple-decker',
    created_at: 1706000000,
    updated_at: 1706000000,
  },
  {
    id: 'building-18',
    landlord_id: 'landlord-08',
    address: '77 Pond St',
    slug: '77-pond-st',
    neighborhood: 'Jamaica Plain',
    city: 'Boston',
    state: 'MA',
    zip_code: '02130',
    year_built: 1915,
    unit_count: 3,
    building_type: 'triple-decker',
    created_at: 1707000000,
    updated_at: 1707000000,
  },
  // ── South End (4 buildings) ────────────────────────────────────────────────
  {
    id: 'building-19',
    landlord_id: 'landlord-02',
    address: '150 Tremont St',
    slug: '150-tremont-st',
    neighborhood: 'South End',
    city: 'Boston',
    state: 'MA',
    zip_code: '02111',
    year_built: 1888,
    unit_count: 10,
    building_type: 'brownstone',
    created_at: 1708000000,
    updated_at: 1708000000,
  },
  {
    id: 'building-20',
    landlord_id: 'landlord-09',
    address: '42 Rutland Square',
    slug: '42-rutland-square',
    neighborhood: 'South End',
    city: 'Boston',
    state: 'MA',
    zip_code: '02118',
    year_built: 1892,
    unit_count: 8,
    building_type: 'brownstone',
    created_at: 1709000000,
    updated_at: 1709000000,
  },
  {
    id: 'building-21',
    landlord_id: 'landlord-10',
    address: '99 Harrison Ave',
    slug: '99-harrison-ave',
    neighborhood: 'South End',
    city: 'Boston',
    state: 'MA',
    zip_code: '02111',
    year_built: 2010,
    unit_count: 48,
    building_type: 'condo',
    created_at: 1710000000,
    updated_at: 1710000000,
  },
  {
    id: 'building-22',
    landlord_id: null,
    address: '28 Appleton St',
    slug: '28-appleton-st',
    neighborhood: 'South End',
    city: 'Boston',
    state: 'MA',
    zip_code: '02116',
    year_built: 1885,
    unit_count: 5,
    building_type: 'brownstone',
    created_at: 1691500000,
    updated_at: 1691500000,
  },
  // ── Fenway/Kenmore (3 buildings) ───────────────────────────────────────────
  {
    id: 'building-23',
    landlord_id: 'landlord-05',
    address: '15 Queensberry St',
    slug: '15-queensberry-st',
    neighborhood: 'Fenway',
    city: 'Boston',
    state: 'MA',
    zip_code: '02215',
    year_built: 1960,
    unit_count: 30,
    building_type: 'apartment',
    created_at: 1692500000,
    updated_at: 1692500000,
  },
  {
    id: 'building-24',
    landlord_id: 'landlord-05',
    address: '88 Peterborough St',
    slug: '88-peterborough-st',
    neighborhood: 'Fenway',
    city: 'Boston',
    state: 'MA',
    zip_code: '02215',
    year_built: 1975,
    unit_count: 24,
    building_type: 'apartment',
    created_at: 1693500000,
    updated_at: 1693500000,
  },
  {
    id: 'building-25',
    landlord_id: 'landlord-10',
    address: '200 Brookline Ave',
    slug: '200-brookline-ave',
    neighborhood: 'Fenway',
    city: 'Boston',
    state: 'MA',
    zip_code: '02215',
    year_built: 2015,
    unit_count: 55,
    building_type: 'condo',
    created_at: 1694500000,
    updated_at: 1694500000,
  },
  // ── Brighton (3 buildings) ─────────────────────────────────────────────────
  {
    id: 'building-26',
    landlord_id: 'landlord-01',
    address: '370 Washington St',
    slug: '370-washington-st',
    neighborhood: 'Brighton',
    city: 'Boston',
    state: 'MA',
    zip_code: '02135',
    year_built: 1955,
    unit_count: 16,
    building_type: 'apartment',
    created_at: 1695500000,
    updated_at: 1695500000,
  },
  {
    id: 'building-27',
    landlord_id: 'landlord-06',
    address: '50 Faneuil St',
    slug: '50-faneuil-st',
    neighborhood: 'Brighton',
    city: 'Boston',
    state: 'MA',
    zip_code: '02135',
    year_built: 1902,
    unit_count: 3,
    building_type: 'triple-decker',
    created_at: 1696500000,
    updated_at: 1696500000,
  },
  {
    id: 'building-28',
    landlord_id: 'landlord-09',
    address: '12 Chestnut Hill Ave',
    slug: '12-chestnut-hill-ave',
    neighborhood: 'Brighton',
    city: 'Boston',
    state: 'MA',
    zip_code: '02135',
    year_built: 1990,
    unit_count: 40,
    building_type: 'apartment',
    created_at: 1697500000,
    updated_at: 1697500000,
  },
  // ── Roxbury (2 buildings) ──────────────────────────────────────────────────
  {
    id: 'building-29',
    landlord_id: 'landlord-03',
    address: '100 Roxbury St',
    slug: '100-roxbury-st',
    neighborhood: 'Roxbury',
    city: 'Boston',
    state: 'MA',
    zip_code: '02119',
    year_built: 1920,
    unit_count: 6,
    building_type: 'triple-decker',
    created_at: 1698500000,
    updated_at: 1698500000,
  },
  {
    id: 'building-30',
    landlord_id: 'landlord-08',
    address: '45 Melnea Cass Blvd',
    slug: '45-melnea-cass-blvd',
    neighborhood: 'Roxbury',
    city: 'Boston',
    state: 'MA',
    zip_code: '02119',
    year_built: 1945,
    unit_count: 18,
    building_type: 'apartment',
    created_at: 1699500000,
    updated_at: 1699500000,
  },
];

// ─── Insert Functions ──────────────────────────────────────────────────────────

/**
 * Insert all 8 test users into the users table.
 * All users share the same pre-computed password hash.
 */
function insertUsers(passwordHash: string): void {
  const statements = USERS.map((u) =>
    `INSERT INTO users (id, email, email_verified, hashed_password, created_at, updated_at, name, is_admin) VALUES ('${escapeSql(u.id)}', '${escapeSql(u.email)}', ${u.email_verified}, '${escapeSql(passwordHash)}', ${CREATED_AT_DEFAULT}, ${UPDATED_AT_DEFAULT}, '${escapeSql(u.name)}', ${u.is_admin})`
  );
  executeSqlBatch(statements);
}

/**
 * Insert all 10 landlords into the landlords table.
 * Optional fields (phone, email, website) use NULL when not provided.
 */
function insertLandlords(): void {
  const statements = LANDLORDS.map((l) => {
    const phone = l.phone ? `'${escapeSql(l.phone)}'` : 'NULL';
    const email = l.email ? `'${escapeSql(l.email)}'` : 'NULL';
    const website = l.website ? `'${escapeSql(l.website)}'` : 'NULL';
    return `INSERT INTO landlords (id, name, slug, description, phone, email, website, created_at, updated_at, verified) VALUES ('${escapeSql(l.id)}', '${escapeSql(l.name)}', '${escapeSql(l.slug)}', '${escapeSql(l.description)}', ${phone}, ${email}, ${website}, ${CREATED_AT_DEFAULT}, ${UPDATED_AT_DEFAULT}, ${l.verified})`;
  });
  executeSqlBatch(statements);
}

/**
 * Insert all 30 buildings into the buildings table.
 * landlord_id is NULL for buildings with unknown landlords (3-5 buildings).
 * Optional fields (latitude, longitude, etc.) use SQL NULL.
 */
function insertBuildings(): void {
  const statements = BUILDINGS.map((b) => {
    const landlordId = b.landlord_id ? `'${escapeSql(b.landlord_id)}'` : 'NULL';
    return `INSERT INTO buildings (id, landlord_id, address, slug, neighborhood, city, state, zip_code, year_built, unit_count, building_type, created_at, updated_at, latitude, longitude, google_place_id, property_manager_id, admin_notes, public_info, owner_name, owner_entity, owner_website) VALUES ('${escapeSql(b.id)}', ${landlordId}, '${escapeSql(b.address)}', '${escapeSql(b.slug)}', '${escapeSql(b.neighborhood)}', '${escapeSql(b.city)}', '${escapeSql(b.state)}', '${escapeSql(b.zip_code)}', ${b.year_built}, ${b.unit_count}, '${escapeSql(b.building_type)}', ${b.created_at}, ${b.updated_at}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`;
  });
  executeSqlBatch(statements);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log(`\n  ${BOLD}Seed local database${RESET}\n`);

  assertDatabaseEmpty();

  run('Insert users (8)', () => insertUsers(TEST_PASSWORD_HASH));
  run('Insert landlords (10)', insertLandlords);
  run('Insert buildings (30)', insertBuildings);

  // PLACEHOLDER: Plan 02 will add these steps:
  // run('Insert reviews (120+)', insertReviews);
  // run('Insert disputes (10)', insertDisputes);
  // run('Compute and insert building scores', insertBuildingScores);
  // run('Compute and insert landlord scores', insertLandlordScores);
  // verifyScores();

  console.log(`\n  ${GREEN}✓ Seed complete (partial — users, landlords, buildings)${RESET}`);
  console.log(`\n  Test credentials:  user@test.ratemyplace.local / TestPassword123!`);
  console.log(`  Admin credentials: admin@test.ratemyplace.local / TestPassword123!\n`);
  process.exit(0);
}

try {
  main();
} catch (err: any) {
  console.error(`\n  ${RED}✗ Seed failed: ${err.message}${RESET}\n`);
  process.exit(1);
}
