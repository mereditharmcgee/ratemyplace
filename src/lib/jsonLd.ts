// Structured data for the page head (SEO-05): Organization and WebSite on the home page,
// WebPage on every indexable page, BreadcrumbList on the pages that show a breadcrumb.
// BaseLayout is the only caller, and it skips noindex pages, the same as their canonical.
//
// Never AggregateRating, Review or any rating value: a landlord or property-manager score is
// withheld below NAMED_PARTY_MIN_REVIEWS, and the design spec (2026-08-26, section 9) defers
// rating markup. The builder's input is strings the page already shows (its title,
// description, canonical URL and breadcrumb labels), never an entity row, so no score, count,
// internal id or private field can reach it.
import { PRIMARY_MESSAGE, SITE_NAME, canonicalPath } from './seo';

// Built from code points so this file stays ASCII: a raw U+2028 or U+2029 inside a regex
// literal is a line terminator to the parser.
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

/**
 * The only way a value reaches the head's structured-data script. BaseLayout writes the result
 * with `set:html`, which does no escaping, so this does: after JSON.stringify, every `<`, `>`
 * and `&` becomes a JSON unicode escape, so a name such as `</script><script>...` cannot close
 * the element or open a comment, and U+2028 / U+2029 are escaped so the text is safe in a
 * JavaScript string context too. Those characters only ever occur inside JSON strings, so the
 * output is still valid JSON and parses back to the same value. Throws on a value JSON cannot
 * represent rather than writing the text `undefined` into the page.
 */
export function serializeJsonLd(value: unknown): string {
  const json: string | undefined = JSON.stringify(value);
  if (json === undefined) throw new TypeError('serializeJsonLd: value has no JSON representation');
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATOR, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR, '\\u2029');
}

export interface Breadcrumb {
  name: string;
  /** A site path. Left off the last crumb, which is the page itself (its canonical URL). */
  path?: string;
}

export const HOME_BREADCRUMB: Breadcrumb = { name: 'Home', path: '/' };
export const SEARCH_BREADCRUMB: Breadcrumb = { name: 'Search', path: '/search' };

/**
 * The trail the building, landlord and property-manager pages show above their heading:
 * Home / Search / the address or name. Each page passes the same value its <nav> prints, and
 * `structuredDataSource.test.ts` holds the labels to the markup.
 */
export function entityBreadcrumbs(name: string): Breadcrumb[] {
  return [HOME_BREADCRUMB, SEARCH_BREADCRUMB, { name }];
}

export interface StructuredDataInput {
  /** `siteOriginFrom(SITE_URL)`, the origin of the canonical. */
  siteOrigin: string;
  /** The page's canonical URL (`headMeta`'s `url`). */
  url: string;
  /** The page's title prop, without the " | RateMyPlace" suffix. */
  name: string;
  description: string;
  breadcrumbs?: readonly Breadcrumb[];
}

export type JsonLdNode = Record<string, unknown>;
export interface JsonLdGraph {
  '@context': 'https://schema.org';
  '@graph': JsonLdNode[];
}

/** The approved Final mark (brand.md, logo section). An owner-approved raster mark can replace it. */
export const ORGANIZATION_LOGO_PATH = '/brand/logo-mark.svg';
const LANGUAGE = 'en-US';

export function structuredData(input: StructuredDataInput): JsonLdGraph {
  const origin = input.siteOrigin;
  const url = input.url;
  const homeUrl = `${origin}/`;
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const breadcrumbId = `${url}#breadcrumb`;
  const crumbs = input.breadcrumbs && input.breadcrumbs.length > 0 ? input.breadcrumbs : null;
  const graph: JsonLdNode[] = [];

  // Google reads the site name and logo from the home page. Other pages point at the WebSite by
  // its @id. No SearchAction: Google retired the sitelinks search box in November 2024, and a
  // /search?q= results page is noindex.
  if (url === homeUrl) {
    graph.push({
      '@type': 'Organization',
      '@id': organizationId,
      name: SITE_NAME,
      url: homeUrl,
      logo: { '@type': 'ImageObject', url: `${origin}${ORGANIZATION_LOGO_PATH}` },
      description: PRIMARY_MESSAGE,
    });
    graph.push({
      '@type': 'WebSite',
      '@id': websiteId,
      url: homeUrl,
      name: SITE_NAME,
      publisher: { '@id': organizationId },
      inLanguage: LANGUAGE,
    });
  }

  graph.push({
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: input.name,
    description: input.description,
    isPartOf: { '@id': websiteId },
    inLanguage: LANGUAGE,
    ...(crumbs ? { breadcrumb: { '@id': breadcrumbId } } : {}),
  });

  if (crumbs) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': breadcrumbId,
      itemListElement: crumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: crumb.path === undefined ? url : `${origin}${canonicalPath(crumb.path)}`,
      })),
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}
