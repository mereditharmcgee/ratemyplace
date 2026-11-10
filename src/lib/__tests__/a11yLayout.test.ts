import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import AdminLayout from '../../components/admin/AdminLayout.astro';
import BaseLayout from '../../components/layout/BaseLayout.astro';

/**
 * Phase 28 (A11Y-02): the parts of the shared layout every page gets. A skip link is the first
 * thing a keyboard user reaches, main is its target and is never a Tab stop, the header nav has
 * a name, the mobile menu button reports whether the menu is open, and the notifications link
 * says how many are unread in words rather than in a badge only.
 */

interface RenderOptions {
  user?: { id: string; isAdmin: boolean } | null;
  unread?: number;
}

/** A D1 stand-in for the one query the header runs: the unread notification count. */
function stubDb(unread: number) {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ count: unread }),
      }),
    }),
  };
}

async function render({ user = null, unread = 0 }: RenderOptions = {}): Promise<Document> {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BaseLayout, {
    props: { title: 'Example', description: 'd' },
    slots: { default: '<h1>Example page</h1>' },
    request: new Request('https://ratemyplace.org/example'),
    partial: false,
    locals: {
      user,
      session: null,
      runtime: { env: { DB: stubDb(unread) } },
    } as unknown as App.Locals,
  });
  return parse(html);
}

/** Parse a whole page. The head's stylesheet links are dropped first, so happy-dom does not fetch the web fonts. */
function parse(html: string): Document {
  return new DOMParser().parseFromString(html.replace(/<link\b[^>]*>/g, ''), 'text/html') as unknown as Document;
}

describe('skip link and main target', () => {
  it('puts the skip link first in body', async () => {
    const doc = await render();
    const first = doc.body.firstElementChild;
    expect(first?.tagName).toBe('A');
    expect(first?.getAttribute('href')).toBe('#main-content');
    expect(first?.textContent?.trim()).toBe('Skip to main content');
  });

  it('keeps the skip link visually hidden until it has focus', async () => {
    const doc = await render();
    const classes = (doc.body.firstElementChild?.getAttribute('class') ?? '').split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['sr-only', 'focus:not-sr-only']));
  });

  it('gives main the target id and takes it out of the Tab order', async () => {
    const doc = await render();
    const main = doc.querySelector('main');
    expect(main?.id).toBe('main-content');
    expect(main?.getAttribute('tabindex')).toBe('-1');
    expect(doc.querySelectorAll('main')).toHaveLength(1);
  });
});

describe('header navigation', () => {
  it('names the header nav', async () => {
    const doc = await render();
    const nav = doc.querySelector('header nav');
    expect(nav?.getAttribute('aria-label')).toBe('Main');
  });

  it('ties the mobile menu button to the menu and starts it collapsed', async () => {
    const doc = await render();
    const button = doc.getElementById('mobile-menu-button');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-controls')).toBe('mobile-menu');
    expect(button?.getAttribute('aria-label')).toBe('Toggle menu');
    expect(doc.getElementById('mobile-menu')).not.toBeNull();
    expect(button?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says how many notifications are unread in the link name', async () => {
    const doc = await render({ user: { id: 'u1', isAdmin: false }, unread: 3 });
    const link = doc.querySelector('header .hidden.md\\:flex a[href="/profile"][aria-label]');
    expect(link?.getAttribute('aria-label')).toBe('Notifications, 3 unread');
    // The label carries the count, so the badge and the bell are hidden from the reader.
    const badge = link?.querySelector('span');
    expect(badge?.textContent?.trim()).toBe('3');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(link?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the plain name when nothing is unread', async () => {
    const doc = await render({ user: { id: 'u1', isAdmin: false }, unread: 0 });
    const link = doc.querySelector('header .hidden.md\\:flex a[href="/profile"][aria-label]');
    expect(link?.getAttribute('aria-label')).toBe('Notifications');
    expect(link?.querySelector('span')).toBeNull();
  });
});

describe('admin navigation', () => {
  async function renderAdmin(): Promise<Document> {
    const container = await AstroContainer.create();
    const html = await container.renderToString(AdminLayout, {
      props: { title: 'Reviews', currentPage: 'reviews' },
      slots: { default: '<h1>Reviews</h1>' },
      request: new Request('https://ratemyplace.org/admin/reviews'),
      partial: false,
      locals: {
        user: { id: 'admin-1', isAdmin: true },
        session: null,
        runtime: { env: { DB: stubDb(0) } },
      } as unknown as App.Locals,
    });
    return parse(html);
  }

  it('names the admin nav and marks the current page', async () => {
    const doc = await renderAdmin();
    const nav = doc.querySelector('nav[aria-label="Admin"]');
    expect(nav).not.toBeNull();
    const current = Array.from(nav!.querySelectorAll('a[aria-current]'));
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('aria-current')).toBe('page');
    expect(current[0].getAttribute('href')).toBe('/admin/reviews');
    for (const icon of Array.from(nav!.querySelectorAll('svg'))) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  it('switches the focus indicator to white on the dark admin bar', async () => {
    const doc = await renderAdmin();
    const bar = Array.from(doc.querySelectorAll('div')).find((el) =>
      (el.getAttribute('class') ?? '').split(/\s+/).includes('bg-slate-800'),
    );
    expect((bar?.getAttribute('class') ?? '').split(/\s+/)).toContain('[--focus-ring:#fff]');
  });
});
