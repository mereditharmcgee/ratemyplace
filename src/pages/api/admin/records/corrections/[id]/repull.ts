import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../../lib/db';
import { createAuditLog } from '../../../../../../lib/audit';
import { checkRateLimit, getClientIP } from '../../../../../../lib/rateLimit';
import { logError } from '../../../../../../lib/logger';
import { pullBuildingRecords } from '../../../../../../lib/records/pull';
import { diffRecordSnapshots, type RecordSnapshot } from '../../../../../../lib/records/corrections';
import type { BuildingRowForIdentity } from '../../../../../../lib/records/identity';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SNAPSHOT_SQL = 'SELECT kind, source_key, payload FROM building_records WHERE building_id = ?';

/**
 * POST /api/admin/records/corrections/:id/repull
 *
 * Re-run every source for the building a correction points at, and report what
 * changed. This is the only real answer to "your record is wrong": we do not
 * hand-edit records, we go back to the city and see what it says now.
 *
 * Audited as `records_pulled` against the building, on top of the `record_pulls`
 * rows the pull itself writes: those carry the provenance of the *data*, while
 * the audit row carries who reached for the city on which correction. The
 * resolution (PATCH ../[id]) is audited separately and refuses to run until one
 * of these pulls has succeeded for at least one source.
 */
export const POST: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  const correctionId = context.params.id;
  if (!correctionId) {
    return json({ error: 'Correction ID required' }, 400);
  }

  const db = getDB(context);

  try {
    const correction = await db
      .prepare('SELECT building_id FROM record_corrections WHERE id = ?')
      .bind(correctionId)
      .first<{ building_id: string }>();

    if (!correction) {
      return json({ error: 'Correction not found' }, 404);
    }

    const building = await db
      .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
      .bind(correction.building_id)
      .first<BuildingRowForIdentity>();

    if (!building) {
      return json({ error: 'Building not found' }, 404);
    }

    // Same debounce key as the manual per-building pull, deliberately: a re-pull
    // and a manual pull hitting the same building at once would race on the
    // delete-then-insert each source performs. Sharing the key means only one of
    // them can start inside the window, whichever route it came from.
    const guard = await checkRateLimit(db, `building:${building.id}`, 'records_pull', 1, 120);
    if (!guard.allowed) {
      if (guard.error) {
        return json({ error: 'Rate limiter unavailable' }, 503);
      }
      return json(
        { error: 'A pull for this building is already running or just finished. Try again in a minute.' },
        429,
      );
    }

    const before = await db.prepare(SNAPSHOT_SQL).bind(building.id).all<RecordSnapshot>();

    const summary = await pullBuildingRecords(db, building, {
      triggeredBy: context.locals.user.id,
      triggerReason: 'correction',
      correctionId,
    });

    const after = await db.prepare(SNAPSHOT_SQL).bind(building.id).all<RecordSnapshot>();

    await createAuditLog(db, {
      adminUserId: context.locals.user.id,
      adminIp: getClientIP(context),
      actionType: 'records_pulled',
      entityType: 'building',
      entityId: building.id,
      newValue: {
        correctionId,
        parcelId: summary.parcelId,
        condominium: summary.condominium,
        sources: summary.sources.map((source) => ({
          label: source.label,
          status: source.status,
          rowCount: source.rowCount,
        })),
      },
      notes: `correction ${correctionId}`,
    });

    return json({ data: { summary, diff: diffRecordSnapshots(before.results, after.results) } }, 200);
  } catch (error) {
    logError('record_correction_repull_failed', {
      endpoint: 'admin/records/corrections/repull',
      correctionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to re-pull records' }, 500);
  }
};
