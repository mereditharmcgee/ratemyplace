import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

interface Notification {
  id: number;
  event_type: string;
  review_id: string | null;
  message: string;
  read_at: number | null;
  created_at: number;
}

/**
 * GET /api/notifications
 * Returns the authenticated user's notifications ordered by created_at DESC.
 */
export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    const { results } = await db
      .prepare(
        'SELECT id, event_type, review_id, message, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
      )
      .bind(context.locals.user.id)
      .all<Notification>();

    return new Response(JSON.stringify({ notifications: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch notifications' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * PATCH /api/notifications
 * Marks all unread notifications as read for the authenticated user.
 */
export async function PATCH(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    await db
      .prepare(
        'UPDATE notifications SET read_at = unixepoch() WHERE user_id = ? AND read_at IS NULL'
      )
      .bind(context.locals.user.id)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    return new Response(JSON.stringify({ error: 'Failed to mark notifications as read' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
