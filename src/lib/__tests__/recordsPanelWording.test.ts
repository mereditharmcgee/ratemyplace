import { describe, expect, it } from 'vitest';
import { assessorUnitsText } from '../records/display';

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
