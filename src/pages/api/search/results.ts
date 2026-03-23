import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

export async function GET(context: APIContext): Promise<Response> {
  const query = (context.url.searchParams.get('q') || '').trim();
  const resultType = context.url.searchParams.get('type') || 'buildings';
  const offset = Math.max(0, parseInt(context.url.searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(context.url.searchParams.get('limit') || '10', 10) || 10));

  try {
    const db = getDB((context.locals as any).runtime);

    if (resultType === 'buildings') {
      const baseQuery = query
        ? `FROM buildings b
           LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
           LEFT JOIN landlords l ON b.landlord_id = l.id
           WHERE b.address LIKE ? OR b.neighborhood LIKE ? OR l.name LIKE ?
           GROUP BY b.id
           HAVING COUNT(r.id) > 0`
        : `FROM buildings b
           LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
           LEFT JOIN landlords l ON b.landlord_id = l.id
           GROUP BY b.id
           HAVING COUNT(r.id) > 0`;

      const binds = query ? [`%${query}%`, `%${query}%`, `%${query}%`] : [];

      const countResult = await db.prepare(
        `SELECT COUNT(*) as total FROM (SELECT b.id ${baseQuery})`
      ).bind(...binds).first<{ total: number }>();

      const rows = await db.prepare(
        `SELECT b.*, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall, l.name as landlord_name
         ${baseQuery}
         ORDER BY COUNT(r.id) DESC, AVG(r.overall_score) DESC
         LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset).all();

      return new Response(JSON.stringify({
        results: rows.results || [],
        total: countResult?.total || 0,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (resultType === 'landlords') {
      const baseQuery = query
        ? `FROM landlords l
           LEFT JOIN buildings b ON b.landlord_id = l.id
           LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
           WHERE l.name LIKE ?
           GROUP BY l.id
           HAVING COUNT(r.id) > 0`
        : `FROM landlords l
           LEFT JOIN buildings b ON b.landlord_id = l.id
           LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
           GROUP BY l.id
           HAVING COUNT(r.id) > 0`;

      const binds = query ? [`%${query}%`] : [];

      const countResult = await db.prepare(
        `SELECT COUNT(*) as total FROM (SELECT l.id ${baseQuery})`
      ).bind(...binds).first<{ total: number }>();

      const rows = await db.prepare(
        `SELECT l.*, COUNT(DISTINCT b.id) as building_count, COUNT(r.id) as review_count, ROUND(AVG(r.overall_score), 1) as avg_overall
         ${baseQuery}
         ORDER BY COUNT(r.id) DESC, l.name ASC
         LIMIT ? OFFSET ?`
      ).bind(...binds, limit, offset).all();

      return new Response(JSON.stringify({
        results: rows.results || [],
        total: countResult?.total || 0,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ results: [], total: 0 }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Search results error:', error);
    return new Response(JSON.stringify({ error: 'Search failed', results: [], total: 0 }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
