import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import LandlordPage from '../../pages/landlord/[slug].astro';
import PropertyManagerPage from '../../pages/property-manager/[slug].astro';
import SearchPage from '../../pages/search.astro';
import {
  createMemoryDatabase,
  sqliteAvailable,
  TestD1Database,
  type SQLiteDatabase,
} from './helpers/sqliteD1';

type DetailPage = typeof LandlordPage | typeof PropertyManagerPage;

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
      email TEXT
    );
    CREATE TABLE property_managers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      company_name TEXT,
      description TEXT,
      website TEXT,
      phone TEXT,
      email TEXT
    );
    CREATE TABLE buildings (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      neighborhood TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      slug TEXT NOT NULL,
      landlord_id TEXT,
      property_manager_id TEXT
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

    INSERT INTO landlords VALUES
      ('landlord-thin', 'Thin Data Landlord', 'thin-data-landlord', NULL, NULL, NULL, NULL),
      ('landlord-established', 'Established Landlord', 'established-landlord', NULL, NULL, NULL, NULL),
      ('landlord-unavailable', 'Unavailable Overall Landlord', 'unavailable-overall-landlord', NULL, NULL, NULL, NULL);
    INSERT INTO property_managers VALUES
      ('manager-thin', 'Thin Data Manager', 'thin-data-manager', NULL, NULL, NULL, NULL, NULL),
      ('manager-established', 'Established Manager', 'established-manager', NULL, NULL, NULL, NULL, NULL),
      ('manager-unavailable', 'Unavailable Overall Manager', 'unavailable-overall-manager', NULL, NULL, NULL, NULL, NULL);
    INSERT INTO buildings VALUES
      ('landlord-thin-1', '10 Oak Street', 'Back Bay', 'Boston', 'MA', '10-oak-street', 'landlord-thin', NULL),
      ('landlord-thin-2', '12 Oak Street', 'Back Bay', 'Boston', 'MA', '12-oak-street', 'landlord-thin', NULL),
      ('landlord-established-1', '20 Pine Street', 'South End', 'Boston', 'MA', '20-pine-street', 'landlord-established', NULL),
      ('landlord-established-2', '22 Pine Street', 'South End', 'Boston', 'MA', '22-pine-street', 'landlord-established', NULL),
      ('landlord-unavailable-1', '24 Pine Street', 'South End', 'Boston', 'MA', '24-pine-street', 'landlord-unavailable', NULL),
      ('landlord-unavailable-2', '26 Pine Street', 'South End', 'Boston', 'MA', '26-pine-street', 'landlord-unavailable', NULL),
      ('manager-thin-1', '30 Cedar Street', 'Roxbury', 'Boston', 'MA', '30-cedar-street', NULL, 'manager-thin'),
      ('manager-thin-2', '32 Cedar Street', 'Roxbury', 'Boston', 'MA', '32-cedar-street', NULL, 'manager-thin'),
      ('manager-established-1', '40 Elm Street', 'Dorchester', 'Boston', 'MA', '40-elm-street', NULL, 'manager-established'),
      ('manager-established-2', '42 Elm Street', 'Dorchester', 'Boston', 'MA', '42-elm-street', NULL, 'manager-established'),
      ('manager-unavailable-1', '44 Elm Street', 'Dorchester', 'Boston', 'MA', '44-elm-street', NULL, 'manager-unavailable'),
      ('manager-unavailable-2', '46 Elm Street', 'Dorchester', 'Boston', 'MA', '46-elm-street', NULL, 'manager-unavailable'),
      ('building-one-review', '50 Main Street', 'Allston', 'Boston', 'MA', '50-main-street', NULL, NULL);
    INSERT INTO reviews VALUES
      ('landlord-thin-review-1', 'landlord-thin-1', 'approved', 4.8, 4.8, 'yes', 1, '2026', 1),
      ('landlord-thin-review-2', 'landlord-thin-2', 'approved', 4.8, 4.8, 'yes', 0, '2026', 1),
      ('landlord-established-review-1', 'landlord-established-1', 'approved', 4.2, 4.2, 'yes', 0, '2026', 1),
      ('landlord-established-review-2', 'landlord-established-1', 'approved', 4.2, 4.2, 'yes', 0, '2026', 1),
      ('landlord-established-review-3', 'landlord-established-2', 'approved', 4.2, 4.2, 'yes', 0, '2026', 1),
      ('landlord-unavailable-review-1', 'landlord-unavailable-1', 'approved', NULL, 4.0, 'yes', 0, '2026', 1),
      ('landlord-unavailable-review-2', 'landlord-unavailable-1', 'approved', NULL, 4.0, 'yes', 0, '2026', 1),
      ('landlord-unavailable-review-3', 'landlord-unavailable-2', 'approved', NULL, 4.0, 'yes', 0, '2026', 1),
      ('manager-thin-review-1', 'manager-thin-1', 'approved', 4.7, 4.7, 'yes', 1, '2026', 1),
      ('manager-thin-review-2', 'manager-thin-2', 'approved', 4.7, 4.7, 'yes', 0, '2026', 1),
      ('manager-established-review-1', 'manager-established-1', 'approved', 4.1, 4.1, 'yes', 0, '2026', 1),
      ('manager-established-review-2', 'manager-established-1', 'approved', 4.1, 4.1, 'yes', 0, '2026', 1),
      ('manager-established-review-3', 'manager-established-2', 'approved', 4.1, 4.1, 'yes', 0, '2026', 1),
      ('manager-unavailable-review-1', 'manager-unavailable-1', 'approved', NULL, 4.0, 'yes', 0, '2026', 1),
      ('manager-unavailable-review-2', 'manager-unavailable-1', 'approved', NULL, 4.0, 'yes', 0, '2026', 1),
      ('manager-unavailable-review-3', 'manager-unavailable-2', 'approved', NULL, 4.0, 'yes', 0, '2026', 1),
      ('building-review-1', 'building-one-review', 'approved', 3.7, 3.7, 'yes', 0, '2026', 1);
  `);
  return database;
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

function testLocals(database: SQLiteDatabase): App.Locals {
  return {
    user: null,
    session: null,
    runtime: { env: { DB: new TestD1Database(database) } },
  } as unknown as App.Locals;
}

async function renderSearch(
  database: SQLiteDatabase,
  query: string,
  type: 'landlords' | 'buildings' = 'landlords',
): Promise<string> {
  const container = await createContainer();

  return container.renderToString(SearchPage, {
    request: new Request(`https://ratemyplace.org/search?q=${encodeURIComponent(query)}&type=${type}`),
    locals: testLocals(database),
    partial: false,
  });
}

