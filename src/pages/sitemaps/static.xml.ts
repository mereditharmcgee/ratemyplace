import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { logError } from '../../lib/logger';
import { getEnv } from '../../lib/runtime';
import { SITEMAP_DEGRADED_HEADERS, SITEMAP_HEADERS, STATIC_SITEMAP_PATHS, landlordSitemapEntries, renderUrlSet, siteUrlFrom, type UrlEntry } from '../../lib/sitemap';

export async function GET(context: APIContext): Promise<Response> {
  const site = siteUrlFrom(getEnv(context));
  // The allowlisted pages carry no lastmod: they change when the code changes, and a date
  // we would have to guess is worse than none.
  const entries: UrlEntry[] = STATIC_SITEMAP_PATHS.map((path) => ({ loc: `${site}${path}`, lastmod: null }));
  let headers = SITEMAP_HEADERS;
  try {
    for (const landlord of await landlordSitemapEntries(getDB(context))) {
      entries.push({ loc: `${site}/landlord/${landlord.slug}`, lastmod: landlord.lastmod });
    }
  } catch (err) {
    // The static pages alone are still a useful, valid urlset — better than a 500. The short
    // TTL keeps a five-second D1 blip from pinning this landlord-less urlset in caches for the
    // full hour.
    logError('static sitemap landlords failed', { route: '/sitemaps/static.xml', error: err instanceof Error ? err.message : String(err) });
    headers = SITEMAP_DEGRADED_HEADERS;
  }
  return new Response(renderUrlSet(entries), { headers });
}
