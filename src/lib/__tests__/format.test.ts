import { describe, it, expect } from 'vitest';
import { humanize, formatEasternDateTime } from '../format';

describe('humanize', () => {
  it('converts snake_case to Title Case', () => {
    expect(humanize('small_dogs')).toBe('Small Dogs');
    expect(humanize('in_unit')).toBe('In Unit');
    expect(humanize('hot_water')).toBe('Hot Water');
  });

  it('handles single words', () => {
    expect(humanize('heat')).toBe('Heat');
    expect(humanize('gym')).toBe('Gym');
  });

  it('handles multiple underscores', () => {
    expect(humanize('air_conditioning_central')).toBe('Air Conditioning Central');
  });

  it('handles already capitalized words', () => {
    expect(humanize('Bike_Storage')).toBe('Bike Storage');
  });

  it('handles empty string', () => {
    expect(humanize('')).toBe('');
  });

  it('handles strings with no underscores', () => {
    expect(humanize('dishwasher')).toBe('Dishwasher');
  });
});

describe('formatEasternDateTime', () => {
  it('renders an EDT evening in Boston time with an ET suffix', () => {
    // 2026-07-18T01:30Z is the evening before in Boston.
    expect(formatEasternDateTime(1784338200)).toBe('Jul 17, 2026, 9:30 PM ET');
  });

  it('renders an EST afternoon', () => {
    // 2026-01-15T17:05Z
    expect(formatEasternDateTime(1768496700)).toBe('Jan 15, 2026, 12:05 PM ET');
  });

  it('says so instead of rendering Invalid Date for a non-finite input', () => {
    expect(formatEasternDateTime(Number.NaN)).toBe('Time not recorded');
    expect(formatEasternDateTime(Number.POSITIVE_INFINITY)).toBe('Time not recorded');
  });

  it('is plain printable ASCII, so it is safe in a subject line (no U+202F or U+00A0)', () => {
    for (const t of [1784338200, 1768496700]) {
      expect(formatEasternDateTime(t)).toMatch(/^[ -~]+$/);
    }
  });
});
