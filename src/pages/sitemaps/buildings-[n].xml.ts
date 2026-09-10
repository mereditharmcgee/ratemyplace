import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { logError } from '../../lib/logger';
import { getEnv } from '../../lib/runtime';
import { SITEMAP_HEADERS, buildingSitemapEntries, renderUrlSet, siteUrlFrom, type BuildingSitemapEntry } from '../../lib/sitemap';

// Bounded at four digits (9999 chunks, ~100M URLs) rather than open-ended. An unbounded `n`
// let any bot URL run the full sitemap query for an uncacheable 404, and values above 2^53
// failed the OFFSET bind, surfacing as a 503 plus a log line instead of a plain 404.
const CHUNK_NUMBER = /^[1-9]\d{0,3}$/;

function notFound(): Response {
  // Cached for a day. An in-range but empty chunk (`buildings-9999.xml`) still runs the
  // sitemap query to discover it is empty, so an uncacheable 404 would let one bot repeat
  // that scan; a day of caching makes the probe cost once per URL instead of once per fetch.
  return new Response('Not found\n', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}

export async function GET(context: APIContext): Promise<Response> {
  const raw = context.params.n;
  // 1-based and no leading zeros, so `buildings-0.xml` and `buildings-01.xml` are not
  // second spellings of a real chunk that a crawler could index twice.
  if (!raw || !CHUNK_NUMBER.test(raw)) return notFound();
  const n = Number(raw);
  const site = siteUrlFrom(getEnv(context));

  let entries: BuildingSitemapEntry[];
  try {
    entries = await buildingSitemapEntries(getDB(context), n);
  } catch (err) {
    // Unlike the index, a chunk has no useful degraded answer. 503 with a Retry-After tells
    // the crawler to come back instead of dropping the URLs it already knows.
    logError('building sitemap chunk failed', { route: '/sitemaps/buildings-[n].xml', chunk: n, error: err instanceof Error ? err.message : String(err) });
    return new Response('Temporarily unavailable\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300' },
    });
  }

  // Past the last chunk. The index never names one of these, so a request for it is a stale
  // bookmark or a probe, not something to answer with an empty urlset.
  if (entries.length === 0) return notFound();

  return new Response(
    renderUrlSet(entries.map((entry) => ({ loc: `${site}/building/${entry.slug}`, lastmod: entry.lastmod }))),
    { headers: SITEMAP_HEADERS },
  );
}
