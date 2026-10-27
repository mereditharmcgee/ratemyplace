import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import ReviewNewPage from '../../pages/review/new.astro';
import {
  createMemoryDatabase,
  sqliteAvailable,
  TestD1Database,
  type SQLiteDatabase,
} from './helpers/sqliteD1';

// The review form is a client:load island, so every prop it receives is
// serialized into the page HTML. The page must hand it only the columns
// the form renders, never the admin-only building columns.

const suite = sqliteAvailable ? describe : describe.skip;

const SENTINELS = [
  'SENTINEL-ADMIN-NOTE',
  'SENTINEL-OWNER-NAME',
  'SENTINEL-OWNER-ENTITY',
  'SENTINEL-PUBLIC-INFO',
  'https://sentinel-owner.example',
];
const PRIVATE_KEYS = ['admin_notes', 'owner_name', 'owner_entity', 'owner_website', 'public_info'];

function makeDatabase(): SQLiteDatabase {
  const database = createMemoryDatabase();
  database.exec(`
    CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, read_at INTEGER);
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      slug TEXT NOT NULL,
      neighborhood TEXT,
      city TEXT NOT NULL,
      state TEXT,
      zip_code TEXT,
      google_place_id TEXT,
      admin_notes TEXT,
      owner_name TEXT,
      owner_entity TEXT,
      owner_website TEXT,
      public_info TEXT
    );
    INSERT INTO buildings
      (id, address, slug, neighborhood, city, state, zip_code, google_place_id,
       admin_notes, owner_name, owner_entity, owner_website, public_info)
    VALUES
      ('b-leak', '45 Melnea Cass Blvd', '45-melnea-cass-blvd-boston', 'Roxbury', 'Boston', 'MA', '02119', 'gp-leak',
       'SENTINEL-ADMIN-NOTE', 'SENTINEL-OWNER-NAME', 'SENTINEL-OWNER-ENTITY', 'https://sentinel-owner.example',
       'SENTINEL-PUBLIC-INFO');
  `);
  return database;
}

function locals(database: SQLiteDatabase, signedIn: boolean): App.Locals {
  return {
    user: signedIn ? { id: 'u-1', email: 'u@example.com', isAdmin: false } : null,
    session: signedIn ? { id: 's-1' } : null,
    runtime: { env: { DB: new TestD1Database(database) } },
  } as unknown as App.Locals;
}

async function createContainer(): Promise<AstroContainer> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({
    name: '@astrojs/react',
    entrypoint: '@astrojs/react/client.js',
  });
  return container;
}

async function render(search: string): Promise<string> {
  const container = await createContainer();
  return container.renderToString(ReviewNewPage, {
    request: new Request(`https://ratemyplace.org/review/new${search}`),
    locals: locals(makeDatabase(), true),
    partial: false,
  });
}

function expectNoPrivateColumns(html: string): void {
  for (const sentinel of SENTINELS) expect(html).not.toContain(sentinel);
  for (const key of PRIVATE_KEYS) expect(html).not.toContain(key);
}

suite('/review/new island props', () => {
  it('?building= passes the form only the columns it renders', async () => {
    const html = await render('?building=b-leak');
    expect(html).toContain('45 Melnea Cass Blvd');
    expectNoPrivateColumns(html);
  });

  it('?placeId= for a known place passes the form only the columns it renders', async () => {
    const html = await render('?placeId=gp-leak');
    expect(html).toContain('45 Melnea Cass Blvd');
    expectNoPrivateColumns(html);
  });

  it('still sends a signed-out visitor to sign in with the full return path', async () => {
    const container = await createContainer();
    const response = await container.renderToResponse(ReviewNewPage, {
      request: new Request('https://ratemyplace.org/review/new?placeId=gp-leak'),
      locals: locals(makeDatabase(), false),
      partial: false,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      '/auth/signin?redirect=%2Freview%2Fnew%3FplaceId%3Dgp-leak',
    );
  });
});
