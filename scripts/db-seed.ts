/**
 * Seed Data Script for RateMyPlace Boston
 *
 * Populates the local D1 database with deterministic test data:
 *   - 8 users (3 test users + 5 reviewer users)
 *   - 10 landlords (realistic Boston mix of LLC/individual names)
 *   - 30 buildings (spread across 8 Boston neighborhoods)
 *   - 128 reviews distributed across 29 buildings (building-30 has 0)
 *   - 10 disputes (7 pending, 3 resolved)
 *   - Pre-computed and verified building_scores and landlord_scores
 *
 * All IDs, slugs, and content are hardcoded for determinism.
 * The password hash is pre-computed (PBKDF2-SHA256) so no async work is needed.
 *
 * Guard: Exits with code 1 if the database already contains data.
 *        Run `npm run db:fresh` first to start clean.
 *
 * Run: npm run db:seed
 * Run directly: npx tsx scripts/db-seed.ts
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { calculateOverallScore, calculateBuildingAverages, calculateLandlordAverages } from '../src/lib/scoring.js';

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
const DB_TARGET = process.env.D1_REMOTE === '1' ? '--remote' : '--local';

function wranglerQuery(sql: string): any[] {
  const escaped = sql.replace(/"/g, '\\"');
  const raw = execSync(
    `npx wrangler d1 execute ratemyplace-db ${DB_TARGET} --command "${escaped}" --json`,
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
      `npx wrangler d1 execute ratemyplace-db ${DB_TARGET} --file "${tmp}"`,
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
  latitude: number;
  longitude: number;
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
    latitude: 42.3533,
    longitude: -71.1326,
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
    latitude: 42.3519,
    longitude: -71.1337,
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
    latitude: 42.3496,
    longitude: -71.1310,
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
    latitude: 42.3521,
    longitude: -71.1289,
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
    latitude: 42.3612,
    longitude: -71.1298,
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
    latitude: 42.3543,
    longitude: -71.1350,
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
    latitude: 42.3520,
    longitude: -71.0796,
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
    latitude: 42.3539,
    longitude: -71.0762,
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
    latitude: 42.3510,
    longitude: -71.0735,
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
    latitude: 42.3512,
    longitude: -71.0710,
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
    latitude: 42.3340,
    longitude: -71.0558,
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
    latitude: 42.2872,
    longitude: -71.0670,
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
    latitude: 42.2985,
    longitude: -71.0835,
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
    latitude: 42.2920,
    longitude: -71.0685,
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
    latitude: 42.3095,
    longitude: -71.1130,
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
    latitude: 42.3070,
    longitude: -71.1155,
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
    latitude: 42.3038,
    longitude: -71.1092,
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
    latitude: 42.3145,
    longitude: -71.1180,
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
    latitude: 42.3470,
    longitude: -71.0668,
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
    latitude: 42.3420,
    longitude: -71.0740,
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
    latitude: 42.3485,
    longitude: -71.0633,
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
    latitude: 42.3445,
    longitude: -71.0720,
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
    latitude: 42.3435,
    longitude: -71.0965,
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
    latitude: 42.3445,
    longitude: -71.0990,
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
    latitude: 42.3465,
    longitude: -71.1010,
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
    latitude: 42.3490,
    longitude: -71.1530,
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
    latitude: 42.3510,
    longitude: -71.1565,
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
    latitude: 42.3475,
    longitude: -71.1520,
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
    latitude: 42.3310,
    longitude: -71.0875,
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
    latitude: 42.3350,
    longitude: -71.0815,
    created_at: 1699500000,
    updated_at: 1699500000,
  },
  // ── Phase 20 E2E test isolation (do NOT remove) ──────────────────────────────
  // Reserved building for e2e/critical-flows.spec.ts (TEST-01 + TEST-02).
  // Slug intentionally non-real to avoid collision with any real Boston address.
  // Zero pre-seeded reviews — score is fully determined by what the test inserts.
  {
    id: 'building-e2e-01',
    landlord_id: null,
    address: '999 E2E Test Way',
    slug: 'test-cross-view-consistency',
    neighborhood: 'Allston',
    city: 'Boston',
    state: 'MA',
    zip_code: '02115',
    year_built: 2000,
    unit_count: 1,
    building_type: 'apartment',
    latitude: 42.3533,
    longitude: -71.1326,
    created_at: 1700000000,
    updated_at: 1700000000,
  },
];

// ─── Reviews ───────────────────────────────────────────────────────────────────

interface ReviewBase {
  id: string;
  user_id: string;
  building_id: string;
  move_in_year: number;
  move_in_season: string;
  move_out_year: number | null;
  move_out_season: string | null;
  is_current_tenant: number;
  unit_type: string;
  rent_amount: number;
  unit_structural: number;
  unit_plumbing: number;
  unit_electrical: number;
  unit_climate: number;
  unit_ventilation: number;
  unit_pests: number;
  unit_mold: number;
  unit_appliances: number;
  unit_layout: number;
  unit_accuracy: number;
  building_common_areas: number;
  building_security: number;
  building_exterior: number;
  building_noise_neighbors: number;
  building_noise_external: number;
  building_mail: number;
  building_laundry: number;
  building_parking: number | null;
  building_trash: number;
  landlord_maintenance: number;
  landlord_communication: number;
  landlord_professionalism: number;
  landlord_lease_clarity: number;
  landlord_privacy: number;
  landlord_deposit: number;
  landlord_rent_practices: number;
  landlord_non_retaliation: number;
  overall_score: number;
  status: string;
  comments: string;
  would_recommend_new: string;
  had_pests: number;
  had_heat_issues: number;
  had_water_issues: number;
  had_security_deposit_issues: number;
  created_at: number;
  updated_at: number;
  move_out_year_new: string | null;
}

type ReviewScores = Pick<ReviewBase,
  'unit_structural' | 'unit_plumbing' | 'unit_electrical' | 'unit_climate' | 'unit_ventilation' |
  'unit_pests' | 'unit_mold' | 'unit_appliances' | 'unit_layout' | 'unit_accuracy' |
  'building_common_areas' | 'building_security' | 'building_exterior' | 'building_noise_neighbors' |
  'building_noise_external' | 'building_mail' | 'building_laundry' | 'building_parking' | 'building_trash' |
  'landlord_maintenance' | 'landlord_communication' | 'landlord_professionalism' | 'landlord_lease_clarity' |
  'landlord_privacy' | 'landlord_deposit' | 'landlord_rent_practices' | 'landlord_non_retaliation'
>;

interface ReviewExtras {
  move_in_year?: number;
  move_in_season?: string;
  move_out_year?: number | null;
  move_out_season?: string | null;
  is_current_tenant?: number;
  unit_type?: string;
  rent_amount?: number;
  comments?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: any;
}

/**
 * Helper to construct a full review object with sensible defaults.
 * overall_score is set to 0 and computed in insertReviews via calculateOverallScore.
 * would_recommend_new, had_* flags are auto-derived from scores.
 */
