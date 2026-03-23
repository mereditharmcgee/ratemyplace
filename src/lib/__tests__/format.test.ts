import { describe, it, expect } from 'vitest';
import { humanize } from '../format';

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
