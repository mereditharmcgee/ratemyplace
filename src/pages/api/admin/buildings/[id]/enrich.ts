import type { APIContext } from 'astro';
import { getDB } from '../../../../../lib/db';
import { selectAdapter } from '../../../../../lib/enrichment/dispatcher';
import type { BuildingRecord } from '../../../../../lib/enrichment/types';

export async function GET(context: APIContext): Promise<Response> {
  if (!context.locals.user?.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const buildingId = context.params.id;
  if (!buildingId) {
    return new Response(JSON.stringify({ error: 'Building ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const db = getDB((context.locals as any).runtime);
  const building = await db
    .prepare('SELECT id, address, city, state, zip_code FROM buildings WHERE id = ?')
    .bind(buildingId)
    .first<BuildingRecord>();

  if (!building) {
    return new Response(JSON.stringify({ error: 'Building not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const adapter = selectAdapter(building.city);
    const result = await adapter.enrich(building);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Enrichment error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to query enrichment database',
      details: err instanceof Error ? err.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
