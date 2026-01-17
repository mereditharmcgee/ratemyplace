interface ReviewScores {
  building_quality?: number;
  maintenance?: number;
  pest_control?: number;
  safety?: number;
  noise?: number;
  landlord_responsiveness?: number;
  landlord_communication?: number;
  landlord_fairness?: number;
  lease_clarity?: number;
  deposit_handling?: number;
  rent_value?: number;
  amenities?: number;
}

export function calculateOverallScore(scores: ReviewScores): number {
  const scoreValues = Object.values(scores).filter((v): v is number => v !== undefined && v !== null);

  if (scoreValues.length === 0) return 0;

  const sum = scoreValues.reduce((acc, val) => acc + val, 0);
  return Math.round((sum / scoreValues.length) * 10) / 10;
}

export function calculateBuildingAverages(reviews: any[]): Record<string, number | null> {
  if (reviews.length === 0) {
    return {
      avg_overall: null,
      avg_building_quality: null,
      avg_maintenance: null,
      avg_pest_control: null,
      avg_safety: null,
      avg_noise: null,
      avg_landlord_responsiveness: null,
      avg_landlord_communication: null,
      avg_landlord_fairness: null,
      avg_lease_clarity: null,
      avg_deposit_handling: null,
      avg_rent_value: null,
      avg_amenities: null,
      pct_would_recommend: null,
      pct_pest_issues: null,
      pct_heat_issues: null,
      pct_water_issues: null,
      pct_deposit_issues: null,
    };
  }

  const scoreFields = [
    'overall_score',
    'score_building_quality',
    'score_maintenance',
    'score_pest_control',
    'score_safety',
    'score_noise',
    'score_landlord_responsiveness',
    'score_landlord_communication',
    'score_landlord_fairness',
    'score_lease_clarity',
    'score_deposit_handling',
    'score_rent_value',
    'score_amenities',
  ];

  const averages: Record<string, number | null> = {};

  for (const field of scoreFields) {
    const values = reviews
      .map((r) => r[field])
      .filter((v): v is number => v !== null && v !== undefined);

    if (values.length > 0) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const avgKey = field === 'overall_score' ? 'avg_overall' : `avg_${field.replace('score_', '')}`;
      averages[avgKey] = Math.round(avg * 10) / 10;
    } else {
      const avgKey = field === 'overall_score' ? 'avg_overall' : `avg_${field.replace('score_', '')}`;
      averages[avgKey] = null;
    }
  }

  // Calculate percentages for boolean flags
  const booleanFields = [
    { field: 'would_recommend', key: 'pct_would_recommend' },
    { field: 'had_pest_issues', key: 'pct_pest_issues' },
    { field: 'had_heat_issues', key: 'pct_heat_issues' },
    { field: 'had_water_issues', key: 'pct_water_issues' },
    { field: 'had_security_deposit_issues', key: 'pct_deposit_issues' },
  ];

  for (const { field, key } of booleanFields) {
    const count = reviews.filter((r) => r[field] === 1 || r[field] === true).length;
    averages[key] = Math.round((count / reviews.length) * 100);
  }

  return averages;
}

export function calculateLandlordAverages(reviews: any[]): Record<string, number | null> {
  if (reviews.length === 0) {
    return {
      avg_overall: null,
      avg_landlord_responsiveness: null,
      avg_landlord_communication: null,
      avg_landlord_fairness: null,
      avg_lease_clarity: null,
      avg_deposit_handling: null,
      pct_would_recommend: null,
      pct_deposit_issues: null,
    };
  }

  const scoreFields = [
    'overall_score',
    'score_landlord_responsiveness',
    'score_landlord_communication',
    'score_landlord_fairness',
    'score_lease_clarity',
    'score_deposit_handling',
  ];

  const averages: Record<string, number | null> = {};

  for (const field of scoreFields) {
    const values = reviews
      .map((r) => r[field])
      .filter((v): v is number => v !== null && v !== undefined);

    if (values.length > 0) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const avgKey = field === 'overall_score' ? 'avg_overall' : `avg_${field.replace('score_', '')}`;
      averages[avgKey] = Math.round(avg * 10) / 10;
    } else {
      const avgKey = field === 'overall_score' ? 'avg_overall' : `avg_${field.replace('score_', '')}`;
      averages[avgKey] = null;
    }
  }

  // Calculate percentages
  const recommendCount = reviews.filter((r) => r.would_recommend === 1 || r.would_recommend === true).length;
  averages['pct_would_recommend'] = Math.round((recommendCount / reviews.length) * 100);

  const depositIssuesCount = reviews.filter((r) => r.had_security_deposit_issues === 1 || r.had_security_deposit_issues === true).length;
  averages['pct_deposit_issues'] = Math.round((depositIssuesCount / reviews.length) * 100);

  return averages;
}
