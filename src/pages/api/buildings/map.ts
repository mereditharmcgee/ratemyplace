import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

interface BuildingMapData {
  id: string;
  address: string;
  slug: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  reviewCount: number;
  avgScore: number | null;
}

export async function GET(context: APIContext): Promise<Response> {
  try {
    const db = getDB((context.locals as any).runtime);

    // Get buildings with coordinates and their review stats
    const result = await db.prepare(`
      SELECT
        b.id,
        b.address,
        b.slug,
        b.neighborhood,
        b.latitude,
        b.longitude,
        COUNT(r.id) as review_count,
        AVG(r.overall_score) as avg_score
      FROM buildings b
      LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
      WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL
      GROUP BY b.id
      ORDER BY review_count DESC
      LIMIT 500
    `).all();

    const buildings: BuildingMapData[] = (result.results || []).map((row: any) => ({
      id: row.id,
      address: row.address,
      slug: row.slug,
      neighborhood: row.neighborhood,
      latitude: row.latitude,
      longitude: row.longitude,
      reviewCount: row.review_count || 0,
      avgScore: row.avg_score ? Math.round(row.avg_score * 10) / 10 : null
    }));

    return new Response(JSON.stringify({ buildings }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      }
    });
  } catch (error) {
    console.error('Map buildings error:', error);
    return new Response(JSON.stringify({ error: 'Failed to load buildings', buildings: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
