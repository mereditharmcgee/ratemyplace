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
  const sql = `SELECT ${buildingSearchSelect(YEAR)}
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

  it('puts reviewed buildings first (by review count, then score), then the rest by address', async () => {
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
    // The city half of the flag has to agree with `jurisdictionForCity`: case-insensitive,
    // tolerant of a trailing ", MA" at any spacing, and never NULL for a row whose city is NULL.
    await insertBuilding(db, { id: 'lower', address: '3 Lanark Rd', parcel_id: '2', city: 'boston' });
    await insertBuilding(db, { id: 'stated', address: '4 Lanark Rd', parcel_id: '3', city: 'Boston, MA' });
    await insertBuilding(db, { id: 'nospace', address: '7 Lanark Rd', parcel_id: '6', city: 'Boston,MA' });
    await insertBuilding(db, { id: 'twospace', address: '8 Lanark Rd', parcel_id: '7', city: 'Boston,  MA' });
    await insertBuilding(db, { id: 'other', address: '5 Lanark Rd', parcel_id: '4', city: 'Cambridge' });
    // `insertBuilding` types `city` as a string, so null it after the fact.
    await insertBuilding(db, { id: 'nocity', address: '6 Lanark Rd', parcel_id: '5' });
    await db.prepare("UPDATE buildings SET city = NULL WHERE id = 'nocity'").run();

    const byslug = new Map((await search(db, 'lanark')).map((r) => [r.slug, r.has_records]));
    expect(byslug.get('p')).toBe(1);
    expect(byslug.get('q')).toBe(0);
    expect(byslug.get('lower')).toBe(1);
    expect(byslug.get('stated')).toBe(1);
    expect(byslug.get('nospace')).toBe(1);
    expect(byslug.get('twospace')).toBe(1);
    expect(byslug.get('other')).toBe(0);
    expect(byslug.get('nocity')).toBe(0);
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

  async function slugs(db: TestD1Database, query: string): Promise<string[]> {
    return (await search(db, query)).map((r) => r.slug);
  }

  it('finds an assessor Wy or Hw street under its spelled-out name, and the other way round', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'a', address: '120 Grampian Wy', source: 'seed' });
    await insertBuilding(db, { id: 'b', address: '121 Grampian Way', source: 'seed' });
    await insertBuilding(db, { id: 'c', address: '5 Grampian St', source: 'seed' });
    await insertBuilding(db, { id: 'h', address: '9 Cummins Hw', source: 'seed' });
    expect(await slugs(db, 'grampian way')).toEqual(['a', 'b']);
    expect(await slugs(db, 'grampian wy')).toEqual(['a', 'b']);
    expect(await slugs(db, 'cummins highway')).toEqual(['h']);
    expect(await slugs(db, 'cummins hwy')).toEqual(['h']);
  });

  it('matches an alternative spelling only as a whole word', async () => {
    // As a substring, 'la' finds Oakland and Place and 'ln' finds Lincoln: 'lane' went from 245
    // results to 2,411 over the production addresses before alternatives were whole-word.
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'oakland', address: '12 Oakland Street', source: 'seed' });
    await insertBuilding(db, { id: 'l1', address: '4 Centre Lane', source: 'seed' });
    await insertBuilding(db, { id: 'l2', address: '6 Centre La', source: 'seed' });
    await insertBuilding(db, { id: 'place', address: '8 Centre Place', source: 'seed' });
    await insertBuilding(db, { id: 'lincoln', address: '10 Lincoln Street', source: 'seed' });
    expect(await slugs(db, 'oak lane')).toEqual([]);
    expect(await slugs(db, 'centre lane')).toEqual(['l1', 'l2']);
    expect(await slugs(db, 'lane')).toEqual(['l1', 'l2']);
  });

  it('narrows an existing suffix too: dorchester street no longer finds Dorchester Avenue', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'avenue', address: '5 Dorchester Avenue', source: 'seed' });
    await insertBuilding(db, { id: 'street', address: '7 Dorchester Street', source: 'seed' });
    await insertBuilding(db, { id: 'st', address: '9 Dorchester St', source: 'seed' });
    expect(await slugs(db, 'dorchester street')).toEqual(['street', 'st']);
  });

  it('reads a comma or a period beside a suffix as a word break', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'ln', address: '14 Centre Ln.' });
    await insertBuilding(db, { id: 'main', address: '3 Main St, Boston' });
    expect(await slugs(db, 'centre lane')).toEqual(['ln']);
    expect(await slugs(db, 'main street')).toEqual(['main']);
  });

  it('binds the typed spelling as a substring and the other spellings as whole words', () => {
    expect(buildingSearchWhere('radford lane').binds).toEqual(['%radford%', '%lane%', '% la %', '% ln %', '%radford lane%', '%radford lane%']);
  });

  it('keeps the typed spelling a substring match: st still finds St James', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'james', address: '1 St James Avenue', source: 'seed' });
    expect(await slugs(db, 'st james')).toEqual(['james']);
  });
});
