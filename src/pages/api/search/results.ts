import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { getClientIP, checkRateLimit, buildRateLimitHeaders } from '../../../lib/rateLimit';
import { validateSearch, escapeLikePattern } from '../../../lib/validation';
import { BUILDING_SEARCH_ORDER, buildingSearchSelect, buildingSearchWhere } from '../../../lib/searchSql';
import { currentReviewYear, namedPartyOverallSql, recencyWeightedOverallSql } from '../../../lib/scoring-sql';
import type { SearchResultsResponse } from '../../../lib/api-types';

export async function GET(context: APIContext): Promise<Response> {
  const db = getDB(context);
  const ip = getClientIP(context);
  const currentYear = currentReviewYear();

  // 1. Rate limit: 60 / minute per IP (SEC-05)
  const rateLimit = await checkRateLimit(db, ip, 'search-results', 60, 60);
  if (!rateLimit.allowed) {
    const status = rateLimit.error ? 503 : 429;
    const message = rateLimit.error
      ? 'Service temporarily unavailable. Please try again in a few minutes.'
      : 'Too many requests. Please slow down.';
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...buildRateLimitHeaders(rateLimit, 60),
      }
    });
  }

  // 2. Validate (VAL-04: length cap on trimmed query)
  const rawQuery = context.url.searchParams.get('q');
  const errors = validateSearch(rawQuery);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const query = (rawQuery || '').trim();
  const resultType = context.url.searchParams.get('type') || 'buildings';
  const offset = Math.max(0, parseInt(context.url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(context.url.searchParams.get('limit') || '10', 10) || 10));

  try {
    if (resultType === 'buildings') {
      // Two different queries, not one template with a flag. A search names an address, so
      // it answers with every matching building — the fragments in `lib/searchSql.ts`, the
      // same ones search.astro renders its first page from. Browse mode has no address to
      // match and stays reviewed-only: it is a landing list, not an answer.
      //
      // Explicit column lists in both — never `b.*`. A wildcard leaks internal columns
      // (admin_notes, owner_*) into this public JSON response and into the search
      // island's serialized props (visible in view-source).
      let countSql: string;
      let rowsSql: string;
      let binds: Array<string | number>;

      if (query) {
        const where = buildingSearchWhere(query);
        const from = `FROM buildings b
           LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
           LEFT JOIN landlords l ON b.landlord_id = l.id
           WHERE ${where.sql}
           GROUP BY b.id`;
        // The count needs no reviews join and no GROUP BY: query mode is no longer
        // reviewed-only, so one row per matching building is exactly COUNT(*).
        // `landlords.id` is the primary key, so the landlord join — which the WHERE needs
        // for `l.name` — cannot multiply a building into several rows.
        countSql = `SELECT COUNT(*) AS total FROM buildings b LEFT JOIN landlords l ON b.landlord_id = l.id WHERE ${where.sql}`;
        rowsSql = `SELECT ${buildingSearchSelect(currentYear)}
         ${from}
         ${BUILDING_SEARCH_ORDER}
         LIMIT ? OFFSET ?`;
        binds = where.binds;
      } else {
        const from = `FROM buildings b
           LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
           LEFT JOIN landlords l ON b.landlord_id = l.id
           GROUP BY b.id
           HAVING COUNT(r.id) > 0`;
        countSql = `SELECT COUNT(*) as total FROM (SELECT b.id ${from})`;
        rowsSql = `SELECT b.slug, b.address, b.neighborhood, b.city, b.state,
                COUNT(r.id) as review_count, ${recencyWeightedOverallSql('r', currentYear)} as avg_overall, l.name as landlord_name
         ${from}
         ORDER BY COUNT(r.id) DESC, avg_overall DESC, b.id ASC
         LIMIT ? OFFSET ?`;
        binds = [];
      }

      // `total` is only consumed for the first page: the search island takes its totals
      // from the SSR props on `search.astro` and every later request is a Load-more
      // append, whose `total` it discards. On a 38,000-row seeded table that count is the
      // expensive half of the request, so skip it whenever the caller is paging.
      const total = offset === 0
        ? (await db.prepare(countSql).bind(...binds).first<{ total: number }>())?.total || 0
        : 0;
      const rows = await db.prepare(rowsSql).bind(...binds, limit, offset).all();

      return new Response(JSON.stringify({
        results: rows.results || [],
        total,
      } satisfies SearchResultsResponse), { headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 60) } });
    }

    if (resultType === 'landlords') {
      const baseQuery = query
        ? `FROM landlords l
           LEFT JOIN buildings b ON b.landlord_id = l.id
           LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
           WHERE l.name LIKE ? ESCAPE '\\'
           GROUP BY l.id
           HAVING COUNT(r.id) > 0`
        : `FROM landlords l
           LEFT JOIN buildings b ON b.landlord_id = l.id
           LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
           GROUP BY l.id
           HAVING COUNT(r.id) > 0`;

      const escaped = query ? escapeLikePattern(query) : '';
      const pattern = `%${escaped}%`;
      const binds = query ? [pattern] : [];

      const countResult = await db.prepare(
        `SELECT COUNT(*) as total FROM (SELECT l.id ${baseQuery})`
      ).bind(...binds).first<{ total: number }>();

      // Explicit column list — never `l.*` (leaks admin_notes, owner_entity).
      const rows = await db.prepare(
        `SELECT l.slug, l.name, COUNT(DISTINCT b.id) as building_count, COUNT(r.id) as review_count, ${namedPartyOverallSql('r', currentYear)} as avg_overall
         ${baseQuery}
         ORDER BY COUNT(r.id) DESC, l.name ASC, l.id ASC
         LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset).all();

      return new Response(JSON.stringify({
        results: rows.results || [],
        total: countResult?.total || 0,
      } satisfies SearchResultsResponse), { headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 60) } });
    }

    return new Response(JSON.stringify({ results: [], total: 0 } satisfies SearchResultsResponse), {
      headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 60) }
    });
  } catch (error) {
    console.error('Search results error:', error);
    return new Response(JSON.stringify({ error: 'Search failed', results: [], total: 0 }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
