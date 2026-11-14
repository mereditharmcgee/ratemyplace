// One review per account and building, a daily limit and a short pause between submissions.
//
// Server only: POST /api/reviews and the /review/new frontmatter use it. It imports types only.
//
// All three rules are predicates of the one statement that writes a review
// (`INSERT ... SELECT <values> WHERE ${REVIEW_GUARD_SQL}`), so D1, which runs one statement at a
// time, cannot let two concurrent submissions both pass. They count live `reviews` rows from
// `created_at`, which D1 writes, and compare it with `unixepoch()` in the same statement, so the
// window and the stored time come from one clock. A review counts whatever its later status (a
// rejected review was still a submission); an edit never changes `created_at`, so edits count for
// nothing. Existing reviews, duplicates included, are never changed: the guard only decides
// whether a new row is written. An admin deletion removes the row, so it frees the slot.
//
// The guard is a code constant and every number in it is bound, never a SQL literal and never a
// trigger. When the insert changes no row, `classifyReviewRefusal` says why with one read-only
// SELECT, and `reviewRefusalResponse` answers in the reason envelope shared with the verified
// email gate: `{ error, details: { reason, editPath? } }`.
import type { RecordsDb } from './records/types';

/** Successful submissions per account in the rolling window. */
export const REVIEW_DAILY_LIMIT = 5;
/** The rolling window for the daily limit: 24 hours back from now, not a calendar day. */
export const REVIEW_DAILY_WINDOW_SECONDS = 86_400;
/** The least time between two successful submissions by one account. */
export const REVIEW_SUBMIT_PAUSE_SECONDS = 60;

/**
 * The WHERE clause of the guarded insert. Seven placeholders, bound by `reviewGuardBinds`:
 * no review of this building by this account; fewer than the limit in the window; none in the
 * pause.
 */
export const REVIEW_GUARD_SQL = [
  'NOT EXISTS (SELECT 1 FROM reviews WHERE user_id = ? AND building_id = ?)',
  'AND (SELECT COUNT(*) FROM reviews WHERE user_id = ? AND created_at > unixepoch() - ?) < ?',
  'AND NOT EXISTS (SELECT 1 FROM reviews WHERE user_id = ? AND created_at > unixepoch() - ?)',
].join('\n');

/** The guard's binds, in placeholder order. Append them after the review's own values. */
export function reviewGuardBinds(
  userId: string,
  buildingId: string,
): [string, string, string, number, number, string, number] {
  return [
    userId,
    buildingId,
    userId,
    REVIEW_DAILY_WINDOW_SECONDS,
    REVIEW_DAILY_LIMIT,
    userId,
    REVIEW_SUBMIT_PAUSE_SECONDS,
  ];
}

/** True only when the insert wrote exactly one row (`meta.changes === 1`). */
export function reviewInserted(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const meta = (result as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return false;
  return (meta as { changes?: unknown }).changes === 1;
}

export type ReviewRefusal =
  | { reason: 'already_reviewed'; reviewId: string }
  | { reason: 'daily_limit' }
  | { reason: 'submission_pause' }
  | { reason: 'unknown' };

/** The account's newest review of the building: newest first, ties broken by id. */
const OWN_REVIEW_SQL =
  'SELECT id FROM reviews WHERE user_id = ? AND building_id = ? ORDER BY created_at DESC, id DESC LIMIT 1';

/**
 * Why a guarded insert wrote nothing, read in one statement. An existing review wins (it is the
 * one the renter can act on), then the daily limit, then the pause. `unknown` means the state
 * changed between the two statements (the pause ran out, say); the route answers it as a failed
 * submission, and a retry then succeeds or gets a named answer.
 */
export async function classifyReviewRefusal(db: RecordsDb, userId: string, buildingId: string): Promise<ReviewRefusal> {
  const row = await db
    .prepare(
      `SELECT
         (${OWN_REVIEW_SQL}) AS own_review_id,
         (SELECT COUNT(*) FROM reviews WHERE user_id = ? AND created_at > unixepoch() - ?) AS in_window,
         (SELECT COUNT(*) FROM reviews WHERE user_id = ? AND created_at > unixepoch() - ?) AS in_pause`,
    )
    .bind(userId, buildingId, userId, REVIEW_DAILY_WINDOW_SECONDS, userId, REVIEW_SUBMIT_PAUSE_SECONDS)
    .first<{ own_review_id: string | null; in_window: number; in_pause: number }>();
  if (row && typeof row.own_review_id === 'string' && row.own_review_id !== '') {
    return { reason: 'already_reviewed', reviewId: row.own_review_id };
  }
  if (row && Number(row.in_window) >= REVIEW_DAILY_LIMIT) return { reason: 'daily_limit' };
  if (row && Number(row.in_pause) > 0) return { reason: 'submission_pause' };
  return { reason: 'unknown' };
}

/** The id of the account's newest review of the building, or null. Read only. */
export async function ownReviewOfBuilding(db: RecordsDb, userId: string, buildingId: string): Promise<string | null> {
  const row = await db.prepare(OWN_REVIEW_SQL).bind(userId, buildingId).first<{ id: string }>();
  return row && typeof row.id === 'string' && row.id !== '' ? row.id : null;
}

/** The author's edit page for a review. The edit page checks ownership again. */
export function reviewEditPath(reviewId: string): string {
  return `/review/edit/${encodeURIComponent(reviewId)}`;
}

export const REVIEW_LIMIT_COPY = {
  /** The first sentence is new; the second is SUBMITTED_NO_LINK_COPY's second sentence. */
  alreadyReviewed: 'You have already reviewed this building. You can find it on your profile.',
  /** The hourly limiter's line in POST /api/reviews, word for word. */
  tooQuickly: 'You are submitting reviews too quickly. Please try again later.',
  /** The edit page's heading. */
  editLink: 'Edit Review',
} as const;

/** The route's answer for a refused insert: 409, 429, or the generic 500 for `unknown`. */
export function reviewRefusalResponse(refusal: ReviewRefusal): Response {
  switch (refusal.reason) {
    case 'already_reviewed':
      return json(409, {
        error: REVIEW_LIMIT_COPY.alreadyReviewed,
        details: { reason: 'already_reviewed', editPath: reviewEditPath(refusal.reviewId) },
      });
    case 'daily_limit':
    case 'submission_pause':
      return json(429, { error: REVIEW_LIMIT_COPY.tooQuickly, details: { reason: refusal.reason } });
    default:
      return json(500, { error: 'Failed to submit review' });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
