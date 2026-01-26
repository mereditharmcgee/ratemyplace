import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

export interface PendingVerification {
  id: string;
  review_id: string;
  user_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: number;
  building_address: string;
  building_city: string;
  user_email: string;
}

export async function GET(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Require admin
  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const verifications = await db.prepare(`
      SELECT
        vi.id,
        vi.review_id,
        vi.user_id,
        vi.r2_key,
        vi.filename,
        vi.content_type,
        vi.size_bytes,
        vi.uploaded_at,
        b.address as building_address,
        b.city as building_city,
        u.email as user_email
      FROM verification_images vi
      JOIN reviews r ON vi.review_id = r.id
      JOIN buildings b ON r.building_id = b.id
      JOIN users u ON vi.user_id = u.id
      WHERE vi.status = 'pending'
      ORDER BY vi.uploaded_at ASC
    `).all<PendingVerification>();

    return new Response(JSON.stringify({
      verifications: verifications.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching pending verifications:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch verifications' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
