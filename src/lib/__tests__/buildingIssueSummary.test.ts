import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateBuildingAverages } from '../scoring';
import { NO_CHECKLIST_ISSUES_COPY } from '../reviewDisplay';

/**
 * The building page's "Common issues reported" box counts four yes/no questions on the
 * review form (pests, heat or hot water, plumbing, deposit). A review can leave all four
 * unchecked and still describe other problems in its ratings or text, so the empty state
 * names the four questions instead of saying "No issues reported".
 */

const source = readFileSync(join(process.cwd(), 'src/pages/building/[slug].astro'), 'utf8');

describe('building page issue summary', () => {
  it('names the four questions in its empty state', () => {
    expect(NO_CHECKLIST_ISSUES_COPY).toBe('No reviewer marked pest, heat, plumbing or deposit issues.');
    expect(source).toContain('{NO_CHECKLIST_ISSUES_COPY}');
    expect(source).not.toContain('No issues reported');
  });

  it('counts the same flags the review card tags show', () => {
    // The card tags read had_pest_issues, had_heat_issues, had_water_issues and
    // had_security_deposit_issues; the summary percentages come from the same columns.
    const scores = calculateBuildingAverages([
      { overall_score: 3, had_pest_issues: 1, had_heat_issues: 0, had_water_issues: 0, had_security_deposit_issues: 0 },
      { overall_score: 3, had_pest_issues: 0, had_heat_issues: 0, had_water_issues: 0, had_security_deposit_issues: 0 },
    ]);
    expect(scores.pct_pest_issues).toBe(50);
    expect(scores.pct_heat_issues).toBe(0);
    expect(scores.pct_water_issues).toBe(0);
    expect(scores.pct_deposit_issues).toBe(0);
  });
});
