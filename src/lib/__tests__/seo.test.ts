import { describe, it, expect } from 'vitest';
import { canonicalPath, headMeta, isSearchVariant, siteOriginFrom } from '../seo';

describe('canonicalPath', () => {
  it('gives root as a single slash', () => {
    expect(canonicalPath('/')).toBe('/');
    expect(canonicalPath('')).toBe('/');
  });

  it('strips the trailing slash, matching the sitemap form', () => {
    expect(canonicalPath('/about/')).toBe('/about');
    expect(canonicalPath('/about')).toBe('/about');
    expect(canonicalPath('/building/6-prescott-street-boston/')).toBe('/building/6-prescott-street-boston');
  });

  it('collapses repeated slashes', () => {
    expect(canonicalPath('//about//')).toBe('/about');
  });

  it('never lowercases or re-encodes', () => {
    expect(canonicalPath('/Building/A%20B')).toBe('/Building/A%20B');
  });
});

describe('siteOriginFrom', () => {
  const DEFAULT = 'https://ratemyplace.org';

  it('falls back to production when SITE_URL is missing or blank', () => {
    expect(siteOriginFrom(undefined)).toBe(DEFAULT);
    expect(siteOriginFrom({ SITE_URL: '' })).toBe(DEFAULT);
    expect(siteOriginFrom({ SITE_URL: '   ' })).toBe(DEFAULT);
  });

  it('reduces SITE_URL to a bare origin', () => {
    expect(siteOriginFrom({ SITE_URL: 'https://ratemyplace.org/' })).toBe(DEFAULT);
    expect(siteOriginFrom({ SITE_URL: 'https://ratemyplace.org/some/path' })).toBe(DEFAULT);
  });

  it('adds https to a scheme-less value', () => {
    expect(siteOriginFrom({ SITE_URL: 'ratemyplace.org' })).toBe(DEFAULT);
    expect(siteOriginFrom({ SITE_URL: 'localhost:4321' })).toBe('https://localhost:4321');
  });

  it('keeps an explicit http origin', () => {
    expect(siteOriginFrom({ SITE_URL: 'http://localhost:4321' })).toBe('http://localhost:4321');
  });

  it('falls back on values that are not an http(s) origin', () => {
    expect(siteOriginFrom({ SITE_URL: 'https://' })).toBe(DEFAULT);
    expect(siteOriginFrom({ SITE_URL: '%%%' })).toBe(DEFAULT);
    expect(siteOriginFrom({ SITE_URL: 'ftp://x.org' })).toBe(DEFAULT);
  });
});

describe('headMeta', () => {
  const base = { title: 'About', description: 'd', pathname: '/about/', siteOrigin: 'https://ratemyplace.org' };

  it('builds the full set for an indexable page', () => {
    const meta = headMeta(base);
    expect(meta.title).toBe('About | RateMyPlace');
    expect(meta.description).toBe('d');
    expect(meta.siteName).toBe('RateMyPlace');
    expect(meta.url).toBe('https://ratemyplace.org/about');
    expect(meta.robots).toBeNull();
    expect(meta.image).toEqual({
      url: 'https://ratemyplace.org/brand/social/og-default.png',
      width: 1200,
      height: 630,
      type: 'image/png',
      alt: expect.any(String),
    });
    expect(meta.image.alt.length).toBeGreaterThan(0);
  });

  it('drops the canonical URL on a noindex page but keeps the absolute image', () => {
    const meta = headMeta({ ...base, noindex: true });
    expect(meta.robots).toBe('noindex, follow');
    expect(meta.url).toBeNull();
    expect(meta.image.url).toBe('https://ratemyplace.org/brand/social/og-default.png');
  });

  it('keeps the trailing slash on the root URL', () => {
    expect(headMeta({ ...base, pathname: '/' }).url).toBe('https://ratemyplace.org/');
  });
});

describe('isSearchVariant', () => {
  it('treats bare /search as the indexable page', () => {
    expect(isSearchVariant(new URL('https://ratemyplace.org/search'))).toBe(false);
    expect(isSearchVariant(new URL('https://ratemyplace.org/search?'))).toBe(false);
  });

  it('treats any query parameter as a variant', () => {
    expect(isSearchVariant(new URL('https://ratemyplace.org/search?q=lanark'))).toBe(true);
    expect(isSearchVariant(new URL('https://ratemyplace.org/search?q='))).toBe(true);
    expect(isSearchVariant(new URL('https://ratemyplace.org/search?type=landlords'))).toBe(true);
  });
});
