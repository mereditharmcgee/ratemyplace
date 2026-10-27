import { describe, expect, it } from 'vitest';
import { BOSTON_LOCALITY_NAMES } from '../bostonLocalities';
import { buildingPageMeta } from '../buildingMeta';

describe('buildingPageMeta', () => {
  const seeded = { address: '23-27 Lanark Road', city: 'Boston', neighborhood: 'Aberdeen', parcel_id: '2102396000' };

  it('describes a seeded page by its city records when no review exists', () => {
    // The stored "Aberdeen" is a Google sub-area; the title names the neighborhood it sits in.
    expect(buildingPageMeta(seeded, 0)).toEqual({
      title: '23-27 Lanark Road, Brighton, Boston',
      description:
        'City of Boston records for 23-27 Lanark Road, Brighton: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.',
    });
  });

  it('switches to review metadata once a review exists', () => {
    // The stored "Aberdeen" is a Google sub-area; the description names the neighborhood.
    expect(buildingPageMeta(seeded, 1)).toEqual({
      title: '23-27 Lanark Road',
      description: 'Reviews for 23-27 Lanark Road in Brighton',
    });
  });

  it('keeps review metadata for a building without a parcel or outside Boston', () => {
    expect(buildingPageMeta({ ...seeded, parcel_id: null }, 0).title).toBe('23-27 Lanark Road');
    expect(buildingPageMeta({ address: '1 Elm St', city: 'New Haven', neighborhood: null, parcel_id: '1' }, 0).description).toBe(
      'Reviews for 1 Elm St in New Haven',
    );
  });

  it('does not name the city twice when the address already carries it', () => {
    expect(buildingPageMeta({ address: '12 Elm St, Boston', city: 'Boston', neighborhood: null, parcel_id: '1' }, 0).title).toBe(
      '12 Elm St, Boston',
    );
    expect(
      buildingPageMeta({ address: '12 Elm St, Boston', city: 'Boston', neighborhood: 'Dorchester', parcel_id: '1' }, 0).title,
    ).toBe('12 Elm St, Boston');
  });

  it('reads the city the way the rest of the records code does', () => {
    // Eligibility is jurisdictionForCity, not a strict equality on 'Boston', so a row whose
    // city was written in another case is still a records page.
    expect(buildingPageMeta({ ...seeded, city: 'boston' }, 0).title).toBe('23-27 Lanark Road, Brighton, Boston');
    expect(buildingPageMeta({ ...seeded, city: 'Boston, MA' }, 0).title).toBe('23-27 Lanark Road, Brighton, Boston');
  });

  describe('records-page place names', () => {
    const at = (address: string, neighborhood: string | null, parcel_id = '1') =>
      buildingPageMeta({ address, city: 'Boston', neighborhood, parcel_id }, 0);

    it('lets East Boston and South Boston stand on their own', () => {
      const east = at('6 Prescott Street', 'East Boston', '0100205000');
      expect(east.title).toBe('6 Prescott Street, East Boston');
      expect(east.description.startsWith('City of Boston records for 6 Prescott Street, East Boston:')).toBe(true);
      const south = at('6 Prescott Street', 'South Boston', '0600001000');
      expect(south.title).toBe('6 Prescott Street, South Boston');
      expect(south.description.startsWith('City of Boston records for 6 Prescott Street, South Boston:')).toBe(true);
    });

    it('separates the same address in two neighborhoods (the production collision)', () => {
      const east = at('6 Prescott Street', 'East Boston', '0100205000');
      const hydePark = at('6 Prescott Street', 'Hyde Park', '1809486000');
      expect(hydePark.title).toBe('6 Prescott Street, Hyde Park, Boston');
      expect(hydePark.title).not.toBe(east.title);
    });

    it('falls back to plain Boston with no neighborhood', () => {
      const meta = at('14-16 Derne Street', null, '0300001000');
      expect(meta.title).toBe('14-16 Derne Street, Boston');
      expect(meta.description.startsWith('City of Boston records for 14-16 Derne Street, Boston:')).toBe(true);
    });

    it('ignores a neighborhood that is just a word from the street', () => {
      expect(at('1027 Commonwealth Avenue', 'Commonwealth').title).toBe('1027 Commonwealth Avenue, Boston');
    });

    it('never names a junk or out-of-city value', () => {
      expect(at('1715 Commonwealth Avenue', "St. Elizabeth's").title).toBe('1715 Commonwealth Avenue, Boston');
      for (const place of ['Chestnut Hill', 'Brookline', 'Newton']) {
        expect(at('1 Test Street', place).title).toBe('1 Test Street, Boston');
      }
    });

    it('uses the display spelling of a lowercase stored neighborhood', () => {
      expect(at('1 Test Street', 'east boston').title).toBe('1 Test Street, East Boston');
    });

    it('does not repeat a neighborhood the address already names', () => {
      const south = at('12 Elm St, South Boston', 'South Boston');
      expect(south.title).toBe('12 Elm St, South Boston');
      expect(south.description.match(/South Boston/g)).toHaveLength(1);
      expect(at('12 Elm St, Dorchester', 'Dorchester').title).toBe('12 Elm St, Dorchester, Boston');
    });

    it('gives twin parcels at one address and ZIP the same title and description', () => {
      // By design: two assessor parcels at one address and ZIP are indistinguishable without
      // the parcel id, and the parcel id is kept out of the metadata (owner decision, Oct 2026).
      const a = at('282 Lexington Street', 'East Boston', '0100243000');
      const b = at('282 Lexington Street', 'East Boston', '0100244000');
      expect(a.title).toBe(b.title);
      expect(a.description).toBe(b.description);
    });

    it.each(BOSTON_LOCALITY_NAMES)('names Boston exactly once for the neighborhood %j', (name) => {
      expect(at('1 Test Street', name).title.match(/\bBoston\b/g)).toHaveLength(1);
    });
  });
});
