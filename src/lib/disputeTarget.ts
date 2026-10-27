/**
 * Which review a dispute is about.
 *
 * Public pages never print a review's internal id, so a landlord has no review link to copy.
 * The dispute form takes the building page link instead. The review is then the only approved
 * review on that page, or the one whose card shows the dates the landlord gave. Two cards
 * often show the same dates (a skipped move-in is stored as winter of the current year), so
 * the review's title or first words, as printed on the card, then pick between them. When
 * those still fit more than one review, this refuses rather than guess: a dispute against
 * the wrong review would notify the wrong tenant.
 *
 * A review link (`#review-{id}`, or the author's own `/review/edit/{id}`) still names the
 * review directly, as before.
 */

import type { D1Database } from '@cloudflare/workers-types';
import {
  extractBuildingSlugFromUrl,
  extractReviewIdFromUrl,
  normalizeReviewDates,
  normalizeReviewWords,
} from './disputes';
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
  manyMatch: 'More than one review on that page shows those dates. Add the review title or its first words.',
  noWordsMatch: 'No review with those dates starts with those words. Copy them from the review.',
  stillMany: 'More than one review on that page matches. Use the contact page to tell us which one.',
} as const;

/** Far longer than any card's dates; anything past it cannot match, so it is not normalized. */
const MAX_REVIEW_DATES_LENGTH = 200;

/** A whole pasted review (5000 characters at most) still fits; anything longer cannot match. */
const MAX_REVIEW_WORDS_LENGTH = 6000;

/** Same bound as the building page's review list, so the route sees what the page shows. */
const PAGE_REVIEW_LIMIT = 500;

type PageReview = DisputedReview &
  ReviewTenancyFields & {
    review_title: string | null;
    review_text: string | null;
    comments: string | null;
  };

export async function resolveDisputedReview(
  db: D1Database,
  reviewUrl: string,
  reviewDates: unknown,
  siteUrl: string,
  reviewWords?: unknown,
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
      `SELECT id, building_id, user_id, move_in_season, move_in_year, move_in_given, move_out_year_new,
              is_current_tenant, review_title, review_text, comments
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
  if (matches.length === 0) {
    return { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.noMatch };
  }

  // Same dates on more than one card: only now do the title or first words count.
  const text = typeof reviewWords === 'string' ? reviewWords : '';
  const words = text.length > MAX_REVIEW_WORDS_LENGTH ? null : normalizeReviewWords(text);
  if (words === '') {
    return { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.manyMatch };
  }
  const byWords = words === null ? [] : matches.filter((review) => startsWithWords(review, words));
  if (byWords.length === 1) {
    return { ok: true, review: pick(byWords[0]) };
  }
  return byWords.length === 0
    ? { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.noWordsMatch }
    : { ok: false, status: 400, error: DISPUTE_TARGET_ERRORS.stillMany };
}

/**
 * Whether the card's title, or the start of its text, is the given words. Whole words only,
 * so "quiet str" does not match "Quiet street". The text is `review_text || comments`, the
 * same pick ReviewCard.astro prints.
 */
function startsWithWords(review: PageReview, words: string): boolean {
  return [review.review_title, review.review_text || review.comments].some((shown) => {
    const normalized = normalizeReviewWords(shown ?? '');
    return normalized !== '' && (normalized === words || normalized.startsWith(`${words} `));
  });
}

function pick(review: PageReview): DisputedReview {
  return { id: review.id, building_id: review.building_id, user_id: review.user_id };
}
