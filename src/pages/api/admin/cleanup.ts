import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';

// Admin endpoint to cleanup buildings with no reviews
export async function POST(context: APIContext): Promise<Response> {
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

    // Find buildings with no reviews
    const emptyBuildings = await db.prepare(`
      SELECT b.id, b.address
      FROM buildings b
      LEFT JOIN reviews r ON b.id = r.building_id
      GROUP BY b.id
      HAVING COUNT(r.id) = 0
    `).all<{ id: string; address: string }>();

    const buildingsToDelete = emptyBuildings.results || [];

    if (buildingsToDelete.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No empty buildings found',
        deleted: 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Delete all empty buildings
    const ids = buildingsToDelete.map(b => b.id);
    const placeholders = ids.map(() => '?').join(',');

    await db.prepare(`DELETE FROM buildings WHERE id IN (${placeholders})`).bind(...ids).run();

    return new Response(JSON.stringify({
      success: true,
      message: `Deleted ${buildingsToDelete.length} building(s) with no reviews`,
      deleted: buildingsToDelete.length,
      buildings: buildingsToDelete.map(b => b.address)
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    return new Response(JSON.stringify({ error: 'Cleanup failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// GET to preview what would be deleted
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

    // Find buildings with no reviews
    const emptyBuildings = await db.prepare(`
      SELECT b.id, b.address, b.city, b.created_at
      FROM buildings b
      LEFT JOIN reviews r ON b.id = r.building_id
      GROUP BY b.id
      HAVING COUNT(r.id) = 0
      ORDER BY b.created_at DESC
    `).all<{ id: string; address: string; city: string; created_at: number }>();

    return new Response(JSON.stringify({
      emptyBuildings: emptyBuildings.results || [],
      count: (emptyBuildings.results || []).length
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error finding empty buildings:', error);
    return new Response(JSON.stringify({ error: 'Failed to find empty buildings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
