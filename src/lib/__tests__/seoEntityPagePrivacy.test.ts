import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import LandlordPage from '../../pages/landlord/[slug].astro';
import PropertyManagerPage from '../../pages/property-manager/[slug].astro';
import { NAMED_PARTY_MIN_REVIEWS } from '../scoring';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * SEO-06: what a crawler or a link preview reads from a detail page, its head and the
 * structured data in it, carries no private unit number, internal id, reviewer email or
 * withheld named-party score. A unit number must not appear anywhere in the page at all
 * (PRIV-03). The body legitimately carries the building id (the "Write a review" link and the
 * bookmark island), so ids are checked on the head only.
 *
 * Every value here is a neutral sentinel; ids differ from slugs so a leak cannot hide behind a
 * public value.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const UNIT = 'UNIT-SENTINEL-4B';
const PENDING_UNIT = 'UNIT-SENTINEL-PENDING';
const EMAIL = 'tenant-sentinel@example.test';
const MODERATION_NOTE = 'MOD-NOTE-SENTINEL';
const USER_ID = 'user-INTERNAL-9c1d';
const THIN_LANDLORD_ID = 'll-INTERNAL-thin-5e2b';
const ESTABLISHED_LANDLORD_ID = 'll-INTERNAL-est-6f3c';
const MANAGER_ID = 'pm-INTERNAL-7a4d';
const BUILDING_A = 'bldg-INTERNAL-7f3a';
const BUILDING_B = 'bldg-INTERNAL-8b4c';
const BUILDING_C = 'bldg-INTERNAL-9d5e';
const THIN_SCORE = '4.8';
const BUILDING_A_SCORE = '4.6';
const ESTABLISHED_SCORE = '4.2';
const INTERNAL_IDS = [USER_ID, THIN_LANDLORD_ID, ESTABLISHED_LANDLORD_ID, MANAGER_ID, BUILDING_A, BUILDING_B, BUILDING_C, 'rev-INTERNAL'];

async function seed(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_number TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN unit_type TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN review_title TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN would_recommend_new TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN had_pest_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN had_heat_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN had_water_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN had_security_deposit_issues INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_structural INTEGER; ' +
      'ALTER TABLE reviews ADD COLUMN landlord_maintenance INTEGER;',
  );
  await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(USER_ID, EMAIL).run();
  await db
    .prepare('INSERT INTO landlords (id, name, slug) VALUES (?, ?, ?), (?, ?, ?)')
    .bind(THIN_LANDLORD_ID, 'Thin Fixture Holdings', 'thin-fixture-holdings', ESTABLISHED_LANDLORD_ID, 'Established Fixture Realty', 'established-fixture-realty')
    .run();
  await db.prepare('INSERT INTO property_managers (id, name, slug) VALUES (?, ?, ?)').bind(MANAGER_ID, 'Thin Fixture Management', 'thin-fixture-management').run();

  // Explicit neutral addresses and slugs: insertBuilding's defaults are a real-place fixture.
  for (const [id, slug, address] of [
    [BUILDING_A, '1-test-street-boston', '1 Test Street'],
    [BUILDING_B, '3-test-street-boston', '3 Test Street'],
    [BUILDING_C, '5-test-street-boston', '5 Test Street'],
  ]) {
    await insertBuilding(db, { id, slug, address, neighborhood: 'Allston', zip_code: '02134' });
  }
  await db.prepare('UPDATE buildings SET landlord_id = ?, property_manager_id = ? WHERE id IN (?, ?)').bind(THIN_LANDLORD_ID, MANAGER_ID, BUILDING_A, BUILDING_B).run();
  await db.prepare('UPDATE buildings SET landlord_id = ? WHERE id = ?').bind(ESTABLISHED_LANDLORD_ID, BUILDING_C).run();

  const review = (id: string, buildingId: string, status: string, score: number, unit: string) =>
    db
      .prepare(
        `INSERT INTO reviews (id, user_id, building_id, status, overall_score, unit_number, unit_type, review_title,
           would_recommend_new, unit_structural, landlord_maintenance, moderation_notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '1br', 'Fixture review', 'yes', 4, 4, ?, 1700000000)`,
      )
      .bind(id, USER_ID, buildingId, status, score, unit, MODERATION_NOTE)
      .run();
  // Thin: one approved review on each of the landlord's two buildings, below the threshold. The
  // building scores (4.6, 5.0) are public by design; their mean, the landlord and manager
  // aggregate (4.8), is withheld.
  await review('rev-INTERNAL-a1', BUILDING_A, 'approved', 4.6, UNIT);
  await review('rev-INTERNAL-a2', BUILDING_B, 'approved', 5.0, UNIT);
  await review('rev-INTERNAL-a3', BUILDING_A, 'pending', 1.2, PENDING_UNIT);
  // Established: exactly the threshold, so its score is published on the page.
  for (let i = 0; i < NAMED_PARTY_MIN_REVIEWS; i += 1) await review(`rev-INTERNAL-c${i}`, BUILDING_C, 'approved', 4.2, UNIT);
  return db;
}

