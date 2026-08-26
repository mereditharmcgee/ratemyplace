import type { APIContext } from 'astro';
import { describe, expect, it } from 'vitest';
import { GET as getLandlords } from '../../pages/api/admin/landlords/index';
import { GET as getManagers } from '../../pages/api/admin/managers/index';
import {
  createMemoryDatabase,
  sqliteAvailable,
  TestD1Database,
  type SQLiteDatabase,
} from './helpers/sqliteD1';

function makeContext(url: string, database: TestD1Database): APIContext {
  return {
    request: new Request(url),
    url: new URL(url),
    locals: {
      user: { id: 'admin-1', isAdmin: true },
      runtime: { env: { DB: database } },
    },
  } as unknown as APIContext;
}

function makeDatabase(): SQLiteDatabase {
  const database = createMemoryDatabase();
  database.exec(`
    CREATE TABLE landlords (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      website TEXT,
      phone TEXT,
      email TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE property_managers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      company_name TEXT,
      description TEXT,
      website TEXT,
      phone TEXT,
      email TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      landlord_id TEXT,
      property_manager_id TEXT
    );
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      status TEXT NOT NULL,
      overall_score REAL,
      move_out_year_new TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  database.exec(`
    INSERT INTO landlords VALUES
      ('landlord-thin', 'Thin Data Landlord', 'thin-data-landlord', NULL, NULL, NULL, NULL, 1),
      ('landlord-established', 'Established Landlord', 'established-landlord', NULL, NULL, NULL, NULL, 1);
    INSERT INTO property_managers VALUES
      ('manager-thin', 'Thin Data Manager', 'thin-data-manager', NULL, NULL, NULL, NULL, NULL, 1),
      ('manager-established', 'Established Manager', 'established-manager', NULL, NULL, NULL, NULL, NULL, 1);
    INSERT INTO buildings VALUES
      ('building-landlord-thin', 'landlord-thin', NULL),
      ('building-landlord-thin-2', 'landlord-thin', NULL),
      ('building-landlord-established', 'landlord-established', NULL),
      ('building-landlord-established-2', 'landlord-established', NULL),
      ('building-manager-thin', NULL, 'manager-thin'),
      ('building-manager-thin-2', NULL, 'manager-thin'),
      ('building-manager-established', NULL, 'manager-established'),
      ('building-manager-established-2', NULL, 'manager-established');
    INSERT INTO reviews VALUES
      ('lt-1', 'building-landlord-thin', 'approved', 4.8, '2026', 1),
      ('lt-2', 'building-landlord-thin-2', 'approved', 4.8, '2026', 1),
      ('le-1', 'building-landlord-established', 'approved', 4.2, '2026', 1),
      ('le-2', 'building-landlord-established', 'approved', 4.2, '2026', 1),
      ('le-3', 'building-landlord-established-2', 'approved', 4.2, '2026', 1),
      ('mt-1', 'building-manager-thin', 'approved', 4.8, '2026', 1),
      ('mt-2', 'building-manager-thin-2', 'approved', 4.8, '2026', 1),
      ('me-1', 'building-manager-established', 'approved', 4.2, '2026', 1),
      ('me-2', 'building-manager-established', 'approved', 4.2, '2026', 1),
      ('me-3', 'building-manager-established-2', 'approved', 4.2, '2026', 1);
  `);

  return database;
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('admin named-party aggregate routes', () => {
  it('keeps raw landlord scores but excludes thin data from high-rated stats', async () => {
    const sqlite = makeDatabase();
    try {
      const response = await getLandlords(makeContext(
        'https://ratemyplace.org/api/admin/landlords',
        new TestD1Database(sqlite),
      ));
      const body = await response.json() as {
        landlords: Array<{ id: string; review_count: number; avg_score: number | null }>;
        stats: { high_rated: number };
      };

      const thinDataLandlord = body.landlords.find((landlord) => landlord.id === 'landlord-thin');
      expect(thinDataLandlord).toMatchObject({ review_count: 2, avg_score: 4.8 });
      expect(body.stats.high_rated).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('keeps raw property-manager scores below the public threshold', async () => {
    const sqlite = makeDatabase();
    try {
      const response = await getManagers(makeContext(
        'https://ratemyplace.org/api/admin/managers',
        new TestD1Database(sqlite),
      ));
      const body = await response.json() as {
        managers: Array<{ id: string; review_count: number; avg_score: number | null }>;
      };

      const thinDataManager = body.managers.find((manager) => manager.id === 'manager-thin');
      const establishedManager = body.managers.find((manager) => manager.id === 'manager-established');
      expect(thinDataManager).toMatchObject({ review_count: 2, avg_score: 4.8 });
      expect(establishedManager).toMatchObject({ review_count: 3, avg_score: 4.2 });
    } finally {
      sqlite.close();
    }
  });
});
