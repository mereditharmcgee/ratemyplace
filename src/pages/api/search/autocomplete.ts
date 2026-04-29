import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { getClientIP, checkRateLimit, buildRateLimitHeaders } from '../../../lib/rateLimit';
import { validateSearch, escapeLikePattern } from '../../../lib/validation';

export async function GET(context: APIContext): Promise<Response> {
  const db = getDB(context);
  const ip = getClientIP(context);

  // 1. Rate limit: 120 / minute per IP (SEC-05)
  const rateLimit = await checkRateLimit(db, ip, 'search-autocomplete', 120, 60);
  if (!rateLimit.allowed) {
    const status = rateLimit.error ? 503 : 429;
    const message = rateLimit.error
      ? 'Service temporarily unavailable. Please try again in a few minutes.'
      : 'Too many requests. Please slow down.';
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...buildRateLimitHeaders(rateLimit, 120),
      }
    });
  }

  // 2. Validate (VAL-04)
  const rawInput = context.url.searchParams.get('q');
  const errors = validateSearch(rawInput);
  if (errors.length > 0) {
    return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const input = (rawInput || '').trim();

  // Existing min-length silent return (no 400 — keeps autocomplete UX clean per CONTEXT.md)
  if (!input || input.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 120) }
    });
  }

  try {
    const escaped = escapeLikePattern(input);
    const pattern = `%${escaped}%`;

    const buildingResults = await db.prepare(`
      SELECT
        b.id, b.address, b.neighborhood, b.city, b.state, b.slug,
        COUNT(r.id) as review_count,
        ROUND(AVG(r.overall_score), 1) as avg_overall
      FROM buildings b
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      WHERE b.address LIKE ? ESCAPE '\\' OR b.neighborhood LIKE ? ESCAPE '\\'
      GROUP BY b.id
      ORDER BY review_count DESC, b.address ASC
      LIMIT 5
    `).bind(pattern, pattern).all();

    const landlordResults = await db.prepare(`
      SELECT
        l.id, l.name, l.slug,
        COUNT(r.id) as review_count,
        ROUND(AVG(r.overall_score), 1) as avg_overall
      FROM landlords l
      LEFT JOIN buildings b ON b.landlord_id = l.id
      LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
      WHERE l.name LIKE ? ESCAPE '\\'
      GROUP BY l.id
      ORDER BY review_count DESC, l.name ASC
      LIMIT 3
    `).bind(pattern).all();

    const results = [
      ...(buildingResults.results || []).map((b: any) => ({
        id: b.id,
        type: 'building' as const,
        title: b.address,
        subtitle: [b.neighborhood, b.city, b.state].filter(Boolean).join(', '),
        slug: b.slug,
        reviewCount: b.review_count || 0,
        avgScore: b.avg_overall,
      })),
      ...(landlordResults.results || []).map((l: any) => ({
        id: l.id,
        type: 'landlord' as const,
        title: l.name,
        subtitle: l.review_count > 0 ? `${l.review_count} review${l.review_count !== 1 ? 's' : ''}` : 'Landlord',
        slug: l.slug,
        reviewCount: l.review_count || 0,
        avgScore: l.avg_overall,
      })),
    ];

    return new Response(JSON.stringify({ results }), {
      headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(rateLimit, 120) }
    });
  } catch (error) {
    console.error('Search autocomplete error:', error);
    return new Response(JSON.stringify({ results: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
