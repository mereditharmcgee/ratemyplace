import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import BaseLayout from '../../components/layout/BaseLayout.astro';

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

const content = (head: HTMLHeadElement, key: string): string | null =>
  head.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content') ?? null;
const canonical = (head: HTMLHeadElement): string | null =>
  head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;

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
});
