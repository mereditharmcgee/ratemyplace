import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EARLY_RATING_LABEL,
  EARLY_RATING_HREF,
  buildingRateCounts,
  countOfReviews,
  earlyRatingNote,
  earlyScoreMarkerClass,
  isEarlyRating,
  issueRateText,
  mapReviewLine,
  recommendDisplay,
  recommendPercent,
  recommendTally,
  reviewsText,
  scoreBasisText,
  scoreNumberClass,
  unitRecommendText,
} from '../earlyRating';
import { NAMED_PARTY_MIN_REVIEWS, calculateBuildingAverages } from '../scoring';
import { getEarlyScoreStyle, getScoreColor, getScoreTextColor } from '../scoring-colors';

const MIN = NAMED_PARTY_MIN_REVIEWS;

describe('isEarlyRating', () => {
  it('is early from the first review up to one short of the named-party threshold', () => {
    for (let n = 1; n < MIN; n++) expect(isEarlyRating(n)).toBe(true);
  });

  it('is not early at the threshold or above', () => {
    expect(isEarlyRating(MIN)).toBe(false);
    expect(isEarlyRating(MIN + 5)).toBe(false);
  });

  it('is not early with no reviews, since there is no score to qualify', () => {
    expect(isEarlyRating(0)).toBe(false);
  });
});

describe('review count wording', () => {
  it('pluralizes reviews', () => {
    expect(reviewsText(1)).toBe('1 review');
    expect(reviewsText(2)).toBe('2 reviews');
    expect(reviewsText(0)).toBe('0 reviews');
  });

  it('gives the basis printed next to a score', () => {
    expect(scoreBasisText(1)).toBe('from 1 review');
    expect(scoreBasisText(2)).toBe('from 2 reviews');
  });

  it('writes a count as "N of M review(s)", the plural following the total', () => {
    expect(countOfReviews(1, 1)).toBe('1 of 1 review');
    expect(countOfReviews(0, 1)).toBe('0 of 1 review');
    expect(countOfReviews(1, 2)).toBe('1 of 2 reviews');
  });

  it('names the threshold in the early-rating note rather than a hardcoded number', () => {
    expect(EARLY_RATING_LABEL).toBe('Early rating');
    expect(earlyRatingNote(1)).toBe('Early rating: based on 1 review.');
    expect(earlyRatingNote(2)).toBe('Early rating: based on 2 reviews.');
  });

  it('links the label to the methodology paragraph that explains it', () => {
    expect(EARLY_RATING_HREF).toBe('/methodology#early-ratings');
  });

  it('gives the map info window one line', () => {
    expect(mapReviewLine(1)).toBe('Early rating · from 1 review');
    expect(mapReviewLine(MIN)).toBe(`${MIN} reviews`);
  });
});

describe('scoreNumberClass', () => {
  it('mutes an early score: neutral gray, lighter weight, no band colour', () => {
    expect(scoreNumberClass(3.9, 1)).toBe(`font-semibold ${getEarlyScoreStyle(3.9).text}`);
    expect(scoreNumberClass(1.4, MIN - 1)).toBe(`font-semibold ${getEarlyScoreStyle(1.4).text}`);
    expect(scoreNumberClass(1.4, 1)).not.toContain(getScoreTextColor(1.4));
    expect(scoreNumberClass(3.1, 1)).not.toContain(getScoreTextColor(3.1));
  });

  it('leaves an established score as it was', () => {
    expect(scoreNumberClass(3.9, MIN)).toBe(`font-bold ${getScoreTextColor(3.9)}`);
  });
});

describe('earlyScoreMarkerClass', () => {
  it('is a small dot in the band fill, so an early score keeps its band', () => {
    for (const score of [1.4, 2.5, 3.1, 3.9, 4.6]) {
      const cls = earlyScoreMarkerClass(score);
      expect(cls).toContain(getScoreColor(score).bg);
      expect(cls).toContain('rounded-full');
    }
    expect(earlyScoreMarkerClass(1.4)).toContain('bg-red-700');
    expect(earlyScoreMarkerClass(3.1)).toContain('bg-amber-500');
  });
});