async function renderDetail(
  database: SQLiteDatabase,
  Page: DetailPage,
  route: 'landlord' | 'property-manager',
  slug: string,
): Promise<string> {
  const container = await createContainer();
  return container.renderToString(Page, {
    request: new Request(`https://ratemyplace.org/${route}/${slug}`),
    params: { slug },
    locals: testLocals(database),
    partial: false,
  });
}

function visibleText(html: string): string {
  return html
    .replace(/<!--.*?-->/gs, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mainFragment(html: string): HTMLDivElement {
  const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!match) throw new Error('Rendered page is missing <main>');
  const fragment = document.createElement('div');
  fragment.innerHTML = match[1];
  return fragment;
}

function aggregateHeaderText(html: string): string {
  const header = mainFragment(html).querySelector('.mb-8 .text-right');
  if (!header) throw new Error('Rendered page is missing the named-party aggregate header');
  return header.textContent ?? '';
}

function ratingBreakdownText(html: string): string | null {
  const heading = Array.from(mainFragment(html).querySelectorAll('h3')).find(
    (candidate) => candidate.textContent?.trim() === 'Rating breakdown',
  );
  return heading?.parentElement?.textContent ?? null;
}

function searchIslandProps(html: string): string {
  const island = mainFragment(html).querySelector('astro-island[props]');
  if (!island) throw new Error('Rendered search page is missing serialized island props');
  return island.getAttribute('props') ?? '';
}

const suite = sqliteAvailable ? describe : describe.skip;

suite('named-party score visibility in rendered SSR pages', () => {
  it('does not render or serialize a two-review landlord aggregate in search', async () => {
    const database = makeDatabase();
    try {
      const html = await renderSearch(database, 'Thin Data');
      const text = visibleText(html);

      expect(text).toContain('Thin Data Landlord');
      expect(text).toContain('Score after 3 reviews');
      expect(text).toContain('2 reviews');
      expect(html).not.toContain('4.8');
      expect(searchIslandProps(html)).toContain('"avg_overall":[0,null]');
    } finally {
      database.close();
    }
  });

  it('renders and serializes a landlord aggregate at three portfolio reviews', async () => {
    const database = makeDatabase();
    try {
      const html = await renderSearch(database, 'Established');
      const text = visibleText(html);

      expect(text).toContain('Established Landlord');
      expect(text).toContain('4.2');
      expect(text).toContain('3 reviews');
      expect(text).not.toContain('Score after 3 reviews');
      expect(searchIslandProps(html)).toContain('"avg_overall":[0,4.2]');
    } finally {
      database.close();
    }
  });

  it('keeps a one-review building score visible in rendered search', async () => {
    const database = makeDatabase();
    try {
      const html = await renderSearch(database, '50 Main', 'buildings');
      const text = visibleText(html);

      expect(text).toContain('50 Main Street');
      expect(text).toContain('3.7');
      expect(text).toContain('1 review');
      expect(text).not.toContain('Score after 3 reviews');
    } finally {
      database.close();
    }
  });

  const detailCases = [
    {
      label: 'landlord',
      Page: LandlordPage,
      route: 'landlord' as const,
      thinSlug: 'thin-data-landlord',
      thinScore: '4.8',
      establishedSlug: 'established-landlord',
      establishedScore: '4.2',
      unavailableSlug: 'unavailable-overall-landlord',
    },
    {
      label: 'property manager',
      Page: PropertyManagerPage,
      route: 'property-manager' as const,
      thinSlug: 'thin-data-manager',
      thinScore: '4.7',
      establishedSlug: 'established-manager',
      establishedScore: '4.1',
      unavailableSlug: 'unavailable-overall-manager',
    },
  ];

  it.each(detailCases)('withholds the $label aggregate and breakdown at two portfolio reviews', async ({
    Page,
    route,
    thinSlug,
    thinScore,
  }) => {
    const database = makeDatabase();
    try {
      const html = await renderDetail(database, Page, route, thinSlug);
      const headerText = aggregateHeaderText(html);
      const mainText = mainFragment(html).textContent ?? '';

      expect(headerText).toContain('2 approved reviews');
      expect(headerText).toContain('Aggregate score appears after 3 approved reviews');
      expect(headerText).not.toContain(thinScore);
      expect(ratingBreakdownText(html)).toBeNull();
      expect(mainText).not.toMatch(/Recommendation Rate/i);
      expect(mainText).not.toContain('Common Issues');
    } finally {
      database.close();
    }
  });

  it.each(detailCases)('publishes the $label aggregate and breakdown at three portfolio reviews', async ({
    Page,
    route,
    establishedSlug,
    establishedScore,
  }) => {
    const database = makeDatabase();
    try {
      const html = await renderDetail(database, Page, route, establishedSlug);
      const headerText = aggregateHeaderText(html);

      expect(headerText).toContain(establishedScore);
      expect(headerText).toContain('3 reviews across 2 buildings');
      expect(ratingBreakdownText(html)).not.toBeNull();
    } finally {
      database.close();
    }
  });

  it.each(detailCases)('keeps the $label breakdown visible when the established overall score is unavailable', async ({
    Page,
    route,
    unavailableSlug,
  }) => {
    const database = makeDatabase();
    try {
      const html = await renderDetail(database, Page, route, unavailableSlug);
      const headerText = aggregateHeaderText(html);
      const breakdownText = ratingBreakdownText(html);

      expect(headerText).toContain('Overall score unavailable');
      expect(headerText).toContain('3 approved reviews');
      expect(breakdownText).not.toBeNull();
      expect(breakdownText).toContain('4.0');
    } finally {
      database.close();
    }
  });
});
