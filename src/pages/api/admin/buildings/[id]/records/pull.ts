import type { APIContext } from 'astro';
import { getDB } from '../../../../../../lib/db';
import { checkRateLimit, getClientIP } from '../../../../../../lib/rateLimit';
import { createAuditLog } from '../../../../../../lib/audit';
import { logError } from '../../../../../../lib/logger';
import { pullBuildingRecords } from '../../../../../../lib/records/pull';
import { toCanonicalParcel, type BuildingRowForIdentity } from '../../../../../../lib/records/identity';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface PullRequestBody {
  parcelId?: string;
}

export async function POST(context: APIContext): Promise<Response> {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  const buildingId = context.params.id;
  if (!buildingId) {
    return json({ error: 'Building ID required' }, 400);
  }

  const db = getDB(context);

  // Debounce, not a lock: this only stops a second pull from starting for the same
  // building within the window. It cannot interrupt a pull already running, and it
  // does nothing to protect two different buildings' concurrent pulls from each other.
  const guard = await checkRateLimit(db, `building:${buildingId}`, 'records_pull', 1, 120);
  if (!guard.allowed) {
    if (guard.error) {
      return json({ error: 'Rate limiter unavailable' }, 503);
    }
    return json(
      { error: 'A pull for this building is already running or just finished. Try again in a minute.' },
      429,
    );
  }

  // Only ever parse a JSON body when the client says it sent one. request.json()
  // throws a raw SyntaxError on non-JSON input; a missing/invalid body is just {}.
  let body: PullRequestBody = {};
  const contentType = context.request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const parsed = await context.request.json();
      if (parsed && typeof parsed === 'object') {
        body = parsed as PullRequestBody;
      }
    } catch {
      body = {};
    }
  }

  let parcelOverride: string | null = null;
  if (typeof body.parcelId === 'string' && body.parcelId.trim() !== '') {
    const canonical = toCanonicalParcel(body.parcelId);
    if (!canonical) {
      return json(
        {
          error: 'Validation failed',
          details: [{ field: 'parcelId', message: 'Parcel id must be 9 or 10 digits.' }],
        },
        400,
      );
    }
    parcelOverride = canonical;
  }

  try {
    const building = await db
      .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
      .bind(buildingId)
      .first<BuildingRowForIdentity>();

    if (!building) {
      return json({ error: 'Building not found' }, 404);
    }

    if (parcelOverride) {
      const previousParcel = building.parcel_id;
      await db
        .prepare('UPDATE buildings SET parcel_id = ?, updated_at = unixepoch() WHERE id = ?')
        .bind(parcelOverride, buildingId)
        .run();
      building.parcel_id = parcelOverride;

      // Audited here, at the point of the override, with the old value — separate from
      // the records_pulled entry below, which only ever carries the pull's own outcome.
      await createAuditLog(db, {
        adminUserId: context.locals.user.id,
        adminIp: getClientIP(context),
        actionType: 'building_updated',
        entityType: 'building',
        entityId: buildingId,
        oldValue: { parcelId: previousParcel },
        newValue: { parcelId: parcelOverride },
        notes: 'parcel id override before records pull',
      });
    }

    const summary = await pullBuildingRecords(db, building, {
      triggeredBy: context.locals.user.id,
      triggerReason: 'admin',
    });

    await createAuditLog(db, {
      adminUserId: context.locals.user.id,
      adminIp: getClientIP(context),
      actionType: 'records_pulled',
      entityType: 'building',
      entityId: buildingId,
      newValue: {
        parcelId: summary.parcelId,
        condominium: summary.condominium,
        sources: summary.sources.map(({ label, status, rowCount }) => ({ label, status, rowCount })),
      },
      notes: parcelOverride ? `parcel override ${parcelOverride}` : undefined,
    });

    return json({ data: summary }, 200);
  } catch (error) {
    logError('records_pull_failed', {
      endpoint: 'admin/records/pull',
      buildingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to pull records' }, 500);
  }
}
