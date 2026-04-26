export interface ScoreColor {
  bg: string;
  text: string;
  label: string;
}

export function getScoreColor(score: number): ScoreColor {
  if (score >= 4) return { bg: 'bg-emerald-600', text: 'text-white', label: 'Good' };
  if (score >= 3) return { bg: 'bg-amber-500',   text: 'text-white', label: 'Mixed' };
  if (score >= 2) return { bg: 'bg-amber-700',   text: 'text-white', label: 'Concerning' };
  return            { bg: 'bg-red-700',     text: 'text-white', label: 'Poor' };
}

export function getScoreTextColor(score: number): string {
  if (score >= 4) return 'text-emerald-700';
  if (score >= 3) return 'text-amber-700';
  return 'text-red-700';
}
