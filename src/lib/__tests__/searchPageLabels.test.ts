import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import SearchPage from '../../pages/search.astro';

/**
 * Phase 28 (A11Y-08): the search form's two fields had only a placeholder and no name at all
 * (axe select-name, critical, at both widths). The query input takes the home search's
 * existing name, and the type select is named "Search type".
 */

/** Browse mode asks D1 for two counts; zero of each means no further query runs. */
const emptyDb = {
  prepare: () => {
    const statement = {
      bind: () => statement,
      first: async () => ({ total: 0 }),
      all: async () => ({ results: [] }),
    };
    return statement;
  },
};

async function render(search = ''): Promise<HTMLElement> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  const html = await container.renderToString(SearchPage, {
    request: new Request(`https://ratemyplace.org/search${search}`),
    locals: { user: null, session: null, runtime: { env: { DB: emptyDb } } } as unknown as App.Locals,
    partial: false,
  });
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function classList(el: Element | null): string[] {
  return (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

describe('search page form labels', () => {
  it('names the query input and the type select', async () => {
    const root = await render();
    const input = root.querySelector('form[action="/search"] input[name="q"]');
    const select = root.querySelector('form[action="/search"] select[name="type"]');
    expect(input?.getAttribute('aria-label')).toBe('Search by address, neighborhood, or landlord');
    expect(select?.getAttribute('aria-label')).toBe('Search type');
  });

  it('keeps the placeholder and the options as they were', async () => {
    const root = await render();
    const input = root.querySelector('input[name="q"]');
    expect(input?.getAttribute('placeholder')).toBe('Search by address, neighborhood, or landlord name...');
    const options = Array.from(root.querySelectorAll('select[name="type"] option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['All', 'Buildings', 'Landlords']);
  });

  it('gives both fields a 2px teal-700 focus ring', async () => {
    const root = await render();
    for (const el of [root.querySelector('input[name="q"]'), root.querySelector('select[name="type"]')]) {
      const classes = classList(el);
      expect(classes).toEqual(expect.arrayContaining(['focus:ring-2', 'focus:ring-teal-700']));
      expect(classes).not.toContain('focus:ring-teal-500');
    }
  });
});
