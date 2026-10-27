import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReviewNewPage from '../../pages/review/new.astro';
import { checkRateLimit } from '../rateLimit';
import { HANDOFF_COPY } from '../reviewHandoff';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
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

  it('?placeId= for a known place redirects to ?building=, which renders only those columns', async () => {
    // Since the handoff stopped rendering the form itself, a known place id 302s to the
    // ?building= page above, so that case is the one that guards this path's props too.
    const container = await createContainer();
    const response = await container.renderToResponse(ReviewNewPage, {
      request: new Request('https://ratemyplace.org/review/new?placeId=gp-leak'),
      locals: locals(makeDatabase(), true),
      partial: false,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/review/new?building=b-leak');
    expectNoPrivateColumns(await response.text());
  });

  it('puts the Turnstile load guard before the Turnstile script tag', async () => {
    // The guard removes a Turnstile <script> that fails to load, so the form's "Try again"
    // can tell failed (no tag) from pending (tag present) and never runs api.js twice.
    const html = await render('?building=b-leak');
    const guard = html.indexOf('data-rmp-turnstile-guard');
    const tag = html.indexOf('turnstile/v0/api.js?render=explicit');
    expect(guard).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(guard);
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

/**
 * The handoff and the ?building= notes, against the records schema (rate_limits, the key
 * columns and the seeded 86-88 Crawford parcel). None of these requests may write a
 * building: GET /review/new never does.
 */
suite('/review/new handoff', () => {
  function recordsDb(): TestD1Database {
    const db = createRecordsTestDb();
    db.exec('ALTER TABLE buildings ADD COLUMN admin_notes TEXT; ALTER TABLE buildings ADD COLUMN public_info TEXT; ALTER TABLE buildings ADD COLUMN owner_website TEXT;');
    return db;
  }

  async function seeded(): Promise<TestD1Database> {
    const db = recordsDb();
    await insertBuilding(db, { id: 'b-leak', address: '45 Melnea Cass Blvd', slug: '45-melnea-cass-blvd-boston', zip_code: '02119', google_place_id: 'gp-leak' });
    await insertBuilding(db, {
      id: 'seed-1202188000',
      address: '86-88 Crawford Street',
      slug: '86-88-crawford-street-boston',
      zip_code: '02121',
      source: 'seed',
      street_key: 'CRAWFORD ST',
      st_num_lo: 86,
      st_num_hi: 88,
    });
    return db;
  }

  function withEnv(db: TestD1Database, env: Record<string, unknown> = {}): App.Locals {
    return {
      user: { id: 'u-1', email: 'u@example.com', isAdmin: false },
      session: { id: 's-1' },
      runtime: { env: { DB: db, ...env } },
    } as unknown as App.Locals;
  }

  async function request(db: TestD1Database, search: string, env: Record<string, unknown> = {}): Promise<Response> {
    const container = await createContainer();
    return container.renderToResponse(ReviewNewPage, {
      request: new Request(`https://ratemyplace.org/review/new${search}`),
      locals: withEnv(db, env),
      partial: false,
    });
  }

  async function count(db: TestD1Database, sql: string): Promise<number> {
    return ((await db.prepare(sql).first<{ n: number }>()) ?? { n: -1 }).n;
  }

  const buildingCount = (db: TestD1Database) => count(db, 'SELECT COUNT(*) AS n FROM buildings');

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('?building=&partOf=1 explains which parcel the review goes on', async () => {
    const db = await seeded();
    const html = await (await request(db, '?building=b-leak&partOf=1')).text();
    expect(html).toContain('property records list the address you picked as part of 45 Melnea Cass Blvd');
  });

  it('?building= without the flag has no note', async () => {
    const db = await seeded();
    const html = await (await request(db, '?building=b-leak')).text();
    expect(html).not.toContain('property records list');
  });

  it('?building= for an unknown id says so', async () => {
    const db = await seeded();
    const html = await (await request(db, '?building=missing')).text();
    expect(html).toContain(HANDOFF_COPY.notFound);
  });

  it('a malformed place id is refused without a write', async () => {
    const db = await seeded();
    const before = await buildingCount(db);
    const html = await (await request(db, '?placeId=..%2Fx')).text();
    expect(html).toContain(HANDOFF_COPY.lookupFailed);
    expect(await buildingCount(db)).toBe(before);
  });

  it('an unknown place with no Places key is unavailable, spends no limiter slot and writes nothing', async () => {
    const db = await seeded();
    const before = await buildingCount(db);
    const html = await (await request(db, '?placeId=ChIJunknown00')).text();
    expect(html).toContain(HANDOFF_COPY.unavailable);
    expect(await buildingCount(db)).toBe(before);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM rate_limits')).toBe(0);
  });

  function stubGoogleCrawford() {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'ChIJcrawford',
      formattedAddress: '86 Crawford St, Boston, MA 02121, USA',
      addressComponents: [
        { longText: '86', shortText: '86', types: ['street_number'] },
        { longText: 'Crawford Street', shortText: 'Crawford St', types: ['route'] },
        { longText: 'Dorchester', shortText: 'Dorchester', types: ['neighborhood'] },
        { longText: 'Boston', shortText: 'Boston', types: ['locality'] },
        { longText: 'Massachusetts', shortText: 'MA', types: ['administrative_area_level_1'] },
        { longText: '02121', shortText: '02121', types: ['postal_code'] },
      ],
      location: { latitude: 42.31, longitude: -71.08 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('a Google place inside a seeded range redirects to the seed, flagged part-of, without a write', async () => {
    const db = await seeded();
    const fetchMock = stubGoogleCrawford();
    const before = await buildingCount(db);
    const response = await request(db, '?placeId=ChIJcrawford', { GOOGLE_PLACES_API_KEY: 'k' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/review/new?building=seed-1202188000&partOf=1');
    expect(await buildingCount(db)).toBe(before);
  });

  it('past 30 lookups an hour the handoff is unavailable and Google is not called', async () => {
    const db = await seeded();
    for (let i = 0; i < 30; i += 1) await checkRateLimit(db, 'u-1', 'review-handoff', 30, 3600);
    const fetchMock = stubGoogleCrawford();
    const before = await buildingCount(db);
    const html = await (await request(db, '?placeId=ChIJcrawford', { GOOGLE_PLACES_API_KEY: 'k' })).text();
    expect(html).toContain(HANDOFF_COPY.unavailable);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await buildingCount(db)).toBe(before);
  });
});
