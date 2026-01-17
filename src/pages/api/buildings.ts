import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';

export async function GET(context: APIContext): Promise<Response> {
  const query = context.url.searchParams.get('q') || '';

  if (!query) {
    return new Response(JSON.stringify({ buildings: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const result = await db.prepare(`
      SELECT id, address, neighborhood, city, state, slug
      FROM buildings
      WHERE address LIKE ? OR neighborhood LIKE ?
      ORDER BY address
      LIMIT 10
    `).bind(`%${query}%`, `%${query}%`).all();

    return new Response(JSON.stringify({ buildings: result.results || [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Buildings search error:', error);
    return new Response(JSON.stringify({ error: 'Search failed', buildings: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
