import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { createAuditLog } from '../../../lib/audit';
import { getClientIP } from '../../../lib/rateLimit';
import { orphanBuildingsWhere } from '../../../lib/admin/orphanBuildings';
import { logError } from '../../../lib/logger';

// Orphan cleanup. Scope is `orphanBuildingsWhere()` and nothing else: user-added buildings
// outside Boston and New Haven with no review in any status and no saves. Seeded parcels
// (tens of thousands of zero-review rows) are never in scope; the old "no reviews" version
// of this endpoint would have targeted every one of them.

const SAMPLE_SIZE = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function requireAdmin(context: APIContext): Response | null {
  if (!context.locals.user) return json({ error: 'Authentication required' }, 401);
  if (!context.locals.user.isAdmin) return json({ error: 'Admin access required' }, 403);
  return null;
}

interface OrphanSample {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  created_at: number;
}

async function preview(db: ReturnType<typeof getDB>): Promise<{ count: number; sample: OrphanSample[] }> {
  const orphans = orphanBuildingsWhere();
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS count FROM buildings b WHERE ${orphans.sql}`)
    .bind(...orphans.binds)
    .first<{ count: number }>();
  const { results } = await db
    .prepare(`
      SELECT b.id, b.address, b.city, b.state, b.created_at
      FROM buildings b
      WHERE ${orphans.sql}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ?
    `)
    .bind(...orphans.binds, SAMPLE_SIZE)
    .all<OrphanSample>();
  return { count: countRow?.count ?? 0, sample: results ?? [] };
}

// GET previews what POST would delete.
export async function GET(context: APIContext): Promise<Response> {
  const denied = requireAdmin(context);
  if (denied) return denied;

  try {
    return json({ data: await preview(getDB(context)) });
  } catch (error) {
    logError('admin_cleanup_preview_failed', { error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Failed to find orphan buildings' }, 500);
  }
}

export async function POST(context: APIContext): Promise<Response> {
  const denied = requireAdmin(context);
  if (denied) return denied;
  const user = context.locals.user!;

  try {
    const db = getDB(context);
    const orphans = orphanBuildingsWhere();

    // Belt and braces: the predicate already excludes these, but a future edit to it must
    // not be able to turn this button into a delete of seeded or reviewed buildings.
    const unsafe = await db
      .prepare(`
        SELECT COUNT(*) AS count FROM buildings b
        WHERE ${orphans.sql}
          AND (b.source <> 'user' OR EXISTS (SELECT 1 FROM reviews r WHERE r.building_id = b.id))
      `)
      .bind(...orphans.binds)
      .first<{ count: number }>();
    if ((unsafe?.count ?? 0) > 0) {
      logError('admin_cleanup_refused', { unsafe: unsafe?.count ?? 0 });
      return json({ error: 'Cleanup refused: it would touch seeded or reviewed buildings' }, 409);
    }

    const { sample } = await preview(db);

    // One statement, re-evaluating the predicate at delete time, with no per-id binds (D1
    // caps bound parameters per statement). FK cascades clear the building's pulls, records,
    // corrections and queue rows.
    const result = await db
      .prepare(`DELETE FROM buildings WHERE id IN (SELECT b.id FROM buildings b WHERE ${orphans.sql})`)
      .bind(...orphans.binds)
      .run();
    const deleted = result.meta?.changes ?? 0;

    if (deleted > 0) {
      await createAuditLog(db, {
        adminUserId: user.id,
        adminIp: getClientIP(context),
        actionType: 'buildings_bulk_deleted',
        entityType: 'building',
        entityId: `orphans:${deleted}`,
        oldValue: {
          deleted,
          scope: 'user-added, outside Boston and New Haven, no reviews, no saves',
          sample_ids: sample.map((b) => b.id),
          sample_addresses: sample.map((b) => b.address),
        },
      });
    }

    return json({ data: { deleted } });
  } catch (error) {
    logError('admin_cleanup_failed', { error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'Cleanup failed' }, 500);
  }
}
