import { describe, expect, it } from 'vitest';
import {
  assessorUnitsText,
  missingYearsNote,
  PERMIT_COVERAGE_NOTE,
  SHOW_LESS_LABEL,
  showAllLabel,
  showLessAtEnd,
} from '../records/display';
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

describe('missingYearsNote', () => {
  it('says a missing year is not a zero and why, in the singular', () => {
    expect(missingYearsNote([2014])).toBe(
      "2014 is marked as missing data, not zero. The city's 311 file for that year is currently empty.",
    );
  });

  it('joins several years and words the sentence in the plural', () => {
    expect(missingYearsNote([2011, 2014])).toBe(
      "2011 and 2014 are marked as missing data, not zero. The city's 311 files for those years are currently empty.",
    );
    expect(missingYearsNote([2010, 2011, 2014])).toContain('2010, 2011 and 2014 are marked');
  });

  it('says nothing when no year is missing', () => {
    expect(missingYearsNote([])).toBeNull();
  });

  it('stays plain: no dash, no exclamation point', () => {
    expect(missingYearsNote([2014])).not.toMatch(/[—!]/);
    expect(missingYearsNote([2011, 2014])).not.toMatch(/[—!]/);
  });
});

describe('the full-list disclosure', () => {
  it('says "Show less" once open, instead of repeating the closed label', () => {
    expect(SHOW_LESS_LABEL).toBe('Show less');
    expect(showAllLabel(31, { one: 'request', many: 'requests' })).toBe('Show all 31 requests');
  });

  it('adds a second "Show less" at the end of a long list only', () => {
    expect(showLessAtEnd(0)).toBe(false);
    expect(showLessAtEnd(1)).toBe(false);
    expect(showLessAtEnd(5)).toBe(false);
    expect(showLessAtEnd(6)).toBe(true);
    expect(showLessAtEnd(220)).toBe(true);
  });
});
