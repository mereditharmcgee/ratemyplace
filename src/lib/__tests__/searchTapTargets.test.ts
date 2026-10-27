import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Footer from '../../components/layout/Footer.astro';
import Header from '../../components/layout/Header.astro';
import {
  createMemoryDatabase,
  sqliteAvailable,
  TestD1Database,
} from './helpers/sqliteD1';

/**
 * Links on the search page smaller than 24x24 CSS px. A browser pass over /search at 375,
 * 390 and 1366px found one when signed out: the footer's "Built by" credit link, an inline
 * text-sm link 17px tall. Signed in, the desktop header's notifications bell is a 20px-wide
 * icon link. Both come from the shared layout, so the fix shows on every page.
 *
 * Each gets a hit area of at least 24px with no visual change: the credit link is padded
 * and pulled back by the same negative margin so its line keeps its height, and the bell
 * sits centred in a 24px box.
 */

function fragment(html: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

function classes(el: Element | null | undefined): string[] {
  if (!el) throw new Error('element not found');
  return (el.getAttribute('class') ?? '').split(/\s+/);
}

describe('search page tap targets', () => {
  it('the footer credit link has a 28px hit area without moving its line', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Footer);
    // The one link set inside running text: the "Built by" credit, opened in a new tab.
    const inline = fragment(html).querySelectorAll('p a');
    expect(inline).toHaveLength(1);
    expect(inline[0].getAttribute('target')).toBe('_blank');
    const list = classes(inline[0]);
    // text-sm is a 20px line; 4px padding above and below makes 28px, and the matching
    // negative margin keeps the paragraph's height where it was.
    expect(list).toEqual(expect.arrayContaining(['inline-block', 'py-1', '-my-1']));
  });

  it('the footer link lists keep their 48px rows', async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Footer);
    const listLinks = Array.from(fragment(html).querySelectorAll('ul a'));
    expect(listLinks.length).toBeGreaterThan(0);
    for (const a of listLinks) expect(classes(a)).toEqual(expect.arrayContaining(['inline-block', 'py-3']));
  });

  const suite = sqliteAvailable ? it : it.skip;
  suite('the signed-in notifications bell is a 24px box', async () => {
    const database = createMemoryDatabase();
    try {
      database.exec('CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, read_at INTEGER)');
      const container = await AstroContainer.create();
      const html = await container.renderToString(Header, {
        locals: {
          user: { id: 'u1', isAdmin: false },
          session: null,
          runtime: { env: { DB: new TestD1Database(database) } },
        } as unknown as App.Locals,
      });
      const bell = fragment(html).querySelector('a[aria-label="Notifications"]');
      expect(classes(bell)).toEqual(expect.arrayContaining(['inline-flex', 'h-6', 'w-6', 'items-center', 'justify-center']));
    } finally {
      database.close();
    }
  });
});
