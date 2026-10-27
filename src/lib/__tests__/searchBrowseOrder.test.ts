import { describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { BOSTON_CITY_SQL, BROWSE_BUILDINGS_ORDER, buildingSearchSelect } from '../searchSql';
import { recencyWeightedOverallSql } from '../scoring-sql';
import { jurisdictionForCity } from '../records/jurisdiction';

/**
 * Browse mode (/search with no query) lists reviewed buildings: Boston first, then
 * everything else, each group by its newest approved review, newest first, with the
 * building id as the last tiebreak so Load more never repeats or skips a row.
 *
 * The FROM, GROUP BY and HAVING below are the shape both call sites use
 * (`src/pages/search.astro` browse branch and the no-query branch of
 * `src/pages/api/search/results.ts`); the ORDER BY is the shared fragment itself.
 * `recordsSearchParity.test.ts` checks that both call sites interpolate that fragment.
 */
const suite = sqliteAvailable ? describe : describe.skip;
const YEAR = 2026;

const BROWSE_FROM = `FROM buildings b
  LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
  LEFT JOIN landlords l ON b.landlord_id = l.id
  GROUP BY b.id
  HAVING COUNT(r.id) > 0`;

/** Midday UTC on a date, in unix seconds. */
function at(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000);
}

async function review(
  db: TestD1Database,
  buildingId: string,
  id: string,
  createdAt: number,
  status: 'approved' | 'pending' | 'rejected' = 'approved',
): Promise<void> {
  await db
    .prepare('INSERT INTO reviews (id, building_id, status, created_at, overall_score) VALUES (?, ?, ?, ?, 3.5)')
    .bind(id, buildingId, status, createdAt)
    .run();
}

async function browsePage(db: TestD1Database, limit: number, offset: number): Promise<string[]> {
  const sql = `SELECT b.slug, b.address, b.neighborhood, b.city, b.state,
      COUNT(r.id) AS review_count,
      ${recencyWeightedOverallSql('r', YEAR)} AS avg_overall,
      l.name AS landlord_name
    ${BROWSE_FROM}
    ${BROWSE_BUILDINGS_ORDER}
    LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(limit, offset).all<{ slug: string }>();
  return results.map((row) => row.slug);
}

async function browseCount(db: TestD1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS total FROM (SELECT b.id ${BROWSE_FROM})`).first<{ total: number }>();
  return row?.total ?? 0;
}

/** Every page of `size` rows, concatenated, the way Load more walks the list. */
async function walk(db: TestD1Database, size: number): Promise<string[]> {
  const all: string[] = [];
  for (let offset = 0; offset < 100; offset += size) {
    const page = await browsePage(db, size, offset);
    if (page.length === 0) break;
    all.push(...page);
  }
  return all;
}

async function seed(db: TestD1Database): Promise<void> {
  // Boston, newest review of the Boston group.
  await insertBuilding(db, { id: 'boston-newest', address: '12 Example Rd', zip_code: '02100', parcel_id: '0100000001' });
  await review(db, 'boston-newest', 'r-bn', at('2026-09-01'));

  // Two Boston buildings whose newest reviews share a second: the id decides.
  await insertBuilding(db, { id: 'boston-tie-b', address: '18 Example Rd', zip_code: '02100', parcel_id: '0100000002' });
  await review(db, 'boston-tie-b', 'r-tb', at('2026-08-01'));
  await insertBuilding(db, { id: 'boston-tie-a', address: '16 Example Rd', zip_code: '02100', parcel_id: '0100000003' });
  await review(db, 'boston-tie-a', 'r-ta', at('2026-08-01'));

  // Boston by city, no parcel id. The order asks "is this Boston", not "does it have records".
  await insertBuilding(db, { id: 'boston-no-parcel', address: '20 Example Rd', zip_code: '02100', city: 'boston' });
  await review(db, 'boston-no-parcel', 'r-np', at('2026-06-01'));

  // Boston with the most reviews, all older. Review count no longer leads the list, and a
  // newer review still waiting for moderation does not count as its newest.
  await insertBuilding(db, { id: 'boston-older', address: '22 Example Rd', zip_code: '02100', parcel_id: '0100000004', city: 'Boston, MA' });
  await review(db, 'boston-older', 'r-bo1', at('2026-03-01'));
  await review(db, 'boston-older', 'r-bo2', at('2026-04-01'));
  await review(db, 'boston-older', 'r-bo3', at('2026-05-01'));
  await review(db, 'boston-older', 'r-bo-pending', at('2026-10-20'), 'pending');

  // Outside Boston. The newest review of all is here, and it still follows every Boston row.
  await insertBuilding(db, { id: 'away-newest', address: '30 Sample St', zip_code: '06500', city: 'Elsewhere', state: 'CT' });
  await review(db, 'away-newest', 'r-an', at('2026-10-01'));
  await insertBuilding(db, { id: 'away-older', address: '32 Sample St', zip_code: '02400', city: 'Nearby Town', state: 'MA' });
  await review(db, 'away-older', 'r-ao', at('2026-07-01'));
  await review(db, 'away-older', 'r-ao-rejected', at('2026-10-25'), 'rejected');
  // No city at all. Its review falls between the other two, so it only lands in the middle if
  // the NULL city sorts with them; without the COALESCE in BROWSE_BUILDINGS_ORDER it sorts last.
  await insertBuilding(db, { id: 'away-no-city', address: '34 Sample St', zip_code: '00000' });
  await db.prepare("UPDATE buildings SET city = NULL WHERE id = 'away-no-city'").run();
  await review(db, 'away-no-city', 'r-nc', at('2026-08-15'));

  // Not listed at all: browse stays reviewed-only.
  await insertBuilding(db, { id: 'boston-pending-only', address: '40 Example Rd', zip_code: '02100', parcel_id: '0100000005' });
  await review(db, 'boston-pending-only', 'r-po', at('2026-10-26'), 'pending');
  await insertBuilding(db, { id: 'boston-unreviewed', address: '42 Example Rd', zip_code: '02100', parcel_id: '0100000006', source: 'seed' });
}