describe('recommendTally', () => {
  it('counts yes, no and maybe separately and skips unanswered reviews', () => {
    expect(
      recommendTally([
        { would_recommend_new: 'yes' },
        { would_recommend_new: 'no' },
        { would_recommend_new: 'maybe' },
        { would_recommend_new: 'maybe' },
        { would_recommend_new: null },
        {},
      ]),
    ).toEqual({ yes: 1, no: 1, maybe: 2 });
  });

  it('never counts a maybe as a no', () => {
    expect(recommendTally([{ would_recommend_new: 'maybe' }])).toEqual({ yes: 0, no: 0, maybe: 1 });
  });
});

describe('recommendPercent matches the aggregate the score card has always shown', () => {
  const cases: Array<Array<{ would_recommend_new: string | null }>> = [
    [{ would_recommend_new: 'yes' }],
    [{ would_recommend_new: 'no' }],
    [{ would_recommend_new: 'maybe' }],
    [{ would_recommend_new: 'yes' }, { would_recommend_new: 'no' }, { would_recommend_new: 'maybe' }],
    [{ would_recommend_new: 'yes' }, { would_recommend_new: 'yes' }, { would_recommend_new: 'no' }],
    [{ would_recommend_new: null }, { would_recommend_new: 'no' }, { would_recommend_new: 'no' }],
  ];

  it.each(cases.map((c, i) => [i, c] as const))('case %i', (_i, reviews) => {
    expect(recommendPercent(recommendTally(reviews))).toBe(
      calculateBuildingAverages(reviews).pct_would_recommend,
    );
  });
});

describe('recommendDisplay', () => {
  it('shows a single yes as a count while the rating is early', () => {
    expect(recommendDisplay({ yes: 1, no: 0, maybe: 0 }, 1)).toEqual({ recommend: '1 of 1 review', maybe: null });
  });

  it('shows a single no as a count', () => {
    expect(recommendDisplay({ yes: 0, no: 1, maybe: 0 }, 1)).toEqual({ recommend: '0 of 1 review', maybe: null });
  });

  it('shows a lone maybe only as a maybe, with no recommend figure at all', () => {
    expect(recommendDisplay({ yes: 0, no: 0, maybe: 1 }, 1)).toEqual({ recommend: null, maybe: '1 of 1 review' });
  });

  it('counts over every review that answered, maybe included, while early', () => {
    expect(recommendDisplay({ yes: 1, no: 0, maybe: 1 }, 2)).toEqual({ recommend: '1 of 2 reviews', maybe: '1 of 2 reviews' });
  });

  it('shows a percentage of yes and no answers once the rating is established, with maybe as a count', () => {
    expect(recommendDisplay({ yes: 2, no: 1, maybe: 1 }, 4)).toEqual({ recommend: '67%', maybe: '1 of 4 reviews' });
    expect(recommendDisplay({ yes: 0, no: 2, maybe: 1 }, MIN)).toEqual({ recommend: '0%', maybe: `1 of ${MIN} reviews` });
  });

  it('shows nothing when nobody answered', () => {
    expect(recommendDisplay({ yes: 0, no: 0, maybe: 0 }, 1)).toEqual({ recommend: null, maybe: null });
  });
});

describe('unitRecommendText', () => {
  it('never prints "0% recommend" for a unit whose only answer is maybe', () => {
    expect(unitRecommendText({ yes: 0, no: 0, maybe: 1 }, 1)).toBe('1 of 1 said maybe');
    expect(unitRecommendText({ yes: 0, no: 0, maybe: MIN }, MIN)).toBe(`${MIN} of ${MIN} said maybe`);
  });

  it('uses counts below the threshold', () => {
    expect(unitRecommendText({ yes: 1, no: 0, maybe: 0 }, 1)).toBe('1 of 1 would recommend');
    expect(unitRecommendText({ yes: 0, no: 1, maybe: 1 }, 2)).toBe('0 of 2 would recommend, 1 maybe');
  });

  it('keeps the percentage at the threshold, over yes and no answers only', () => {
    expect(unitRecommendText({ yes: 2, no: 1, maybe: 0 }, 3)).toBe('67% recommend');
    expect(unitRecommendText({ yes: 1, no: 1, maybe: 1 }, 3)).toBe('50% recommend, 1 maybe');
  });

  it('prints nothing when no review answered', () => {
    expect(unitRecommendText({ yes: 0, no: 0, maybe: 0 }, 2)).toBeNull();
  });
});