function makeReview(
  id: string,
  building_id: string,
  user_id: string,
  scores: ReviewScores,
  extras: ReviewExtras = {}
): ReviewBase {
  const avg27 = (
    scores.unit_structural + scores.unit_plumbing + scores.unit_electrical +
    scores.unit_climate + scores.unit_ventilation + scores.unit_pests +
    scores.unit_mold + scores.unit_appliances + scores.unit_layout + scores.unit_accuracy +
    scores.building_common_areas + scores.building_security + scores.building_exterior +
    scores.building_noise_neighbors + scores.building_noise_external + scores.building_mail +
    scores.building_laundry + (scores.building_parking ?? 3) + scores.building_trash +
    scores.landlord_maintenance + scores.landlord_communication + scores.landlord_professionalism +
    scores.landlord_lease_clarity + scores.landlord_privacy + scores.landlord_deposit +
    scores.landlord_rent_practices + scores.landlord_non_retaliation
  ) / 27;

  const move_out_year = extras.move_out_year !== undefined ? extras.move_out_year : null;
  const is_current_tenant = extras.is_current_tenant !== undefined ? extras.is_current_tenant : (move_out_year === null ? 1 : 0);
  const move_out_season = extras.move_out_season !== undefined ? extras.move_out_season : (move_out_year !== null ? 'fall' : null);
  const created_at = extras.created_at ?? 1700000000;

  return {
    id,
    user_id,
    building_id,
    move_in_year: extras.move_in_year ?? 2021,
    move_in_season: extras.move_in_season ?? 'fall',
    move_out_year,
    move_out_season,
    is_current_tenant,
    unit_type: extras.unit_type ?? '1br',
    rent_amount: extras.rent_amount ?? 2000,
    ...scores,
    overall_score: 0, // Computed in insertReviews
    status: 'approved',
    comments: extras.comments ?? 'Decent place overall. The location is convenient and the unit is reasonably maintained.',
    would_recommend_new: avg27 >= 3.5 ? 'yes' : 'no',
    had_pests: scores.unit_pests <= 2 ? 1 : 0,
    had_heat_issues: scores.unit_climate <= 2 ? 1 : 0,
    had_water_issues: scores.unit_plumbing <= 2 ? 1 : 0,
    had_security_deposit_issues: scores.landlord_deposit <= 2 ? 1 : 0,
    created_at,
    updated_at: extras.updated_at ?? created_at,
    move_out_year_new: move_out_year !== null ? String(move_out_year) : (is_current_tenant ? 'current' : null),
  } as ReviewBase;
}

// Shorthand score sets used by makeReview
// High: scores 4-5 (great building)
const HIGH = { unit_structural:4, unit_plumbing:4, unit_electrical:5, unit_climate:4, unit_ventilation:4, unit_pests:5, unit_mold:5, unit_appliances:4, unit_layout:4, unit_accuracy:4, building_common_areas:4, building_security:4, building_exterior:5, building_noise_neighbors:4, building_noise_external:4, building_mail:4, building_laundry:4, building_parking:4, building_trash:4, landlord_maintenance:4, landlord_communication:5, landlord_professionalism:5, landlord_lease_clarity:4, landlord_privacy:5, landlord_deposit:4, landlord_rent_practices:4, landlord_non_retaliation:5 };
// MID: scores 3 (average building)
const MID  = { unit_structural:3, unit_plumbing:3, unit_electrical:3, unit_climate:3, unit_ventilation:3, unit_pests:3, unit_mold:3, unit_appliances:3, unit_layout:3, unit_accuracy:3, building_common_areas:3, building_security:3, building_exterior:3, building_noise_neighbors:3, building_noise_external:3, building_mail:3, building_laundry:3, building_parking:3, building_trash:3, landlord_maintenance:3, landlord_communication:3, landlord_professionalism:3, landlord_lease_clarity:3, landlord_privacy:3, landlord_deposit:3, landlord_rent_practices:3, landlord_non_retaliation:3 };
// LOW: scores 1-2 (poor building)
const LOW  = { unit_structural:2, unit_plumbing:1, unit_electrical:2, unit_climate:1, unit_ventilation:2, unit_pests:1, unit_mold:2, unit_appliances:2, unit_layout:2, unit_accuracy:2, building_common_areas:2, building_security:2, building_exterior:1, building_noise_neighbors:2, building_noise_external:2, building_mail:2, building_laundry:1, building_parking:null, building_trash:2, landlord_maintenance:1, landlord_communication:2, landlord_professionalism:2, landlord_lease_clarity:2, landlord_privacy:2, landlord_deposit:1, landlord_rent_practices:2, landlord_non_retaliation:2 };

