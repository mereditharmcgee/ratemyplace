/**
 * Scoring System for RateMyPlace
 *
 * Methodology based on housing quality research:
 * - Krieger & Higgins (2002) - American Journal of Public Health
 * - Jacobs et al. (2009) - Environmental Health Perspectives
 * - Bonnefoy et al. (2003) - WHO LARES study
 *
 * Health/safety items receive higher weights (1.2-1.5x) based on
 * documented associations with health outcomes.
 */

// Field definitions for the 27-item survey
export const UNIT_FIELDS = [
  'unit_structural',
  'unit_plumbing',
  'unit_electrical',
  'unit_climate',
  'unit_ventilation',
  'unit_pests',
  'unit_mold',
  'unit_appliances',
  'unit_layout',
  'unit_accuracy',
] as const;

export const BUILDING_FIELDS = [
  'building_common_areas',
  'building_security',
  'building_exterior',
  'building_noise_neighbors',
  'building_noise_external',
  'building_mail',
  'building_laundry',
  'building_parking',
  'building_trash',
] as const;

export const LANDLORD_FIELDS = [
  'landlord_maintenance',
  'landlord_communication',
  'landlord_professionalism',
  'landlord_lease_clarity',
  'landlord_privacy',
  'landlord_deposit',
  'landlord_rent_practices',
  'landlord_non_retaliation',
] as const;

export const ALL_SCORE_FIELDS = [...UNIT_FIELDS, ...BUILDING_FIELDS, ...LANDLORD_FIELDS] as const;

export type ScoreFieldName = typeof ALL_SCORE_FIELDS[number];

/**
 * Health/Safety Weights
 *
 * Based on epidemiological evidence:
 * - Pests: 1.5x - Strong allergen/disease vector evidence (Krieger 2002)
 * - Mold: 1.5x - OR 1.5-3.5 for respiratory illness (Jacobs 2009)
 * - Structural: 1.3x - Safety hazard, injury risk
 * - Climate: 1.3x - Cardiovascular/hypothermia risk (important for Boston)
 * - Plumbing: 1.2x - Water damage → mold pathway
 * - Security: 1.2x - Personal safety
 */
export const ITEM_WEIGHTS: Record<ScoreFieldName, number> = {
  // Unit items (10)
  unit_structural: 1.3,
  unit_plumbing: 1.2,
  unit_electrical: 1.0,
  unit_climate: 1.3,
  unit_ventilation: 1.0,
  unit_pests: 1.5,
  unit_mold: 1.5,
  unit_appliances: 1.0,
  unit_layout: 1.0,
  unit_accuracy: 1.0,
  // Building items (9)
  building_common_areas: 1.0,
  building_security: 1.2,
  building_exterior: 1.0,
  building_noise_neighbors: 1.0,
  building_noise_external: 1.0,
  building_mail: 1.0,
  building_laundry: 1.0,
  building_parking: 1.0,
  building_trash: 1.0,
  // Landlord items (8)
  landlord_maintenance: 1.0,
  landlord_communication: 1.0,
  landlord_professionalism: 1.0,
  landlord_lease_clarity: 1.0,
  landlord_privacy: 1.0,
  landlord_deposit: 1.0,
  landlord_rent_practices: 1.0,
  landlord_non_retaliation: 1.0,
};

/**
 * Recency weight factor
 * Gentle decay for older reviews: 5% reduction per year after 2 years, floor at 85%
 * Based on Hu, Pavlou & Zhang (2017) - MIS Quarterly
 */
export function getRecencyWeight(reviewYear: number | null, currentYear: number = new Date().getFullYear()): number {
  if (!reviewYear) return 1.0;

  const age = currentYear - reviewYear;

  if (age <= 2) return 1.0;
  if (age === 3) return 0.95;
  if (age === 4) return 0.90;
  return 0.85; // Floor for 5+ years old
}

