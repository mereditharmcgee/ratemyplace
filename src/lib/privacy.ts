const seasonLabels: Record<string, string> = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  fall: 'Fall'
};

export function formatFuzzyDate(year: number, season: string): string {
  const seasonLabel = seasonLabels[season] || season;
  return `${seasonLabel} ${year}`;
}

export function getCurrentSeason(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

export function getCurrentYear(): number {
  return new Date().getFullYear();
}
