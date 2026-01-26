import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';

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

    const users = await db.prepare(`
      SELECT
        u.id,
        u.email,
        u.is_admin,
        u.email_verified,
        u.created_at,
        COUNT(r.id) as review_count
      FROM users u
      LEFT JOIN reviews r ON u.id = r.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    return new Response(JSON.stringify({
      users: users.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch users' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
