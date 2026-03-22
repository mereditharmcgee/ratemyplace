import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

export interface UserReview {
  id: string;
  building_id: string;
  building_address: string;
  building_slug: string;
  neighborhood: string | null;
  city: string;
  overall_score: number;
  status: 'pending' | 'approved' | 'rejected';
  is_verified: number | boolean;
  created_at: number;
  updated_at: number | null;
  review_title: string | null;
  moderation_notes: string | null;
  has_open_dispute: number | boolean;
}

export async function GET(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const reviews = await db.prepare(`
      SELECT
        r.id,
        r.building_id,
        b.address as building_address,
        b.slug as building_slug,
        b.neighborhood,
        b.city,
        r.overall_score,
        r.status,
        r.is_verified,
        r.created_at,
        r.updated_at,
        r.review_title,
        r.moderation_notes,
        CASE WHEN d.id IS NOT NULL THEN 1 ELSE 0 END as has_open_dispute
      FROM reviews r
      JOIN buildings b ON r.building_id = b.id
      LEFT JOIN disputes d ON d.review_id = r.id AND d.status = 'pending'
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `).bind(context.locals.user.id).all<UserReview>();

    return new Response(JSON.stringify({
      reviews: reviews.results.map(r => ({
        ...r,
        is_verified: r.is_verified === 1 || r.is_verified === true,
        has_open_dispute: r.has_open_dispute === 1 || r.has_open_dispute === true
      }))
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching user reviews:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch reviews' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
