import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);
    const { results } = await db.prepare(
      'SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100'
    ).all();

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to fetch contact messages:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
