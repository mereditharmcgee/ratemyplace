import { describe, expect, it } from 'vitest';
import { BOSTON_SUB_AREAS } from '../bostonLocalities';
import { displayLocality, localityLine, resolveBostonSubArea } from '../locality';

describe('resolveBostonSubArea', () => {
  it('maps a sub-area to its neighborhood, ignoring case and spacing', () => {
    expect(resolveBostonSubArea('Aberdeen')).toBe('Brighton');
    expect(resolveBostonSubArea('KENMORE')).toBe('Fenway');
    expect(resolveBostonSubArea(' bay village ')).toBe('South End');
  });

  it('returns anything else trimmed but otherwise unchanged', () => {
    expect(resolveBostonSubArea('Brighton')).toBe('Brighton');
    expect(resolveBostonSubArea(' East Rock ')).toBe('East Rock');
  });

  it('only ever points at a neighborhood display already trusts', () => {
    for (const target of Object.values(BOSTON_SUB_AREAS)) {
      expect(displayLocality({ address: `1 ${target} St`, neighborhood: target, city: 'Boston' })).toBe(target);
    }
  });
});

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

  it('trusts a known neighborhood even when it is also a street word', () => {
    expect(
      displayLocality({ address: '100 Roxbury St', neighborhood: 'Roxbury', city: 'Boston' })
    ).toBe('Roxbury');
    expect(
      displayLocality({ address: '1234 Dorchester Ave', neighborhood: 'Dorchester', city: 'Boston' })
    ).toBe('Dorchester');
  });

  it('still falls back to city for an unlisted street-name neighborhood', () => {
    expect(
      displayLocality({ address: '84 East Newton Street', neighborhood: 'Newton', city: 'Boston' })
    ).toBe('Boston');
  });

  it('strips punctuation attached to an address word before matching', () => {
    expect(
      displayLocality({ address: '1027 Commonwealth, Boston', neighborhood: 'Commonwealth', city: 'Boston' })
    ).toBe('Boston');
  });

  it('reads a Google sub-area as the Boston neighborhood it sits in', () => {
    // Production: 27 Lanark Road came back from Google Places as "Aberdeen"; every seeded
    // Lanark Road row says "Brighton".
    expect(displayLocality({ address: '27 Lanark Road', neighborhood: 'Aberdeen', city: 'Boston' })).toBe('Brighton');
    expect(displayLocality({ address: '27 Lanark Road', neighborhood: '  aberdeen ', city: 'Boston' })).toBe('Brighton');
    expect(displayLocality({ address: '1 Main St', neighborhood: 'Fort Point', city: 'Boston' })).toBe('Seaport');
    expect(displayLocality({ address: '1 Main St', neighborhood: 'Savin Hill', city: 'Dorchester' })).toBe('Dorchester');
  });

  it('resolves a sub-area even when it shares a word with the street', () => {
    expect(displayLocality({ address: '5 Cleveland Circle', neighborhood: 'Cleveland Circle', city: 'Boston' })).toBe(
      'Brighton'
    );
  });

  it('leaves a sub-area name alone outside Boston', () => {
    // Fairmount is a Philadelphia neighborhood too; the alias is a Boston fact.
    expect(displayLocality({ address: '1 Main St', neighborhood: 'Fairmount', city: 'Philadelphia' })).toBe('Fairmount');
  });

  it('passes an unknown neighborhood through unchanged', () => {
    expect(displayLocality({ address: '1 Elm St', neighborhood: 'Wooster Square', city: 'New Haven' })).toBe(
      'Wooster Square'
    );
    expect(displayLocality({ address: '1 Main St', neighborhood: 'Somewhere New', city: 'Boston' })).toBe('Somewhere New');
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

  it('names the Boston neighborhood for a Google sub-area', () => {
    expect(localityLine({ address: '27 Lanark Road', neighborhood: 'Aberdeen', city: 'Boston' }, 'MA')).toBe(
      'Brighton, Boston, MA'
    );
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

  it('does not render a bare state when both neighborhood and city are missing', () => {
    expect(localityLine({ address: '1 Main St', neighborhood: null, city: null }, 'MA')).toBe('');
    expect(localityLine({ address: '1 Main St', neighborhood: undefined, city: undefined }, 'MA')).toBe('');
  });
});
