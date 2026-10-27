import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { createRecordsTestDb, insertBuilding, insertPull } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * Where the public records sit on a building page. With no approved review, the records are
 * the page's content, so they come straight after the header and the empty-review UI is the
 * header's one line and one button. With reviews, the reviews come first and the records
 * follow, as before. Either way the records card is as wide as the main column's cards.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const BUILDING_ID = 'bldg-example';
const SLUG = '12-example-rd-boston';
const WRITE_REVIEW_HREF = `href="/review/new?building=${BUILDING_ID}"`;
const DISCLAIMER = 'These reviews are written by tenants';

interface SeedOptions {
  reviews: number;
  pulled?: boolean;
}

async function seed({ reviews, pulled = true }: SeedOptions): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  // The page joins each review to its author's email flag and groups reviews by unit type.
  db.exec(
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_type TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN review_title TEXT;',
  );
  await insertBuilding(db, {
    id: BUILDING_ID,
    slug: SLUG,
    address: '12 Example Rd',
    neighborhood: 'Allston',
    zip_code: '02134',
    parcel_id: '2100000000',
    source: 'seed',
  });
  await db
    .prepare('UPDATE buildings SET building_type = ?, year_built = ? WHERE id = ?')
    .bind('apartment', 1930, BUILDING_ID)
    .run();
  if (pulled) await insertPull(db, BUILDING_ID, FY2026_RESOURCE_ID);
  for (let i = 0; i < reviews; i++) {
    await db
      .prepare(
        "INSERT INTO reviews (id, building_id, status, overall_score, unit_type, review_title) VALUES (?, ?, 'approved', 3.8, '1br', ?)",
      )
      .bind(`review-${i}`, BUILDING_ID, `Review ${i}`)
      .run();
  }
  return db;
}

async function renderPage(db: TestD1Database): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return container.renderToString(BuildingPage, {
    params: { slug: SLUG },
    request: new Request(`https://ratemyplace.org/building/${SLUG}`),
    locals: { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals,
    partial: false,
  });
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function parse(html: string): HTMLElement {
  const fragment = document.createElement('div');
  fragment.innerHTML = html;
  return fragment;
}

function cardByHeading(root: HTMLElement, heading: string): HTMLElement {
  const h2 = Array.from(root.querySelectorAll('h2')).find((el) => el.textContent?.trim() === heading);
  const card = h2?.closest('div.bg-white, section') as HTMLElement | null | undefined;
  if (!card) throw new Error(`no card headed "${heading}"`);
  return card;
}

/** The main-column cell the element sits in: a `lg:col-span-2` child of a three-column grid. */
function mainColumnOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const parentClass = node.parentElement?.getAttribute('class') ?? '';
    if ((node.getAttribute('class') ?? '').split(/\s+/).includes('lg:col-span-2') && parentClass.includes('lg:grid-cols-3')) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

suite('building page with no reviews', () => {
  it('puts the public records directly under the header, before building details', async () => {
    const html = await renderPage(await seed({ reviews: 0 }));
    const h1 = html.indexOf('<h1');
    const records = html.indexOf('id="public-records"');
    const details = html.indexOf('Building details');
    expect(h1).toBeGreaterThan(-1);
    expect(records).toBeGreaterThan(h1);
    expect(details).toBeGreaterThan(records);
    expect(occurrences(html, 'id="public-records"')).toBe(1);
  });

  it('collapses the empty-review UI to one line and one write-review link above the records', async () => {
    const html = await renderPage(await seed({ reviews: 0 }));
    expect(occurrences(html, WRITE_REVIEW_HREF)).toBe(1);
    expect(html.indexOf(WRITE_REVIEW_HREF)).toBeLessThan(html.indexOf('id="public-records"'));
    expect(occurrences(html, 'No reviews yet')).toBe(1);
    expect(html).not.toContain('Be the first');
    expect(html).not.toContain('Rating breakdown appears after the first review.');
  });

  it('leaves out the line about tenant-written reviews', async () => {
    const html = await renderPage(await seed({ reviews: 0 }));
    expect(html).not.toContain(DISCLAIMER);
  });

  it('gives the records card the main column width, the same as building details', async () => {
    const root = parse(await renderPage(await seed({ reviews: 0 })));
    const records = root.querySelector('#public-records') as HTMLElement;
    expect(mainColumnOf(records)).not.toBeNull();
    expect(mainColumnOf(cardByHeading(root, 'Building details'))).not.toBeNull();
    expect(records.closest('.max-w-3xl')).toBeNull();
  });

  it('keeps the one line and one link when the building has no records yet', async () => {
    const html = await renderPage(await seed({ reviews: 0, pulled: false }));
    expect(html).not.toContain('id="public-records"');
    expect(occurrences(html, WRITE_REVIEW_HREF)).toBe(1);
    expect(occurrences(html, 'No reviews yet')).toBe(1);
    expect(html).not.toContain(DISCLAIMER);
  });
});

suite('building page with reviews', () => {
  it('keeps the reviews first and the records after them', async () => {
    const html = await renderPage(await seed({ reviews: 2 }));
    const units = html.indexOf('Units reviewed');
    const disclaimer = html.indexOf(DISCLAIMER);
    const records = html.indexOf('id="public-records"');
    expect(units).toBeGreaterThan(-1);
    expect(disclaimer).toBeGreaterThan(units);
    expect(records).toBeGreaterThan(disclaimer);
    expect(occurrences(html, 'id="public-records"')).toBe(1);
  });

  it('keeps the header write-review button and the rating sidebar', async () => {
    const html = await renderPage(await seed({ reviews: 2 }));
    expect(occurrences(html, WRITE_REVIEW_HREF)).toBe(1);
    expect(html).toContain('2 reviews');
    expect(html).not.toContain('No reviews yet');
  });

  it('gives the records card the main column width', async () => {
    const root = parse(await renderPage(await seed({ reviews: 2 })));
    const records = root.querySelector('#public-records') as HTMLElement;
    expect(mainColumnOf(records)).not.toBeNull();
    expect(records.closest('.max-w-3xl')).toBeNull();
  });
});