const REVIEWS: ReviewBase[] = [
  // ── building-01: 25 reviews, mixed 3.0-3.5 avg (STRESS-01) ────────────────
  makeReview('review-001','building-01','user-test-01',{...MID},{comments:'The apartment was decent overall. Management responds within a day or two but maintenance quality varies.',created_at:1680000000,move_in_year:2020,move_out_year:2023,unit_type:'1br',rent_amount:2100}),
  makeReview('review-002','building-01','user-04',{...MID,unit_pests:2,unit_mold:2,landlord_maintenance:2},{comments:'Had some pest issues in the first winter. The landlord eventually sent someone but it took weeks.',created_at:1682000000,move_in_year:2021,move_out_year:2023,unit_type:'studio',rent_amount:1800}),
  makeReview('review-003','building-01','user-05',{...MID,landlord_communication:4,landlord_professionalism:4},{comments:'Good communication from the management office. Rent is fair for Allston. Would consider returning.',created_at:1684000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2200}),
  makeReview('review-004','building-01','user-06',{...MID,unit_structural:2,unit_climate:2,had_heat_issues:1},{comments:'Heat was unreliable the first winter. Filed multiple complaints before it was properly fixed. Walls are thin.',created_at:1685000000,move_in_year:2019,move_out_year:2022,unit_type:'2br',rent_amount:2700}),
  makeReview('review-005','building-01','user-07',{...MID,unit_pests:4,unit_mold:4,building_common_areas:4},{comments:'No pest problems during my stay. Common areas are kept clean. The laundry machines work consistently.',created_at:1686000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2050}),
  makeReview('review-006','building-01','user-08',{...HIGH,unit_structural:3,unit_climate:3},{comments:'Great landlord overall. Quick repairs, fair lease terms. A few drafty windows in winter but manageable.',created_at:1688000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2300}),
  makeReview('review-007','building-01','user-test-01',{...MID,landlord_deposit:2,had_security_deposit_issues:1},{comments:'Move-out process was frustrating. Deductions felt excessive for normal wear and tear.',created_at:1690000000,move_in_year:2020,move_out_year:2022,unit_type:'studio',rent_amount:1750}),
  makeReview('review-008','building-01','user-04',{...MID,building_noise_neighbors:2,building_noise_external:2},{comments:'Street noise is significant on the lower floors. Thin walls between units. Otherwise acceptable.',created_at:1692000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2100}),
  makeReview('review-009','building-01','user-05',{...MID,landlord_communication:2,landlord_maintenance:2},{comments:'Hard to reach management for non-emergency issues. Took three requests to fix a leaking faucet.',created_at:1694000000,move_in_year:2022,move_out_year:2024,unit_type:'2br',rent_amount:2800}),
  makeReview('review-010','building-01','user-06',{...MID,unit_layout:4,unit_appliances:4,building_exterior:4},{comments:'Well-laid-out unit with updated appliances. Building exterior is well maintained. Good value for the area.',created_at:1696000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2250}),
  makeReview('review-011','building-01','user-07',{...LOW,unit_structural:3},{comments:'Pest infestation was never fully resolved despite repeated reports. Heat was off for two weeks in January.',created_at:1698000000,move_in_year:2018,move_out_year:2021,unit_type:'studio',rent_amount:1600}),
  makeReview('review-012','building-01','user-08',{...HIGH,unit_structural:5,unit_climate:5},{comments:'Excellent building. Renovated units, responsive management, and a great location near the T. Very happy here.',created_at:1700000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3200}),
  makeReview('review-013','building-01','user-test-01',{...MID},{comments:'Average in every way. Nothing exceptional but nothing terrible. Acceptable for the price.',created_at:1702000000,move_in_year:2020,move_out_year:2022,unit_type:'1br',rent_amount:2000}),
  makeReview('review-014','building-01','user-04',{...MID,unit_pests:2,unit_mold:3},{comments:'Some roach activity in the kitchen during summer. Management treated but it recurred seasonally.',created_at:1703000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2100}),
  makeReview('review-015','building-01','user-05',{...MID,landlord_professionalism:4,landlord_lease_clarity:4},{comments:'Lease was straightforward and the manager explained everything clearly at signing. Fair experience overall.',created_at:1704000000,move_in_year:2022,move_out_year:2024,unit_type:'studio',rent_amount:1900}),
  makeReview('review-016','building-01','user-06',{...MID,building_security:2,building_mail:2},{comments:'Package theft from lobby has been an ongoing issue. Building security could be improved significantly.',created_at:1706000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2300}),
  makeReview('review-017','building-01','user-07',{...HIGH,building_laundry:5,building_trash:5},{comments:'In-building laundry is a huge plus and machines are always clean. Trash is picked up regularly.',created_at:1708000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:2950}),
  makeReview('review-018','building-01','user-08',{...MID,unit_climate:2,unit_ventilation:2},{comments:'Poor ventilation makes the apartment stuffy in summer. AC window unit barely keeps up with Boston heat.',created_at:1710000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2050}),
  makeReview('review-019','building-01','user-test-01',{...MID,landlord_rent_practices:2},{comments:'Rent increased 15 percent at renewal with minimal notice. Management was not negotiable about it.',created_at:1712000000,move_in_year:2020,move_out_year:2023,unit_type:'2br',rent_amount:2600}),
  makeReview('review-020','building-01','user-04',{...MID,unit_accuracy:4,building_exterior:4},{comments:'Listing photos matched reality, which is refreshing. Building looks good from outside and inside.',created_at:1714000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2200}),
  makeReview('review-021','building-01','user-05',{...LOW,unit_structural:2,unit_plumbing:1},{comments:'Persistent plumbing issues including a slow drain that was never fully fixed. Hot water pressure is weak.',created_at:1716000000,move_in_year:2019,move_out_year:2022,unit_type:'1br',rent_amount:1850}),
  makeReview('review-022','building-01','user-06',{...HIGH,landlord_communication:5,landlord_maintenance:5},{comments:'Best landlord experience I have had in Boston. Problems fixed same day. Friendly and professional staff.',created_at:1718000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'studio',rent_amount:2000}),
  makeReview('review-023','building-01','user-07',{...MID,building_parking:null},{comments:'No parking available which is expected in Allston. Unit itself is fine. Standard Boston apartment experience.',created_at:1720000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2100}),
  makeReview('review-024','building-01','user-08',{...MID,unit_pests:3,unit_mold:2},{comments:'Noticed some mold around the bathroom window. Reported it and got a tube of caulk as the solution.',created_at:1722000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2000}),
  makeReview('review-025','building-01','user-test-01',{...MID,unit_layout:4,unit_appliances:3},{comments:'Good layout for the price. Kitchen appliances are dated but functional. Location near the T is great.',created_at:1724000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:2800}),

  // ── building-02: 12 reviews, above-average ~3.8 ────────────────────────────
  makeReview('review-026','building-02','user-04',{...HIGH,unit_structural:3},{comments:'Well-managed building on Comm Ave. Management is attentive and the common areas are always clean.',created_at:1681000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2400}),
  makeReview('review-027','building-02','user-05',{...HIGH,unit_climate:3,unit_ventilation:3},{comments:'Great building overall. Heat is sometimes inconsistent in older units but management addresses it quickly.',created_at:1683000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3100}),
  makeReview('review-028','building-02','user-06',{...HIGH},{comments:'Top-notch property management. Security deposit returned in full with itemized statement. Very professional.',created_at:1685500000,move_in_year:2020,move_out_year:2023,unit_type:'1br',rent_amount:2300}),
  makeReview('review-029','building-02','user-07',{...HIGH,building_noise_neighbors:3},{comments:'Neighbors can be noisy but the building itself is great. Management handled my complaint professionally.',created_at:1687000000,move_in_year:2021,move_out_year:2023,unit_type:'studio',rent_amount:2000}),
  makeReview('review-030','building-02','user-08',{...HIGH,unit_pests:3,unit_mold:3},{comments:'No major pest issues. Spotted one mouse in fall but management responded immediately with traps.',created_at:1689000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2500}),
  makeReview('review-031','building-02','user-test-01',{...HIGH,unit_structural:4,building_exterior:5},{comments:'Beautiful building in a great location. Well-kept and responsive management. One of the better rentals in Allston.',created_at:1691000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3000}),
  makeReview('review-032','building-02','user-04',{...MID,unit_plumbing:4,landlord_maintenance:4},{comments:'Mostly positive experience. Plumbing is solid and maintenance requests are handled within two days.',created_at:1693000000,move_in_year:2020,move_out_year:2022,unit_type:'1br',rent_amount:2200}),
  makeReview('review-033','building-02','user-05',{...HIGH,landlord_deposit:5,landlord_rent_practices:4},{comments:'Fair rent increases and full deposit refund. Landlord is respectful of tenant rights. Will renew.',created_at:1695000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'studio',rent_amount:2100}),
  makeReview('review-034','building-02','user-06',{...HIGH,building_laundry:3},{comments:'Laundry machines are older but functional. Everything else about the building is above average.',created_at:1697000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2350}),
  makeReview('review-035','building-02','user-07',{...HIGH,unit_layout:5,unit_accuracy:5},{comments:'The floor plan is efficient and the listing description was accurate. Management is professional.',created_at:1699000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2450}),
  makeReview('review-036','building-02','user-08',{...MID,landlord_communication:4,building_security:4},{comments:'Secure building with responsive management. Middle-of-the-road experience but leaning positive.',created_at:1701000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2900}),
  makeReview('review-037','building-02','user-test-01',{...HIGH,unit_electrical:5,unit_ventilation:5},{comments:'New electrical panel and good ventilation throughout. Management recently renovated several units.',created_at:1703000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2400}),

  // ── building-03: 10 reviews, great ~4.5 avg ────────────────────────────────
  makeReview('review-038','building-03','user-04',{...HIGH,unit_structural:5,unit_pests:5,unit_mold:5},{comments:'Exceptional building. Never had a single pest issue. Landlord is hands-on and cares about the property.',created_at:1682500000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3200}),
  makeReview('review-039','building-03','user-05',{...HIGH,landlord_maintenance:5,landlord_communication:5,landlord_professionalism:5},{comments:'The best landlord I have had in 10 years of renting. Repairs completed same day. Deposit fully returned.',created_at:1684500000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2800}),
  makeReview('review-040','building-03','user-06',{...HIGH,building_security:5,building_exterior:5},{comments:'Safe neighborhood with excellent building security. Well-maintained exterior. Highly recommend.',created_at:1686500000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2900}),
  makeReview('review-041','building-03','user-07',{...HIGH,unit_climate:5,unit_ventilation:5},{comments:'Excellent insulation keeps the apartment comfortable year-round. No heat or cooling issues ever.',created_at:1688500000,move_in_year:2020,move_out_year:2023,unit_type:'2br',rent_amount:3100}),
  makeReview('review-042','building-03','user-08',{...HIGH},{comments:'Five-star experience from move-in to move-out. Lease was clear, deposit returned promptly. Would rent again.',created_at:1690500000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'studio',rent_amount:2200}),
  makeReview('review-043','building-03','user-test-01',{...HIGH,unit_appliances:5,unit_layout:5},{comments:'Modern appliances and thoughtful layout. The kitchen has been recently renovated. Love living here.',created_at:1692500000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3300}),
  makeReview('review-044','building-03','user-04',{...HIGH,building_laundry:5,building_trash:5},{comments:'Spotlessly maintained building. Laundry room is always clean. Trash handled efficiently. Great experience.',created_at:1694500000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2700}),
  makeReview('review-045','building-03','user-05',{...HIGH,landlord_deposit:5,landlord_rent_practices:5},{comments:'Received full deposit with interest. Rent increases have been reasonable and given with proper notice.',created_at:1696500000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2850}),
  makeReview('review-046','building-03','user-06',{...HIGH,unit_accuracy:5,building_common_areas:5},{comments:'Listing was completely accurate. Common areas are beautifully maintained. Property manager is excellent.',created_at:1698500000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'studio',rent_amount:2300}),
  makeReview('review-047','building-03','user-07',{...HIGH,unit_plumbing:5,unit_electrical:5},{comments:'Solid plumbing and updated electrical throughout. Never had a maintenance emergency in two years.',created_at:1700500000,move_in_year:2022,move_out_year:2024,unit_type:'2br',rent_amount:3100}),

  // ── building-04: 8 reviews, poor ~1.8 avg ─────────────────────────────────
  makeReview('review-048','building-04','user-08',{...LOW},{comments:'Terrible experience. Pest problems from day one. Heat was out multiple times. Do not rent here.',created_at:1680500000,move_in_year:2019,move_out_year:2021,unit_type:'1br',rent_amount:1700}),
  makeReview('review-049','building-04','user-test-01',{...LOW,unit_structural:1},{comments:'Structural cracks in the walls were reported but ignored for months. The building is in poor condition.',created_at:1682500000,move_in_year:2020,move_out_year:2022,unit_type:'studio',rent_amount:1500}),
  makeReview('review-050','building-04','user-04',{...LOW,landlord_communication:1,landlord_professionalism:1},{comments:'Impossible to reach management. Calls go unanswered. The only contact is a voicemail that is never returned.',created_at:1684500000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:1800}),
  makeReview('review-051','building-04','user-05',{...LOW,unit_mold:1},{comments:'Significant mold in the bathroom ceiling. Reported multiple times. Management sent a painter to cover it.',created_at:1686500000,move_in_year:2018,move_out_year:2020,unit_type:'2br',rent_amount:2000}),
  makeReview('review-052','building-04','user-06',{...LOW,landlord_deposit:1,landlord_rent_practices:1},{comments:'Lost entire deposit over minor scuffs. Rent increased 20 percent at renewal with two weeks notice.',created_at:1688500000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:1900}),
  makeReview('review-053','building-04','user-07',{...LOW,building_security:1},{comments:'Front door lock broken for weeks. No security camera in lobby. Packages regularly stolen.',created_at:1690500000,move_in_year:2020,move_out_year:2022,unit_type:'studio',rent_amount:1600}),
  makeReview('review-054','building-04','user-08',{...LOW,unit_climate:1,unit_ventilation:1},{comments:'No working heat for three weeks in February. Management unreachable. Had to buy space heaters.',created_at:1692500000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:1750}),
  makeReview('review-055','building-04','user-test-01',{...LOW,unit_plumbing:1,building_trash:1},{comments:'Sewage smell from drains regularly. Trash overflows in the alley. Management does not care.',created_at:1694500000,move_in_year:2019,move_out_year:2021,unit_type:'1br',rent_amount:1650}),

  // ── building-05: 8 reviews, moderate ──────────────────────────────────────
  makeReview('review-056','building-05','user-04',{...MID,unit_pests:3,building_common_areas:3},{comments:'Typical triple-decker in Allston. Landlord is responsive but slow. Fair rent for the location.',created_at:1681500000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2400}),
  makeReview('review-057','building-05','user-05',{...MID,landlord_maintenance:4},{comments:'Maintenance issues are usually resolved within a week. Nothing extraordinary but no major complaints.',created_at:1683500000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2100}),
  makeReview('review-058','building-05','user-06',{...MID,unit_layout:2},{comments:'Oddly shaped rooms make furniture placement challenging. Otherwise a decent place at a fair price.',created_at:1685500000,move_in_year:2020,move_out_year:2022,unit_type:'1br',rent_amount:2000}),
  makeReview('review-059','building-05','user-07',{...MID,building_noise_external:2},{comments:'Street noise from Western Ave is constant. Earplugs recommended for light sleepers.',created_at:1687500000,move_in_year:2021,move_out_year:2023,unit_type:'studio',rent_amount:1800}),
  makeReview('review-060','building-05','user-08',{...MID,landlord_deposit:4},{comments:'Smooth move-out. Deposit returned within the legal window with a clear breakdown. Positive experience.',created_at:1689500000,move_in_year:2022,move_out_year:2024,unit_type:'2br',rent_amount:2600}),
  makeReview('review-061','building-05','user-test-01',{...MID,unit_structural:4,building_exterior:4},{comments:'Solid construction for a 1910 building. Exterior is well-kept. Landlord maintains the property.',created_at:1691500000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2200}),
  makeReview('review-062','building-05','user-04',{...MID,unit_pests:2,unit_mold:3},{comments:'Mouse problem in fall that took a few months to resolve. Bathroom has some mold around the tub.',created_at:1693500000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2050}),
  makeReview('review-063','building-05','user-05',{...MID,landlord_communication:4,landlord_professionalism:4},{comments:'Professional landlord who communicates clearly. Not the fanciest building but well run.',created_at:1695500000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:2500}),

  // ── building-06: 7 reviews ─────────────────────────────────────────────────
  makeReview('review-064','building-06','user-06',{...MID,building_common_areas:4,building_security:4},{comments:'Large apartment complex with good amenities. Professionally managed by Urban Realty. Good security.',created_at:1682000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2300}),
  makeReview('review-065','building-06','user-07',{...HIGH,unit_appliances:5,building_laundry:5},{comments:'Updated appliances in every unit and excellent in-building laundry. Urban Realty is very responsive.',created_at:1684000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3100}),
  makeReview('review-066','building-06','user-08',{...MID,landlord_rent_practices:2},{comments:'Annual rent increases are significant. Management is professional but costs increase rapidly.',created_at:1686000000,move_in_year:2020,move_out_year:2022,unit_type:'1br',rent_amount:2200}),
  makeReview('review-067','building-06','user-test-01',{...MID,unit_climate:4,unit_ventilation:4},{comments:'Central HVAC works well. Building temperature is comfortable year-round. Common areas are nice.',created_at:1688000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'studio',rent_amount:2000}),
  makeReview('review-068','building-06','user-04',{...MID,building_parking:4},{comments:'Rare Boston perk - assigned parking available. Building is large but well-managed. Decent experience.',created_at:1690000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2900}),
  makeReview('review-069','building-06','user-05',{...HIGH,landlord_maintenance:5,landlord_communication:4},{comments:'24/7 maintenance line actually works. Had a plumbing emergency at midnight and someone came within an hour.',created_at:1692000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2500}),
  makeReview('review-070','building-06','user-06',{...MID,unit_pests:4,unit_mold:4},{comments:'No pest issues in a 1985 building which is impressive. Management keeps up with preventative care.',created_at:1694000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2400}),

  // ── building-07: 6 reviews ─────────────────────────────────────────────────
  makeReview('review-071','building-07','user-07',{...HIGH,building_exterior:5,unit_structural:5},{comments:'Beautiful Back Bay brownstone. Well-maintained historic building with modern updates inside.',created_at:1683000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:3400}),
  makeReview('review-072','building-07','user-08',{...HIGH,unit_layout:5,unit_accuracy:4},{comments:'Classic brownstone layout with high ceilings. Listing photos were accurate. Worth the higher rent.',created_at:1685000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:3000}),
  makeReview('review-073','building-07','user-test-01',{...MID,unit_climate:2,landlord_maintenance:3},{comments:'Historic building has charm but old radiator heat is inconsistent. Cold rooms in winter on upper floors.',created_at:1687000000,move_in_year:2020,move_out_year:2022,unit_type:'studio',rent_amount:2200}),
  makeReview('review-074','building-07','user-04',{...HIGH,landlord_professionalism:5,landlord_lease_clarity:5},{comments:'Harbor Property Group is professional and thorough. Lease terms are fair and clearly explained.',created_at:1689000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2900}),
  makeReview('review-075','building-07','user-05',{...MID,building_parking:null,building_noise_external:2},{comments:'No parking available and street noise from Commonwealth Ave is constant. Beautiful building though.',created_at:1691000000,move_in_year:2022,move_out_year:2024,unit_type:'2br',rent_amount:3200}),
  makeReview('review-076','building-07','user-06',{...HIGH,unit_pests:5,unit_mold:5,building_security:5},{comments:'Impeccably maintained brownstone. Zero pest issues. Secure entry system. Excellent management.',created_at:1693000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:3100}),

  // ── building-08: 6 reviews ─────────────────────────────────────────────────
  makeReview('review-077','building-08','user-07',{...HIGH,building_exterior:5,unit_structural:4},{comments:'Another excellent Harbor brownstone on Marlborough St. Well-maintained and quiet street.',created_at:1684000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:3100}),
  makeReview('review-078','building-08','user-08',{...MID,unit_climate:3,building_noise_neighbors:3},{comments:'Thick brownstone walls reduce noise but heat distribution in the historic building is uneven.',created_at:1686000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:3300}),
  makeReview('review-079','building-08','user-test-01',{...HIGH,landlord_communication:5,landlord_deposit:5},{comments:'Exceptional management team. Communicated proactively throughout tenancy. Full deposit returned.',created_at:1688000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2950}),
  makeReview('review-080','building-08','user-04',{...HIGH,unit_pests:5,unit_mold:5},{comments:'Pest-free and mold-free for three years. Landlord invests in proper maintenance. Great Back Bay living.',created_at:1690000000,move_in_year:2020,move_out_year:2023,unit_type:'studio',rent_amount:2400}),
  makeReview('review-081','building-08','user-05',{...MID,landlord_maintenance:3,unit_plumbing:3},{comments:'Some plumbing delays but eventually resolved. Overall a solid building in a great location.',created_at:1692000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:3000}),
  makeReview('review-082','building-08','user-06',{...HIGH,unit_layout:4,building_common_areas:4},{comments:'Lovely Marlborough St address. Thoughtful unit layout. Shared entryway is well-kept.',created_at:1694000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3400}),

  // ── building-09: 5 reviews ─────────────────────────────────────────────────
  makeReview('review-083','building-09','user-07',{...HIGH,building_security:5,building_common_areas:5},{comments:'Modern condo building on Boylston. Great amenities, professional management, prime Back Bay location.',created_at:1685000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3500}),
  makeReview('review-084','building-09','user-08',{...MID,landlord_rent_practices:2},{comments:'Luxury building but rent increases are steep. Management is professional and building is well-maintained.',created_at:1687000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:3200}),
  makeReview('review-085','building-09','user-test-01',{...HIGH,unit_appliances:5,unit_climate:5},{comments:'Top-of-the-line appliances and excellent climate control. Bay State manages this building very well.',created_at:1689000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'studio',rent_amount:2800}),
  makeReview('review-086','building-09','user-04',{...MID,building_noise_external:3,building_noise_neighbors:3},{comments:'Some street noise from Boylston but triple-pane windows help. Central HVAC is reliable.',created_at:1691000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:3100}),
  makeReview('review-087','building-09','user-05',{...HIGH,landlord_professionalism:5,building_laundry:5},{comments:'Excellent condo management. In-unit washer/dryer in some units. Building amenities are excellent.',created_at:1693000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3400}),

  // ── building-10: 5 reviews ─────────────────────────────────────────────────
  makeReview('review-088','building-10','user-06',{...MID,unit_structural:4,building_exterior:4},{comments:'Classic Newbury St brownstone. Well-maintained exterior and solid unit structure. Atmospheric location.',created_at:1686000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2900}),
  makeReview('review-089','building-10','user-07',{...MID,unit_climate:2,building_noise_external:2},{comments:'Old windows let in cold air and Newbury St shopping noise. Charming building but practical issues.',created_at:1688000000,move_in_year:2022,move_out_year:2024,unit_type:'studio',rent_amount:2300}),
  makeReview('review-090','building-10','user-08',{...MID,landlord_communication:3},{comments:'Small building with individual ownership. Response times vary. Location is unbeatable on Newbury St.',created_at:1690000000,move_in_year:2020,move_out_year:2022,unit_type:'2br',rent_amount:3200}),
  makeReview('review-091','building-10','user-test-01',{...MID,unit_pests:4,unit_mold:4},{comments:'No pest issues and well-maintained plumbing for an 1898 building. Owner lives nearby and is attentive.',created_at:1692000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2800}),
  makeReview('review-092','building-10','user-04',{...MID,landlord_deposit:4,landlord_lease_clarity:4},{comments:'Straightforward lease and fair deposit handling. Owner is pleasant to deal with. Good location.',created_at:1694000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:3000}),

  // ── building-11: 4 reviews ─────────────────────────────────────────────────
  makeReview('review-093','building-11','user-05',{...MID,unit_structural:3,unit_pests:3},{comments:'Triple-decker in Dorchester managed by Dorchester Realty. Solid building with fair management.',created_at:1687000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2200}),
  makeReview('review-094','building-11','user-06',{...MID,landlord_maintenance:3,unit_plumbing:3},{comments:'Responsive enough for a smaller operation. No major emergencies in my time there. Affordable.',created_at:1689000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:1900}),
  makeReview('review-095','building-11','user-07',{...MID,building_noise_neighbors:2},{comments:'Floors between units are thin. Can hear neighbors walking above. Otherwise acceptable triple-decker.',created_at:1691000000,move_in_year:2020,move_out_year:2022,unit_type:'2br',rent_amount:2100}),
  makeReview('review-096','building-11','user-08',{...MID,unit_pests:2,unit_mold:2},{comments:'Some seasonal pest activity typical of older Dorchester homes. Management treats but issues recur.',created_at:1693000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:1950}),

  // ── building-12: 4 reviews ─────────────────────────────────────────────────
  makeReview('review-097','building-12','user-test-01',{...MID,building_exterior:3,unit_structural:3},{comments:'Another Dorchester triple-decker. Functional and affordable. Dorchester Realty is mediocre but not terrible.',created_at:1688000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2300}),
  makeReview('review-098','building-12','user-04',{...MID,landlord_deposit:3,landlord_rent_practices:3},{comments:'Average landlord experience. Some quibbling over deposit at move-out but was resolved. Decent apartment.',created_at:1690000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2000}),
  makeReview('review-099','building-12','user-05',{...MID,unit_climate:3,unit_pests:3},{comments:'Heat is provided through old radiators. Takes time to warm up in deep winter but eventually works.',created_at:1692000000,move_in_year:2020,move_out_year:2022,unit_type:'1br',rent_amount:1900}),
  makeReview('review-100','building-12','user-06',{...MID,landlord_communication:3,unit_appliances:3},{comments:'Appliances are older but functional. Landlord responds to calls within a day or two typically.',created_at:1694000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:2400}),

  // ── building-13: 3 reviews ─────────────────────────────────────────────────
  makeReview('review-101','building-13','user-07',{...MID,building_security:3,landlord_professionalism:3},{comments:'Blue Hill Ave apartment building. Patricia manages it without much professionalism but gets things done eventually.',created_at:1689000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:1800}),
  makeReview('review-102','building-13','user-08',{...MID,unit_pests:2,unit_mold:3},{comments:'Pest issues are a recurring problem on this stretch of Blue Hill Ave. Management treats but does not prevent.',created_at:1691000000,move_in_year:2020,move_out_year:2022,unit_type:'2br',rent_amount:2100}),
  makeReview('review-103','building-13','user-test-01',{...MID,landlord_communication:2,landlord_maintenance:2},{comments:'Hard to reach and slow to respond. Had a broken radiator for two weeks in December. Not recommended.',created_at:1693000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:1750}),

  // ── building-14: 3 reviews ─────────────────────────────────────────────────
  makeReview('review-104','building-14','user-04',{...MID,unit_structural:3,building_exterior:3},{comments:'Small Dorchester triple-decker with unknown ownership. Neighborhood is transitional but improving.',created_at:1690000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2200}),
  makeReview('review-105','building-14','user-05',{...MID,unit_pests:3,landlord_maintenance:3},{comments:'Owner-managed property. Generally responsive but takes longer than a professional company would.',created_at:1692000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:1900}),
  makeReview('review-106','building-14','user-06',{...MID,landlord_deposit:4,landlord_lease_clarity:4},{comments:'Fair deposit return and a clear lease. Good value in Dorchester. Would recommend for budget-conscious renters.',created_at:1694000000,move_in_year:2020,move_out_year:2022,unit_type:'1br',rent_amount:1850}),

  // ── building-15: 3 reviews ─────────────────────────────────────────────────
  makeReview('review-107','building-15','user-07',{...MID,unit_structural:4,building_exterior:3},{comments:'JP triple-decker managed by Commonwealth. Solid structure for a 1900 building. Management is decent.',created_at:1691000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:2500}),
  makeReview('review-108','building-15','user-08',{...MID,landlord_maintenance:4,landlord_communication:3},{comments:'Maintenance is responsive. Communication could be better but issues get resolved in reasonable time.',created_at:1693000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2100}),
  makeReview('review-109','building-15','user-test-01',{...MID,unit_pests:3,building_noise_neighbors:3},{comments:'Nice JP location on Centre St. Neighbors are a bit noisy but building is well-maintained overall.',created_at:1695000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2200}),

  // ── building-16: 2 reviews ─────────────────────────────────────────────────
  makeReview('review-110','building-16','user-04',{...MID,landlord_maintenance:4,building_laundry:3},{comments:'Commonwealth Housing manages this JP apartment. Maintenance is good, laundry could use updating.',created_at:1692000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2600}),
  makeReview('review-111','building-16','user-05',{...MID,unit_climate:3,building_common_areas:3},{comments:'Decent building in Jamaica Plain. Common areas are maintained. Heat is old-style baseboard.',created_at:1694000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2200}),

  // ── building-17: 2 reviews ─────────────────────────────────────────────────
  makeReview('review-112','building-17','user-06',{...MID,unit_structural:3,landlord_maintenance:3},{comments:'Robert Sullivan triple-decker in JP. Owner is old-school but generally responsive to issues.',created_at:1693000000,move_in_year:2022,move_out_year:2024,unit_type:'2br',rent_amount:2400}),
  makeReview('review-113','building-17','user-07',{...MID,unit_pests:3,unit_mold:3},{comments:'Typical older JP triple-decker. Has character but also older issues. Fair rent for the neighborhood.',created_at:1695000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2000}),

  // ── building-18: 2 reviews ─────────────────────────────────────────────────
  makeReview('review-114','building-18','user-08',{...MID,building_exterior:3,unit_appliances:3},{comments:'Pond St triple-decker. Quiet street in JP. Sullivan is slow but does get to maintenance eventually.',created_at:1694000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:2100}),
  makeReview('review-115','building-18','user-test-01',{...MID,landlord_communication:3,landlord_deposit:3},{comments:'Some friction at move-out over minor cleaning items. Resolved but annoying. Otherwise ok experience.',created_at:1696000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:2500}),

  // ── building-19: 2 reviews ─────────────────────────────────────────────────
  makeReview('review-116','building-19','user-04',{...HIGH,building_exterior:5,unit_structural:5},{comments:'Beautiful South End brownstone managed by Harbor. Historic character with modern maintenance.',created_at:1695000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3400}),
  makeReview('review-117','building-19','user-05',{...MID,unit_climate:3,building_noise_external:3},{comments:'Tremont St has some noise. Unit is comfortable and management is professional. Good South End location.',created_at:1697000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2800}),

  // ── building-20: 2 reviews ─────────────────────────────────────────────────
  makeReview('review-118','building-20','user-06',{...HIGH,building_common_areas:5,building_security:5},{comments:'Urban Realty brownstone on Rutland Square. Gorgeous location, excellent security, professional management.',created_at:1696000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'1br',rent_amount:3200}),
  makeReview('review-119','building-20','user-07',{...MID,unit_pests:3,landlord_rent_practices:3},{comments:'Great building but rent increases are Urban Realty standard. Beautiful South End brownstone overall.',created_at:1698000000,move_in_year:2021,move_out_year:2023,unit_type:'2br',rent_amount:3000}),

  // ── building-21 through building-29: 1 review each ────────────────────────
  makeReview('review-120','building-21','user-08',{...HIGH,unit_appliances:5,building_security:5},{comments:'New South End condo development. Bay State Property manages it professionally. Modern and comfortable.',created_at:1697000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3500}),
  makeReview('review-121','building-22','user-test-01',{...MID,unit_structural:4,building_exterior:4},{comments:'Charming South End brownstone. Owner-managed with care. Quiet Appleton St location.',created_at:1698000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2900}),
  makeReview('review-122','building-23','user-04',{...MID,building_noise_external:3,unit_appliances:3},{comments:'Fenway building managed by Fenway Property. Functional and close to Kenmore. Student-heavy crowd.',created_at:1699000000,move_in_year:2022,move_out_year:2024,unit_type:'studio',rent_amount:2000}),
  makeReview('review-123','building-24','user-05',{...MID,landlord_communication:3,building_laundry:4},{comments:'Good in-building laundry. Fenway Property is average on communication but responsive for emergencies.',created_at:1700000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2200}),
  makeReview('review-124','building-25','user-06',{...HIGH,unit_structural:5,unit_appliances:5},{comments:'Luxury Fenway condo with top-tier finishes. Bay State management is excellent. Worth the premium rent.',created_at:1701000000,move_in_year:2023,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:3500}),
  makeReview('review-125','building-26','user-07',{...MID,landlord_maintenance:3,building_exterior:3},{comments:'Allston Management Group handles this Brighton building adequately. Older property but functional.',created_at:1702000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:2100}),
  makeReview('review-126','building-27','user-08',{...MID,unit_structural:3,unit_pests:3},{comments:'Michael Chen triple-decker in Brighton. He is hands-on and responds to issues quickly. Good experience.',created_at:1703000000,move_in_year:2022,move_out_year:null,is_current_tenant:1,unit_type:'2br',rent_amount:2400}),
  makeReview('review-127','building-28','user-test-01',{...MID,building_common_areas:4,building_security:4},{comments:'Large Urban Realty complex in Brighton. Well-maintained and secure. Standard apartment experience.',created_at:1704000000,move_in_year:2022,move_out_year:2024,unit_type:'1br',rent_amount:2300}),
  makeReview('review-128','building-29','user-04',{...MID,unit_structural:3,landlord_maintenance:3},{comments:'Commonwealth triple-decker in Roxbury. Affordable and functional. Management is average overall.',created_at:1705000000,move_in_year:2021,move_out_year:2023,unit_type:'1br',rent_amount:1900}),
  // building-30: 0 reviews (empty state testing)
];

