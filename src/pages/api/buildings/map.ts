import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { recencyWeightedOverallSql, currentReviewYear } from '../../../lib/scoring-sql';

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
    const db = getDB(context);

    // Optional viewport-bounds filter. When the client supplies all four
    // numeric bounds, only return buildings inside the current map view; when
    // absent, fall back to the global set (backward compatible). Assumes a
    // non-antimeridian-crossing viewport (true for Boston/New Haven).
    const sp = context.url.searchParams;
    const north = parseFloat(sp.get('north') ?? '');
    const south = parseFloat(sp.get('south') ?? '');
    const east = parseFloat(sp.get('east') ?? '');
    const west = parseFloat(sp.get('west') ?? '');
    const hasBounds = [north, south, east, west].every((n) => Number.isFinite(n));

    const boundsClause = hasBounds
      ? 'AND b.latitude BETWEEN ? AND ? AND b.longitude BETWEEN ? AND ?'
      : '';
    const boundsBinds = hasBounds ? [south, north, west, east] : [];

    const currentYear = currentReviewYear();

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
        ${recencyWeightedOverallSql('r', currentYear)} as avg_score
      FROM buildings b
      LEFT JOIN reviews r ON r.building_id = b.id AND r.status = 'approved'
      WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL ${boundsClause}
      GROUP BY b.id
      ORDER BY review_count DESC
      LIMIT 500
    `).bind(...boundsBinds).all();

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
