import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';

export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);

    const { results } = await db.prepare(`
      SELECT b.*, u.email as user_email
      FROM bug_reports b
      LEFT JOIN users u ON b.user_id = u.id
      ORDER BY b.created_at DESC
    `).all();

    return new Response(JSON.stringify({ bugs: results }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to fetch bug reports:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch bug reports' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