// ─── Disputes ──────────────────────────────────────────────────────────────────

interface Dispute {
  id: string;
  review_id: string;
  landlord_name: string;
  landlord_email: string;
  landlord_phone: string;
  dispute_reasons: string;
  dispute_explanation: string;
  status: string;
  resolution_outcome: string | null;
  resolution_notes: string | null;
  resolved_at: number | null;
  resolved_by: string | null;
  created_at: number;
  updated_at: number;
}

const DISPUTES: Dispute[] = [
  // 7 pending disputes
  {
    id: 'dispute-01',
    review_id: 'review-005',
    landlord_name: 'John Smith',
    landlord_email: 'john.smith@example.com',
    landlord_phone: '617-555-0201',
    dispute_reasons: '["inaccurate_information"]',
    dispute_explanation: 'The review contains factual errors about the property condition and maintenance response times.',
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: 1720000000,
    updated_at: 1720000000,
  },
  {
    id: 'dispute-02',
    review_id: 'review-011',
    landlord_name: 'David Park',
    landlord_email: 'david.park@example.com',
    landlord_phone: '617-555-0202',
    dispute_reasons: '["not_a_tenant"]',
    dispute_explanation: 'We have no record of this individual ever renting a unit in our building. The review appears to be fraudulent.',
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: 1721000000,
    updated_at: 1721000000,
  },
  {
    id: 'dispute-03',
    review_id: 'review-021',
    landlord_name: 'Maria Gonzalez',
    landlord_email: 'maria.gonzalez@example.com',
    landlord_phone: '617-555-0203',
    dispute_reasons: '["offensive_content"]',
    dispute_explanation: 'The review contains language that is personally offensive and directed at our maintenance staff by name.',
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: 1722000000,
    updated_at: 1722000000,
  },
  {
    id: 'dispute-04',
    review_id: 'review-048',
    landlord_name: 'Robert Chen',
    landlord_email: 'robert.chen@example.com',
    landlord_phone: '617-555-0204',
    dispute_reasons: '["inaccurate_information","offensive_content"]',
    dispute_explanation: 'Multiple claims in this review are false. The heat was never out for more than 24 hours and all repairs were documented.',
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: 1723000000,
    updated_at: 1723000000,
  },
  {
    id: 'dispute-05',
    review_id: 'review-052',
    landlord_name: 'Lisa Tran',
    landlord_email: 'lisa.tran@example.com',
    landlord_phone: '617-555-0205',
    dispute_reasons: '["inaccurate_information"]',
    dispute_explanation: 'The deposit deductions described were for documented damage beyond normal wear and tear as shown in move-out photos.',
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: 1724000000,
    updated_at: 1724000000,
  },
  {
    id: 'dispute-06',
    review_id: 'review-066',
    landlord_name: 'Urban Realty Partners',
    landlord_email: 'disputes@urbanrealty.example.com',
    landlord_phone: '617-555-0206',
    dispute_reasons: '["inaccurate_information"]',
    dispute_explanation: 'Rent increase figures cited are incorrect. All increases were within legal limits and given with proper notice as required by Boston law.',
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: 1725000000,
    updated_at: 1725000000,
  },
  {
    id: 'dispute-07',
    review_id: 'review-073',
    landlord_name: 'Harbor Property Group',
    landlord_email: 'disputes@harborproperty.example.com',
    landlord_phone: '617-555-0207',
    dispute_reasons: '["not_a_tenant","inaccurate_information"]',
    dispute_explanation: 'We cannot verify this person was a tenant at this address during the period described. The heat complaints do not match our records.',
    status: 'pending',
    resolution_outcome: null,
    resolution_notes: null,
    resolved_at: null,
    resolved_by: null,
    created_at: 1726000000,
    updated_at: 1726000000,
  },
  // 3 resolved disputes
  {
    id: 'dispute-08',
    review_id: 'review-036',
    landlord_name: 'Thomas McCarthy',
    landlord_email: 'thomas.mccarthy@example.com',
    landlord_phone: '617-555-0208',
    dispute_reasons: '["inaccurate_information"]',
    dispute_explanation: 'The review overstates pest problems. Building has active preventative pest control service.',
    status: 'resolved',
    resolution_outcome: 'dismiss',
    resolution_notes: 'Review content verified as accurate based on tenant maintenance records. Dispute dismissed.',
    resolved_at: 1728000000,
    resolved_by: 'user-admin-01',
    created_at: 1726500000,
    updated_at: 1728000000,
  },
  {
    id: 'dispute-09',
    review_id: 'review-050',
    landlord_name: 'Kevin Huang',
    landlord_email: 'kevin.huang@example.com',
    landlord_phone: '617-555-0209',
    dispute_reasons: '["offensive_content","not_a_tenant"]',
    dispute_explanation: 'The reviewer used derogatory language and we believe they were never a tenant at this property.',
    status: 'resolved',
    resolution_outcome: 'partially_valid',
    resolution_notes: 'Offensive language removed from review. Tenancy confirmed via lease records. Partial update applied.',
    resolved_at: 1729000000,
    resolved_by: 'user-admin-01',
    created_at: 1727000000,
    updated_at: 1729000000,
  },
  {
    id: 'dispute-10',
    review_id: 'review-024',
    landlord_name: 'Allston Management Group LLC',
    landlord_email: 'disputes@allstonmgmt.example.com',
    landlord_phone: '617-555-0210',
    dispute_reasons: '["inaccurate_information"]',
    dispute_explanation: 'The mold issue described was addressed within 48 hours of reporting and properly remediated by a licensed contractor.',
    status: 'resolved',
    resolution_outcome: 'uphold',
    resolution_notes: 'Remediation records provided by landlord are insufficient. Review content stands as submitted.',
    resolved_at: 1730000000,
    resolved_by: 'user-admin-01',
    created_at: 1727500000,
    updated_at: 1730000000,
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
    return `INSERT INTO buildings (id, landlord_id, address, slug, neighborhood, city, state, zip_code, year_built, unit_count, building_type, created_at, updated_at, latitude, longitude, google_place_id, property_manager_id, admin_notes, public_info, owner_name, owner_entity, owner_website) VALUES ('${escapeSql(b.id)}', ${landlordId}, '${escapeSql(b.address)}', '${escapeSql(b.slug)}', '${escapeSql(b.neighborhood)}', '${escapeSql(b.city)}', '${escapeSql(b.state)}', '${escapeSql(b.zip_code)}', ${b.year_built}, ${b.unit_count}, '${escapeSql(b.building_type)}', ${b.created_at}, ${b.updated_at}, ${b.latitude}, ${b.longitude}, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`;
  });
  executeSqlBatch(statements);
}

