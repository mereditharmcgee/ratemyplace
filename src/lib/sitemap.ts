// Sitemap data and rendering, design spec Section 6. Included: an allowlist of static
// pages; every Boston building with a parcel; any other building, and any landlord, with an
// approved review. Excluded by construction: auth, profile, admin, review forms, property
// managers (their pages carry the named-party threshold and are reachable from buildings).
//
// No date in these files comes from a review. A lastmod that moved when a review was approved
// would tell anyone watching the sitemap the day a tenant posted, so a building's lastmod
// reads only its own row and its record pulls, and a landlord entry carries none.
import type { RecordsDb } from './records/types';

export const STATIC_SITEMAP_PATHS: readonly string[] = ['/', '/about', '/contact', '/guidelines', '/map', '/methodology', '/privacy', '/search', '/terms'];
export const SITEMAP_CHUNK = 10_000;

export interface BuildingSitemapEntry {
  slug: string;
  /** Unix seconds: the later of updated_at and the last record pull. Never a review date. */
  lastmod: number;
}

// Membership is a WHERE with an EXISTS, and the pull timestamp is a correlated subquery in the
// select list. The earlier shape pre-grouped `record_pulls` and `reviews` into derived tables
// and LEFT JOINed them, which scanned both tables in full on every chunk request and built a
// transient automatic index over each; the correlated form runs the MAX seek only for the
// rows actually emitted, because SQLite does not evaluate result-column subqueries for rows
// skipped by OFFSET. `idx_record_pulls_building (building_id, source_id, retrieved_at)` serves
// the pull seek; `idx_reviews_building_status (building_id, status)` serves the EXISTS.
const BUILDING_FROM = `
  FROM buildings b
  WHERE (b.city = 'Boston' AND b.parcel_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM reviews r WHERE r.building_id = b.id AND r.status = 'approved')`;

/**
 * How many `buildings-<n>.xml` chunks exist. Zero when nothing qualifies — the index lists
 * only the chunks it can actually serve, so a crawler is never handed a 404 for a URL the
 * index named.
 */
export async function buildingChunkCount(db: RecordsDb): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n ${BUILDING_FROM}`).first<{ n: number }>();
  return Math.ceil((row?.n ?? 0) / SITEMAP_CHUNK);
}

/** Chunk `n` (1-based) of the building URLs, ordered by id so chunk membership is stable between requests. */
export async function buildingSitemapEntries(db: RecordsDb, n: number): Promise<BuildingSitemapEntry[]> {
  // Scalar two-argument MAX(), not the aggregate: the larger of the two timestamps. It returns
  // NULL if any argument is NULL, hence the COALESCE around the subquery, which is NULL for a
  // building with no pull; `buildings.updated_at` is NOT NULL and needs none. The pull seek is
  // deliberately not filtered to the deeper sources: the assessor pull's `retrieved_at` is the
  // "as of" date the records panel shows, so it is exactly the date a crawler should read as
  // this page's last modification. Review timestamps stay out (see the top of this file).
  const { results } = await db
    .prepare(
      `SELECT b.slug,
              MAX(b.updated_at,
                  COALESCE((SELECT MAX(retrieved_at) FROM record_pulls p WHERE p.building_id = b.id), 0)) AS lastmod
       ${BUILDING_FROM} ORDER BY b.id LIMIT ? OFFSET ?`,
    )
    .bind(SITEMAP_CHUNK, (n - 1) * SITEMAP_CHUNK)
    .all<BuildingSitemapEntry>();
  return results;
}

/**
 * A landlord's slug and nothing else. There is no lastmod: a landlord's only timestamps are its
 * reviews' dates and the profile's own `created_at` / `updated_at`, and a profile is usually
 * created (or linked) while an admin moderates a review, so those track review dates too.
 */
export interface LandlordSitemapEntry {
  slug: string;
}

export async function landlordSitemapEntries(db: RecordsDb): Promise<LandlordSitemapEntry[]> {
  const { results } = await db
    .prepare(
      "SELECT l.slug FROM landlords l WHERE EXISTS (SELECT 1 FROM buildings b JOIN reviews r ON r.building_id = b.id AND r.status = 'approved' WHERE b.landlord_id = l.id) ORDER BY l.id",
    )
    .all<LandlordSitemapEntry>();
  return results;
}

export function toLastmod(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export interface UrlEntry {
  loc: string;
  lastmod: number | null;
}

export function renderUrlSet(entries: readonly UrlEntry[]): string {
  const body = entries.map((e) => `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${toLastmod(e.lastmod)}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function renderSitemapIndex(siteUrl: string, files: readonly string[]): string {
  const body = files.map((f) => `  <sitemap><loc>${escapeXml(`${siteUrl}/sitemaps/${f}`)}</loc></sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export const SITEMAP_HEADERS = { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' };

// A degraded answer is still a 200, so without a shorter TTL a five-second D1 blip would pin a
// truncated index (or a landlord-less static file) in caches for the full hour.
export const SITEMAP_DEGRADED_HEADERS = { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=60' };

export function siteUrlFrom(env: { SITE_URL?: string } | undefined): string {
  return (env?.SITE_URL || 'https://ratemyplace.org').replace(/\/+$/, '');
}
