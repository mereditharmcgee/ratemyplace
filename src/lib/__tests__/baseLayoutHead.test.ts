import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import BaseLayout from '../../components/layout/BaseLayout.astro';
import ResetPasswordPage from '../../pages/auth/reset-password.astro';
import SigninPage from '../../pages/auth/signin.astro';

/**
 * The head every page gets from BaseLayout: canonical, Open Graph and Twitter tags. Until
 * October 2026 the image tags were relative and pointed at a missing file, there was no
 * canonical, and private pages were indexable.
 */

const PROD = { runtime: { env: { SITE_URL: 'https://ratemyplace.org' } } };

async function render(
  url: string,
  props: Record<string, unknown> = { title: 'About', description: 'd' },
  extra: Record<string, unknown> = PROD,
): Promise<HTMLHeadElement> {
  const container = await AstroContainer.create();
  const html = await container.renderToString(BaseLayout, {
    props,
    slots: { default: '<p>x</p>' },
    request: new Request(url),
    partial: false,
    locals: { user: null, session: null, ...extra } as unknown as App.Locals,
  });
  return new DOMParser().parseFromString(html, 'text/html').head; // happy-dom
}

async function renderPage(Page: Parameters<AstroContainer['renderToString']>[0], url: string): Promise<HTMLHeadElement> {
  const container = await AstroContainer.create();
  const html = await container.renderToString(Page, {
    request: new Request(url),
    partial: false,
    locals: { user: null, session: null } as unknown as App.Locals,
  });
  return new DOMParser().parseFromString(html, 'text/html').head;
}

const content = (head: HTMLHeadElement, key: string): string | null =>
  head.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content') ?? null;
const canonical = (head: HTMLHeadElement): string | null =>
  head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

type JsonLdNode = Record<string, unknown>;
const ldScripts = (head: HTMLHeadElement): HTMLScriptElement[] =>
  Array.from(head.querySelectorAll('script[type="application/ld+json"]'));
/** The one structured-data block's @graph, parsed. Fails the test unless there is exactly one. */
function ldGraph(head: HTMLHeadElement): JsonLdNode[] {
  const scripts = ldScripts(head);
  expect(scripts).toHaveLength(1);
  const parsed = JSON.parse(scripts[0].textContent ?? '') as { '@context': string; '@graph': JsonLdNode[] };
  expect(parsed['@context']).toBe('https://schema.org');
  return parsed['@graph'];
}
const ldNode = (graph: JsonLdNode[], type: string): JsonLdNode | undefined => graph.find((node) => node['@type'] === type);

