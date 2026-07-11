import { describe, it, expect } from 'vitest';
import { RECENCY_BANDS } from '../scoring';
import {
  reviewYearSql,
  recencyWeightSql,
  recencyWeightedOverallSql,
  currentReviewYear,
} from '../scoring-sql';

describe('reviewYearSql', () => {
  it('uses move_out_year then created_at UTC year for the given alias', () => {
    const sql = reviewYearSql('r');
    expect(sql).toContain('r.move_out_year');
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
    for (const band of RECENCY_BANDS) {
      expect(sql).toContain(String(band.weight));
    }
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
