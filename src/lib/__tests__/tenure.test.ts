import { describe, it, expect } from 'vitest';
import { parseTenureMonths, tenureEditChoices, tenureEditValue } from '../tenure';
import { supplementaryItems } from '../surveyItems';

/**
 * "How long did you live at this address?" on the reviewer's edit page. The select starts at
 * the stored answer, so an untouched save writes back what was there: a review stored with
 * no tenure used to start at "1-2 years" and save 18 months the reviewer never gave.
 */

const OPTIONS = supplementaryItems.tenure.options;

describe('tenureEditValue', () => {
  it('starts at the stored months, as the select value', () => {
    expect(tenureEditValue({ tenure_months: 18 })).toBe('18');
    expect(tenureEditValue({ tenure_months: 72 })).toBe('72');
  });

  it('starts blank when no tenure is stored', () => {
    expect(tenureEditValue({ tenure_months: null })).toBe('');
    expect(tenureEditValue({})).toBe('');
  });

  it('keeps a stored value the list does not offer', () => {
    expect(tenureEditValue({ tenure_months: 12 })).toBe('12');
  });
});

describe('tenureEditChoices', () => {
  it('is the form list, as strings, when the stored value is on it', () => {
    expect(tenureEditChoices(OPTIONS, '18')).toEqual(
      OPTIONS.map((opt) => ({ value: String(opt.value), label: opt.label })),
    );
  });

  it('adds a blank "Select..." choice first only when nothing is stored', () => {
    const choices = tenureEditChoices(OPTIONS, '');
    expect(choices[0]).toEqual({ value: '', label: 'Select...' });
    expect(choices).toHaveLength(OPTIONS.length + 1);
    expect(tenureEditChoices(OPTIONS, '36').map((opt) => opt.value)).not.toContain('');
  });

  it('adds a stored value the list does not offer, in months', () => {
    const choices = tenureEditChoices(OPTIONS, '12');
    expect(choices[0]).toEqual({ value: '12', label: '12 months' });
    expect(choices.slice(1).map((opt) => opt.value)).toEqual(OPTIONS.map((opt) => String(opt.value)));
    expect(tenureEditChoices(OPTIONS, '1')[0]).toEqual({ value: '1', label: '1 month' });
  });
});

describe('parseTenureMonths', () => {
  it('reads whole months from a number or a digit string', () => {
    expect(parseTenureMonths(18)).toBe(18);
    expect(parseTenureMonths('36')).toBe(36);
    expect(parseTenureMonths(' 12 ')).toBe(12);
  });

  it('reads a blank or missing tenure as null', () => {
    expect(parseTenureMonths('')).toBeNull();
    expect(parseTenureMonths(null)).toBeNull();
    expect(parseTenureMonths(undefined)).toBeNull();
  });

  it('reads anything that is not a positive whole number of months as null', () => {
    expect(parseTenureMonths(0)).toBeNull();
    expect(parseTenureMonths(-6)).toBeNull();
    expect(parseTenureMonths(1.5)).toBeNull();
    expect(parseTenureMonths('abc')).toBeNull();
    expect(parseTenureMonths('18 months')).toBeNull();
    expect(parseTenureMonths({})).toBeNull();
  });
});
