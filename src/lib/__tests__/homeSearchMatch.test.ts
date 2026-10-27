import { beforeEach, describe, expect, it } from 'vitest';
import { localityAgrees, matchPredictionsToBuildings } from '../homeSearchMatch';
import { addressKey } from '../records/identity';
import type { AutocompletePrediction } from '../places';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

// The homepage's Google suggestions, matched read-only to building pages we already have,
// through the same resolver the review handoff uses.

function prediction(mainText: string, secondaryText: string, placeId: string): AutocompletePrediction {
  return { placeId, description: `${mainText}, ${secondaryText}`, mainText, secondaryText };
}

describe('localityAgrees', () => {
  it('agrees when either side names only Boston, or nothing', () => {
    expect(localityAgrees('Boston', { neighborhood: 'Dorchester', city: 'Boston' })).toBe(true);
    expect(localityAgrees('Brighton', { neighborhood: null, city: 'Boston' })).toBe(true);
    expect(localityAgrees('Brighton', { neighborhood: 'Odd Label', city: 'Boston' })).toBe(true);
  });

  it('agrees on the same neighborhood, a sub-area of it, and across Allston and Brighton', () => {
    expect(localityAgrees('Brighton', { neighborhood: 'Brighton', city: 'Boston' })).toBe(true);
    expect(localityAgrees('Dorchester Center', { neighborhood: 'Dorchester', city: 'Boston' })).toBe(true);
    expect(localityAgrees('Allston', { neighborhood: 'Brighton', city: 'Boston' })).toBe(true);
    expect(localityAgrees('Brighton', { neighborhood: null, city: 'Allston' })).toBe(true);
  });

  it('disagrees when both name different neighborhoods', () => {
    expect(localityAgrees('Brighton', { neighborhood: 'Dorchester', city: 'Boston' })).toBe(false);
    expect(localityAgrees('Roxbury', { neighborhood: null, city: 'Jamaica Plain' })).toBe(false);
  });
});

const suite = sqliteAvailable ? describe : describe.skip;

suite('matchPredictionsToBuildings', () => {
  let db: TestD1Database;

  beforeEach(async () => {
    db = createRecordsTestDb();
    // A seeded single parcel and a seeded range parcel, both in Brighton.
    await insertBuilding(db, {
      id: 'seed-0000000001',
      address: '12 Example Road',
      slug: '12-example-road-boston',
      neighborhood: 'Brighton',
      city: 'Boston',
      zip_code: '02135',
      source: 'seed',
      street_key: addressKey('12 Example Road')!.streetKey,
      st_num_lo: 12,
      st_num_hi: 12,
    });
    await insertBuilding(db, {
      id: 'seed-0000000002',
      address: '20-24 Sample Street',
      slug: '20-24-sample-street-boston',
      neighborhood: 'Brighton',
      city: 'Boston',
      zip_code: '02135',
      source: 'seed',
      street_key: addressKey('20 Sample Street')!.streetKey,
      st_num_lo: 20,
      st_num_hi: 24,
    });
    // A user row elsewhere, found only by its Google place id.
    await insertBuilding(db, {
      id: 'user-1',
      address: '5 Elsewhere Ave',
      slug: '5-elsewhere-ave-springfield',
      neighborhood: null,
      city: 'Springfield',
      state: 'MA',
      zip_code: '01103',
      google_place_id: 'gp-known',
    });
    await db
      .prepare(
        "INSERT INTO reviews (id, building_id, status, overall_score, move_out_year_new) VALUES ('r1', 'seed-0000000001', 'approved', 4.0, NULL), ('r2', 'seed-0000000001', 'pending', 1.0, NULL)",
      )
      .run();
  });

  it('matches by address key and carries our address, place line and approved reviews', async () => {
    const [match] = await matchPredictionsToBuildings(db, [prediction('12 Example Road', 'Brighton, MA, USA', 'gp-a')]);
    expect(match.existing).toEqual({
      slug: '12-example-road-boston',
      title: '12 Example Road',
      subtitle: 'Brighton, Boston, MA',
      reviewCount: 1,
      avgScore: 4,
    });
  });

  it('matches a number inside a range parcel to that parcel', async () => {
    const [match] = await matchPredictionsToBuildings(db, [prediction('22 Sample St', 'Boston, MA, USA', 'gp-b')]);
    expect(match.existing?.slug).toBe('20-24-sample-street-boston');
    expect(match.existing?.title).toBe('20-24 Sample Street');
  });

  it('matches by exact place id, outside Boston too', async () => {
    const [match] = await matchPredictionsToBuildings(db, [prediction('5 Elsewhere Avenue', 'Springfield, MA, USA', 'gp-known')]);
    expect(match.existing?.slug).toBe('5-elsewhere-ave-springfield');
  });

  it('matches a suggestion from another state by its exact place id', async () => {
    await insertBuilding(db, {
      id: 'user-ct',
      address: '40 Sample Street',
      slug: '40-sample-street-elsewhere',
      neighborhood: null,
      city: 'Elsewhere',
      state: 'CT',
      zip_code: '06500',
      google_place_id: 'gp-ct',
    });
    const [match] = await matchPredictionsToBuildings(db, [prediction('40 Sample Street', 'Elsewhere, CT, USA', 'gp-ct')]);
    expect(match.existing).toEqual({
      slug: '40-sample-street-elsewhere',
      title: '40 Sample Street',
      subtitle: 'Elsewhere, CT',
      reviewCount: 0,
      avgScore: null,
    });
  });

  it('never matches a suggestion from another state by address, even on a Boston neighborhood name', async () => {
    // "Brighton, MI" and "Hyde Park, NY" are towns; our Boston building on the same street and
    // number is not theirs. Unreadable states get the same rule.
    const result = await matchPredictionsToBuildings(db, [
      prediction('12 Example Road', 'Brighton, MI, USA', 'gp-mi'),
      prediction('12 Example Road', 'Hyde Park, NY, USA', 'gp-ny'),
      prediction('22 Sample St', 'Brighton', 'gp-nostate'),
    ]);
    expect(result.map((p) => p.existing)).toEqual([null, null, null]);
  });

  it('refuses an address match when Google names a different neighborhood', async () => {
    const [match] = await matchPredictionsToBuildings(db, [prediction('12 Example Road', 'Dorchester, MA, USA', 'gp-c')]);
    expect(match.existing).toBeNull();
  });

  it('leaves an address we have no page for, and another town, unmatched', async () => {
    const result = await matchPredictionsToBuildings(db, [
      prediction('99 Example Road', 'Brighton, MA, USA', 'gp-d'),
      prediction('12 Example Road', 'Groveland, MA, USA', 'gp-e'),
    ]);
    expect(result.map((p) => p.existing)).toEqual([null, null]);
    expect(result.map((p) => p.placeId)).toEqual(['gp-d', 'gp-e']);
  });

  it('never writes', async () => {
    const before = await db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM buildings').first();
    await matchPredictionsToBuildings(db, [
      prediction('12 Example Road', 'Brighton, MA, USA', 'gp-a'),
      prediction('99 Example Road', 'Brighton, MA, USA', 'gp-d'),
    ]);
    expect(await db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM buildings').first()).toEqual(before);
  });

  it('runs no display query when nothing matched', async () => {
    const result = await matchPredictionsToBuildings(db, []);
    expect(result).toEqual([]);
  });
});
