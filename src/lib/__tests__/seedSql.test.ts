import { describe, expect, it } from 'vitest';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { SEED_TRIGGER_REASON, lit, seedStatements } from '../records/seed/sql';
import type { ExistingBuilding, SeedBuilding } from '../records/seed/types';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

const parcel: SeedBuilding = {
  parcelId: '2102098000', address: "23-27 O'Lanark Road", streetKey: 'LANARK RD', numLo: 23, numHi: 27, neighborhood: 'Brighton', zip: '02135',
  unitCount: 12, yearBuilt: 1925, buildingType: 'apartment', latitude: 42.33909, longitude: -71.1458, samId: '83763',
  assessment: {
    fiscalYear: 'FY2026', parcelId: '2102098000', owner: "O'BRIEN LLC", mailAddressee: null, mailStreet: '1 Main St', mailCity: 'Boston', mailState: 'MA', mailZip: '02135',
    landUse: 'A', landUseDescription: 'APT 7-30 UNITS', yearBuilt: 1925, yearRemodel: null, grossArea: 12000, livingArea: 10000,
    residentialUnits: 12, commercialUnits: 0, totalValue: 3500000, landValue: 1000000, buildingValue: 2500000, condominium: false,
  },
};

async function apply(db: ReturnType<typeof createRecordsTestDb>, statements: string[]): Promise<void> {
  for (const sql of statements) await db.prepare(sql).run();
}

describe('lit', () => {
  it('doubles single quotes and renders null', () => {
    expect(lit("O'Brien")).toBe("'O''Brien'");
    expect(lit(null)).toBe('NULL');
    expect(lit(12)).toBe('12');
    expect(() => lit(Number.NaN)).toThrow();
  });
});

describe('seedStatements', () => {
  it('creates a seeded building, its assessor pull, and its assessment record', async () => {
    const db = createRecordsTestDb();
    const statements = seedStatements({ created: [{ parcel, slug: '23-27-olanark-road-boston' }], matched: [] });
    expect(statements).toHaveLength(3);
    await apply(db, statements);
    const b = await db.prepare("SELECT id, address, slug, city, neighborhood, zip_code, source, parcel_id, sam_id, street_key, st_num_lo, st_num_hi, unit_count, year_built, building_type, latitude FROM buildings WHERE parcel_id = '2102098000'").first<Record<string, unknown>>();
    expect(b).toMatchObject({ id: 'seed-2102098000', address: "23-27 O'Lanark Road", slug: '23-27-olanark-road-boston', city: 'Boston', neighborhood: 'Brighton', zip_code: '02135', source: 'seed', sam_id: '83763', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 27, unit_count: 12, year_built: 1925, building_type: 'apartment', latitude: 42.33909 });
    const pull = await db.prepare("SELECT id, source_id, source_label, status, row_count, triggered_by, trigger_reason FROM record_pulls WHERE building_id = 'seed-2102098000'").first<Record<string, unknown>>();
    expect(pull).toMatchObject({ id: 'seed-FY2026-2102098000', source_id: FY2026_RESOURCE_ID, source_label: 'Property Assessment FY2026', status: 'ok', row_count: 1, triggered_by: null, trigger_reason: SEED_TRIGGER_REASON });
    const record = await db.prepare("SELECT kind, source_key, payload FROM building_records WHERE building_id = 'seed-2102098000'").first<{ kind: string; source_key: string; payload: string }>();
    expect(record?.kind).toBe('assessment');
    expect(record?.source_key).toBe('FY2026');
    expect(JSON.parse(record!.payload).owner).toBe("O'BRIEN LLC");
  });

  it('is idempotent and updates assessor fields without touching address or slug on re-run', async () => {
    const db = createRecordsTestDb();
    await apply(db, seedStatements({ created: [{ parcel, slug: 'first-slug' }], matched: [] }));
    const again = { ...parcel, address: 'renamed', unitCount: 13, assessment: { ...parcel.assessment, totalValue: 1 } };
    await apply(db, seedStatements({ created: [{ parcel: again, slug: 'second-slug' }], matched: [] }));
    const b = await db.prepare("SELECT address, slug, unit_count FROM buildings WHERE id = 'seed-2102098000'").first<Record<string, unknown>>();
    expect(b).toEqual({ address: "23-27 O'Lanark Road", slug: 'first-slug', unit_count: 13 });
    const pulls = await db.prepare("SELECT COUNT(*) AS n FROM record_pulls WHERE building_id = 'seed-2102098000'").first<{ n: number }>();
    expect(pulls?.n).toBe(1);
    const record = await db.prepare("SELECT payload FROM building_records WHERE building_id = 'seed-2102098000'").first<{ payload: string }>();
    expect(JSON.parse(record!.payload).totalValue).toBe(1);
  });

  it('updates a matched existing building in place and gives it provenance', async () => {
    const db = createRecordsTestDb();
    const id = await insertBuilding(db, { id: 'b1', address: '23 Lanark Rd' });
    // The helper writes no coordinate, so the COALESCE in the UPDATE takes the parcel's.
    const building: ExistingBuilding = { id, address: '23 Lanark Rd', slug: 'b1', parcel_id: null, latitude: 1, longitude: 2, zip_code: '02135' };
    const statements = seedStatements({ created: [], matched: [{ building, parcel }] });
    await apply(db, statements);
    const b = await db.prepare("SELECT address, parcel_id, sam_id, street_key, st_num_lo, st_num_hi, latitude, longitude, source FROM buildings WHERE id = 'b1'").first<Record<string, unknown>>();
    expect(b).toEqual({ address: '23 Lanark Rd', parcel_id: '2102098000', sam_id: '83763', street_key: 'LANARK RD', st_num_lo: 23, st_num_hi: 23, latitude: 42.33909, longitude: -71.1458, source: 'user' });
    const pull = await db.prepare("SELECT id FROM record_pulls WHERE building_id = 'b1'").first<{ id: string }>();
    expect(pull?.id).toBe('seed-FY2026-b1');
  });
});
