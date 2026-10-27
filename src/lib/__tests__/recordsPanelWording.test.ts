import { describe, expect, it } from 'vitest';
import { assessorUnitsText, PERMIT_COVERAGE_NOTE } from '../records/display';
import { PERMIT_COVERAGE_START } from '../records/sources/boston/permits';

/**
 * Small wording fixes on the records panel, each held to the sentence it now says. Every string
 * here is also sampled into `PANEL_COPY`, so the banned-words scan covers it.
 */

describe('assessorUnitsText', () => {
  it('says the assessor left the count blank, not that nobody recorded it', () => {
    // Building details can show a unit count from elsewhere; this line is the assessor's field.
    expect(assessorUnitsText(null)).toBe('units not recorded by the assessor');
    expect(assessorUnitsText(undefined)).toBe('units not recorded by the assessor');
  });

  it('prints a recorded count, zero included, as recorded', () => {
    expect(assessorUnitsText(3)).toBe('units 3');
    expect(assessorUnitsText(0)).toBe('units 0');
  });
});

describe('PERMIT_COVERAGE_NOTE', () => {
  it("states where the city's permit feed starts, as a fact about the feed", () => {
    expect(PERMIT_COVERAGE_NOTE).toBe(`The city's permit records start in ${PERMIT_COVERAGE_START}.`);
    // "On record from" read as this building's permits, against a row span that starts later.
    expect(PERMIT_COVERAGE_NOTE).not.toContain('On record from');
    expect(PERMIT_COVERAGE_NOTE).not.toMatch(/[—!]/);
  });
});
