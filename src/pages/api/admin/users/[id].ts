import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';

export async function PATCH(context: APIContext): Promise<Response> {
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

  const userId = context.params.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'User ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Prevent self-modification
  if (userId === context.locals.user.id) {
    return new Response(JSON.stringify({ error: 'Cannot modify your own admin status' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await context.request.json();
    const { is_admin } = body;

    if (typeof is_admin !== 'number' || (is_admin !== 0 && is_admin !== 1)) {
      return new Response(JSON.stringify({ error: 'Invalid is_admin value' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB((context.locals as any).runtime);

    // Check if user exists
    const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update user
    await db.prepare(`
      UPDATE users
      SET is_admin = ?, updated_at = unixepoch()
      WHERE id = ?
    `).bind(is_admin, userId).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return new Response(JSON.stringify({ error: 'Failed to update user' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
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

  const userId = context.params.id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'User ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const user = await db.prepare(`
      SELECT
        u.id,
        u.email,
        u.is_admin,
        u.email_verified,
        u.created_at,
        u.updated_at
      FROM users u
      WHERE u.id = ?
    `).bind(userId).first();

    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get user's reviews
    const reviews = await db.prepare(`
      SELECT
        r.id,
        r.review_title,
        r.status,
        r.created_at,
        r.overall_score,
        b.address as building_address
      FROM reviews r
      JOIN buildings b ON r.building_id = b.id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `).bind(userId).all();

    return new Response(JSON.stringify({
      user,
      reviews: reviews.results
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch user' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
