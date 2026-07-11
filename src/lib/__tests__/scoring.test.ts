import { describe, it, expect } from 'vitest';
import {
  RECENCY_BANDS,
  getRecencyWeight,
  getReviewYear,
  calculateDomainScores,
  calculateOverallScore,
  calculateAggregatedScores,
  calculateBuildingAverages,
  calculateLandlordAverages,
  formatScore,
  ITEM_WEIGHTS,
  ALL_SCORE_FIELDS,
  UNIT_FIELDS,
  BUILDING_FIELDS,
  LANDLORD_FIELDS,
} from '../scoring';

// ── Helper: create a scores object with all fields set to a value ──
function allScores(value: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const field of ALL_SCORE_FIELDS) {
    scores[field] = value;
  }
  scores.overall_score = calculateOverallScore(scores);
  return scores;
}

// ── Helper: create a scores object for one domain ──
function domainScores(fields: readonly string[], value: number): Record<string, number | null> {
  const scores: Record<string, number | null> = {};
  for (const field of ALL_SCORE_FIELDS) {
    scores[field] = null;
  }
  for (const field of fields) {
    scores[field] = value;
  }
  scores.overall_score = calculateOverallScore(scores);
  return scores;
}

// ═══════════════════════════════════════════════════
// Field definitions
// ═══════════════════════════════════════════════════

describe('Field definitions', () => {
  it('has 10 unit fields', () => {
    expect(UNIT_FIELDS).toHaveLength(10);
  });

  it('has 9 building fields', () => {
    expect(BUILDING_FIELDS).toHaveLength(9);
  });

  it('has 8 landlord fields', () => {
    expect(LANDLORD_FIELDS).toHaveLength(8);
  });

  it('has 27 total fields', () => {
    expect(ALL_SCORE_FIELDS).toHaveLength(27);
  });

  it('has weights defined for every field', () => {
    for (const field of ALL_SCORE_FIELDS) {
      expect(ITEM_WEIGHTS[field]).toBeDefined();
      expect(ITEM_WEIGHTS[field]).toBeGreaterThanOrEqual(1.0);
    }
  });
});

// ═══════════════════════════════════════════════════
// Health/safety weights
// ═══════════════════════════════════════════════════

