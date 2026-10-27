import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import SearchPage from '../../pages/search.astro';
import { searchEmptyState } from '../searchEmptyState';
import {
  createMemoryDatabase,
  sqliteAvailable,
  TestD1Database,
  type SQLiteDatabase,
} from './helpers/sqliteD1';

/**
 * What /search says when nothing matches. The Landlords filter searches landlord names
 * only, so its empty state must not fall back to the buildings message ("partial street
 * name"), which tells someone looking for a landlord to type a street.
 */
describe('searchEmptyState', () => {
  const none = { areaSearch: false, streetQuery: null };

  it('gives the Landlords filter its own message and a way to search buildings', () => {
    const state = searchEmptyState({ query: 'Example Realty', type: 'landlords', ...none });
    expect(state.title).toBe('No landlords match that search');
    expect(state.description).toBe(
      'Landlords named in reviews are listed once one of their buildings has a review. Owners of record are listed when the owner is a business or has two or more residential buildings here. Try part of the name.',
    );
    expect(state.next).toEqual({
      label: 'Search buildings instead',
      href: '/search?q=Example%20Realty&type=buildings',
    });
  });

  it('keeps the landlord message even when the query reads like an address or a place', () => {
    for (const extra of [{ areaSearch: true, streetQuery: null }, { areaSearch: false, streetQuery: 'Example Rd' }]) {
      const state = searchEmptyState({ query: '12 Example Rd', type: 'landlords', ...extra });
      expect(state.title).toBe('No landlords match that search');
      expect(state.description).not.toMatch(/street|neighborhood/i);
    }
  });

  it('encodes the query in the buildings link', () => {
    const state = searchEmptyState({ query: 'A & B #2', type: 'landlords', ...none });
    expect(state.next?.href).toBe('/search?q=A%20%26%20B%20%232&type=buildings');
  });

  it.each(['all', 'buildings'])('keeps the buildings messages for type=%s', (type) => {
    expect(searchEmptyState({ query: 'zzqx', type, ...none })).toEqual({
      title: 'No buildings match that search',
      description: 'Try a wider neighborhood or a partial street name.',
      next: null,
    });
    expect(searchEmptyState({ query: 'Brighton', type, areaSearch: true, streetQuery: null })).toEqual({
      title: 'No buildings listed under that neighborhood or ZIP code',
      description: 'Some buildings have no neighborhood on file. Try the street name or the full address.',
      next: null,
    });
    expect(searchEmptyState({ query: '99 Example Rd', type, areaSearch: false, streetQuery: 'Example Rd' })).toEqual({
      title: 'No buildings match that address',
      description: 'Try the street without the house number.',
      next: { label: 'Search Example Rd', href: '/search?q=Example%20Rd' },
    });
  });

  it('falls back to the buildings message for an unknown type', () => {
    expect(searchEmptyState({ query: 'zzqx', type: 'nonsense', ...none }).title).toBe('No buildings match that search');
  });
});

function makeDatabase(): SQLiteDatabase {
  const database = createMemoryDatabase();
  database.exec(`
    CREATE TABLE landlords (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL);
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      neighborhood TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      slug TEXT NOT NULL,
      landlord_id TEXT,
      parcel_id TEXT,
      st_num_lo INTEGER,
      st_num_hi INTEGER
    );
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      status TEXT NOT NULL,
      overall_score REAL,
      landlord_maintenance REAL,
      would_recommend_new TEXT,
      had_security_deposit_issues INTEGER,
      move_out_year_new TEXT,
      created_at INTEGER NOT NULL
    );
    INSERT INTO landlords VALUES ('l1', 'Example Realty', 'example-realty');
    INSERT INTO buildings (id, address, neighborhood, city, state, slug, landlord_id) VALUES
      ('b1', '12 Example Road', 'Brighton', 'Boston', 'MA', '12-example-road', 'l1');
    INSERT INTO reviews VALUES ('r1', 'b1', 'approved', 4.0, 4.0, 'yes', 0, '2026', 1);
  `);
  return database;
}

async function renderSearch(database: SQLiteDatabase, query: string, type: string): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container.renderToString(SearchPage, {
    request: new Request(`https://ratemyplace.org/search?q=${encodeURIComponent(query)}&type=${type}`),
    locals: {
      user: null,
      session: null,
      runtime: { env: { DB: new TestD1Database(database) } },
    } as unknown as App.Locals,
    partial: false,
  });
}

function mainText(html: string): string {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error('Rendered page is missing <main>');
  return match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function mainLinks(html: string): HTMLAnchorElement[] {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error('Rendered page is missing <main>');
  const fragment = document.createElement('div');
  fragment.innerHTML = match[1];
  return Array.from(fragment.querySelectorAll('a'));
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('search page empty states, rendered', () => {
  it('a Landlords search with no match says so, without the street-name hint', async () => {
    const database = makeDatabase();
    try {
      const html = await renderSearch(database, 'Nobody Holdings', 'landlords');
      const text = mainText(html);
      expect(text).toContain('No landlords match that search');
      expect(text).toContain('Landlords named in reviews are listed once one of their buildings has a review.');
      expect(text).not.toContain('No buildings match');
      expect(text).not.toContain('partial street name');
      const link = mainLinks(html).find((a) => a.textContent?.trim() === 'Search buildings instead');
      expect(link?.getAttribute('href')).toBe('/search?q=Nobody%20Holdings&type=buildings');
    } finally {
      database.close();
    }
  });

  it('a Landlords search that matches still lists the landlord', async () => {
    const database = makeDatabase();
    try {
      const text = mainText(await renderSearch(database, 'Example', 'landlords'));
      expect(text).toContain('Example Realty');
      expect(text).not.toContain('No landlords match');
    } finally {
      database.close();
    }
  });

  it('a Buildings search with no match keeps the buildings message', async () => {
    const database = makeDatabase();
    try {
      const text = mainText(await renderSearch(database, 'zzqx', 'buildings'));
      expect(text).toContain('No buildings match that search');
      expect(text).not.toContain('No landlords match');
      expect(text).not.toContain('Search buildings instead');
    } finally {
      database.close();
    }
  });
});
