import { describe, expect, it } from 'vitest';
import {
  HOME_BREADCRUMB,
  SEARCH_BREADCRUMB,
  entityBreadcrumbs,
  serializeJsonLd,
  structuredData,
  type StructuredDataInput,
} from '../jsonLd';
import { DEFAULT_OG_IMAGE, PRIMARY_MESSAGE, SITE_NAME } from '../seo';

/**
 * SEO-05: the one serializer every JSON-LD node goes through before BaseLayout writes it raw
 * into the head, and the graph builder that feeds it. A named-party field ("</script>...") must
 * stay inert data, and no rating of any kind may reach structured data.
 */

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const HOSTILE = [
  '</script><script>alert(1)</script>',
  '</SCRIPT ><script>alert(1)</script >',
  '<!-- comment -->',
  '<![CDATA[x]]>',
  'Smith & Sons <LLC>',
  `line${LS}separator${PS}paragraph`,
];

const ORIGIN = 'https://ratemyplace.org';

type Node = Record<string, unknown>;

function graphOf(input: StructuredDataInput): Node[] {
  return structuredData(input)['@graph'] as Node[];
}

function types(graph: Node[]): unknown[] {
  return graph.map((node) => node['@type']);
}

function byType(graph: Node[], type: string): Node {
  const node = graph.find((candidate) => candidate['@type'] === type);
  if (!node) throw new Error(`no ${type} node`);
  return node;
}

/** Every [key, value] pair at any depth. */
function entries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) return value.flatMap(entries);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [[key, child] as [string, unknown], ...entries(child)]);
  }
  return [];
}

const RATING_KEYS = ['aggregateRating', 'review', 'reviews', 'reviewRating', 'ratingValue', 'ratingCount', 'reviewCount', 'bestRating', 'worstRating'];
const RATING_TYPES = ['AggregateRating', 'Review', 'Rating'];
const PERSONAL_KEYS = ['founder', 'author', 'email', 'telephone', 'address', 'person', 'employee', 'member'];

describe('serializeJsonLd', () => {
  it('escapes <, > and & as unicode escapes', () => {
    expect(serializeJsonLd({ a: '<>&' })).toBe('{"a":"\\u003c\\u003e\\u0026"}');
  });

  it('escapes U+2028 and U+2029', () => {
    expect(serializeJsonLd({ a: `${LS}${PS}` })).toBe('{"a":"\\u2028\\u2029"}');
  });

  it.each(HOSTILE)('keeps %j inert and round-trips it', (hostile) => {
    const value = { '@context': 'https://schema.org', name: hostile, nested: [{ name: hostile }] };
    const out = serializeJsonLd(value);

    expect(out).not.toMatch(/[<>&]/);
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
    expect(out.toLowerCase()).not.toContain('</script');
    expect(out).not.toContain('<!--');
    expect(JSON.parse(out)).toEqual(value);
  });

  it('leaves other non-ASCII text as it is', () => {
    const name = `Caf${String.fromCharCode(0xe9)} ${String.fromCharCode(0xc9)}lan, Dorchester`;
    const out = serializeJsonLd({ name });
    expect(out).toContain(name);
    expect(JSON.parse(out)).toEqual({ name });
  });

  it('refuses a value JSON cannot represent', () => {
    expect(() => serializeJsonLd(undefined)).toThrow();
    expect(() => serializeJsonLd(() => 1)).toThrow();
    expect(() => serializeJsonLd(Symbol('x'))).toThrow();
  });
});