export interface DomainScores {
  unit: number | null;
  building: number | null;
  landlord: number | null;
  overall: number | null;
}

export interface WeightedScoreResult {
  score: number;
  weightedSum: number;
  totalWeight: number;
  itemCount: number;
}

/**
 * Calculate weighted score for a set of items
 */
function calculateWeightedScore(
  scores: Record<string, number | null | undefined>,
  fields: readonly string[]
): WeightedScoreResult | null {
  let weightedSum = 0;
  let totalWeight = 0;
  let itemCount = 0;

  for (const field of fields) {
    const value = scores[field];
    if (value !== null && value !== undefined && typeof value === 'number') {
      const weight = ITEM_WEIGHTS[field as ScoreFieldName] || 1.0;
      weightedSum += value * weight;
      totalWeight += weight;
      itemCount++;
    }
  }

  if (itemCount === 0) return null;

  return {
    score: Math.round((weightedSum / totalWeight) * 10) / 10,
    weightedSum,
    totalWeight,
    itemCount,
  };
}

/**
 * Calculate domain sub-scores and overall score for a single review
 */
export function calculateDomainScores(scores: Record<string, number | null | undefined>): DomainScores {
  const unitResult = calculateWeightedScore(scores, UNIT_FIELDS);
  const buildingResult = calculateWeightedScore(scores, BUILDING_FIELDS);
  const landlordResult = calculateWeightedScore(scores, LANDLORD_FIELDS);

  // Overall is weighted average of all three domains
  // Each domain contributes proportionally to its item count
  let totalWeightedSum = 0;
  let totalWeight = 0;

  if (unitResult) {
    totalWeightedSum += unitResult.weightedSum;
    totalWeight += unitResult.totalWeight;
  }
  if (buildingResult) {
    totalWeightedSum += buildingResult.weightedSum;
    totalWeight += buildingResult.totalWeight;
  }
  if (landlordResult) {
    totalWeightedSum += landlordResult.weightedSum;
    totalWeight += landlordResult.totalWeight;
  }

  const overall = totalWeight > 0
    ? Math.round((totalWeightedSum / totalWeight) * 10) / 10
    : null;

  return {
    unit: unitResult?.score ?? null,
    building: buildingResult?.score ?? null,
    landlord: landlordResult?.score ?? null,
    overall,
  };
}

/**
 * Calculate overall score (for backward compatibility)
 * This is what gets stored in the overall_score column
 */
export function calculateOverallScore(scores: Record<string, number | null | undefined>): number {
  const domainScores = calculateDomainScores(scores);
  return domainScores.overall ?? 0;
}

/**
 * Calculate aggregated scores across multiple reviews with recency weighting
 */