describe('Health/safety weights', () => {
  it('pests have 1.5x weight', () => {
    expect(ITEM_WEIGHTS.unit_pests).toBe(1.5);
  });

  it('mold has 1.5x weight', () => {
    expect(ITEM_WEIGHTS.unit_mold).toBe(1.5);
  });

  it('structural has 1.3x weight', () => {
    expect(ITEM_WEIGHTS.unit_structural).toBe(1.3);
  });

  it('climate has 1.3x weight', () => {
    expect(ITEM_WEIGHTS.unit_climate).toBe(1.3);
  });

  it('plumbing has 1.2x weight', () => {
    expect(ITEM_WEIGHTS.unit_plumbing).toBe(1.2);
  });

  it('security has 1.2x weight', () => {
    expect(ITEM_WEIGHTS.building_security).toBe(1.2);
  });

  it('cosmetic items have 1.0x weight', () => {
    expect(ITEM_WEIGHTS.unit_layout).toBe(1.0);
    expect(ITEM_WEIGHTS.unit_appliances).toBe(1.0);
    expect(ITEM_WEIGHTS.building_mail).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════
// getRecencyWeight
// ═══════════════════════════════════════════════════

describe('getRecencyWeight', () => {
  const currentYear = 2026;

  it('returns 1.0 for current year', () => {
    expect(getRecencyWeight(2026, currentYear)).toBe(1.0);
  });

  it('returns 1.0 for 1 year old', () => {
    expect(getRecencyWeight(2025, currentYear)).toBe(1.0);
  });

  it('returns 1.0 for 2 years old', () => {
    expect(getRecencyWeight(2024, currentYear)).toBe(1.0);
  });

  it('returns 0.95 for 3 years old', () => {
    expect(getRecencyWeight(2023, currentYear)).toBe(0.95);
  });

  it('returns 0.90 for 4 years old', () => {
    expect(getRecencyWeight(2022, currentYear)).toBe(0.90);
  });

  it('returns 0.85 floor for 5+ years old', () => {
    expect(getRecencyWeight(2021, currentYear)).toBe(0.85);
    expect(getRecencyWeight(2020, currentYear)).toBe(0.85);
    expect(getRecencyWeight(2010, currentYear)).toBe(0.85);
  });

  it('returns 1.0 for null year', () => {
    expect(getRecencyWeight(null)).toBe(1.0);
  });
});

// ═══════════════════════════════════════════════════
// calculateDomainScores
// ═══════════════════════════════════════════════════

describe('calculateDomainScores', () => {
  it('returns all nulls for empty scores', () => {
    const result = calculateDomainScores({});
    expect(result.unit).toBeNull();
    expect(result.building).toBeNull();
    expect(result.landlord).toBeNull();
    expect(result.overall).toBeNull();
  });

  it('returns all nulls when all values are null', () => {
    const scores: Record<string, null> = {};
    for (const field of ALL_SCORE_FIELDS) {
      scores[field] = null;
    }
    const result = calculateDomainScores(scores);
    expect(result.overall).toBeNull();
  });

  it('calculates correct score when all fields are the same value', () => {
    // When all fields = 3, weighted average should still be 3.0
    // because weight * 3 / weight = 3 regardless of weight
    const result = calculateDomainScores(allScores(3));
    expect(result.unit).toBe(3.0);
    expect(result.building).toBe(3.0);
    expect(result.landlord).toBe(3.0);
    expect(result.overall).toBe(3.0);
  });

  it('calculates correct score when all fields are 5', () => {
    const result = calculateDomainScores(allScores(5));
    expect(result.overall).toBe(5.0);
  });

  it('calculates correct score when all fields are 1', () => {
    const result = calculateDomainScores(allScores(1));
    expect(result.overall).toBe(1.0);
  });

  it('calculates unit score only when only unit fields provided', () => {
    const result = calculateDomainScores(domainScores(UNIT_FIELDS, 4));
    expect(result.unit).toBe(4.0);
    expect(result.building).toBeNull();
    expect(result.landlord).toBeNull();
    expect(result.overall).toBe(4.0);
  });

  it('health/safety items pull weighted average down', () => {
    // All items = 5 except pest and mold = 1
    // Since pest (1.5x) and mold (1.5x) have higher weight,
    // the weighted average should be lower than a simple average
    const scores = allScores(5);
    scores.unit_pests = 1;
    scores.unit_mold = 1;

    const result = calculateDomainScores(scores);
    expect(result.overall).toBeDefined();
    expect(result.overall!).toBeLessThan(5.0);

    // Compare with unweighted: if all weights were 1.0,
    // the average would be (25*5 + 2*1) / 27 = 4.70
    // With pest/mold at 1.5x weight, the impact should be greater
    const simpleAvg = (25 * 5 + 2 * 1) / 27;
    expect(result.overall!).toBeLessThan(simpleAvg);
  });

  it('rounds to one decimal place', () => {
    // Create a scenario that would produce a non-round number
    const scores: Record<string, number | null> = {};
    for (const field of ALL_SCORE_FIELDS) scores[field] = null;
    scores.unit_structural = 3;
    scores.unit_plumbing = 4;

    const result = calculateDomainScores(scores);
    expect(result.unit).toBeDefined();
    // Check it's rounded to 1 decimal
    const str = result.unit!.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════
// calculateOverallScore
// ═══════════════════════════════════════════════════

describe('calculateOverallScore', () => {
  it('returns 0 for empty scores', () => {
    expect(calculateOverallScore({})).toBe(0);
  });

  it('returns correct weighted average for all-3 scores', () => {
    expect(calculateOverallScore(allScores(3))).toBe(3.0);
  });

  it('returns a number (not null)', () => {
    const result = calculateOverallScore(allScores(4));
    expect(typeof result).toBe('number');
    expect(result).toBe(4.0);
  });
});

// ═══════════════════════════════════════════════════
// calculateAggregatedScores
// ═══════════════════════════════════════════════════

describe('calculateAggregatedScores', () => {
  it('returns nulls for empty array', () => {
    const result = calculateAggregatedScores([]);
    expect(result.avgOverall).toBeNull();
    expect(result.avgUnit).toBeNull();
    expect(result.avgBuilding).toBeNull();
    expect(result.avgLandlord).toBeNull();
    expect(result.reviewCount).toBe(0);
    expect(result.pctWouldRecommend).toBeNull();
  });

  it('calculates averages for a single review', () => {
    const review = {
      ...allScores(4),
      move_out_year: 2026,
      would_recommend_new: 'yes',
    };
    const result = calculateAggregatedScores([review]);
    expect(result.avgOverall).toBe(4.0);
    expect(result.reviewCount).toBe(1);
    expect(result.pctWouldRecommend).toBe(100);
  });

  it('calculates pctWouldRecommend correctly', () => {
    const reviews = [
      { ...allScores(4), would_recommend_new: 'yes', move_out_year: 2026 },
      { ...allScores(3), would_recommend_new: 'no', move_out_year: 2026 },
      { ...allScores(5), would_recommend_new: 'yes', move_out_year: 2026 },
      { ...allScores(2), would_recommend_new: 'maybe', move_out_year: 2026 },
    ];
    const result = calculateAggregatedScores(reviews);
    // 2 yes out of 3 definitive (maybe excluded) = 67%
    expect(result.pctWouldRecommend).toBe(67);
  });

  it('handles legacy would_recommend boolean', () => {
    const reviews = [
      { ...allScores(4), would_recommend: true, move_out_year: 2026 },
      { ...allScores(3), would_recommend: false, move_out_year: 2026 },
    ];
    const result = calculateAggregatedScores(reviews);
    expect(result.pctWouldRecommend).toBe(50);
  });

  it('applies recency weighting to older reviews', () => {
    // Recent review (2026) scores 5, old review (2020, 6 yrs old = 0.85 weight) scores 1
    const recentReview = { ...allScores(5), move_out_year: 2026 };
    const oldReview = { ...allScores(1), move_out_year: 2020 };

    const resultWeighted = calculateAggregatedScores([recentReview, oldReview]);

    // Compare: two equally-weighted recent reviews with same scores
    const recentReview2 = { ...allScores(5), move_out_year: 2026 };
    const recentOldEquiv = { ...allScores(1), move_out_year: 2026 };

    const resultEqual = calculateAggregatedScores([recentReview2, recentOldEquiv]);

    // With recency weighting, the high-scoring recent review should have MORE
    // influence than the low-scoring old review, so the weighted average
    // should be >= the equally-weighted average
    expect(resultWeighted.avgOverall).toBeDefined();
    expect(resultEqual.avgOverall).toBeDefined();
    expect(resultWeighted.avgOverall!).toBeGreaterThanOrEqual(resultEqual.avgOverall!);
  });
});

describe('calculateAggregatedScores uses the stored overall_score', () => {
  it('avgOverall equals the recency-weighted mean of the stored column', () => {
    // Stored overall is 4.0 for both; item-derived overall would be ~1.0 and ~5.0
    // (mean 3.0). Only the stored-column implementation yields 4.0 — this fails
    // if the aggregate ever reverts to recomputing overall from items.
    const reviews = [
      { overall_score: 4.0, move_out_year: 2026, unit_structural: 1 },
      { overall_score: 4.0, move_out_year: 2026, unit_structural: 5 },
    ];
    expect(calculateAggregatedScores(reviews, 2026).avgOverall).toBe(4.0);
  });

  it('excludes reviews with a null overall_score from avgOverall', () => {
    const reviews = [
      { overall_score: 4.0, move_out_year: 2026 },
      { overall_score: null, move_out_year: 2026 },
    ];
    expect(calculateAggregatedScores(reviews, 2026).avgOverall).toBe(4.0);
  });
});

// ═══════════════════════════════════════════════════
// calculateBuildingAverages (legacy)
// ═══════════════════════════════════════════════════

describe('calculateBuildingAverages', () => {
  it('returns review_count', () => {
    const reviews = [allScores(3), allScores(4)];
    const result = calculateBuildingAverages(reviews);
    expect(result.review_count).toBe(2);
  });

  it('calculates issue percentages', () => {
    const reviews = [
      { ...allScores(3), had_pest_issues: true, had_heat_issues: false },
      { ...allScores(3), had_pest_issues: false, had_heat_issues: true },
      { ...allScores(3), had_pest_issues: true, had_heat_issues: true },
    ];
    const result = calculateBuildingAverages(reviews);
    expect(result.pct_pest_issues).toBe(67); // 2/3
    expect(result.pct_heat_issues).toBe(67); // 2/3
  });

  it('handles empty reviews array', () => {
    const result = calculateBuildingAverages([]);
    expect(result.review_count).toBe(0);
    expect(result.avg_overall).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// calculateLandlordAverages (legacy)
// ═══════════════════════════════════════════════════

describe('calculateLandlordAverages', () => {
  it('returns review_count', () => {
    const result = calculateLandlordAverages([allScores(4)]);
    expect(result.review_count).toBe(1);
  });

  it('calculates deposit issue percentage', () => {
    const reviews = [
      { ...allScores(3), had_security_deposit_issues: true },
      { ...allScores(3), had_security_deposit_issues: false },
    ];
    const result = calculateLandlordAverages(reviews);
    expect(result.pct_deposit_issues).toBe(50);
  });

  it('handles empty reviews', () => {
    const result = calculateLandlordAverages([]);
    expect(result.review_count).toBe(0);
    expect(result.avg_overall).toBeNull();
    expect(result.pct_deposit_issues).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// formatScore
// ═══════════════════════════════════════════════════

describe('formatScore', () => {
  it('returns "N/A" for null', () => {
    expect(formatScore(null)).toBe('N/A');
  });

  it('formats whole numbers with one decimal', () => {
    expect(formatScore(3)).toBe('3.0');
    expect(formatScore(5)).toBe('5.0');
  });

  it('formats decimal numbers to one decimal', () => {
    expect(formatScore(3.5)).toBe('3.5');
    expect(formatScore(4.2)).toBe('4.2');
  });
});

// ═══════════════════════════════════════════════════
// Write-path parity: submit vs edit compute the same stored overall_score
// (api/reviews.ts uses calculateDomainScores().overall; api/reviews/[id].ts
//  uses calculateOverallScore()). They must agree for identical input.
// ═══════════════════════════════════════════════════

describe('submit vs edit overall_score parity', () => {
  it('calculateOverallScore equals calculateDomainScores().overall for scored reviews', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      const scores = allScores(v);
      expect(calculateOverallScore(scores)).toBe(calculateDomainScores(scores).overall);
    }
  });

  it('agrees on a mixed-domain review', () => {
    const scores = { ...allScores(4), unit_pests: 1, unit_mold: 2, landlord_deposit: 5 };
    expect(calculateOverallScore(scores)).toBe(calculateDomainScores(scores).overall);
  });

  it('differs only in the all-null case (0 vs null), by design', () => {
    const empty = domainScores([], 0); // all fields null
    expect(calculateDomainScores(empty).overall).toBeNull();
    expect(calculateOverallScore(empty)).toBe(0); // legacy column default
  });
});

// ═══════════════════════════════════════════════════
// Aggregate vs simple mean: SQL AVG(overall_score) (used by search/map/admin)
// vs calculateAggregatedScores (used by detail headers). They agree when all
// reviews are recent (recency weight 1.0) and diverge only as reviews age —
// the documented "recency divergence". These tests pin that contract.
// ═══════════════════════════════════════════════════

describe('aggregate vs simple-mean agreement (recency divergence)', () => {
  const thisYear = new Date().getFullYear();

  it('recency weighting is a no-op when all reviews are recent', () => {
    const reviews = [
      { ...allScores(4), move_out_year: thisYear },
      { ...allScores(2), move_out_year: thisYear },
    ];
    // Simple mean of per-review domain overalls = (4.0 + 2.0) / 2 = 3.0
    const simpleMean =
      Math.round(
        ((calculateDomainScores(reviews[0]).overall! +
          calculateDomainScores(reviews[1]).overall!) /
          2) * 10
      ) / 10;
    expect(calculateAggregatedScores(reviews).avgOverall).toBe(simpleMean);
    expect(calculateAggregatedScores(reviews).avgOverall).toBe(3.0);
  });

  it('diverges from the simple mean once a review is old enough to decay', () => {
    const reviews = [
      { ...allScores(4), move_out_year: thisYear },      // weight 1.0
      { ...allScores(2), move_out_year: thisYear - 5 },  // weight 0.85 (5+ yrs)
    ];
    // Weighted: (4*1.0 + 2*0.85) / 1.85 = 3.08 → 3.1; simple mean would be 3.0
    expect(calculateAggregatedScores(reviews).avgOverall).toBeGreaterThan(3.0);
  });
});

describe('RECENCY_BANDS (single source of recency weighting)', () => {
  it('is ordered and covers all ages with a terminal Infinity band', () => {
    expect(RECENCY_BANDS.map(b => b.weight)).toEqual([1.0, 0.95, 0.90, 0.85]);
    expect(RECENCY_BANDS[RECENCY_BANDS.length - 1].maxAge).toBe(Infinity);
  });

  it('getRecencyWeight derives from the bands', () => {
    expect(getRecencyWeight(2026, 2026)).toBe(1.0);  // age 0
    expect(getRecencyWeight(2024, 2026)).toBe(1.0);  // age 2
    expect(getRecencyWeight(2023, 2026)).toBe(0.95); // age 3
    expect(getRecencyWeight(2022, 2026)).toBe(0.90); // age 4
    expect(getRecencyWeight(2021, 2026)).toBe(0.85); // age 5
    expect(getRecencyWeight(2010, 2026)).toBe(0.85); // very old
    expect(getRecencyWeight(null, 2026)).toBe(1.0);  // unknown → no decay
  });
});

describe('getReviewYear', () => {
  it('prefers move_out_year, falls back to created_at UTC year, then currentYear', () => {
    expect(getReviewYear({ move_out_year: 2023 }, 2026)).toBe(2023);
    const tsUtc2025 = Date.UTC(2025, 5, 15) / 1000;
    expect(getReviewYear({ created_at: tsUtc2025 }, 2026)).toBe(2025);
    expect(getReviewYear({}, 2026)).toBe(2026);
  });
});
