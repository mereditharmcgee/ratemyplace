/**
 * How a building's score and rates read while they rest on only a few reviews.
 *
 * A building score shows from its first approved review. Below NAMED_PARTY_MIN_REVIEWS, the
 * bar landlord and property manager scores wait for, it is an early rating: the review count
 * sits next to the score, the score is drawn lighter, and issue and recommend rates are
 * counts ("1 of 1 review") rather than percentages, because "100%" from one review reads as
 * a pattern. Display only: nothing here feeds a score, and the percentages it still prints
 * use the same formulas as calculateAggregatedScores / calculateBuildingAverages (the tests
 * hold them equal).
 *
 * "Maybe / It depends" is never a no. The recommend percentage counts yes and no answers
 * only, as it always has; a maybe is shown on its own as a count.
 *
 * Imported by the search and map islands, so its runtime imports are limited to the two
 * score modules, which import nothing (earlyRating.test.ts checks both).
 */
import { NAMED_PARTY_MIN_REVIEWS } from './scoring';
import { getEarlyScoreTextColor, getScoreTextColor } from './scoring-colors';

export const EARLY_RATING_LABEL = 'Early rating';

/** Where the label links: the methodology paragraph on early ratings. */
export const EARLY_RATING_HREF = '/methodology#early-ratings';

/** True when a score exists but rests on fewer reviews than the named-party threshold. */
export function isEarlyRating(reviewCount: number): boolean {
  return reviewCount > 0 && reviewCount < NAMED_PARTY_MIN_REVIEWS;
}

/** "1 review" / "2 reviews". */
export function reviewsText(count: number): string {
  return `${count} review${count === 1 ? '' : 's'}`;
}

/** "from 1 review": printed next to an early score. */
export function scoreBasisText(reviewCount: number): string {
  return `from ${reviewsText(reviewCount)}`;
}

/** "1 of 2 reviews": the plural follows the total. */
export function countOfReviews(count: number, total: number): string {
  return `${count} of ${reviewsText(total)}`;
}

/** The note at the top of an early rating's breakdown. */
export function earlyRatingNote(reviewCount: number): string {
  return `${EARLY_RATING_LABEL}: based on ${reviewsText(reviewCount)}.`;
}

/** The review line in a map info window. */
export function mapReviewLine(reviewCount: number): string {
  return isEarlyRating(reviewCount)
    ? `${EARLY_RATING_LABEL} · ${scoreBasisText(reviewCount)}`
    : reviewsText(reviewCount);
}

/**
 * Weight and colour classes for a headline score number. An early score keeps its band but
 * in a lighter shade and weight; an established one is unchanged. The caller adds the size,
 * which must stay 24px or larger for the lighter shade (see getEarlyScoreTextColor).
 */
export function scoreNumberClass(score: number, reviewCount: number): string {
  return isEarlyRating(reviewCount)
    ? `font-semibold ${getEarlyScoreTextColor(score)}`
    : `font-bold ${getScoreTextColor(score)}`;
}

// --- Rates ------------------------------------------------------------------------------

/** The review columns the rates read. Loosely typed because the page rows are. */
export interface RateReview {
  had_pest_issues?: unknown;
  had_heat_issues?: unknown;
  had_water_issues?: unknown;
  had_security_deposit_issues?: unknown;
  would_recommend_new?: unknown;
}

export interface RecommendTally {
  yes: number;
  no: number;
  maybe: number;
}

export interface IssueCounts {
  pest: number;
  heat: number;
  water: number;
  deposit: number;
}

export interface BuildingRateCounts {
  reviewCount: number;
  issues: IssueCounts;
  recommend: RecommendTally;
}

/**
 * Yes, no and maybe answers. Classified exactly as calculateAggregatedScores does: no
 * answer is skipped, 'maybe' is its own answer, 'yes' (or a legacy 1/true) is a yes, and
 * any other answer is a no.
 */
export function recommendTally(reviews: ReadonlyArray<RateReview>): RecommendTally {
  const tally: RecommendTally = { yes: 0, no: 0, maybe: 0 };
  for (const { would_recommend_new: answer } of reviews) {
    if (answer === null || answer === undefined) continue;
    if (answer === 'maybe') tally.maybe++;
    else if (answer === 'yes' || answer === 1 || answer === true) tally.yes++;
    else tally.no++;
  }
  return tally;
}

/** Issue flags counted the way calculateBuildingAverages counts them (truthy is reported). */
export function buildingRateCounts(reviews: ReadonlyArray<RateReview>): BuildingRateCounts {
  const issues: IssueCounts = { pest: 0, heat: 0, water: 0, deposit: 0 };
  for (const review of reviews) {
    if (review.had_pest_issues) issues.pest++;
    if (review.had_heat_issues) issues.heat++;
    if (review.had_water_issues) issues.water++;
    if (review.had_security_deposit_issues) issues.deposit++;
  }
  return { reviewCount: reviews.length, issues, recommend: recommendTally(reviews) };
}

/** Share of yes among yes and no answers, rounded; null when nobody said yes or no. */
export function recommendPercent(tally: RecommendTally): number | null {
  const decided = tally.yes + tally.no;
  return decided > 0 ? Math.round((tally.yes / decided) * 100) : null;
}

/** An issue rate: a count while early, otherwise calculateBuildingAverages' percentage. */
export function issueRateText(count: number, reviewCount: number): string {
  if (isEarlyRating(reviewCount)) return countOfReviews(count, reviewCount);
  return `${Math.round((count / (reviewCount || 1)) * 100)}%`;
}

export interface RecommendDisplay {
  /** The "Would recommend" value, or null when nobody answered yes or no. */
  recommend: string | null;
  /** The "Maybe / It depends" value, always a count, or null when nobody answered maybe. */
  maybe: string | null;
}

/**
 * The two recommend rows of a building's breakdown. While early, both are counts over every
 * review that answered the question. Once established, "Would recommend" is the percentage
 * of yes among yes and no answers. A lone maybe produces no recommend figure at all, so it
 * can never read as 0%.
 */
export function recommendDisplay(tally: RecommendTally, reviewCount: number): RecommendDisplay {
  const answered = tally.yes + tally.no + tally.maybe;
  const percent = recommendPercent(tally);
  let recommend: string | null = null;
  if (percent !== null) {
    recommend = isEarlyRating(reviewCount) ? countOfReviews(tally.yes, answered) : `${percent}%`;
  }
  return { recommend, maybe: tally.maybe > 0 ? countOfReviews(tally.maybe, answered) : null };
}

/** The short recommend line on a unit card, or null when no review answered. */
export function unitRecommendText(tally: RecommendTally, reviewCount: number): string | null {
  const answered = tally.yes + tally.no + tally.maybe;
  const percent = recommendPercent(tally);
  if (percent === null) return tally.maybe > 0 ? `${tally.maybe} of ${answered} said maybe` : null;
  const maybe = tally.maybe > 0 ? `, ${tally.maybe} maybe` : '';
  return isEarlyRating(reviewCount)
    ? `${tally.yes} of ${answered} would recommend${maybe}`
    : `${percent}% recommend${maybe}`;
}
