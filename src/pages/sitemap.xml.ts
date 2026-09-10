import type { APIContext } from 'astro';
import { getDB } from '../lib/db';
import { logError } from '../lib/logger';
import { getEnv } from '../lib/runtime';
import { SITEMAP_DEGRADED_HEADERS, SITEMAP_HEADERS, buildingChunkCount, renderSitemapIndex, siteUrlFrom } from '../lib/sitemap';

export async function GET(context: APIContext): Promise<Response> {
  const site = siteUrlFrom(getEnv(context));
  try {
    const chunks = await buildingChunkCount(getDB(context));
    const files = ['static.xml', ...Array.from({ length: chunks }, (_, i) => `buildings-${i + 1}.xml`)];
    return new Response(renderSitemapIndex(site, files), { headers: SITEMAP_HEADERS });
  } catch (err) {
    // D1 down: still answer with the static file so the index is never a 500 to a crawler.
    // The short TTL matters here: a five-second blip must not pin this truncated index — one
    // that names no building chunk at all — in caches for the full hour.
    logError('sitemap index chunk count failed', { route: '/sitemap.xml', error: err instanceof Error ? err.message : String(err) });
    return new Response(renderSitemapIndex(site, ['static.xml']), { headers: SITEMAP_DEGRADED_HEADERS });
  }
}
