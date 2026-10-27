/**
 * Which review a dispute is about.
 *
 * Public pages never print a review's internal id, so a landlord has no review link to copy.
 * The dispute form takes the building page link instead. The review is then the only approved
 * review on that page, or the one whose card shows the dates the landlord gave. When two
 * reviews on the page show the same dates, this refuses rather than guess: a dispute against
 * the wrong review would notify the wrong tenant.
 *
 * A review link (`#review-{id}`, or the author's own `/review/edit/{id}`) still names the
 * review directly, as before.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { extractBuildingSlugFromUrl, extractReviewIdFromUrl, normalizeReviewDates } from './disputes';
import { reviewTenancyLabel } from './privacy';
import type { ReviewTenancyFields } from './privacy';

export interface DisputedReview {
  id: string;
  building_id: string;
  user_id: string | null;
}

export type DisputeTarget =
  | { ok: true; review: DisputedReview }
  | { ok: false; status: 400 | 404; error: string };

/** User-facing messages, exported so tests assert the exact text. */
export const DISPUTE_TARGET_ERRORS = {
  badLink: 'Paste the full link to the building page from your browser.',
  reviewNotFound: 'Review not found. Please check the URL and try again.',
  buildingNotFound: 'No building page matches that link.',
  noReviews: 'That building page has no reviews.',
  needDates: 'That page has more than one review. Add the dates shown on the review you mean.',
  noMatch: 'No review on that page shows those dates. Copy them from the review.',
  manyMatch: 'More than one review on that page shows those dates. Use the contact page to tell us which one.',
} as const;

/** Far longer than any card's dates; anything past it cannot match, so it is not normalized. */
const MAX_REVIEW_DATES_LENGTH = 200;

/** Same bound as the building page's review list, so the route sees what the page shows. */
const PAGE_REVIEW_LIMIT = 500;

type PageReview = DisputedReview & ReviewTenancyFields;

export async function resolveDisputedReview(
  db: D1Database,
  reviewUrl: string,
  reviewDates: unknown,
  siteUrl: string,
): Promise<DisputeTarget> {
  const reviewId = extractReviewIdFromUrl(reviewUrl, siteUrl);
  if (reviewId) {
    const review = await db
      .prepare('SELECT id, building_id, user_id FROM reviews WHERE id = ?')
      .bind(reviewId)
      .first<DisputedReview>();
    return review
      ? { ok: true, review }
      : { ok: false, status: 404, error: DISPUTE_TARGET_ERRORS.reviewNotFound };
  }

  const slug = extractBuildingSlugFromUrl(reviewUrl, siteUrl);
  if (!slug) {
    return { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.badLink };
  }

  const building = await db
    .prepare('SELECT id FROM buildings WHERE slug = ?')
    .bind(slug)
    .first<{ id: string }>();
  if (!building) {
    return { ok: false, status: 404, error: DISPUTE_TARGET_ERRORS.buildingNotFound };
  }

  // Only approved reviews appear on the page, so only they can be the one the landlord saw.
  const rows = await db
    .prepare(
      `SELECT id, building_id, user_id, move_in_season, move_in_year, move_out_year_new, is_current_tenant
       FROM reviews
       WHERE building_id = ? AND status = 'approved'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(building.id, PAGE_REVIEW_LIMIT)
    .all<PageReview>();
  const reviews = rows.results ?? [];
  if (reviews.length === 0) {
    return { ok: false, status: 404, error: DISPUTE_TARGET_ERRORS.noReviews };
  }

  const dates = typeof reviewDates === 'string' ? reviewDates : '';
  const wanted = dates.length > MAX_REVIEW_DATES_LENGTH ? null : normalizeReviewDates(dates);

  if (wanted === '') {
    return reviews.length === 1
      ? { ok: true, review: pick(reviews[0]) }
      : { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.needDates };
  }

  const matches = wanted === null
    ? []
    : reviews.filter((review) => normalizeReviewDates(reviewTenancyLabel(review) ?? '') === wanted);
  if (matches.length === 1) {
    return { ok: true, review: pick(matches[0]) };
  }
  return matches.length === 0
    ? { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.noMatch }
    : { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.manyMatch };
}

function pick(review: PageReview): DisputedReview {
  return { id: review.id, building_id: review.building_id, user_id: review.user_id };
}
