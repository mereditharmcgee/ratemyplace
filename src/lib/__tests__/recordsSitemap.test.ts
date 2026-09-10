import { describe, expect, it } from 'vitest';
import type { APIContext } from 'astro';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import {
  SITEMAP_CHUNK,
  STATIC_SITEMAP_PATHS,
  buildingChunkCount,
  buildingSitemapEntries,
  landlordSitemapEntries,
  renderSitemapIndex,
  renderUrlSet,
  toLastmod,
} from '../sitemap';
import { GET as indexGet } from '../../pages/sitemap.xml';
import { GET as staticGet } from '../../pages/sitemaps/static.xml';
import { GET as buildingsGet } from '../../pages/sitemaps/buildings-[n].xml';
import { GET as robotsGet } from '../../pages/robots.txt';

const suite = sqliteAvailable ? describe : describe.skip;
const SITE = 'https://ratemyplace.org';

async function review(db: TestD1Database, buildingId: string, createdAt: number, status = 'approved'): Promise<void> {
  await db
    .prepare('INSERT INTO reviews (id, building_id, status, created_at) VALUES (?, ?, ?, ?)')
    .bind(`${buildingId}-${createdAt}`, buildingId, status, createdAt)
    .run();
}

/**
 * `insertPull` cannot set `retrieved_at` (it takes the column default), and the lastmod rule
 * is entirely about which timestamp is newest, so this suite writes its own pull rows.
 */
async function pull(db: TestD1Database, buildingId: string, retrievedAt: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, error_message, triggered_by, correction_id, trigger_reason, retrieved_at) VALUES (?, ?, 'boston', 's', 'l', 'q', 'ok', 0, NULL, NULL, NULL, 'seed', ?)",
    )
    .bind(`${buildingId}-${retrievedAt}`, buildingId, retrievedAt)
    .run();
}

suite('sitemap', () => {
  it('includes Boston parcels and reviewed buildings elsewhere, excludes the rest', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', slug: 'a', parcel_id: '1' });
    await insertBuilding(db, { id: 'b', slug: 'b', parcel_id: null });
    await insertBuilding(db, { id: 'c', slug: 'c', city: 'New Haven', parcel_id: null });
    await insertBuilding(db, { id: 'd', slug: 'd', city: 'New Haven', parcel_id: null });
    await review(db, 'c', 1_700_000_000);
    await review(db, 'd', 1_700_000_000, 'pending');
    const slugs = (await buildingSitemapEntries(db, 1)).map((e) => e.slug);
    expect(slugs).toEqual(['a', 'c']);
  });

  it('lastmod is the latest of updated_at, the last pull, and the last approved review', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', slug: 'a', parcel_id: '1' });
    await db.prepare("UPDATE buildings SET updated_at = 1600000000 WHERE id = 'a'").run();
    await pull(db, 'a', 1_650_000_000);
    await review(db, 'a', 1_700_000_000);
    await review(db, 'a', 1_800_000_000, 'pending');
    const [entry] = await buildingSitemapEntries(db, 1);
    expect(entry.lastmod).toBe(1_700_000_000);
  });

  it('falls back to updated_at when a building has no pull and no approved review', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', slug: 'a', parcel_id: '1' });
    await db.prepare("UPDATE buildings SET updated_at = 1600000000 WHERE id = 'a'").run();
    const [entry] = await buildingSitemapEntries(db, 1);
    expect(entry.lastmod).toBe(1_600_000_000);
  });

  it('chunks by SITEMAP_CHUNK in a stable order', async () => {
    const db = createRecordsTestDb();
    for (let i = 0; i < 5; i += 1) await insertBuilding(db, { id: `b${i}`, slug: `b${i}`, parcel_id: String(i) });
    expect(SITEMAP_CHUNK).toBe(10_000);
    expect(await buildingChunkCount(db)).toBe(1);
    expect((await buildingSitemapEntries(db, 2)).length).toBe(0);
  });

  it('advertises no building chunk when nothing qualifies', async () => {
    // The index only lists chunks that exist, so a crawler is never handed a 404 for a URL
    // the index named. This is why the count is not floored at 1.
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'b', slug: 'b', parcel_id: null });
    expect(await buildingChunkCount(db)).toBe(0);
  });

  it('lists landlords with an approved review only', async () => {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO landlords (id, name, slug) VALUES ('l1', 'A', 'a'), ('l2', 'B', 'b')").run();
    await insertBuilding(db, { id: 'x', slug: 'x' });
    await db.prepare("UPDATE buildings SET landlord_id = 'l1' WHERE id = 'x'").run();
    await review(db, 'x', 1_700_000_000);
    expect((await landlordSitemapEntries(db)).map((e) => e.slug)).toEqual(['a']);
  });

  it('renders valid XML with escaped locations and ISO dates', () => {
    expect(toLastmod(1_700_000_000)).toBe('2023-11-14');
    const index = renderSitemapIndex(SITE, ['static.xml', 'buildings-1.xml']);
    expect(index).toContain('<sitemapindex');
    expect(index).toContain(`<loc>${SITE}/sitemaps/buildings-1.xml</loc>`);
    const urlset = renderUrlSet([
      { loc: `${SITE}/building/a&b`, lastmod: 1_700_000_000 },
      { loc: `${SITE}/about`, lastmod: null },
    ]);
    expect(urlset).toContain('<loc>https://ratemyplace.org/building/a&amp;b</loc>');
    expect(urlset).toContain('<lastmod>2023-11-14</lastmod>');
    expect(urlset).not.toContain('<lastmod></lastmod>');
  });

  it('allowlists only public static pages', () => {
    expect(STATIC_SITEMAP_PATHS).toEqual(['/', '/about', '/contact', '/guidelines', '/map', '/methodology', '/privacy', '/search', '/terms']);
    for (const path of STATIC_SITEMAP_PATHS) expect(path).not.toMatch(/admin|auth|profile|review|api/);
  });
});

