import { describe, expect, it } from 'vitest';
import { displayLocality, localityLine } from '../locality';

describe('displayLocality', () => {
  it('falls back to city when the neighborhood is a street-name word from the geocoder', () => {
    expect(
      displayLocality({ address: '1027 Commonwealth Avenue', neighborhood: 'Commonwealth', city: 'Boston' })
    ).toBe('Boston');
  });

  it('is case-insensitive and trims whitespace when matching a street word', () => {
    expect(
      displayLocality({ address: '1027 Commonwealth Avenue', neighborhood: '  commonwealth  ', city: 'Boston' })
    ).toBe('Boston');
  });

  it('matches any whitespace-separated word of the address, not just the first', () => {
    expect(
      displayLocality({ address: '84 East Newton Street', neighborhood: 'Newton', city: 'Boston' })
    ).toBe('Boston');
  });

  it('keeps a normal neighborhood that is not a street word', () => {
    expect(
      displayLocality({ address: '1027 Commonwealth Avenue', neighborhood: 'Allston', city: 'Boston' })
    ).toBe('Allston');
  });

  it('falls back to city when neighborhood is null', () => {
    expect(displayLocality({ address: '1 Main St', neighborhood: null, city: 'Boston' })).toBe('Boston');
  });

  it('falls back to city when neighborhood is empty or whitespace-only', () => {
    expect(displayLocality({ address: '1 Main St', neighborhood: '', city: 'Boston' })).toBe('Boston');
    expect(displayLocality({ address: '1 Main St', neighborhood: '   ', city: 'Boston' })).toBe('Boston');
  });

  it('returns an empty string when both neighborhood and city are missing', () => {
    expect(displayLocality({ address: '1 Main St', neighborhood: null, city: null })).toBe('');
    expect(displayLocality({ address: '1 Main St', neighborhood: undefined, city: undefined })).toBe('');
  });

  it('handles a missing address gracefully (no street words to match)', () => {
    expect(displayLocality({ address: null, neighborhood: 'Allston', city: 'Boston' })).toBe('Allston');
  });
});

describe('localityLine', () => {
  it('joins locality, city (when different), and state', () => {
    expect(
      localityLine({ address: '1 Main St', neighborhood: 'Allston', city: 'Boston' }, 'MA')
    ).toBe('Allston, Boston, MA');
  });

  it('skips the city when it duplicates the locality (no neighborhood case)', () => {
    expect(
      localityLine({ address: '1027 Commonwealth Avenue', neighborhood: 'Commonwealth', city: 'Boston' }, 'MA')
    ).toBe('Boston, MA');
  });

  it('works without a state', () => {
    expect(
      localityLine({ address: '1 Main St', neighborhood: 'Allston', city: 'Boston' })
    ).toBe('Allston, Boston');
  });

  it('skips blanks entirely when neighborhood, city, and state are all missing', () => {
    expect(localityLine({ address: '1 Main St', neighborhood: null, city: null })).toBe('');
  });

  it('handles a city-only building with a state', () => {
    expect(localityLine({ address: '1 Main St', neighborhood: null, city: 'Boston' }, 'MA')).toBe('Boston, MA');
  });
});
