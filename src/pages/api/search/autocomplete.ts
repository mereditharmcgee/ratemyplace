import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

export async function GET(context: APIContext): Promise<Response> {
  const input = (context.url.searchParams.get('q') || '').trim();

  if (!input || input.length < 2) {
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);
    const pattern = `%${input}%`;

    // Search buildings by address and neighborhood
    const buildingResults = await db.prepare(`
      SELECT
        b.id, b.address, b.neighborhood, b.city, b.state, b.slug,
        COUNT(r.id) as review_count,
        ROUND(AVG(r.overall_score), 1) as avg_overall
      FROM buildings b
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      WHERE b.address LIKE ? OR b.neighborhood LIKE ?
      GROUP BY b.id
      ORDER BY review_count DESC, b.address ASC
      LIMIT 5
    `).bind(pattern, pattern).all();

    // Search landlords by name
    const landlordResults = await db.prepare(`
      SELECT
        l.id, l.name, l.slug,
        COUNT(r.id) as review_count,
        ROUND(AVG(r.overall_score), 1) as avg_overall
      FROM landlords l
      LEFT JOIN buildings b ON b.landlord_id = l.id
      LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
      WHERE l.name LIKE ?
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
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Search autocomplete error:', error);
    return new Response(JSON.stringify({ results: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