/**
 * Insert all 128 reviews into the reviews table.
 * Computes overall_score for each review using calculateOverallScore from scoring.ts.
 * Batches inserts in chunks of 30 to avoid oversized temp files.
 */
function insertReviews(): void {
  const inserts: string[] = [];
  for (const r of REVIEWS) {
    const overallScore = calculateOverallScore(r);
    const moveOutYear = r.move_out_year !== null ? String(r.move_out_year) : 'NULL';
    const moveOutSeason = r.move_out_season !== null ? `'${r.move_out_season}'` : 'NULL';
    const buildingParking = r.building_parking !== null ? String(r.building_parking) : 'NULL';
    const moveOutYearNew = r.move_out_year_new !== null ? `'${r.move_out_year_new}'` : 'NULL';

    inserts.push(`INSERT INTO reviews (
      id, user_id, building_id, move_in_year, move_in_season,
      move_out_year, move_out_season, is_current_tenant, unit_type, rent_amount,
      unit_structural, unit_plumbing, unit_electrical, unit_climate, unit_ventilation,
      unit_pests, unit_mold, unit_appliances, unit_layout, unit_accuracy,
      building_common_areas, building_security, building_exterior, building_noise_neighbors, building_noise_external,
      building_mail, building_laundry, building_parking, building_trash,
      landlord_maintenance, landlord_communication, landlord_professionalism, landlord_lease_clarity,
      landlord_privacy, landlord_deposit, landlord_rent_practices, landlord_non_retaliation,
      overall_score, status, comments, would_recommend_new,
      had_pests, had_heat_issues, had_water_issues, had_security_deposit_issues,
      created_at, updated_at, move_out_year_new
    ) VALUES (
      '${r.id}', '${r.user_id}', '${r.building_id}', ${r.move_in_year}, '${r.move_in_season}',
      ${moveOutYear}, ${moveOutSeason},
      ${r.is_current_tenant}, '${r.unit_type}', ${r.rent_amount},
      ${r.unit_structural}, ${r.unit_plumbing}, ${r.unit_electrical}, ${r.unit_climate}, ${r.unit_ventilation},
      ${r.unit_pests}, ${r.unit_mold}, ${r.unit_appliances}, ${r.unit_layout}, ${r.unit_accuracy},
      ${r.building_common_areas}, ${r.building_security}, ${r.building_exterior}, ${r.building_noise_neighbors}, ${r.building_noise_external},
      ${r.building_mail}, ${r.building_laundry}, ${buildingParking}, ${r.building_trash},
      ${r.landlord_maintenance}, ${r.landlord_communication}, ${r.landlord_professionalism}, ${r.landlord_lease_clarity},
      ${r.landlord_privacy}, ${r.landlord_deposit}, ${r.landlord_rent_practices}, ${r.landlord_non_retaliation},
      ${overallScore}, 'approved', '${escapeSql(r.comments)}', '${r.would_recommend_new}',
      ${r.had_pests}, ${r.had_heat_issues}, ${r.had_water_issues}, ${r.had_security_deposit_issues},
      ${r.created_at}, ${r.updated_at}, ${moveOutYearNew}
    )`);
  }

  const chunkSize = 30;
  for (let i = 0; i < inserts.length; i += chunkSize) {
    executeSqlBatch(inserts.slice(i, i + chunkSize));
  }
}

