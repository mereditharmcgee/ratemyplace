// Every page is either one search engines should index or one they should not (SEO-03). A
// page is indexable when it is in the sitemap or is one of the public detail routes; every
// other page carries BaseLayout's `noindex` (AdminLayout carries it for every admin page).
// A new page fails here until someone classifies it. Source-text test, like
// recordsBuildingPageSource.test.ts: rendering every page would need every page's data.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATIC_SITEMAP_PATHS } from '../sitemap';

const PAGES = join(process.cwd(), 'src', 'pages');
const INDEXABLE_DYNAMIC = ['/building/[slug]', '/landlord/[slug]', '/property-manager/[slug]'];

const pages = readdirSync(PAGES, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith('.astro'))
  .map((file) => {
    const rel = file.split(sep).join('/').replace(/\.astro$/, '').replace(/(^|\/)index$/, '');
    const route = rel === '' ? '/' : `/${rel}`;
    return { file, route, src: readFileSync(join(PAGES, file), 'utf8') };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

/** The page's layout tag. `[^>]*` spans line breaks, so a multi-line tag (dispute.astro) is read whole. */
function layoutTag(src: string): { name: string; tag: string } | null {
  const match = src.match(/<(BaseLayout|AdminLayout)\b[^>]*>/);
  return match ? { name: match[1], tag: match[0] } : null;
}

describe('page indexing', () => {
  it('finds the pages', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('classifies $route exactly once', ({ route, src }) => {
    const layout = layoutTag(src);
    expect(layout, `${route} renders no BaseLayout or AdminLayout tag`).not.toBeNull();
    if (!layout) return;

    const inSitemap = STATIC_SITEMAP_PATHS.includes(route);
    const dynamic = INDEXABLE_DYNAMIC.includes(route);

    if (route === '/search') {
      // Plain /search is in the sitemap; any query parameter makes it a noindexed variant.
      expect(inSitemap).toBe(true);
      expect(layout.tag).toContain('noindex={isSearchVariant(Astro.url)}');
      return;
    }

    const noindexed = layout.name === 'AdminLayout' || /\bnoindex\b/.test(layout.tag);
    expect(
      [inSitemap, dynamic, noindexed].filter(Boolean),
      `${route} must be exactly one of: a sitemap page, an indexable dynamic route, or noindex`,
    ).toHaveLength(1);
  });

  it('has a page for every sitemap path', () => {
    for (const path of STATIC_SITEMAP_PATHS) {
      const file = path === '/' ? join(PAGES, 'index.astro') : join(PAGES, `${path.slice(1)}.astro`);
      expect(existsSync(file), `${path} is in the sitemap but has no page`).toBe(true);
    }
  });

  it('noindexes every admin page through AdminLayout', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'admin', 'AdminLayout.astro'), 'utf8');
    const tag = src.match(/<BaseLayout\b[^>]*>/)?.[0] ?? '';
    expect(tag).toMatch(/\bnoindex\b/);
  });

  it('titles the homepage with the tagline, verbatim', () => {
    expect(readFileSync(join(PAGES, 'index.astro'), 'utf8')).toContain('title="Know before you sign."');
  });
});
