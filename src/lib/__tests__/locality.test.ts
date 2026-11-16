import { describe, expect, it } from 'vitest';
import { BOSTON_LOCALITY_NAMES, BOSTON_SUB_AREAS, BOSTON_ZIP_NEIGHBORHOODS } from '../bostonLocalities';
import { bostonLocalityName, bostonNeighborhoodFor, displayLocality, isBostonLocality, isBostonPlace, localityLine, resolveBostonSubArea } from '../locality';

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
    // Production: a Brighton building came back from Google Places as "Aberdeen"; every
    // seeded row on the same street says "Brighton".
    expect(displayLocality({ address: '68 Tarnwick Place', neighborhood: 'Aberdeen', city: 'Boston' })).toBe('Brighton');
    expect(displayLocality({ address: '68 Tarnwick Place', neighborhood: '  aberdeen ', city: 'Boston' })).toBe('Brighton');
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
    expect(localityLine({ address: '68 Tarnwick Place', neighborhood: 'Aberdeen', city: 'Boston' }, 'MA')).toBe(
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

describe('bostonLocalityName', () => {
  it.each([
    ['east boston', 'East Boston'],
    ['EAST BOSTON', 'East Boston'],
    [' Hyde Park ', 'Hyde Park'],
    ['hyde-park', 'Hyde Park'],
    ['Boston, MA', 'Boston'],
  ])('gives %j the display spelling %j', (input, expected) => {
    expect(bostonLocalityName(input)).toBe(expected);
  });

  it.each(['Brookline', 'Newton', 'Chestnut Hill', "St. Elizabeth's"])('gives null for the non-locality %j', (input) => {
    expect(bostonLocalityName(input)).toBeNull();
  });

  it('gives null for a sub-area, which is not a locality name', () => {
    expect(bostonLocalityName('Aberdeen')).toBeNull();
  });

  it('gives null for blank and missing values', () => {
    expect(bostonLocalityName('')).toBeNull();
    expect(bostonLocalityName(null)).toBeNull();
    expect(bostonLocalityName(undefined)).toBeNull();
  });

  it('round-trips every name in the vocabulary', () => {
    for (const name of BOSTON_LOCALITY_NAMES) expect(bostonLocalityName(name)).toBe(name);
  });

  it.each(['Boston', 'boston, ma', 'Roxbury', 'Readville', 'Brookline', 'Chestnut Hill', '', "St. Elizabeth's", 'South End'])(
    'agrees with isBostonLocality on %j',
    (value) => {
      expect(bostonLocalityName(value) !== null).toBe(isBostonLocality(value));
    },
  );
});

describe('isBostonPlace', () => {
  it.each([
    ['Boston', 'MA'],
    ['Brighton', 'MA'],
    ['Hyde Park', 'ma'],
    ['Boston', 'Massachusetts'],
    ['Allston', null],
    ['Boston', ''],
    ['Boston, MA', undefined],
  ])('reads %j in %j as Boston', (city, state) => {
    expect(isBostonPlace(city, state)).toBe(true);
  });

  it.each([
    ['Brighton', 'NY'],
    ['Hyde Park', 'NY'],
    ['Charlestown', 'RI'],
    ['Roxbury', 'CT'],
    ['Cambridge', 'MA'],
    ['', 'MA'],
    [null, 'MA'],
  ])('does not read %j in %j as Boston', (city, state) => {
    expect(isBostonPlace(city, state)).toBe(false);
  });
});

describe('bostonNeighborhoodFor', () => {
  const at = (neighborhood: string | null | undefined, zip: string | null | undefined, city = 'Boston') =>
    bostonNeighborhoodFor({ neighborhood, city, zip });

  // The city's own neighborhood for a new Boston building. Google's "Commonwealth" covers
  // addresses in two neighborhoods, so it is the ZIP that places it.
  it.each([
    ['Commonwealth', '02135', 'Brighton'],
    ['Commonwealth', '02134', 'Allston'],
    ["St. Elizabeth's", '02135', 'Brighton'],
    ['Chestnut Hill', '02135', 'Brighton'],
  ])('reads the name %j it does not know in ZIP %s as %j', (value, zip, expected) => {
    expect(at(value, zip)).toBe(expected);
  });

  it('keeps a Boston locality name in its display spelling, whatever the ZIP says', () => {
    expect(at('jamaica plain', '02135')).toBe('Jamaica Plain');
    expect(at(' Back Bay ', '02116')).toBe('Back Bay');
    expect(at('Mission Hill', null)).toBe('Mission Hill');
    expect(at('Allston', '02135', 'Brighton')).toBe('Allston');
  });

  it('reads a sub-area as its neighborhood before the ZIP is consulted', () => {
    expect(at('Aberdeen', '02134')).toBe('Brighton');
    expect(at('Savin Hill', null)).toBe('Dorchester');
  });

  it('takes the ZIP for a blank name or plain Boston when the city is Boston', () => {
    expect(at(null, '02128')).toBe('East Boston');
    expect(at('', '02127')).toBe('South Boston');
    expect(at('  ', '02129')).toBe('Charlestown');
    expect(at('Boston', '02130')).toBe('Jamaica Plain');
    expect(at('Commonwealth', '02135', 'Boston, MA')).toBe('Brighton');
  });

  // A city typed or geocoded as a neighborhood already places the building; the ZIP's name
  // beside it would read "Brighton, Allston".
  it.each([
    ['Allston', '02135'],
    ['Brighton', '02134'],
    ['Roxbury', '02121'],
    ['Mattapan', '02124'],
    ['Dorchester Center', '02124'],
  ])('stores nothing for an unknown name when the city %j is itself a neighborhood (ZIP %s)', (city, zip) => {
    expect(at(null, zip, city)).toBeNull();
    expect(at('Commonwealth', zip, city)).toBeNull();
    expect(localityLine({ address: '1 Example Road', neighborhood: at(null, zip, city), city }, 'MA')).toBe(`${city}, MA`);
  });

  it('gives null, which reads as Boston, when the ZIP is not one neighborhood', () => {
    expect(at('Commonwealth', '02116')).toBeNull();
    expect(at('Commonwealth', '02118')).toBeNull();
    expect(at('Commonwealth', '02132')).toBeNull();
    expect(at('Commonwealth', '02136')).toBeNull();
    expect(at('Commonwealth', null)).toBeNull();
    expect(at('Boston', undefined)).toBeNull();
    expect(at(undefined, '')).toBeNull();
  });

  it('finds nothing for a key that is an Object method name', () => {
    expect(at('Commonwealth', 'constructor')).toBeNull();
    expect(at('Commonwealth', '__proto__')).toBeNull();
  });

  it('lists only five-digit ZIPs, each mapped to a Boston neighborhood display trusts', () => {
    expect(Object.keys(BOSTON_ZIP_NEIGHBORHOODS).length).toBeGreaterThan(0);
    for (const [zip, neighborhood] of Object.entries(BOSTON_ZIP_NEIGHBORHOODS)) {
      expect(zip).toMatch(/^\d{5}$/);
      expect(BOSTON_LOCALITY_NAMES).toContain(neighborhood);
      expect(neighborhood).not.toBe('Boston');
      expect(displayLocality({ address: '1 Example Road', neighborhood, city: 'Boston' })).toBe(neighborhood);
    }
  });
});
