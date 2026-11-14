// SEO-05 guards that read source text, like pageIndexing.test.ts: one place writes structured
// data, it goes through the one serializer, and the breadcrumb trail a page puts in its JSON-LD
// is the one its visible <nav> shows.
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_BREADCRUMB, SEARCH_BREADCRUMB } from '../jsonLd';

const SRC = join(process.cwd(), 'src');
const LAYOUT = 'src/components/layout/BaseLayout.astro';

const files = readdirSync(SRC, { recursive: true })
  .map(String)
  .map((file) => `src/${file.split(sep).join('/')}`)
  .filter((file) => /\.(astro|ts|tsx|js|mjs)$/.test(file) && !file.includes('/__tests__/'))
  .sort();
const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');

/** The breadcrumb trail a page shows: a <nav> whose items are separated by a "/" span. */
function breadcrumbNav(src: string): string | null {
  for (const match of src.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/g)) {
    if (match[1].includes('<span class="mx-2">/</span>')) return match[1];
  }
  return null;
}

const pages = files.filter((file) => file.startsWith('src/pages/') && file.endsWith('.astro'));
const breadcrumbPages = pages.filter((file) => breadcrumbNav(read(file)) !== null);

describe('structured data source', () => {
  it('scans the source tree', () => {
    expect(files).toContain(LAYOUT);
    expect(files).toContain('src/lib/jsonLd.ts');
  });

  // Components and islands only: `src/lib/smoke.ts` reads JSON-LD blocks, it does not write one.
  it('writes a JSON-LD script in exactly one component, the base layout', () => {
    expect(files.filter((file) => /\.(astro|tsx)$/.test(file) && read(file).includes('ld+json'))).toEqual([LAYOUT]);
  });

  it('uses set:html in exactly one component, the base layout', () => {
    expect(files.filter((file) => file.endsWith('.astro') && read(file).includes('set:html'))).toEqual([LAYOUT]);
  });

  it('feeds that set:html only from serializeJsonLd', () => {
    const src = read(LAYOUT);
    expect(src).toMatch(/import \{[^}]*\bserializeJsonLd\b[^}]*\} from '\.\.\/\.\.\/lib\/jsonLd';/);
    const uses = Array.from(src.matchAll(/set:html=\{([^}]*)\}/g), (match) => match[1].trim());
    expect(uses).toHaveLength(1);
    const [name] = uses;
    expect(name).toMatch(/^\w+$/);
    const assignment = src.match(new RegExp(`const ${name} = ([^;]*);`));
    expect(assignment?.[1]).toContain('serializeJsonLd(');
    // The block is a data block, never a module or classic script.
    expect(src).toMatch(new RegExp(`<script type="application/ld\\+json" is:inline set:html=\\{${name}\\} />`));
  });

  it('finds the three detail pages that render a breadcrumb', () => {
    expect(breadcrumbPages).toEqual([
      'src/pages/building/[slug].astro',
      'src/pages/landlord/[slug].astro',
      'src/pages/property-manager/[slug].astro',
    ]);
  });

  it.each(breadcrumbPages)('%s passes its visible breadcrumb trail to the layout', (file) => {
    const src = read(file);
    const nav = breadcrumbNav(src) ?? '';

    // The links the nav shows are the shared Home and Search crumbs, in that order.
    const links = Array.from(nav.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g), (match) => ({ path: match[1], name: match[2].trim() }));
    expect(links).toEqual([HOME_BREADCRUMB, SEARCH_BREADCRUMB]);

    // The last crumb is an expression; the JSON-LD trail is built from that same expression.
    const last = nav.trim().match(/<span[^>]*>\{([^}]+)\}<\/span>$/)?.[1];
    expect(last, 'the trail ends in a span holding the page name').toBeTruthy();
    expect(src).toContain(`const breadcrumbs = entityBreadcrumbs(${last});`);
    expect(src.match(/<BaseLayout\b[^>]*>/)?.[0]).toContain('breadcrumbs={breadcrumbs}');
  });
});