/**
 * Insert all 10 disputes into the disputes table.
 * Handles null resolution fields for pending disputes.
 */
function insertDisputes(): void {
  const inserts: string[] = [];
  for (const d of DISPUTES) {
    const resolutionOutcome = d.resolution_outcome !== null ? `'${escapeSql(d.resolution_outcome)}'` : 'NULL';
    const resolutionNotes = d.resolution_notes !== null ? `'${escapeSql(d.resolution_notes)}'` : 'NULL';
    const resolvedAt = d.resolved_at !== null ? String(d.resolved_at) : 'NULL';
    const resolvedBy = d.resolved_by !== null ? `'${escapeSql(d.resolved_by)}'` : 'NULL';

    inserts.push(`INSERT INTO disputes (
      id, review_id, landlord_name, landlord_email, landlord_phone,
      dispute_reasons, dispute_explanation, status,
      resolution_outcome, resolution_notes, resolved_at, resolved_by,
      created_at, updated_at
    ) VALUES (
      '${escapeSql(d.id)}', '${escapeSql(d.review_id)}',
      '${escapeSql(d.landlord_name)}', '${escapeSql(d.landlord_email)}', '${escapeSql(d.landlord_phone)}',
      '${escapeSql(d.dispute_reasons)}', '${escapeSql(d.dispute_explanation)}', '${d.status}',
      ${resolutionOutcome}, ${resolutionNotes}, ${resolvedAt}, ${resolvedBy},
      ${d.created_at}, ${d.updated_at}
    )`);
  }
  executeSqlBatch(inserts);
}

