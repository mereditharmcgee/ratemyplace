import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { logError } from '../../../../../lib/logger';
import type { RecordsQueueBackfillResult, RecordsQueueBackfillSkip } from '../../../../../lib/api-types';
import { hasDeeperPull, pendingQueueReason, recordsRequestState } from '../../../../../lib/records/coverage';
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
 * building goes through `recordsRequestState`, and `never_pulled` is enqueued — the rule the
 * approval and save paths follow — plus one case those paths do not need:
 *
 * A reviewed building with no `parcel_id` is enqueued too. Most reviewed buildings are
 * `source = 'user'` rows from Google Places that have never had a parcel, and
 * `recordsRequestState` reads them `ineligible` before it looks at anything else, so the
 * `never_pulled` rule alone would skip the very buildings this endpoint exists for.
 * `pullBuildingRecords` resolves the parcel itself and writes `parcel_id` on success; when the
 * address matches no parcel or several, it writes an error row on every source without
 * throwing, so the queue row completes in one attempt (no retry, no parking) and a later press
 * sees those rows and skips.
 *
 * The guard is `hasDeeperPull`: a condo whose resolution found no whole-building parcel keeps
 * `parcel_id` NULL even after a full pull, and `recordsRequestState` reports `ineligible`
 * before `pulled`. A parcel-less building with any deeper pull row has been tried already and
 * is skipped as `ineligible`, which `skippedByState` counts so the receipt says so. A
 * parcel-less building with a pending row is counted as `requested`, as it would be with a
 * parcel: `recordsRequestState` stops at `ineligible` before it reads the queue, so the route
 * asks `pendingQueueReason` itself rather than leaving it to `enqueue` to report
 * `already_queued`, which means a row that landed between the read and the insert.
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
      // Outside Boston was filtered above, so `ineligible` here means no parcel (see docblock).
      const parcelless = state === 'ineligible' && !(await hasDeeperPull(db, building.id));
      if (state !== 'never_pulled' && !parcelless) {
        skip(state);
        continue;
      }
      if (parcelless && (await pendingQueueReason(db, building.id)) !== null) {
        skip('requested');
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