type Page = typeof BuildingPage | typeof LandlordPage | typeof PropertyManagerPage;

async function render(db: TestD1Database, Page: Page, path: string, slug: string, query = ''): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container.renderToString(Page, {
    params: { slug },
    request: new Request(`https://ratemyplace.org${path}${query}`),
    locals: { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals,
    partial: false,
  });
}

function head(html: string): string {
  const match = html.match(/<head>([\s\S]*?)<\/head>/);
  if (!match) throw new Error('Rendered page is missing <head>');
  return match[1];
}

function jsonLd(html: string): Array<Record<string, unknown>> {
  return Array.from(head(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g), (match) =>
    JSON.parse(match[1]) as Record<string, unknown>,
  );
}

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
  return [];
}

const pages = [
  // The building's own score is on the page; it still stays out of the head and structured data.
  { label: 'building', Page: BuildingPage, path: '/building/1-test-street-boston', slug: '1-test-street-boston', withheld: [THIN_SCORE, BUILDING_A_SCORE] },
  { label: 'landlord below the threshold', Page: LandlordPage, path: '/landlord/thin-fixture-holdings', slug: 'thin-fixture-holdings', withheld: [THIN_SCORE] },
  { label: 'landlord at the threshold', Page: LandlordPage, path: '/landlord/established-fixture-realty', slug: 'established-fixture-realty', withheld: [ESTABLISHED_SCORE] },
  { label: 'property manager below the threshold', Page: PropertyManagerPage, path: '/property-manager/thin-fixture-management', slug: 'thin-fixture-management', withheld: [THIN_SCORE] },
];

suite('detail page privacy (SEO-06)', () => {
  it.each(pages)('keeps the unit number, email and moderation note out of the whole $label page', async ({ Page, path, slug }) => {
    const html = await render(await seed(), Page, path, slug);
    expect(html).toContain('Test Street'); // rendered for real, not a 404
    for (const secret of [UNIT, PENDING_UNIT, 'unit_number', EMAIL, MODERATION_NOTE, USER_ID]) expect(html).not.toContain(secret);
  });

  it.each(pages)('keeps internal ids and scores out of the $label head and structured data', async ({ Page, path, slug, withheld }) => {
    const html = await render(await seed(), Page, path, slug);
    const headHtml = head(html);
    for (const id of INTERNAL_IDS) expect(headHtml).not.toContain(id);
    for (const score of withheld) expect(headHtml).not.toContain(score);

    const blocks = jsonLd(html);
    expect(blocks).toHaveLength(1);
    const graph = blocks[0]['@graph'] as Array<Record<string, unknown>>;
    expect(graph.find((node) => node['@type'] === 'WebPage')?.url).toBe(`https://ratemyplace.org${path}`);
    const keys = allKeys(blocks[0]);
    for (const key of ['aggregateRating', 'review', 'ratingValue', 'reviewCount', 'ratingCount']) expect(keys).not.toContain(key);
  });

  it.each([
    { label: 'landlord', Page: LandlordPage, path: '/landlord/thin-fixture-holdings', slug: 'thin-fixture-holdings' },
    { label: 'property manager', Page: PropertyManagerPage, path: '/property-manager/thin-fixture-management', slug: 'thin-fixture-management' },
  ])('shows the withheld $label aggregate nowhere in the page', async ({ Page, path, slug }) => {
    const html = await render(await seed(), Page, path, slug);
    expect(html).toContain('Aggregate score appears after');
    expect(html).not.toContain(THIN_SCORE);
  });

  it('publishes the established landlord score in the body only', async () => {
    const html = await render(await seed(), LandlordPage, '/landlord/established-fixture-realty', 'established-fixture-realty');
    expect(html).toContain(ESTABLISHED_SCORE);
    expect(head(html)).not.toContain(ESTABLISHED_SCORE);
  });

  it('keeps the post-submit review id out of the building head', async () => {
    const html = await render(await seed(), BuildingPage, '/building/1-test-street-boston', '1-test-street-boston', '?submitted=true&reviewId=rev-INTERNAL-a3');
    expect(head(html)).not.toContain('rev-INTERNAL');
    expect(head(html)).not.toContain('submitted');
    expect(JSON.stringify(jsonLd(html))).not.toContain('reviewId');
  });
});
