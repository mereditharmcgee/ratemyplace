import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import ScoreCard from '../../components/ratings/ScoreCard.astro';
import ReviewCard from '../../components/reviews/ReviewCard.astro';
import UGCDisclaimer from '../../components/reviews/UGCDisclaimer.astro';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * The last links on building pages smaller than 24x24 CSS px, per a browser pass: the
 * review disclaimer's "Terms of service" (111x17), the methodology "Learn more" (65x15) and
 * the landlord link in the header (95x17). Each is padded to 28px tall with a matching
 * negative margin, so the hit area grows and the line it sits on does not move:
 * - text-sm sits on a 20px line, so 4px above and below (py-1, -my-1) makes 28px;
 * - text-xs sits on a 16px line, so 6px above and below (py-1.5, -my-1.5) makes 28px.
 * The property manager link shares the landlord link's row and gets the same padding.
 *
 * The header's "No reviews yet" was gray-400, 2.37:1 on the paper background (#F6F4EE).
 * WCAG AA needs 4.5:1 for body text; gray-500 is 4.40:1, so it is gray-600 at 6.87:1.
 */

const TEXT_SM_TARGET = ['inline-block', 'py-1', '-my-1'];
const TEXT_XS_TARGET = ['inline-block', 'py-1.5', '-my-1.5'];

function parse(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function classesOf(el: Element | null | undefined): string[] {
  if (!el) throw new Error('element not found');
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

function linkByText(root: HTMLElement, text: string): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll('a')).filter((a) => a.textContent?.trim() === text);
}

describe('review disclaimer', () => {
  it('pads "Terms of service" to a 28px hit area', async () => {
    const container = await AstroContainer.create();
    const root = parse(await container.renderToString(UGCDisclaimer));
    const [terms] = linkByText(root, 'Terms of service');
    expect(terms.getAttribute('href')).toBe('/terms');
    expect(classesOf(terms)).toEqual(expect.arrayContaining(TEXT_SM_TARGET));
  });
});

describe('"Learn more" methodology links', () => {
  it('pads the rating breakdown link', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ScoreCard, {
      props: {
        type: 'building',
        scores: { avg_overall: 4.0, avg_unit: 4.0, avg_building: 4.0, avg_landlord: 4.0, review_count: 3 },
      },
    });
    const links = linkByText(parse(html), 'Learn more');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/methodology');
    expect(classesOf(links[0])).toEqual(expect.arrayContaining(TEXT_XS_TARGET));
  });

  it('pads the link under each review card score breakdown', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ReviewCard, {
      props: {
        review: {
          id: 'review-1',
          review_title: 'Fine place',
          overall_score: 4.0,
          unit_type: '1br',
          would_recommend_new: 'yes',
          unit_structural: 4,
          building_common_areas: 4,
          landlord_maintenance: 4,
        },
      },
    });
    const links = linkByText(parse(html), 'Learn more');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/methodology');
    expect(classesOf(links[0])).toEqual(expect.arrayContaining(TEXT_XS_TARGET));
  });
});

const suite = sqliteAvailable ? describe : describe.skip;

const BUILDING_ID = 'bldg-example';
const SLUG = '12-example-rd-boston';

async function seed(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_type TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN review_title TEXT;',
  );
  await db.prepare('INSERT INTO landlords (id, name, slug) VALUES (?, ?, ?)').bind('ll-1', 'EXAMPLE HOLDINGS LLC', 'example-holdings-llc').run();
  await db.prepare('INSERT INTO property_managers (id, name, slug) VALUES (?, ?, ?)').bind('pm-1', 'Example Management', 'example-management').run();
  await insertBuilding(db, {
    id: BUILDING_ID,
    slug: SLUG,
    address: '12 Example Rd',
    neighborhood: 'Allston',
    zip_code: '02134',
    source: 'seed',
  });
  await db
    .prepare('UPDATE buildings SET landlord_id = ?, property_manager_id = ? WHERE id = ?')
    .bind('ll-1', 'pm-1', BUILDING_ID)
    .run();
  return db;
}

async function renderPage(db: TestD1Database): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  const html = await container.renderToString(BuildingPage, {
    params: { slug: SLUG },
    request: new Request(`https://ratemyplace.org/building/${SLUG}`),
    locals: { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals,
    partial: false,
  });
  return parse(html);
}

suite('building page header', () => {
  it('pads the landlord and property manager links to a 28px hit area', async () => {
    const root = await renderPage(await seed());
    const landlord = root.querySelector('a[href="/landlord/example-holdings-llc"]');
    const manager = root.querySelector('a[href="/property-manager/example-management"]');
    expect(landlord?.textContent?.trim()).toBe('EXAMPLE HOLDINGS LLC');
    expect(manager?.textContent?.trim()).toBe('Example Management');
    expect(classesOf(landlord)).toEqual(expect.arrayContaining(TEXT_SM_TARGET));
    expect(classesOf(manager)).toEqual(expect.arrayContaining(TEXT_SM_TARGET));
  });

  it('sets "No reviews yet" in gray-600, which meets AA on the paper background', async () => {
    const root = await renderPage(await seed());
    const line = Array.from(root.querySelectorAll('p')).filter((p) => p.textContent?.trim() === 'No reviews yet');
    expect(line).toHaveLength(1);
    const classes = classesOf(line[0]);
    expect(classes).toContain('text-gray-600');
    expect(classes).not.toContain('text-gray-400');
    expect(classes).not.toContain('text-gray-500');
  });
});
