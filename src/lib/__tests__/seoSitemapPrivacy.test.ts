import { describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { GET as indexGet } from '../../pages/sitemap.xml';
import { GET as staticGet } from '../../pages/sitemaps/static.xml';
import { GET as buildingsGet } from '../../pages/sitemaps/buildings-[n].xml';
import { STATIC_SITEMAP_PATHS } from '../sitemap';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * SEO-06, the sitemap side. recordsSitemap.test.ts proves who is in the sitemap; this proves
 * what the files can never carry: an internal id, a unit number, a reviewer email, a score of
 * any kind, a property-manager page, or a URL outside the public allowlist. Every value is a
 * neutral sentinel, and every id differs from its slug so a leaked id cannot pass for a slug.
 */

const suite = sqliteAvailable ? describe : describe.skip;
const SITE = 'https://ratemyplace.org';

const UNIT = 'UNIT-SENTINEL-4B';
const EMAIL = 'tenant-sentinel@example.test';
const USER_ID = 'user-INTERNAL-9c1d';
// No '?' here: the XML declaration has two. A query string in a loc fails ALLOWED_LOC instead.
const SECRETS = ['INTERNAL', UNIT, 'unit_number', EMAIL, 'example.test', '4.8', '4.6', '5.0', '1.2', '/property-manager/', 'admin_notes'];

const ALLOWED_LOC = new RegExp(
  `^${SITE.replace(/\./g, '\\.')}(/|/(about|contact|guidelines|map|methodology|privacy|search|terms)|/landlord/[a-z0-9-]+|/building/[a-z0-9-]+|/sitemaps/(static|buildings-\\d+)\\.xml)$`,
);
const ALLOWED_ELEMENTS = ['urlset', 'url', 'loc', 'lastmod', 'sitemapindex', 'sitemap'];

async function seed(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec('ALTER TABLE reviews ADD COLUMN unit_number TEXT;');
  await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(USER_ID, EMAIL).run();
  await db
    .prepare('INSERT INTO landlords (id, name, slug) VALUES (?, ?, ?), (?, ?, ?)')
    .bind('ll-INTERNAL-thin-5e2b', 'Thin Fixture Holdings', 'thin-fixture-holdings', 'll-INTERNAL-pend-1a2b', 'Pending Fixture Landlord', 'pending-fixture-landlord')
    .run();
  await db.prepare('INSERT INTO property_managers (id, name, slug) VALUES (?, ?, ?)').bind('pm-INTERNAL-7a4d', 'Thin Fixture Management', 'thin-fixture-management').run();

  // Explicit neutral addresses and slugs: insertBuilding's defaults are a real-place fixture.
  await insertBuilding(db, { id: 'bldg-INTERNAL-7f3a', slug: '1-test-street-boston', address: '1 Test Street' });
  await insertBuilding(db, { id: 'bldg-INTERNAL-8b4c', slug: '3-test-street-boston', address: '3 Test Street' });
  // Pending review only, and not a Boston parcel: in neither sitemap.
  await insertBuilding(db, { id: 'bldg-INTERNAL-9d5e', slug: '5-test-street-new-haven', address: '5 Test Street', city: 'New Haven', state: 'CT', zip_code: '06511' });
  // A seeded Boston parcel with no review: a records page, in the building sitemap.
  await insertBuilding(db, { id: 'bldg-INTERNAL-0e6f', slug: '7-test-street-boston', address: '7 Test Street', parcel_id: '0100000007', source: 'seed' });
  await db
    .prepare("UPDATE buildings SET landlord_id = 'll-INTERNAL-thin-5e2b', property_manager_id = 'pm-INTERNAL-7a4d' WHERE id IN ('bldg-INTERNAL-7f3a', 'bldg-INTERNAL-8b4c')")
    .run();
  await db.prepare("UPDATE buildings SET landlord_id = 'll-INTERNAL-pend-1a2b' WHERE id = 'bldg-INTERNAL-9d5e'").run();

  const review = (id: string, buildingId: string, status: string, score: number) =>
    db
      .prepare('INSERT INTO reviews (id, user_id, building_id, status, overall_score, unit_number, created_at) VALUES (?, ?, ?, ?, ?, ?, 1700000000)')
      .bind(id, USER_ID, buildingId, status, score, UNIT)
      .run();
  // Two approved reviews: the landlord and manager aggregate (4.8) is below the threshold.
  await review('rev-INTERNAL-a1', 'bldg-INTERNAL-7f3a', 'approved', 4.6);
  await review('rev-INTERNAL-a2', 'bldg-INTERNAL-8b4c', 'approved', 5.0);
  await review('rev-INTERNAL-p1', 'bldg-INTERNAL-9d5e', 'pending', 1.2);
  return db;
}

function context(db: unknown, path: string, params: Record<string, string> = {}): APIContext {
  return {
    request: new Request(`${SITE}${path}`),
    params,
    url: new URL(`${SITE}${path}`),
    locals: { user: null, runtime: { env: { DB: db, SITE_URL: SITE } } },
  } as unknown as APIContext;
}

async function bodies(db: TestD1Database): Promise<{ index: string; statics: string; chunk: string }> {
  const index = await indexGet(context(db, '/sitemap.xml'));
  const statics = await staticGet(context(db, '/sitemaps/static.xml'));
  const chunk = await buildingsGet(context(db, '/sitemaps/buildings-1.xml', { n: '1' }));
  for (const response of [index, statics, chunk]) expect(response.status).toBe(200);
  return { index: await index.text(), statics: await statics.text(), chunk: await chunk.text() };
}

const locs = (xml: string): string[] => Array.from(xml.matchAll(/<loc>([^<]*)<\/loc>/g), (match) => match[1]);
const elements = (xml: string): string[] => [...new Set(Array.from(xml.matchAll(/<\/?([A-Za-z][\w:-]*)/g), (match) => match[1]))];

suite('sitemap privacy (SEO-06)', () => {
  it('carries no id, unit number, email, score or property-manager page in any file', async () => {
    const { index, statics, chunk } = await bodies(await seed());
    for (const body of [index, statics, chunk]) {
      for (const secret of SECRETS) expect(body).not.toContain(secret);
    }
  });

  it('lists only allowlisted public URLs', async () => {
    const { index, statics, chunk } = await bodies(await seed());
    const all = [...locs(index), ...locs(statics), ...locs(chunk)];
    expect(all.length).toBeGreaterThan(STATIC_SITEMAP_PATHS.length);
    for (const loc of all) expect(loc, loc).toMatch(ALLOWED_LOC);
  });

  it('uses only sitemap elements', async () => {
    const { index, statics, chunk } = await bodies(await seed());
    for (const body of [index, statics, chunk]) {
      for (const element of elements(body)) expect(ALLOWED_ELEMENTS, element).toContain(element);
    }
  });

  it('names a landlord by slug only once it has an approved review', async () => {
    const { statics } = await bodies(await seed());
    expect(locs(statics)).toContain(`${SITE}/landlord/thin-fixture-holdings`);
    expect(statics).not.toContain('pending-fixture-landlord');
    expect(statics).not.toContain('Thin Fixture Holdings');
  });

  it('names buildings by slug only, and never one with nothing public', async () => {
    const { chunk } = await bodies(await seed());
    expect(locs(chunk).sort()).toEqual([
      `${SITE}/building/1-test-street-boston`,
      `${SITE}/building/3-test-street-boston`,
      `${SITE}/building/7-test-street-boston`,
    ]);
    expect(chunk).not.toContain('Test Street');
    expect(chunk).not.toContain('new-haven');
  });
});