function createContext(db: unknown, url: string, params: Record<string, string> = {}): APIContext {
  return {
    request: new Request(`${SITE}${url}`),
    params,
    url: new URL(`${SITE}${url}`),
    locals: { user: null, runtime: { env: { DB: db, SITE_URL: SITE } } },
  } as unknown as APIContext;
}

suite('sitemap routes', () => {
  async function seeded(): Promise<TestD1Database> {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO landlords (id, name, slug) VALUES ('l1', 'A', 'acme-realty')").run();
    await insertBuilding(db, { id: 'a', slug: 'a', parcel_id: '1' });
    await db.prepare("UPDATE buildings SET landlord_id = 'l1' WHERE id = 'a'").run();
    await review(db, 'a', 1_700_000_000);
    return db;
  }

  it('serves an index naming the static file and each building chunk', async () => {
    const res = await indexGet(createContext(await seeded(), '/sitemap.xml'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const body = await res.text();
    expect(body).toContain(`<loc>${SITE}/sitemaps/static.xml</loc>`);
    expect(body).toContain(`<loc>${SITE}/sitemaps/buildings-1.xml</loc>`);
    expect(body).not.toContain('buildings-2.xml');
  });

  it('serves the static file with the allowlisted pages and reviewed landlords', async () => {
    const res = await staticGet(createContext(await seeded(), '/sitemaps/static.xml'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`<loc>${SITE}/about</loc>`);
    expect(body).toContain(`<loc>${SITE}/</loc>`);
    expect(body).toContain(`<loc>${SITE}/landlord/acme-realty</loc>`);
  });

  it('serves a building chunk, 404s past the end, and 404s a non-chunk parameter', async () => {
    const db = await seeded();
    const one = await buildingsGet(createContext(db, '/sitemaps/buildings-1.xml', { n: '1' }));
    expect(one.status).toBe(200);
    expect(one.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const body = await one.text();
    expect(body).toContain(`<loc>${SITE}/building/a</loc>`);
    // `updated_at` defaults to now, so the date is whatever today is — assert the shape.
    expect(body).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);

    expect((await buildingsGet(createContext(db, '/sitemaps/buildings-2.xml', { n: '2' }))).status).toBe(404);
    expect((await buildingsGet(createContext(db, '/sitemaps/buildings-0.xml', { n: '0' }))).status).toBe(404);
    expect((await buildingsGet(createContext(db, '/sitemaps/buildings-x.xml', { n: 'x' }))).status).toBe(404);
  });

  it('serves robots.txt naming the index and disallowing the private trees', async () => {
    const res = robotsGet(createContext(null, '/robots.txt'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    const text = await res.text();
    expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(text).toContain('Disallow: /admin/');
    expect(text).toContain('Allow: /');
  });

  it('degrades to the static file rather than a 500 when D1 is unavailable', async () => {
    // A binding that throws on use, not a missing one: the same shape as D1 refusing a
    // query mid-request, which is the failure the index has to survive.
    const broken = {
      prepare(): never {
        throw new Error('D1 unavailable');
      },
    };
    const index = await indexGet(createContext(broken, '/sitemap.xml'));
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('static.xml');

    const statics = await staticGet(createContext(null, '/sitemaps/static.xml'));
    expect(statics.status).toBe(200);
    expect(await statics.text()).toContain(`<loc>${SITE}/about</loc>`);

    const chunk = await buildingsGet(createContext(null, '/sitemaps/buildings-1.xml', { n: '1' }));
    expect(chunk.status).toBe(503);
    expect(chunk.headers.get('Retry-After')).toBe('300');
  });
});