describe('BaseLayout head', () => {
  it('carries the full canonical, Open Graph and Twitter set', async () => {
    const head = await render('https://ratemyplace-64y.pages.dev/about/?utm_source=x');

    expect(head.querySelectorAll('title')).toHaveLength(1);
    expect(head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(canonical(head)).toBe('https://ratemyplace.org/about');
    expect(content(head, 'og:url')).toBe('https://ratemyplace.org/about');
    expect(content(head, 'og:site_name')).toBe('RateMyPlace');
    expect(content(head, 'og:type')).toBe('website');

    expect(head.querySelector('title')?.textContent).toBe('About | RateMyPlace');
    expect(content(head, 'og:title')).toBe('About | RateMyPlace');
    expect(content(head, 'twitter:title')).toBe('About | RateMyPlace');
    expect(content(head, 'og:description')).toBe('d');
    expect(content(head, 'twitter:description')).toBe('d');

    expect(content(head, 'og:image')).toBe('https://ratemyplace.org/brand/social/og-default.png');
    expect(content(head, 'twitter:image')).toBe('https://ratemyplace.org/brand/social/og-default.png');
    expect(content(head, 'og:image:width')).toBe('1200');
    expect(content(head, 'og:image:height')).toBe('630');
    expect(content(head, 'og:image:type')).toBe('image/png');
    expect(content(head, 'og:image:alt')).toBeTruthy();
    expect(content(head, 'twitter:image:alt')).toBeTruthy();
    expect(content(head, 'twitter:card')).toBe('summary_large_image');
    expect(head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('makes every URL absolute', async () => {
    const head = await render('https://ratemyplace.org/about');
    const urls = [content(head, 'og:image'), content(head, 'og:url'), content(head, 'twitter:image'), canonical(head)];
    for (const url of urls) expect(url).toMatch(/^https:\/\//);
  });

  it('keeps the slash on the root canonical', async () => {
    expect(canonical(await render('https://ratemyplace.org/'))).toBe('https://ratemyplace.org/');
  });

  it('marks a noindex page and advertises no URL for it', async () => {
    const head = await render('https://ratemyplace.org/about', { title: 'X', noindex: true });
    expect(content(head, 'robots')).toBe('noindex, follow');
    expect(canonical(head)).toBeNull();
    expect(content(head, 'og:url')).toBeNull();
    expect(content(head, 'og:image')).toBe('https://ratemyplace.org/brand/social/og-default.png');
  });

  it('renders with no runtime at all, falling back to production', async () => {
    expect(canonical(await render('https://ratemyplace.org/about', undefined, {}))).toBe('https://ratemyplace.org/about');
  });

  it('renders under the Astro 6+ adapter, whose env getter throws', async () => {
    const extra = {
      runtime: {
        get env(): never {
          throw new Error('removed');
        },
      },
    };
    expect(canonical(await render('https://ratemyplace.org/about', undefined, extra))).toBe('https://ratemyplace.org/about');
  });

  it('accepts a scheme-less SITE_URL', async () => {
    const extra = { runtime: { env: { SITE_URL: 'ratemyplace.org' } } };
    expect(canonical(await render('https://ratemyplace.org/about', undefined, extra))).toBe('https://ratemyplace.org/about');
  });

  it('never lets a query string reach the head', async () => {
    const head = await render('https://ratemyplace.org/building/x?submitted=true&reviewId=rev-SECRET-42');
    expect(head.innerHTML).not.toContain('rev-SECRET-42');
    expect(head.innerHTML).not.toContain('submitted');
    expect(canonical(head)).toBe('https://ratemyplace.org/building/x');
  });

  it('keeps a password-reset token out of the head', async () => {
    const head = await renderPage(ResetPasswordPage, 'https://ratemyplace.org/auth/reset-password?token=SECRET123');
    expect(head.innerHTML).not.toContain('SECRET123');
    expect(content(head, 'robots')).toBe('noindex, follow');
    expect(canonical(head)).toBeNull();
    expect(content(head, 'og:url')).toBeNull();
  });

  it('noindexes the sign-in page', async () => {
    const head = await renderPage(SigninPage, 'https://ratemyplace.org/auth/signin');
    expect(content(head, 'robots')).toBe('noindex, follow');
    expect(ldScripts(head)).toHaveLength(0);
  });
});

// SEO-05: one structured-data block on every indexable page, built from the same canonical,
// and none on a noindex page.
describe('BaseLayout structured data', () => {
  it('gives the home page Organization, WebSite and WebPage on the SITE_URL origin', async () => {
    const head = await render('https://ratemyplace-64y.pages.dev/', { title: 'Know before you sign.', description: 'Home' });
    const graph = ldGraph(head);

    expect(graph.map((node) => node['@type'])).toEqual(['Organization', 'WebSite', 'WebPage']);
    expect(ldNode(graph, 'Organization')?.['@id']).toBe('https://ratemyplace.org/#organization');
    expect(ldNode(graph, 'WebSite')?.['@id']).toBe('https://ratemyplace.org/#website');
    expect(ldNode(graph, 'WebPage')?.url).toBe(canonical(head));
    expect(ldNode(graph, 'WebPage')?.name).toBe('Know before you sign.');
    expect(ldNode(graph, 'WebPage')?.description).toBe('Home');
  });

  it('gives another page its WebPage only, at its canonical', async () => {
    const head = await render('https://ratemyplace.org/about/?utm_source=x');
    const graph = ldGraph(head);

    expect(graph.map((node) => node['@type'])).toEqual(['WebPage']);
    expect(ldNode(graph, 'WebPage')?.url).toBe('https://ratemyplace.org/about');
    expect(ldNode(graph, 'WebPage')?.url).toBe(canonical(head));
    expect(ldNode(graph, 'WebPage')?.isPartOf).toEqual({ '@id': 'https://ratemyplace.org/#website' });
    expect(head.innerHTML).not.toContain('utm_source');
  });

  it('renders the breadcrumbs a page passes as a BreadcrumbList', async () => {
    const head = await render('https://ratemyplace.org/landlord/x', {
      title: 'X',
      description: 'd',
      breadcrumbs: [{ name: 'Home', path: '/' }, { name: 'Search', path: '/search' }, { name: 'X' }],
    });
    const list = ldNode(ldGraph(head), 'BreadcrumbList');
    expect(list?.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://ratemyplace.org/' },
      { '@type': 'ListItem', position: 2, name: 'Search', item: 'https://ratemyplace.org/search' },
      { '@type': 'ListItem', position: 3, name: 'X', item: 'https://ratemyplace.org/landlord/x' },
    ]);
  });

  it('carries no structured data on a noindex page', async () => {
    const head = await render('https://ratemyplace.org/about', {
      title: 'X',
      noindex: true,
      breadcrumbs: [{ name: 'Home', path: '/' }, { name: 'X' }],
    });
    expect(ldScripts(head)).toHaveLength(0);
    expect(head.innerHTML).not.toContain('ld+json');
  });

  it('keeps a hostile title inert: no script breakout, and the parsed name is the raw text', async () => {
    const sentinel = `Sentinel </script><script>alert(1)</script><!-- & Co${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}`;
    const container = await AstroContainer.create();
    const html = await container.renderToString(BaseLayout, {
      props: { title: sentinel, description: sentinel, breadcrumbs: [{ name: 'Home', path: '/' }, { name: sentinel }] },
      slots: { default: '<p>x</p>' },
      request: new Request('https://ratemyplace.org/landlord/sentinel'),
      partial: false,
      locals: { user: null, session: null, ...PROD } as unknown as App.Locals,
    });
    // The raw block, up to the first closing tag: had the name closed the element early, this
    // would stop inside the name and carry its markup.
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1] ?? '';
    expect(block).toContain('"@graph"');
    expect(block).not.toMatch(/[<>&]/);
    expect(block).not.toContain(String.fromCharCode(0x2028));
    expect(block).not.toContain(String.fromCharCode(0x2029));

    // Parsed as a browser would: the head holds one script, the data block, and no executable
    // script anywhere carries the injected code. (The title and meta attributes hold the text
    // too, escaped by Astro; inside a quoted attribute it is inert.)
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const headScripts = Array.from(doc.head.querySelectorAll('script'));
    expect(headScripts.map((script) => script.getAttribute('type'))).toEqual(['application/ld+json']);
    const executable = Array.from(doc.querySelectorAll('script')).filter((script) => script.getAttribute('type') !== 'application/ld+json');
    for (const script of executable) expect(script.textContent ?? '').not.toContain('alert(1)');

    const graph = ldGraph(doc.head);
    expect(ldNode(graph, 'WebPage')?.name).toBe(sentinel);
    expect((ldNode(graph, 'BreadcrumbList')?.itemListElement as JsonLdNode[])[1].name).toBe(sentinel);
  });
});