describe('structuredData', () => {
  const home: StructuredDataInput = {
    siteOrigin: ORIGIN,
    url: `${ORIGIN}/`,
    name: 'Know before you sign.',
    description: 'Home description',
  };

  it('gives the home page Organization, WebSite and WebPage, and no breadcrumb', () => {
    const graph = graphOf(home);
    expect(types(graph)).toEqual(['Organization', 'WebSite', 'WebPage']);
    expect(structuredData(home)['@context']).toBe('https://schema.org');

    const organization = byType(graph, 'Organization');
    expect(organization).toEqual({
      '@type': 'Organization',
      '@id': `${ORIGIN}/#organization`,
      name: SITE_NAME,
      url: `${ORIGIN}/`,
      logo: { '@type': 'ImageObject', url: `${ORIGIN}/brand/logo-mark.svg` },
      description: PRIMARY_MESSAGE,
    });

    const website = byType(graph, 'WebSite');
    expect(website).toEqual({
      '@type': 'WebSite',
      '@id': `${ORIGIN}/#website`,
      url: `${ORIGIN}/`,
      name: SITE_NAME,
      publisher: { '@id': `${ORIGIN}/#organization` },
      inLanguage: 'en-US',
    });
    // No SearchAction: Google retired the sitelinks search box, and /search?q= is noindex.
    expect(website).not.toHaveProperty('potentialAction');

    const page = byType(graph, 'WebPage');
    expect(page).toEqual({
      '@type': 'WebPage',
      '@id': `${ORIGIN}/#webpage`,
      url: `${ORIGIN}/`,
      name: 'Know before you sign.',
      description: 'Home description',
      isPartOf: { '@id': `${ORIGIN}/#website` },
      inLanguage: 'en-US',
    });
  });

  it('gives any other page only its WebPage, part of the site', () => {
    const graph = graphOf({ siteOrigin: ORIGIN, url: `${ORIGIN}/about`, name: 'About', description: 'd' });
    expect(types(graph)).toEqual(['WebPage']);
    expect(graph[0]).toMatchObject({ '@id': `${ORIGIN}/about#webpage`, url: `${ORIGIN}/about`, isPartOf: { '@id': `${ORIGIN}/#website` } });
    expect(graph[0]).not.toHaveProperty('breadcrumb');
  });

  it('adds a BreadcrumbList that ends at the page itself', () => {
    const url = `${ORIGIN}/building/1-test-street-boston`;
    const graph = graphOf({ siteOrigin: ORIGIN, url, name: '1 Test Street', description: 'd', breadcrumbs: entityBreadcrumbs('1 Test Street') });
    expect(types(graph)).toEqual(['WebPage', 'BreadcrumbList']);

    const list = byType(graph, 'BreadcrumbList');
    expect(list['@id']).toBe(`${url}#breadcrumb`);
    expect(byType(graph, 'WebPage').breadcrumb).toEqual({ '@id': `${url}#breadcrumb` });
    expect(list.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Search', item: `${ORIGIN}/search` },
      { '@type': 'ListItem', position: 3, name: '1 Test Street', item: url },
    ]);
  });

  it('treats an empty breadcrumb list as none', () => {
    expect(types(graphOf({ ...home, url: `${ORIGIN}/map`, breadcrumbs: [] }))).toEqual(['WebPage']);
  });

  it('builds every URL from the site origin it is given', () => {
    const origin = 'https://staging.example.test';
    const graph = structuredData({
      siteOrigin: origin,
      url: `${origin}/`,
      name: 'n',
      description: 'd',
      breadcrumbs: [HOME_BREADCRUMB, SEARCH_BREADCRUMB, { name: 'x' }],
    });
    const urls = entries(graph).filter(([key]) => ['@id', 'url', 'item'].includes(key)).map(([, value]) => value);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(String(url).startsWith(`${origin}/`), String(url)).toBe(true);
  });

  it('never carries a rating, a review or a person, even when handed one', () => {
    // The input is strings only. A caller that spreads an entity row in anyway gets nothing
    // of it back: the builder reads its declared fields and nothing else.
    const smuggled = {
      ...home,
      breadcrumbs: entityBreadcrumbs('Thin Data Landlord'),
      avg_overall: 4.8,
      aggregateRating: { ratingValue: 4.8 },
      id: 'landlord-INTERNAL-1',
      email: 'owner@example.test',
    } as unknown as StructuredDataInput;
    const graph = structuredData(smuggled);
    const keys = entries(graph).map(([key]) => key);
    for (const key of [...RATING_KEYS, ...PERSONAL_KEYS]) expect(keys).not.toContain(key);
    const typeValues = entries(graph).filter(([key]) => key === '@type').map(([, value]) => value);
    for (const type of RATING_TYPES) expect(typeValues).not.toContain(type);
    const text = JSON.stringify(graph);
    expect(text).not.toContain('4.8');
    expect(text).not.toContain('INTERNAL');
    expect(text).not.toContain('example.test');
  });

  it('round-trips a hostile breadcrumb name through the serializer unchanged', () => {
    const name = `Sentinel </script><script>alert(1)</script> & Co${LS}`;
    const url = `${ORIGIN}/landlord/sentinel-co`;
    const out = serializeJsonLd(structuredData({ siteOrigin: ORIGIN, url, name, description: `Reviews for landlord ${name}`, breadcrumbs: entityBreadcrumbs(name) }));
    expect(out.toLowerCase()).not.toContain('</script');
    const parsed = JSON.parse(out) as { '@graph': Node[] };
    const list = byType(parsed['@graph'], 'BreadcrumbList').itemListElement as Node[];
    expect(list[2].name).toBe(name);
    expect(byType(parsed['@graph'], 'WebPage').name).toBe(name);
  });
});

describe('entityBreadcrumbs', () => {
  it('is the Home / Search / name trail the detail pages show', () => {
    expect(entityBreadcrumbs('X')).toEqual([{ name: 'Home', path: '/' }, { name: 'Search', path: '/search' }, { name: 'X' }]);
  });
});

describe('PRIMARY_MESSAGE', () => {
  it('is the tail of the social image alt text, unchanged', () => {
    expect(DEFAULT_OG_IMAGE.alt).toBe('RateMyPlace. Know before you sign. A public record of rental housing, from the people who know it best.');
    expect(DEFAULT_OG_IMAGE.alt.endsWith(PRIMARY_MESSAGE)).toBe(true);
  });
});
