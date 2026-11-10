import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * Phase 28 (A11Y-02): the banner a reviewer sees after submitting. Its dismiss button was an
 * icon with no name and an inline handler. It is now a named button that the delegated
 * listener in BaseLayout handles through data-dismiss.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const BUILDING_ID = 'bldg-example';
const SLUG = '12-example-rd-boston';

async function seed(): Promise<TestD1Database> {
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
  return db;
}

async function render(search: string): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  const html = await container.renderToString(BuildingPage, {
    params: { slug: SLUG },
    request: new Request(`https://ratemyplace.org/building/${SLUG}${search}`),
    locals: { user: null, session: null, runtime: { env: { DB: await seed() } } } as unknown as App.Locals,
    partial: false,
  });
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

suite('building page submitted banner', () => {
  it('names the dismiss button and hands it to the delegated listener', async () => {
    const root = await render('?submitted=true');
    const banner = root.querySelector('#submitted-banner');
    expect(banner).not.toBeNull();

    const buttons = banner!.querySelectorAll('button[data-dismiss]');
    expect(buttons).toHaveLength(1);
    const button = buttons[0];
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Close');
    expect(button.getAttribute('data-dismiss')).toBe('submitted-banner');
    expect(button.hasAttribute('onclick')).toBe(false);
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows no banner without the query flag', async () => {
    const root = await render('');
    expect(root.querySelector('#submitted-banner')).toBeNull();
    expect(root.querySelector('[data-dismiss]')).toBeNull();
  });

  it('keeps one h1 in main for the dismiss handler to move focus to', async () => {
    const root = await render('?submitted=true');
    expect(root.querySelectorAll('main h1')).toHaveLength(1);
    expect(root.querySelector('main#main-content')).not.toBeNull();
  });
});
