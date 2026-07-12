/**
 * SQL counterparts to the JS recency weighting in scoring.ts. Both are generated
 * from the shared RECENCY_BANDS array, so list-view aggregation (SQL) and
 * detail-page aggregation (JS) cannot diverge.
 *
 * The current year is inlined as an integer LITERAL (never a bind), which keeps
 * each emitted fragment self-contained so heterogeneous call sites don't have to
 * manage bind positions. It is safe: the year is server-computed and coerced to
 * an integer here — it is never user input. (Same category as the ALL_SCORE_FIELDS
 * column-list interpolation already used elsewhere.)
 */
import { RECENCY_BANDS } from './scoring';

function safeYear(currentYear: number): number {
  const y = Math.trunc(Number(currentYear));
  if (!Number.isFinite(y)) throw new Error(`Invalid currentYear: ${currentYear}`);
  return y;
}

/** SQL expression for a review's recency-basis year (mirrors getReviewYear). */
export function reviewYearSql(alias: string): string {
  return `COALESCE(
    CASE WHEN ${alias}.move_out_year_new GLOB '[0-9][0-9][0-9][0-9]' THEN CAST(${alias}.move_out_year_new AS INTEGER) END,
    CAST(strftime('%Y', ${alias}.created_at, 'unixepoch') AS INTEGER)
  )`;
}

/** SQL CASE expression for a review's recency weight (mirrors getRecencyWeight). */
export function recencyWeightSql(alias: string, currentYear: number): string {
  const cy = safeYear(currentYear);
  const age = `(${cy} - ${reviewYearSql(alias)})`;
  const branches = RECENCY_BANDS
    .filter((b) => Number.isFinite(b.maxAge))
    .map((b) => `    WHEN ${age} <= ${b.maxAge} THEN ${b.weight.toFixed(2)}`)
    .join('\n');
  const terminal = RECENCY_BANDS[RECENCY_BANDS.length - 1].weight.toFixed(2);
  return `CASE\n${branches}\n    ELSE ${terminal}\n  END`;
}

/**
 * SQL expression: recency-weighted mean of overall_score over a GROUP BY (or a
 * correlated subquery) of reviews aliased `alias`. Rounded to 1 decimal to match
 * JS. Reviews with a NULL overall_score are excluded (matching AVG). NULLIF
 * guards the all-null / no-rows case → NULL (same as AVG).
 */
export function recencyWeightedOverallSql(alias: string, currentYear: number): string {
  const w = recencyWeightSql(alias, currentYear);
  return `ROUND(
    SUM(CASE WHEN ${alias}.overall_score IS NOT NULL THEN ${alias}.overall_score * (${w}) ELSE 0 END)
    / NULLIF(SUM(CASE WHEN ${alias}.overall_score IS NOT NULL THEN (${w}) ELSE 0 END), 0)
  , 1)`;
}

/** Current year for recency (UTC, to match strftime 'unixepoch'). */
export function currentReviewYear(): number {
  return new Date().getUTCFullYear();
}
