import { describe, expect, it } from 'vitest';
import { buildingPageMeta } from '../buildingMeta';

describe('buildingPageMeta', () => {
  const seeded = { address: '23-27 Lanark Road', city: 'Boston', neighborhood: 'Aberdeen', parcel_id: '2102396000' };

  it('describes a seeded page by its city records when no review exists', () => {
    expect(buildingPageMeta(seeded, 0)).toEqual({
      title: '23-27 Lanark Road, Boston',
      description:
        'City of Boston records for 23-27 Lanark Road: assessment, permits, violations, code enforcement, and 311 requests. No tenant reviews yet.',
    });
  });

  it('switches to review metadata once a review exists', () => {
    expect(buildingPageMeta(seeded, 1)).toEqual({
      title: '23-27 Lanark Road',
      description: 'Reviews for 23-27 Lanark Road in Aberdeen',
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
  });

  it('reads the city the way the rest of the records code does', () => {
    // Eligibility is jurisdictionForCity, not a strict equality on 'Boston', so a row whose
    // city was written in another case is still a records page.
    expect(buildingPageMeta({ ...seeded, city: 'boston' }, 0).title).toBe('23-27 Lanark Road, Boston');
    expect(buildingPageMeta({ ...seeded, city: 'Boston, MA' }, 0).title).toBe('23-27 Lanark Road, Boston');
  });
});
