import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import LandlordPage from '../../pages/landlord/[slug].astro';
import PropertyManagerPage from '../../pages/property-manager/[slug].astro';
import { containsExactNumber } from './helpers/exactNumbers';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';

/**
 * No public page shows a review's exact rent or square footage: the review cards and the
 * building page's per-unit rent line show ranges built from bands (reviewDisplay.ts). Every
 * row here is fictional, and the exact numbers are odd ones so a stray match is a real leak.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const RENTS = [2137, 2611];
const SIZES = [817, 1133];

function expectNoExactValues(html: string): void {
  for (const value of [...RENTS, ...SIZES]) {
    expect(containsExactNumber(html, value), `exact ${value} on a public page`).toBe(false);
  }
}

async function createContainer(): Promise<AstroContainer> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container;
}

function locals(db: TestD1Database): App.Locals {
  return { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------
// Building page
// ---------------------------------------------------------------------------------------

const BUILDING_ID = 'bldg-ranges';
const SLUG = '1-fictional-way-boston';

interface SeedReview {
  rent: number | null;
  size: number | null;
  bedrooms: string;
}

async function seedBuilding(reviews: SeedReview[]): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_type TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN bedrooms TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN review_title TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN rent_amount INTEGER; ' +
      'ALTER TABLE reviews ADD COLUMN square_footage INTEGER; ' +
      'ALTER TABLE reviews ADD COLUMN unit_structural INTEGER;',
  );
  await insertBuilding(db, { id: BUILDING_ID, slug: SLUG, address: '1 Fictional Way', neighborhood: 'Allston' });
  for (const [i, review] of reviews.entries()) {
    await db
      .prepare(
        `INSERT INTO reviews (id, building_id, status, overall_score, unit_type, bedrooms, review_title,
           rent_amount, square_footage, unit_structural, move_out_year_new)
         VALUES (?, ?, 'approved', 3.9, ?, ?, ?, ?, ?, 4, 'current')`,
      )
      .bind(`review-${i}`, BUILDING_ID, `${review.bedrooms}br`, review.bedrooms, `Review ${i}`, review.rent, review.size)
      .run();
  }
  return db;
}

async function renderBuilding(db: TestD1Database): Promise<{ html: string; root: HTMLElement }> {
  const container = await createContainer();
  const html = await container.renderToString(BuildingPage, {
    params: { slug: SLUG },
    request: new Request(`https://ratemyplace.org/building/${SLUG}`),
    locals: locals(db),
    partial: false,
  });
  const root = document.createElement('div');
  root.innerHTML = html;
  return { html, root };
}

/** The rent line on each unit card, by unit name. */
function unitRentLines(root: HTMLElement): Record<string, string> {
  const lines: Record<string, string> = {};
  for (const card of Array.from(root.querySelectorAll('.unit-card'))) {
    const name = text(card.querySelector('h4'));
    const rent = card.querySelector('[data-unit-rent]');
    if (rent) lines[name] = text(rent);
  }
  return lines;
}

suite('building page rent and size', () => {
  it('a unit group with one review shows its band, not its rent', async () => {
    const { html, root } = await renderBuilding(await seedBuilding([{ rent: 2137, size: 817, bedrooms: '1' }]));
    expectNoExactValues(html);
    expect(unitRentLines(root)).toEqual({ '1 bedroom': '$2,000 to $2,250/mo' });
    const card = root.querySelector('.unit-reviews article');
    expect(text(card)).toContain('$2,000 to $2,250/mo');
    expect(text(card)).toContain('750 to 1,000 sq ft');
  });

  it('a unit group with several reviews runs from the lowest band to the highest', async () => {
    const { html, root } = await renderBuilding(
      await seedBuilding([
        { rent: 2137, size: 817, bedrooms: '2' },
        { rent: 2611, size: 1133, bedrooms: '2' },
      ]),
    );
    expectNoExactValues(html);
    expect(unitRentLines(root)).toEqual({ '2 bedrooms': '$2,000 to $2,750/mo' });
  });

  it('keeps each unit group to its own reviews', async () => {
    const { html, root } = await renderBuilding(
      await seedBuilding([
        { rent: 2137, size: 817, bedrooms: '1' },
        { rent: 2611, size: 1133, bedrooms: '2' },
        { rent: null, size: null, bedrooms: '3' },
      ]),
    );
    expectNoExactValues(html);
    expect(unitRentLines(root)).toEqual({
      '1 bedroom': '$2,000 to $2,250/mo',
      '2 bedrooms': '$2,500 to $2,750/mo',
    });
  });
});

