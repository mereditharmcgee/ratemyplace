import { describe, it, expect } from 'vitest';
import { RECENCY_BANDS } from '../scoring';
import {
  reviewYearSql,
  recencyWeightSql,
  recencyWeightedOverallSql,
  currentReviewYear,
} from '../scoring-sql';

describe('reviewYearSql', () => {
  it('uses a 4-digit move_out_year_new then created_at UTC year for the given alias', () => {
    const sql = reviewYearSql('r');
    expect(sql).toContain("r.move_out_year_new GLOB '[0-9][0-9][0-9][0-9]'");
    expect(sql).toContain("strftime('%Y', r.created_at, 'unixepoch')");
  });
});

describe('recencyWeightSql', () => {
  it('inlines the current year as an integer literal (safe, not user input)', () => {
    expect(recencyWeightSql('r', 2026)).toContain('2026');
  });
  it('rejects a non-numeric year', () => {
    // @ts-expect-error deliberate misuse
    expect(() => recencyWeightSql('r', 'oops')).toThrow();
  });
  it('emits a weight branch for every band in RECENCY_BANDS', () => {
    const sql = recencyWeightSql('r', 2026);
    // finite-maxAge bands become WHEN ... THEN <weight>, terminal band is ELSE <weight>
    expect(sql).toContain('THEN 1.00');
    expect(sql).toContain('THEN 0.95');
    expect(sql).toContain('THEN 0.90');
    expect(sql).toContain('ELSE 0.85');
    // one WHEN per finite band, plus one ELSE. Match only the band branches
    // (`WHEN (2026 - ...)`) so the WHEN inside reviewYearSql's GLOB CASE — which
    // is inlined once per branch — is not miscounted.
    const bandWhenCount = (sql.match(/WHEN \(2026 -/g) || []).length;
    expect(bandWhenCount).toBe(RECENCY_BANDS.filter(b => Number.isFinite(b.maxAge)).length);
  });
});

describe('recencyWeightedOverallSql', () => {
  it('is a NULL-safe weighted mean of overall_score rounded to 1 decimal', () => {
    const sql = recencyWeightedOverallSql('r', 2026);
    expect(sql).toContain('r.overall_score');
    expect(sql).toContain('SUM(');
    expect(sql).toContain('NULLIF(');
    expect(sql).toContain('ROUND(');
  });
});

describe('currentReviewYear', () => {
  it('returns a 4-digit UTC year', () => {
    expect(currentReviewYear()).toBeGreaterThanOrEqual(2024);
  });
});
