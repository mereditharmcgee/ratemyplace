import { describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { buildingSearchOrder, buildingSearchSelect, buildingSearchWhere } from '../searchSql';
import { isAreaSearch, parseSearchQuery } from '../searchQuery';

/**
 * Search takes an address the way people type it: with the neighborhood, "Boston", "MA" and
 * the ZIP on the end. Those never appear in the stored street line, so they are taken out of
 * the match and used to rank instead. The query shape below is the one both call sites run
 * (`search.astro` first page, `api/search/results.ts` Load more); `recordsSearchParity.test.ts`
 * checks they both build it from `searchSql.ts`.
 */
const suite = sqliteAvailable ? describe : describe.skip;
const YEAR = 2026;

/** D1 refuses a statement with more than 100 bound parameters. */
const D1_MAX_PARAMETERS = 100;

async function review(db: TestD1Database, buildingId: string, id = `${buildingId}-r`): Promise<void> {
  await db
    .prepare("INSERT INTO reviews (id, building_id, status, created_at, overall_score) VALUES (?, ?, 'approved', 1750000000, 3.5)")
    .bind(id, buildingId)
    .run();
}

async function search(db: TestD1Database, query: string, limit = 50, offset = 0): Promise<string[]> {
  const where = buildingSearchWhere(query);
  const order = buildingSearchOrder(query);
  const sql = `SELECT ${buildingSearchSelect(YEAR)}
    FROM buildings b
    LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
    LEFT JOIN landlords l ON b.landlord_id = l.id
    WHERE ${where.sql}
    GROUP BY b.id
    ${order.sql}
    LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(...where.binds, ...order.binds, limit, offset).all<{ slug: string }>();
  return results.map((row) => row.slug);
}

async function count(db: TestD1Database, query: string): Promise<number> {
  const where = buildingSearchWhere(query);
  const row = await db
    .prepare(`SELECT COUNT(*) AS total FROM buildings b LEFT JOIN landlords l ON b.landlord_id = l.id WHERE ${where.sql}`)
    .bind(...where.binds)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

interface Seeded {
  id: string;
  address: string;
  neighborhood?: string | null;
  zip?: string;
  lo?: number;
  hi?: number;
  city?: string;
}

/** A seeded parcel: number columns filled, as the bulk seed writes them. */
async function seeded(db: TestD1Database, row: Seeded): Promise<void> {
  await insertBuilding(db, {
    id: row.id,
    address: row.address,
    neighborhood: row.neighborhood ?? null,
    zip_code: row.zip ?? '02135',
    city: row.city ?? 'Boston',
    source: 'seed',
    parcel_id: `p-${row.id}`,
    st_num_lo: row.lo ?? null,
    st_num_hi: row.hi ?? row.lo ?? null,
  });
}

/** A reviewer-created row: no number columns, so the number is read off the address. */
async function userRow(db: TestD1Database, row: Seeded): Promise<void> {
  await insertBuilding(db, {
    id: row.id,
    address: row.address,
    neighborhood: row.neighborhood ?? null,
    zip_code: row.zip ?? '02135',
    city: row.city ?? 'Boston',
    source: 'user',
  });
}

suite('search by full address', () => {
  it('finds the building when the neighborhood, state and ZIP are typed after the street', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'wood', address: '12 Wood Street', neighborhood: 'Allston', zip: '02134', lo: 12 });
    await seeded(db, { id: 'other', address: '30 Wood Street', neighborhood: 'Allston', zip: '02134', lo: 30 });
    for (const query of [
      '12 Wood St, Allston, MA 02134',
      '12 Wood Street, Allston',
      '12 Wood St Allston',
      '12 Wood St Boston MA',
      '12 Wood St, Boston, Massachusetts 02134-1234',
      '12 Wood St Apt 3, Allston',
    ]) {
      expect((await search(db, query))[0], query).toBe('wood');
    }
  });

  it('puts the exact address before a street that only contains the typed word', async () => {
    // 'wood' is a substring of 'Norwood', which is how a typed street found the wrong one first.
    const db = createRecordsTestDb();
    await seeded(db, { id: 'norwood', address: '12 Norwood Street', neighborhood: 'Dorchester', zip: '02124', lo: 12 });
    await seeded(db, { id: 'wood', address: '12 Wood Street', neighborhood: 'Allston', zip: '02134', lo: 12 });
    expect(await search(db, '12 Wood St')).toEqual(['wood', 'norwood']);
    // Substring matching stays: a partial street still finds both.
    expect((await search(db, '12 wo')).sort()).toEqual(['norwood', 'wood']);
  });

  it('ranks the exact address above reviewed buildings, and only that tier', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'exact', address: '12 Wood Street', lo: 12 });
    await userRow(db, { id: 'reviewed-near', address: '12 Norwood Street' });
    await review(db, 'reviewed-near');
    await seeded(db, { id: 'seeded-near', address: '12 Lockwood Street', lo: 12 });
    expect(await search(db, '12 Wood St')).toEqual(['exact', 'reviewed-near', 'seeded-near']);
  });

  it('keeps reviewed buildings above unreviewed ones when no exact address was typed', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'seeded', address: '4 Wood Street', lo: 4 });
    await userRow(db, { id: 'reviewed', address: '9 Norwood Street' });
    await review(db, 'reviewed');
    await seeded(db, { id: 'seeded-near', address: '2 Norwood Street', lo: 2 });
    // Whole-word "Wood St" leads its group, but the reviewed building still leads the list.
    expect(await search(db, 'Wood St')).toEqual(['reviewed', 'seeded', 'seeded-near']);
  });

  it('uses the typed neighborhood or ZIP to choose between two buildings at the same address', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'brighton', address: '45 Twin Street', neighborhood: 'Brighton', zip: '02135', lo: 45 });
    await seeded(db, { id: 'dorchester', address: '45 Twin Street', neighborhood: 'Dorchester', zip: '02124', lo: 45 });
    expect((await search(db, '45 Twin St Dorchester'))[0]).toBe('dorchester');
    expect((await search(db, '45 Twin St, Brighton'))[0]).toBe('brighton');
    expect((await search(db, '45 Twin St 02124'))[0]).toBe('dorchester');
    // The place ranks; it never filters. Both buildings are still listed.
    expect(await count(db, '45 Twin St Dorchester')).toBe(2);
  });

  it('a typed neighborhood outranks a review inside the exact tier', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'typed', address: '45 Twin Street', neighborhood: 'Brighton', lo: 45 });
    await userRow(db, { id: 'reviewed', address: '45 Twin Street', neighborhood: 'Dorchester', zip: '02124' });
    await review(db, 'reviewed');
    expect(await search(db, '45 Twin St Brighton')).toEqual(['typed', 'reviewed']);
  });

  it('matches a house number as a whole number or inside a range, on the right side of the street', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'sixteen', address: '16 Example Road', lo: 16 });
    await seeded(db, { id: 'range', address: '14-18 Example Road', lo: 14, hi: 18 });
    await seeded(db, { id: 'hundred', address: '116-118 Example Road', lo: 116, hi: 118 });
    await seeded(db, { id: 'both-sides', address: '13-16 Example Road', lo: 13, hi: 16 });
    // A reviewer-created range with no number columns: read off the address.
    await userRow(db, { id: 'user-range', address: '10-20 Example Road' });
    await userRow(db, { id: 'user-plain', address: '160 Example Road' });

    expect((await search(db, '16 Example Rd')).sort()).toEqual(['both-sides', 'range', 'sixteen', 'user-range']);
    // 15 is across the street from 14-18 and 10-20, but inside the mixed-parity 13-16.
    expect(await search(db, '15 Example Rd')).toEqual(['both-sides']);
    expect(await search(db, '117 Example Rd')).toEqual([]);
    expect(await search(db, '116 Example Rd')).toEqual(['hundred']);
    // A typed range must sit inside the building's range.
    expect((await search(db, '14-18 Example Rd')).sort()).toEqual(['range', 'user-range']);
  });

  it('sorts house numbers as numbers, not text', async () => {
    const db = createRecordsTestDb();
    for (const n of [1008, 103, 100, 98, 2]) {
      await seeded(db, { id: `n${n}`, address: `${n} Example Avenue`, lo: n });
    }
    await userRow(db, { id: 'u1027', address: '1027 Example Avenue' });
    expect(await search(db, 'Example Ave')).toEqual(['n2', 'n98', 'n100', 'n103', 'n1008', 'u1027']);
  });

  it('keeps a neighborhood name that is part of a street name', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'ave', address: '40 Brighton Avenue', neighborhood: 'Allston', zip: '02134', lo: 40 });
    await seeded(db, { id: 'nbhd', address: '7 Sample Street', neighborhood: 'Brighton', lo: 7 });
    await seeded(db, { id: 'allston-st', address: '9 Allston Street', neighborhood: 'Dorchester', zip: '02124', lo: 9 });
    await seeded(db, { id: 'boston-st', address: '5 Boston Street', neighborhood: 'Dorchester', zip: '02125', lo: 5 });
    await seeded(db, { id: 'hp-ave', address: '300 Hyde Park Avenue', neighborhood: 'Roslindale', zip: '02131', lo: 300 });
    expect(await search(db, 'Brighton Ave')).toEqual(['ave']);
    expect(await search(db, 'Brighton Ave, Allston')).toEqual(['ave']);
    expect(await search(db, 'Allston St')).toEqual(['allston-st']);
    expect(await search(db, 'Boston St')).toEqual(['boston-st']);
    expect(await search(db, '300 Hyde Park Ave')).toEqual(['hp-ave']);
  });

  it('a street plus a neighborhood lists that street, the neighborhood first', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'allston', address: '100 Example Avenue', neighborhood: 'Allston', zip: '02134', lo: 100 });
    await seeded(db, { id: 'brighton', address: '1900 Example Avenue', neighborhood: 'Brighton', lo: 1900 });
    await seeded(db, { id: 'elsewhere', address: '5 Sample Street', neighborhood: 'Brighton', lo: 5 });
    expect(await search(db, 'Example Avenue Brighton')).toEqual(['brighton', 'allston']);
  });
});

suite('search by neighborhood or ZIP alone', () => {
  it('lists the neighborhood first, then streets that carry its name', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'street', address: '88 Allston Street', neighborhood: 'Dorchester', zip: '02124', lo: 88 });
    await seeded(db, { id: 'in-a', address: '20 Sample Road', neighborhood: 'Allston', zip: '02134', lo: 20 });
    await seeded(db, { id: 'in-b', address: '8 Example Road', neighborhood: 'Allston', zip: '02134', lo: 8 });
    await seeded(db, { id: 'away', address: '3 Sample Road', neighborhood: 'Roxbury', zip: '02119', lo: 3 });
    expect(await search(db, 'Allston')).toEqual(['in-b', 'in-a', 'street']);
    expect(await search(db, 'allston, ma')).toEqual(['in-b', 'in-a', 'street']);
  });

  it('keeps reviewed buildings first in an area search', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'seeded', address: '20 Sample Road', neighborhood: 'Brighton', lo: 20 });
    await userRow(db, { id: 'reviewed', address: '30 Sample Road', neighborhood: 'Brighton' });
    await review(db, 'reviewed');
    expect(await search(db, 'Brighton')).toEqual(['reviewed', 'seeded']);
  });

  it('finds buildings by ZIP, with no neighborhood on file', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'zip', address: '20 Sample Road', neighborhood: null, zip: '02135', lo: 20 });
    await seeded(db, { id: 'other', address: '21 Sample Road', neighborhood: null, zip: '02134', lo: 21 });
    expect(await search(db, '02135')).toEqual(['zip']);
    expect(await search(db, '02135-0001')).toEqual(['zip']);
    expect(await search(db, 'MA 02135')).toEqual(['zip']);
  });

  it('a multiword neighborhood is one place', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'jp', address: '20 Sample Road', neighborhood: 'Jamaica Plain', zip: '02130', lo: 20 });
    await seeded(db, { id: 'hp', address: '21 Sample Road', neighborhood: 'Hyde Park', zip: '02136', lo: 21 });
    expect(await search(db, 'Jamaica Plain')).toEqual(['jp']);
    expect(await search(db, 'hyde park')).toEqual(['hp']);
  });

  it('a postal name finds the neighborhood it sits in', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'dot', address: '20 Sample Road', neighborhood: 'Dorchester', zip: '02124', lo: 20 });
    expect(await search(db, 'Dorchester Center')).toEqual(['dot']);
  });

  it('"Boston" alone lists Boston buildings, not other cities', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'boston', address: '20 Sample Road', neighborhood: 'Brighton', lo: 20 });
    await userRow(db, { id: 'elsewhere', address: '20 Sample Road', city: 'Springfield', zip: '01103' });
    expect(await search(db, 'Boston')).toEqual(['boston']);
    expect(await search(db, 'Boston, MA')).toEqual(['boston']);
  });

  it('an area with nothing on file returns no rows, and reads as an area search', async () => {
    const db = createRecordsTestDb();
    await seeded(db, { id: 'one', address: '20 Sample Road', neighborhood: 'Brighton', zip: '02135', lo: 20 });
    expect(await search(db, '02199')).toEqual([]);
    expect(isAreaSearch(parseSearchQuery('02199'))).toBe(true);
  });
});

suite('search order and paging', () => {
  it('pages through the full order with no repeat or gap', async () => {
    const db = createRecordsTestDb();
    for (let n = 1; n <= 12; n += 1) {
      await seeded(db, { id: `b${n}`, address: `${n * 3} Example Road`, neighborhood: n % 2 ? 'Brighton' : 'Allston', lo: n * 3 });
    }
    await userRow(db, { id: 'r1', address: '7 Example Road', neighborhood: 'Allston' });
    await review(db, 'r1');
    for (const query of ['Example Rd', 'Example Rd Brighton', '6 Example Rd', 'Allston']) {
      const all = await search(db, query, 50, 0);
      const paged: string[] = [];
      for (let offset = 0; offset < all.length; offset += 4) {
        paged.push(...(await search(db, query, 4, offset)));
      }
      expect(paged, query).toEqual(all);
      expect(await count(db, query), query).toBe(all.length);
    }
  });

  it('stays under the D1 parameter limit for the widest query the parser allows', () => {
    // Eight distinct suffix words (the term cap), the longest suffix rows, a range, three
    // places and two ZIPs: the most binds one search can produce.
    const widest = '14-18 te ter terr terrace ave la pw hw Allston Brighton Roxbury Fenway 02134 02135 02136';
    for (const query of [widest, `${widest} apt 2`, 'Allston Brighton Roxbury 02134 02135']) {
      const where = buildingSearchWhere(query);
      const order = buildingSearchOrder(query);
      // + LIMIT and OFFSET
      expect(where.binds.length + order.binds.length + 2, query).toBeLessThanOrEqual(D1_MAX_PARAMETERS);
    }
  });
});
