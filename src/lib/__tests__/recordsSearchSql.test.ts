import { describe, expect, it } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { BUILDING_SEARCH_ORDER, buildingSearchSelect, buildingSearchWhere } from '../searchSql';

const suite = sqliteAvailable ? describe : describe.skip;
const YEAR = 2026;

async function review(db: TestD1Database, buildingId: string, score: number, id = `${buildingId}-r${score}`): Promise<void> {
  await db
    .prepare("INSERT INTO reviews (id, building_id, status, created_at, overall_score) VALUES (?, ?, 'approved', 1750000000, ?)")
    .bind(id, buildingId, score)
    .run();
}

async function search(db: TestD1Database, query: string): Promise<Array<{ slug: string; review_count: number; has_records: number }>> {
  const where = buildingSearchWhere(query);
  const sql = `SELECT ${buildingSearchSelect('r', YEAR)}
    FROM buildings b
    LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
    LEFT JOIN landlords l ON b.landlord_id = l.id
    WHERE ${where.sql}
    GROUP BY b.id
    ${BUILDING_SEARCH_ORDER}
    LIMIT 50`;
  const { results } = await db.prepare(sql).bind(...where.binds).all<{ slug: string; review_count: number; has_records: number }>();
  return results;
}

suite('building search SQL', () => {
  it('expands suffix abbreviations and ANDs terms', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', address: '1027 Commonwealth Avenue', parcel_id: '1', source: 'seed' });
    await insertBuilding(db, { id: 'b', address: '1027 Commonwealth Ave', parcel_id: '2', source: 'seed' });
    await insertBuilding(db, { id: 'c', address: '12 Commonwealth Ave', parcel_id: '3', source: 'seed' });
    const slugs = (await search(db, '1027 comm ave')).map((r) => r.slug).sort();
    expect(slugs).toEqual(['a', 'b']);
  });

  it('puts reviewed buildings first in the old order, then the rest by address', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'z', address: '9 Lanark Rd', parcel_id: '1', source: 'seed' });
    await insertBuilding(db, { id: 'y', address: '5 Lanark Rd', parcel_id: '2', source: 'seed' });
    await insertBuilding(db, { id: 'x', address: '7 Lanark Rd', parcel_id: '3' });
    await insertBuilding(db, { id: 'w', address: '3 Lanark Rd', parcel_id: '4' });
    await review(db, 'x', 4);
    await review(db, 'w', 3, 'w-1');
    await review(db, 'w', 5, 'w-2');
    expect((await search(db, 'lanark')).map((r) => r.slug)).toEqual(['w', 'x', 'y', 'z']);
  });

  it('flags city records only for Boston buildings with a parcel', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'p', address: '1 Lanark Rd', parcel_id: '1' });
    await insertBuilding(db, { id: 'q', address: '2 Lanark Rd', parcel_id: null });
    const rows = await search(db, 'lanark');
    expect(rows.find((r) => r.slug === 'p')?.has_records).toBe(1);
    expect(rows.find((r) => r.slug === 'q')?.has_records).toBe(0);
  });

  it('still matches a neighborhood or landlord name with the whole query', async () => {
    const db = createRecordsTestDb();
    await db.prepare("INSERT INTO landlords (id, name, slug) VALUES ('l1', 'Acme Realty', 'acme')").run();
    await insertBuilding(db, { id: 'n', address: '1 Oak St', neighborhood: 'Allston' });
    await db.prepare("UPDATE buildings SET landlord_id = 'l1' WHERE id = 'n'").run();
    expect((await search(db, 'allston')).map((r) => r.slug)).toEqual(['n']);
    expect((await search(db, 'acme realty')).map((r) => r.slug)).toEqual(['n']);
  });

  it('escapes LIKE wildcards in every bind', () => {
    const { binds } = buildingSearchWhere('100% Main_St');
    expect(binds.length).toBeGreaterThan(0);
    for (const bind of binds) {
      expect(bind.startsWith('%') && bind.endsWith('%')).toBe(true);
      const inner = bind.slice(1, -1);
      // every % or _ inside must be preceded by the escape backslash
      expect(inner.replace(/\\[%_\\]/g, '')).not.toMatch(/[%_]/);
    }
  });
});