/**
 * Compute and insert building_scores rows for all buildings with reviews.
 * Skips building-30 (0 reviews). Populates avg_overall, review_count, pct_* columns.
 * Per-field averages are left NULL — building page falls back to live calculation.
 */
function insertBuildingScores(): void {
  const inserts: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const b of BUILDINGS) {
    const bReviews = REVIEWS.filter(r => r.building_id === b.id);
    if (bReviews.length === 0) continue;

    const avgs = calculateBuildingAverages(bReviews);

    inserts.push(`INSERT INTO building_scores (
      building_id, review_count, avg_overall,
      pct_would_recommend, pct_pest_issues, pct_heat_issues,
      pct_water_issues, pct_deposit_issues, updated_at
    ) VALUES (
      '${b.id}', ${avgs.review_count ?? bReviews.length}, ${avgs.avg_overall ?? 'NULL'},
      ${avgs.pct_would_recommend ?? 'NULL'}, ${avgs.pct_pest_issues ?? 'NULL'},
      ${avgs.pct_heat_issues ?? 'NULL'}, ${avgs.pct_water_issues ?? 'NULL'},
      ${avgs.pct_deposit_issues ?? 'NULL'}, ${now}
    )`);
  }

  executeSqlBatch(inserts);
}

/**
 * Compute and insert landlord_scores rows for all landlords with reviews.
 * building_count is the total number of buildings owned (not just reviewed ones).
 * Per-field averages are left NULL — pages fall back to live calculation.
 */