// ---------------------------------------------------------------------------------------
// Landlord and property manager pages
// ---------------------------------------------------------------------------------------

function namedPartyDb(): TestD1Database {
  const database = createMemoryDatabase();
  database.exec(`
    CREATE TABLE landlords (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
      description TEXT, website TEXT, phone TEXT, email TEXT
    );
    CREATE TABLE property_managers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, company_name TEXT,
      description TEXT, website TEXT, phone TEXT, email TEXT
    );
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY, address TEXT NOT NULL, neighborhood TEXT, city TEXT NOT NULL,
      state TEXT NOT NULL, slug TEXT NOT NULL, landlord_id TEXT, property_manager_id TEXT,
      parcel_id TEXT, st_num_lo INTEGER, st_num_hi INTEGER
    );
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY, building_id TEXT NOT NULL, status TEXT NOT NULL, overall_score REAL,
      landlord_maintenance REAL, would_recommend_new TEXT, had_security_deposit_issues INTEGER,
      move_out_year_new TEXT, created_at INTEGER NOT NULL,
      unit_type TEXT, bedrooms TEXT, review_title TEXT, rent_amount INTEGER, square_footage INTEGER
    );
    INSERT INTO landlords VALUES ('landlord-r', 'Fictional Landlord', 'fictional-landlord', NULL, NULL, NULL, NULL);
    INSERT INTO property_managers VALUES ('manager-r', 'Fictional Manager', 'fictional-manager', NULL, NULL, NULL, NULL, NULL);
    INSERT INTO buildings (id, address, neighborhood, city, state, slug, landlord_id, property_manager_id) VALUES
      ('b-r1', '1 Fictional Way', 'Allston', 'Boston', 'MA', '1-fictional-way', 'landlord-r', 'manager-r'),
      ('b-r2', '3 Fictional Way', 'Allston', 'Boston', 'MA', '3-fictional-way', 'landlord-r', 'manager-r');
    INSERT INTO reviews VALUES
      ('r-r1', 'b-r1', 'approved', 4.0, 4.0, 'yes', 0, 'current', 1, '1br', '1', 'One', 2137, 817),
      ('r-r2', 'b-r2', 'approved', 3.6, 3.6, 'yes', 0, 'current', 2, '2br', '2', 'Two', 2611, 1133);
  `);
  return new TestD1Database(database);
}

suite.each([
  { name: 'landlord', Page: LandlordPage, route: 'landlord', slug: 'fictional-landlord' },
  { name: 'property manager', Page: PropertyManagerPage, route: 'property-manager', slug: 'fictional-manager' },
])('$name page rent and size', ({ Page, route, slug }) => {
  it('shows each review card with ranges, never the exact numbers', async () => {
    const container = await createContainer();
    const html = await container.renderToString(Page, {
      request: new Request(`https://ratemyplace.org/${route}/${slug}`),
      params: { slug },
      locals: locals(namedPartyDb()),
      partial: false,
    });
    const root = document.createElement('div');
    root.innerHTML = html;
    const cards = Array.from(root.querySelectorAll('article')).map((card) => text(card));
    expect(cards).toHaveLength(2);
    expect(cards.join(' ')).toContain('$2,000 to $2,250/mo');
    expect(cards.join(' ')).toContain('$2,500 to $2,750/mo');
    expect(cards.join(' ')).toContain('750 to 1,000 sq ft');
    expect(cards.join(' ')).toContain('1,000 to 1,250 sq ft');
    expectNoExactValues(html);
  });
});