const EXPECTED = [
  'boston-newest',
  'boston-tie-a',
  'boston-tie-b',
  'boston-no-parcel',
  'boston-older',
  'away-newest',
  'away-no-city',
  'away-older',
];

suite('browse order: Boston first, most recently reviewed', () => {
  it('lists Boston newest, Boston older, then everything else newest to oldest', async () => {
    const db = createRecordsTestDb();
    await seed(db);
    expect(await browsePage(db, 50, 0)).toEqual(EXPECTED);
  });

  it('counts only reviewed buildings, the same rows the list shows', async () => {
    const db = createRecordsTestDb();
    await seed(db);
    expect(await browseCount(db)).toBe(EXPECTED.length);
  });

  it.each([1, 2, 3, 5])('pages of %i neither repeat nor skip a row', async (size) => {
    const db = createRecordsTestDb();
    await seed(db);
    const walked = await walk(db, size);
    expect(walked).toEqual(EXPECTED);
    expect(new Set(walked).size).toBe(walked.length);
  });

  // SQLite happens to group by the primary-key index, so the tie above comes out in id order
  // even without the tiebreak; D1 owes no such thing. The last key has to be stated.
  it('ends on the unique building id, so the order is total', () => {
    expect(BROWSE_BUILDINGS_ORDER).toMatch(/,\s*b\.id\s+ASC$/);
  });

  it('returns the same order on every read', async () => {
    const db = createRecordsTestDb();
    await seed(db);
    const first = await browsePage(db, 50, 0);
    for (let i = 0; i < 3; i += 1) {
      expect(await browsePage(db, 50, 0)).toEqual(first);
    }
  });
});

suite('the Boston test is one SQL fragment', () => {
  it('is the city half of has_records and the first key of the browse order', () => {
    expect(buildingSearchSelect(YEAR)).toContain(`COALESCE(b.parcel_id IS NOT NULL AND ${BOSTON_CITY_SQL}, 0) AS has_records`);
    expect(BROWSE_BUILDINGS_ORDER).toContain(BOSTON_CITY_SQL);
  });

  it('agrees with jurisdictionForCity on the city spellings stored today', async () => {
    const db = createRecordsTestDb();
    const cities = ['Boston', 'boston', 'BOSTON', ' Boston ', 'Boston, MA', 'Boston,MA', 'Boston,  MA', 'Boston MA', 'East Boston', 'South Boston', 'Brookline', 'Elsewhere', ''];
    for (const [i, city] of cities.entries()) {
      await insertBuilding(db, { id: `c${i}`, address: `${i + 1} Example Rd`, city });
    }
    await insertBuilding(db, { id: 'cnull', address: '99 Example Rd' });
    await db.prepare("UPDATE buildings SET city = NULL WHERE id = 'cnull'").run();

    const { results } = await db
      .prepare(`SELECT b.id, b.city, COALESCE(${BOSTON_CITY_SQL}, 0) AS is_boston FROM buildings b`)
      .all<{ id: string; city: string | null; is_boston: number }>();
    expect(results).toHaveLength(cities.length + 1);
    for (const row of results) {
      expect(row.is_boston, `city ${JSON.stringify(row.city)}`).toBe(jurisdictionForCity(row.city) === 'boston' ? 1 : 0);
    }
  });
});