describe('buildingRateCounts and issueRateText', () => {
  const reviews = [
    { had_pest_issues: 1, had_heat_issues: 1, had_water_issues: 0, had_security_deposit_issues: null, would_recommend_new: 'no' },
    { had_pest_issues: 1, had_heat_issues: 0, had_water_issues: 1, had_security_deposit_issues: 1, would_recommend_new: 'maybe' },
    { had_pest_issues: 0, had_heat_issues: 0, had_water_issues: 0, had_security_deposit_issues: 0, would_recommend_new: 'yes' },
  ];

  it('counts each issue flag and the recommend answers', () => {
    expect(buildingRateCounts(reviews)).toEqual({
      reviewCount: 3,
      issues: { pest: 2, heat: 1, water: 1, deposit: 1 },
      recommend: { yes: 1, no: 1, maybe: 1 },
    });
  });

  it('writes an issue rate as a count while the rating is early', () => {
    expect(issueRateText(1, 1)).toBe('1 of 1 review');
    expect(issueRateText(2, 2)).toBe('2 of 2 reviews');
  });

  it('keeps the same percentage calculateBuildingAverages gives once established', () => {
    const counts = buildingRateCounts(reviews);
    const pct = calculateBuildingAverages(reviews);
    expect(issueRateText(counts.issues.pest, counts.reviewCount)).toBe(`${pct.pct_pest_issues}%`);
    expect(issueRateText(counts.issues.heat, counts.reviewCount)).toBe(`${pct.pct_heat_issues}%`);
    expect(issueRateText(counts.issues.water, counts.reviewCount)).toBe(`${pct.pct_water_issues}%`);
    expect(issueRateText(counts.issues.deposit, counts.reviewCount)).toBe(`${pct.pct_deposit_issues}%`);
  });
});

describe('earlyRating.ts is safe to import from an island', () => {
  // SearchResults.tsx and BuildingMap.tsx import this module, so whatever it imports at
  // runtime ships to every browser. It may import only the two score modules, and those
  // must have no runtime imports of their own.
  const runtimeImports = (file: string) =>
    [...readFileSync(join(process.cwd(), file), 'utf8').matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map(
      (m) => m[1],
    );

  it('imports only ./scoring and ./scoring-colors', () => {
    expect(runtimeImports('src/lib/earlyRating.ts').sort()).toEqual(['./scoring', './scoring-colors']);
  });

  it.each([['src/lib/scoring.ts'], ['src/lib/scoring-colors.ts']])('%s has no runtime imports', (file) => {
    expect(runtimeImports(file)).toEqual([]);
  });
});

describe('the methodology page describes the display', () => {
  // Non-negotiable 3: the published methodology must match what the pages do.
  const source = readFileSync(join(process.cwd(), 'src/pages/methodology.astro'), 'utf8');
  const paragraph = source.match(/<p[^>]*id="early-ratings"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';

  it('has the anchor the early-rating label links to', () => {
    expect(EARLY_RATING_HREF.split('#')[1]).toBe('early-ratings');
    expect(paragraph).not.toBe('');
  });

  it('names the threshold through the constant, not a typed number', () => {
    expect(paragraph).toContain('{NAMED_PARTY_MIN_REVIEWS} approved reviews');
    expect(paragraph).toContain('early rating');
    expect(paragraph).toContain('counts');
  });

  it('says a maybe is never counted as a no', () => {
    expect(paragraph).toContain('yes and no answers only');
    expect(paragraph).toContain('never counted as a no');
  });
});
