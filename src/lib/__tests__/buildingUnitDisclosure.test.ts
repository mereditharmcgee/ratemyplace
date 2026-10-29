import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingPage from '../../pages/building/[slug].astro';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

/**
 * Phase 28 (A11Y-07): each unit card on the building page was a clickable div with no role,
 * no keyboard support and no state. The card keeps its markup (the e2e specs and
 * buildingEarlyRating.test.ts read it) and gains a native button laid over it, named by the
 * unit name, that reports and controls the reviews panel under it.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const BUILDING_ID = 'bldg-units';
const SLUG = '12-example-rd-boston';

async function seed(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(
    'ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0; ' +
      'ALTER TABLE reviews ADD COLUMN unit_type TEXT; ' +
      'ALTER TABLE reviews ADD COLUMN review_title TEXT;',
  );
  await insertBuilding(db, { id: BUILDING_ID, slug: SLUG, address: '12 Example Rd', neighborhood: 'Allston' });
  // Three unit types, so the page renders three cards: Studio, 1 bedroom, 2 bedrooms.
  for (const [i, unitType] of ['2br', '1br', 'studio', '1br'].entries()) {
    await db
      .prepare(
        `INSERT INTO reviews (id, building_id, status, overall_score, unit_type, review_title)
         VALUES (?, ?, 'approved', 3.5, ?, ?)`,
      )
      .bind(`review-${i}`, BUILDING_ID, unitType, `Review ${i}`)
      .run();
  }
  return db;
}

async function renderPage(): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  const html = await container.renderToString(BuildingPage, {
    params: { slug: SLUG },
    request: new Request(`https://ratemyplace.org/building/${SLUG}`),
    locals: { user: null, session: null, runtime: { env: { DB: await seed() } } } as unknown as App.Locals,
    partial: false,
  });
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

suite('building page unit cards', () => {
  it('gives every card one native button that controls a panel on the page', async () => {
    const root = await renderPage();
    const cards = Array.from(root.querySelectorAll('.unit-card'));
    expect(cards).toHaveLength(3);

    for (const card of cards) {
      const buttons = card.querySelectorAll('button[aria-controls]');
      expect(buttons).toHaveLength(1);
      const button = buttons[0];
      expect(button.getAttribute('type')).toBe('button');
      const panel = root.querySelector(`[id="${button.getAttribute('aria-controls')}"]`);
      expect(panel).not.toBeNull();
      expect(panel!.classList.contains('unit-reviews')).toBe(true);
      // The button is the card's last child, laid over it, and is not a second .cursor-pointer.
      expect(card.lastElementChild).toBe(button);
      expect(button.classList.contains('cursor-pointer')).toBe(false);
      expect(button.className).toContain('absolute');
      expect(button.className).toContain('inset-0');
      // The card keeps what the e2e specs select it by.
      expect(card.classList.contains('cursor-pointer')).toBe(true);
      expect(card.classList.contains('relative')).toBe(true);
    }
  });

  it('opens the first card and closes the rest, in the button, the card and the panel alike', async () => {
    const root = await renderPage();
    const cards = Array.from(root.querySelectorAll('.unit-card'));
    cards.forEach((card, index) => {
      const button = card.querySelector('button[aria-controls]')!;
      const panel = root.querySelector(`[id="${button.getAttribute('aria-controls')}"]`)!;
      const chevron = card.querySelector('.chevron-icon')!;
      const open = index === 0;
      expect(button.getAttribute('aria-expanded')).toBe(open ? 'true' : 'false');
      expect(card.getAttribute('data-expanded')).toBe(open ? 'true' : 'false');
      expect(panel.classList.contains('hidden')).toBe(!open);
      expect(chevron.classList.contains('rotate-180')).toBe(open);
      expect(chevron.getAttribute('aria-hidden')).toBe('true');
      expect(chevron.getAttribute('class')).toContain('motion-reduce:transition-none');
    });
  });

  it('names each button by its unit, in card order', async () => {
    const root = await renderPage();
    const names = Array.from(root.querySelectorAll('.unit-card')).map((card) => {
      const button = card.querySelector('button[aria-controls]')!;
      const label = root.querySelector(`[id="${button.getAttribute('aria-labelledby')}"]`);
      expect(label?.tagName).toBe('H4');
      expect(card.contains(label)).toBe(true);
      return text(label);
    });
    expect(names).toEqual(['Studio', '1 bedroom', '2 bedrooms']);
  });

  it('labels the breadcrumb navigation', async () => {
    const root = await renderPage();
    const nav = root.querySelector('nav[aria-label="Breadcrumb"]');
    expect(nav).not.toBeNull();
    expect(nav!.querySelector('a[href="/"]')).not.toBeNull();
    expect(nav!.querySelector('a[href="/search"]')).not.toBeNull();
    expect(text(nav)).toContain('12 Example Rd');
  });
});