function insertLandlordScores(): void {
  const inserts: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const l of LANDLORDS) {
    const landlordBuildingIds = BUILDINGS
      .filter(b => b.landlord_id === l.id)
      .map(b => b.id);

    const lReviews = REVIEWS.filter(r => landlordBuildingIds.includes(r.building_id));
    if (lReviews.length === 0) continue;

    const avgs = calculateLandlordAverages(lReviews);

    inserts.push(`INSERT INTO landlord_scores (
      landlord_id, building_count, review_count, avg_overall,
      pct_would_recommend, pct_deposit_issues, updated_at
    ) VALUES (
      '${l.id}', ${landlordBuildingIds.length}, ${avgs.review_count ?? lReviews.length}, ${avgs.avg_overall ?? 'NULL'},
      ${avgs.pct_would_recommend ?? 'NULL'}, ${avgs.pct_deposit_issues ?? 'NULL'}, ${now}
    )`);
  }

  executeSqlBatch(inserts);
}

/**
 * Verify that stored building_scores match re-computed values from REVIEWS data.
 * Allows 0.01 tolerance for floating point rounding.
 * Returns true if all buildings verified, false if any mismatch found.
 */
function verifyScores(): boolean {
  process.stdout.write(`  ${BOLD}Verifying scores${RESET}... `);
  let allMatch = true;
  let checked = 0;

  for (const b of BUILDINGS) {
    const bReviews = REVIEWS.filter(r => r.building_id === b.id);
    if (bReviews.length === 0) continue;

    const rows = wranglerQuery(`SELECT avg_overall, review_count FROM building_scores WHERE building_id = '${b.id}'`);
    if (!rows || rows.length === 0) {
      console.error(`\n    ${RED}Missing building_scores row for ${b.id}${RESET}`);
      allMatch = false;
      continue;
    }

    const stored = rows[0];
    const expected = calculateBuildingAverages(bReviews);

    const storedOverall = stored.avg_overall;
    const expectedOverall = expected.avg_overall;

    if (storedOverall === null && expectedOverall === null) {
      // Both null — OK
    } else if (storedOverall === null || expectedOverall === null) {
      console.error(`\n    ${RED}Score null mismatch for ${b.id}: stored=${storedOverall}, expected=${expectedOverall}${RESET}`);
      allMatch = false;
    } else if (Math.abs(storedOverall - expectedOverall) > 0.01) {
      console.error(`\n    ${RED}Score mismatch for ${b.id}: stored=${storedOverall}, expected=${expectedOverall}${RESET}`);
      allMatch = false;
    }

    if (stored.review_count !== bReviews.length) {
      console.error(`\n    ${RED}Count mismatch for ${b.id}: stored=${stored.review_count}, expected=${bReviews.length}${RESET}`);
      allMatch = false;
    }

    checked++;
  }

  if (allMatch) {
    console.log(`${GREEN}✓${RESET} (${checked} buildings verified)`);
  } else {
    console.log(`${RED}✗${RESET}`);
  }

  return allMatch;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const isRemote = process.env.D1_REMOTE === '1';
  const reviewsOnly = process.env.SEED_REVIEWS_ONLY === '1';
  console.log(`\n  ${BOLD}Seed ${isRemote ? 'REMOTE' : 'local'} database${reviewsOnly ? ' (reviews only)' : ''}${RESET}\n`);

  if (!reviewsOnly) {
    assertDatabaseEmpty();
    run('Insert users (8)', () => insertUsers(TEST_PASSWORD_HASH));
    run('Insert landlords (10)', insertLandlords);
    run('Insert buildings (30)', insertBuildings);
  }

  run('Insert reviews (128)', insertReviews);
  run('Insert disputes (10)', insertDisputes);
  run('Compute building scores', insertBuildingScores);
  run('Compute landlord scores', insertLandlordScores);

  const ok = verifyScores();
  if (!ok) {
    console.error(`\n  ${RED}✗ Score verification failed${RESET}\n`);
    process.exit(1);
  }

  console.log(`\n  ${GREEN}✓ Seed complete — database ready${RESET}`);
  console.log(`\n  Summary: ${reviewsOnly ? '' : '8 users, 10 landlords, 30 buildings, '}128 reviews, 10 disputes`);
  if (!reviewsOnly) {
    console.log(`  Test credentials:  user@test.ratemyplace.local / TestPassword123!`);
    console.log(`  Admin credentials: admin@test.ratemyplace.local / TestPassword123!`);
  }
  console.log('');
  process.exit(0);
}

try {
  main();
} catch (err: any) {
  console.error(`\n  ${RED}✗ Seed failed: ${err.message}${RESET}\n`);
  process.exit(1);
}
