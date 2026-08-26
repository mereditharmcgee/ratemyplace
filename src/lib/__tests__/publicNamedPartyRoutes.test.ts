import type { APIContext } from 'astro';
import { describe, expect, it } from 'vitest';
import { GET as getSearchResults } from '../../pages/api/search/results';
import { GET as getAutocomplete } from '../../pages/api/search/autocomplete';
import {
  createMemoryDatabase,
  sqliteAvailable,
  TestD1Database,
  type SQLiteDatabase,
} from './helpers/sqliteD1';

function makeContext(url: string, database: TestD1Database): APIContext {
  const request = new Request(url, {
    headers: { 'X-Forwarded-For': '127.0.0.1' },
  });

  return {
    request,
    url: new URL(url),
    locals: { runtime: { env: { DB: database } } },
  } as unknown as APIContext;
}

function makeDatabase(): SQLiteDatabase {
  const database = createMemoryDatabase();
  database.exec(`
    CREATE TABLE rate_limits (
      rate_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE landlords (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL
    );
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      neighborhood TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      slug TEXT NOT NULL,
      landlord_id TEXT
    );
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      status TEXT NOT NULL,
      overall_score REAL,
      move_out_year_new TEXT,
      created_at INTEGER NOT NULL
    );

    INSERT INTO landlords VALUES
      ('landlord-thin', 'Thin Data Landlord', 'thin-data-landlord'),
      ('landlord-established', 'Established Landlord', 'established-landlord');
    INSERT INTO buildings VALUES
      ('building-thin', '10 Oak Street', 'Back Bay', 'Boston', 'MA', '10-oak-street', 'landlord-thin'),
      ('building-thin-2', '12 Oak Street', 'Back Bay', 'Boston', 'MA', '12-oak-street', 'landlord-thin'),
      ('building-established', '20 Pine Street', 'South End', 'Boston', 'MA', '20-pine-street', 'landlord-established'),
      ('building-established-2', '22 Pine Street', 'South End', 'Boston', 'MA', '22-pine-street', 'landlord-established'),
      ('building-one-review', '30 Main Street', 'Roxbury', 'Boston', 'MA', '30-main-street', NULL);
    INSERT INTO reviews VALUES
      ('thin-1', 'building-thin', 'approved', 4.8, '2026', 1),
      ('thin-2', 'building-thin-2', 'approved', 4.8, '2026', 1),
      ('established-1', 'building-established', 'approved', 4.2, '2026', 1),
      ('established-2', 'building-established', 'approved', 4.2, '2026', 1),
      ('established-3', 'building-established-2', 'approved', 4.2, '2026', 1),
      ('building-1', 'building-one-review', 'approved', 4.6, '2026', 1);
  `);
  return database;
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('public named-party aggregate routes', () => {
  it('withholds a thin-data landlord score in paginated search JSON', async () => {
    const sqlite = makeDatabase();
    try {
      const response = await getSearchResults(makeContext(
        'https://ratemyplace.org/api/search/results?type=landlords',
        new TestD1Database(sqlite),
      ));
      const body = await response.json() as {
        results: Array<{ slug: string; review_count: number; avg_overall: number | null }>;
      };

      expect(body.results.find((result) => result.slug === 'thin-data-landlord')).toMatchObject({
        review_count: 2,
        avg_overall: null,
      });
      expect(body.results.find((result) => result.slug === 'established-landlord')).toMatchObject({
        review_count: 3,
        avg_overall: 4.2,
      });
    } finally {
      sqlite.close();
    }
  });

  it('keeps a one-review building score in paginated search JSON', async () => {
    const sqlite = makeDatabase();
    try {
      const response = await getSearchResults(makeContext(
        'https://ratemyplace.org/api/search/results?type=buildings',
        new TestD1Database(sqlite),
      ));
      const body = await response.json() as {
        results: Array<{ slug: string; review_count: number; avg_overall: number | null }>;
      };

      expect(body.results.find((result) => result.slug === '30-main-street')).toMatchObject({
        review_count: 1,
        avg_overall: 4.6,
      });
    } finally {
      sqlite.close();
    }
  });

  it('withholds a thin-data landlord score in autocomplete JSON', async () => {
    const sqlite = makeDatabase();
    try {
      const response = await getAutocomplete(makeContext(
        'https://ratemyplace.org/api/search/autocomplete?q=Thin',
        new TestD1Database(sqlite),
      ));
      const body = await response.json() as {
        results: Array<{ type: string; slug: string; reviewCount: number; avgScore: number | null }>;
      };
      const landlord = body.results.find((result) => result.type === 'landlord');

      expect(landlord).toMatchObject({
        slug: 'thin-data-landlord',
        reviewCount: 2,
        avgScore: null,
      });
    } finally {
      sqlite.close();
    }
  });
});
