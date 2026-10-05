import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import type { RecordsQueueBackfillResult, RecordsQueueBackfillSkip } from '../../../../../lib/api-types';
import { recordsRequestState } from '../../../../../lib/records/coverage';
import { jurisdictionForCity } from '../../../../../lib/records/jurisdiction';
import { enqueue } from '../../../../../lib/records/queue';
import { json, readJsonBody } from './_json';

/**
 * POST /api/admin/records/queue/backfill-reviewed  `{}`
 *
 * Queues a `follower` pull for every reviewed Boston building that has never been pulled —
 * the row approval would have queued had the follower enqueue existed when the review was
 * approved. Run once after deploy; pressing it again is harmless, because a building with a
 * pending row reads `requested` and is skipped.
 *
 * The candidate list is every building with at least one approved review. Jurisdiction is
 * `jurisdictionForCity`, evaluated here rather than as a SQL string compare on 'Boston', so the
 * endpoint and the request paths cannot disagree about what counts as Boston. Then each Boston
 * building goes through `recordsRequestState`, and only `never_pulled` is enqueued — exactly the
 * rule the approval and save paths follow. A reviewed building with no `parcel_id` reads
 * `ineligible` there and is skipped; `skippedByState` counts it so the receipt says so.
 *
 * One state read and one enqueue per building, not a single INSERT … SELECT: the reviewed set
 * is small (it is the site's reviews, not the city's parcels), and going through `enqueue`
 * keeps its one-pending-row and live-lease rules in one place.
 *
 * 202, not 200: the rows are queued, not pulled. The Worker pulls them on later minute ticks,
 * three people-facing rows a tick.
 *
 * No audit entry, like pause and retry: AGENTS.md audits destructive admin actions, and this
 * adds queue rows and nothing else. The response is the receipt, and every pull it causes
 * writes its own `record_pulls` rows with `trigger_reason = 'queue:follower'`.
 *
 * CSRF: per AGENTS.md, an authenticated endpoint is covered by the SameSite=Lax session
 * cookie — a cross-site POST carries no session and fails the admin check above.
 * `readJsonBody` runs the content-type guard before `request.json()`; the body itself carries
 * nothing this endpoint reads.
 */
export const POST: APIRoute = async (context: APIContext) => {
  if (!context.locals.user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  const parsed = await readJsonBody(context);
  if (!parsed.ok) return parsed.response;

  try {
    const db = getDB(context);
    const now = Math.floor(Date.now() / 1000);

    const { results } = await db
      .prepare(
        'SELECT b.id, b.city FROM buildings b ' +
          "WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.building_id = b.id AND r.status = 'approved') " +
          'ORDER BY b.id',
      )
      .all<{ id: string; city: string | null }>();

    let enqueued = 0;
    const skippedByState: Partial<Record<RecordsQueueBackfillSkip, number>> = {};
    const skip = (reason: RecordsQueueBackfillSkip): void => {
      skippedByState[reason] = (skippedByState[reason] ?? 0) + 1;
    };

    for (const building of results) {
      if (jurisdictionForCity(building.city) !== 'boston') {
        skip('outside_boston');
        continue;
      }
      const state = await recordsRequestState(db, building.id);
      if (state !== 'never_pulled') {
        skip(state);
        continue;
      }
      const result = await enqueue(db, { buildingId: building.id, reason: 'follower', now });
      if (result.status === 'queued') enqueued += 1;
      else skip('already_queued');
    }

    const data: RecordsQueueBackfillResult = {
      enqueued,
      skipped: results.length - enqueued,
      examined: results.length,
      skippedByState,
    };
    return json({ data }, 202);
  } catch (error) {
    logError('records_queue_backfill_failed', {
      endpoint: 'admin/records/queue/backfill-reviewed',
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to queue pulls for reviewed buildings' }, 500);
  }
};