export function calculateAggregatedScores(reviews: any[]): {
  avgOverall: number | null;
  avgUnit: number | null;
  avgBuilding: number | null;
  avgLandlord: number | null;
  reviewCount: number;
  pctWouldRecommend: number | null;
} {
  if (reviews.length === 0) {
    return {
      avgOverall: null,
      avgUnit: null,
      avgBuilding: null,
      avgLandlord: null,
      reviewCount: 0,
      pctWouldRecommend: null,
    };
  }

  const currentYear = new Date().getFullYear();

  let overallSum = 0;
  let overallWeight = 0;
  let unitSum = 0;
  let unitWeight = 0;
  let buildingSum = 0;
  let buildingWeight = 0;
  let landlordSum = 0;
  let landlordWeight = 0;
  let recommendCount = 0;
  let recommendTotal = 0;

  for (const review of reviews) {
    // Determine review year for recency weighting
    const reviewYear = review.move_out_year || review.created_at
      ? new Date((review.created_at || 0) * 1000).getFullYear()
      : currentYear;
    const recencyWeight = getRecencyWeight(reviewYear, currentYear);

    // Calculate domain scores for this review
    const domainScores = calculateDomainScores(review);

    if (domainScores.overall !== null) {
      overallSum += domainScores.overall * recencyWeight;
      overallWeight += recencyWeight;
    }
    if (domainScores.unit !== null) {
      unitSum += domainScores.unit * recencyWeight;
      unitWeight += recencyWeight;
    }
    if (domainScores.building !== null) {
      buildingSum += domainScores.building * recencyWeight;
      buildingWeight += recencyWeight;
    }
    if (domainScores.landlord !== null) {
      landlordSum += domainScores.landlord * recencyWeight;
      landlordWeight += recencyWeight;
    }

    // Would recommend (use new field if available, fall back to old)
    const wouldRecommend = review.would_recommend_new || review.would_recommend;
    if (wouldRecommend !== null && wouldRecommend !== undefined) {
      recommendTotal++;
      if (wouldRecommend === 'yes' || wouldRecommend === 1 || wouldRecommend === true) {
        recommendCount++;
      }
    }
  }

  return {
    avgOverall: overallWeight > 0 ? Math.round((overallSum / overallWeight) * 10) / 10 : null,
    avgUnit: unitWeight > 0 ? Math.round((unitSum / unitWeight) * 10) / 10 : null,
    avgBuilding: buildingWeight > 0 ? Math.round((buildingSum / buildingWeight) * 10) / 10 : null,
    avgLandlord: landlordWeight > 0 ? Math.round((landlordSum / landlordWeight) * 10) / 10 : null,
    reviewCount: reviews.length,
    pctWouldRecommend: recommendTotal > 0 ? Math.round((recommendCount / recommendTotal) * 100) : null,
  };
}

/**
 * Legacy function for backward compatibility
 * Maps old field names to calculations
 */
export function calculateBuildingAverages(reviews: any[]): Record<string, number | null> {
  const aggregated = calculateAggregatedScores(reviews);

  // Also calculate issue percentages
  let pestCount = 0;
  let heatCount = 0;
  let waterCount = 0;
  let depositCount = 0;

  for (const review of reviews) {
    if (review.had_pest_issues || review.had_pests) pestCount++;
    if (review.had_heat_issues) heatCount++;
    if (review.had_water_issues) waterCount++;
    if (review.had_security_deposit_issues) depositCount++;
  }

  const total = reviews.length || 1;

  return {
    avg_overall: aggregated.avgOverall,
    avg_unit: aggregated.avgUnit,
    avg_building: aggregated.avgBuilding,
    avg_landlord: aggregated.avgLandlord,
    pct_would_recommend: aggregated.pctWouldRecommend,
    pct_pest_issues: Math.round((pestCount / total) * 100),
    pct_heat_issues: Math.round((heatCount / total) * 100),
    pct_water_issues: Math.round((waterCount / total) * 100),
    pct_deposit_issues: Math.round((depositCount / total) * 100),
    review_count: reviews.length,
  };
}

/**
 * Legacy function for landlord averages
 */
export function calculateLandlordAverages(reviews: any[]): Record<string, number | null> {
  const aggregated = calculateAggregatedScores(reviews);

  let depositCount = 0;
  for (const review of reviews) {
    if (review.had_security_deposit_issues) depositCount++;
  }

  return {
    avg_overall: aggregated.avgOverall,
    avg_landlord: aggregated.avgLandlord,
    pct_would_recommend: aggregated.pctWouldRecommend,
    pct_deposit_issues: reviews.length > 0 ? Math.round((depositCount / reviews.length) * 100) : null,
    review_count: reviews.length,
  };
}

/**
 * Get score color class based on value
 */
export function getScoreColorClass(score: number | null): string {
  if (score === null) return 'bg-gray-200 text-gray-600';
  if (score >= 4) return 'bg-emerald-100 text-emerald-800';
  if (score >= 3) return 'bg-amber-100 text-amber-800';
  if (score >= 2) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

/**
 * Format score for display
 */
export function formatScore(score: number | null): string {
  if (score === null) return 'N/A';
  return score.toFixed(1);
}
