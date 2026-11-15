import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { wardEqualsClause } from '../records/ckan';
import { WARD_ZIPS, parcelWard, wardZipArm } from '../records/wards';
import { LEGACY_311_RESOURCES, NEW_311_RESOURCE_ID, serviceRequestsSource } from '../records/sources/boston/serviceRequests';
import type { BuildingIdentity } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';

/**
 * 311 rows can carry a different ZIP than the parcel's: the November 2026 survey found a Hyde Park
 * parcel the assessor files under 02136 whose every legacy 311 row, 2012 to 2026, says 02126, so
 * the ZIP qualifier dropped all of them. Every one of those rows names the parcel's own ward, and a
 * Boston parcel id starts with its ward. A row whose ZIP is neither the page's nor the parcel's is
 * now kept when its ward is the parcel's and its ZIP is one that ward's parcels carry, so a twin
 * street in another ward still stays out. Synthetic addresses throughout; wards and ZIPs are the
 * city's.
 */

function identity(overrides: { zip?: string | null; parcelZip?: string | null; parcelId?: string | null } = {}): BuildingIdentity {
  const built = buildIdentity({
    id: 'b-ward',
    address: '12 Example Rd',
    city: 'Boston',
    state: 'MA',
    zip_code: overrides.zip === undefined ? '02136' : overrides.zip,
    parcel_id: overrides.parcelId === undefined ? '1800000012' : overrides.parcelId,
    sam_id: null,
  });
  return { ...built, parcelZip: overrides.parcelZip ?? null };
}

describe('parcelWard', () => {
  it('reads the ward from the first two digits of a canonical parcel id', () => {
    expect(parcelWard('1800000012')).toBe(18);
    expect(parcelWard('0100000012')).toBe(1);
    expect(parcelWard('2200000012')).toBe(22);
  });

  it('is null for no parcel, a malformed one, or a ward Boston does not have', () => {
    expect(parcelWard(null)).toBeNull();
    expect(parcelWard('180000001')).toBeNull();
    expect(parcelWard('18O0000012')).toBeNull();
    expect(parcelWard('0000000012')).toBeNull();
    expect(parcelWard('2300000012')).toBeNull();
  });
});

describe('WARD_ZIPS', () => {
  it('lists every Boston ward, 1 to 22, each with five-digit ZIPs', () => {
    expect(Object.keys(WARD_ZIPS).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1));
    for (const zips of Object.values(WARD_ZIPS)) {
      expect(zips.length).toBeGreaterThan(0);
      for (const zip of zips) expect(zip).toMatch(/^\d{5}$/);
    }
  });

  it('gives the Hyde Park ward the Mattapan and Roslindale ZIPs its parcels carry', () => {
    expect(WARD_ZIPS[18]).toEqual(['02126', '02131', '02136']);
  });

  it('keeps East Boston and Charlestown to their own ZIP', () => {
    expect(WARD_ZIPS[1]).toEqual(['02128']);
    expect(WARD_ZIPS[2]).toEqual(['02129']);
  });
});

describe('wardZipArm', () => {
  it('names the parcel ward and the ward ZIPs the page and parcel ZIPs do not already cover', () => {
    expect(wardZipArm(identity())).toEqual({ ward: 18, zips: ['02126', '02131'] });
    expect(wardZipArm(identity({ parcelZip: '02131' }))).toEqual({ ward: 18, zips: ['02126'] });
  });

  it('is null with no parcel, no Boston ward, or a ward whose only ZIP the page already has', () => {
    expect(wardZipArm(identity({ parcelId: null }))).toBeNull();
    expect(wardZipArm(identity({ parcelId: '0000000012' }))).toBeNull();
    expect(wardZipArm(identity({ zip: '02129', parcelId: '0200000012' }))).toBeNull();
  });

  it('never narrows a page that has no usable ZIP', () => {
    expect(wardZipArm(identity({ zip: null }))).toBeNull();
    expect(wardZipArm(identity({ zip: '2136' }))).toBeNull();
  });
});

describe('wardEqualsClause', () => {
  it('matches both spellings of a two-digit ward, compared as text so a numeric column works too', () => {
    expect(wardEqualsClause('ward', 18)).toBe(`"ward"::text IN ('Ward 18','18')`);
  });

  it('adds the zero-padded spelling for a one-digit ward', () => {
    expect(wardEqualsClause('ward', 5)).toBe(`"ward"::text IN ('Ward 5','5','05')`);
  });

  it('refuses an unsafe column or a ward that is not a whole number from 1 to 99', () => {
    expect(() => wardEqualsClause('ward"; DROP', 18)).toThrow();
    for (const bad of [0, 100, 1.5, Number.NaN, -3]) expect(() => wardEqualsClause('ward', bad)).toThrow();
  });
});

describe('311 keeps a request filed under another ZIP of the parcel’s own ward', () => {
  const legacyId = LEGACY_311_RESOURCES[0].resourceId;
  const WARD_ARM_LEGACY = `("ward"::text IN ('Ward 18','18') AND "location_zipcode" IN ('02126','02131'))`;
  const WARD_ARM_NEW = `("ward"::text IN ('Ward 18','18') AND "zip_code" IN ('02126','02131'))`;

  it('adds the ward arm to both the legacy and the new-system ZIP qualifier', async () => {
    const queries: string[] = JSON.parse((await serviceRequestsSource.run(identity(), fixtureFetch([]))).query);
    expect(queries.find((q) => q.includes(legacyId))).toContain(
      `("location_zipcode" IS NULL OR "location_zipcode" = '02136' OR ${WARD_ARM_LEGACY})`,
    );
    expect(queries.find((q) => q.includes(NEW_311_RESOURCE_ID))).toContain(
      `("zip_code" IS NULL OR "zip_code" = '02136' OR ${WARD_ARM_NEW})`,
    );
  });

  it('attaches the rows only a query carrying the ward arm would find', async () => {
    const fetchImpl = fixtureFetch([
      {
        resourceId: legacyId,
        sqlIncludes: WARD_ARM_LEGACY,
        records: [{ case_enquiry_id: 101000000001, open_dt: '2026-03-01 10:00:00', reason: 'Housing', type: 'Heat', location: '12 Example Rd  Hyde Park  MA  02126' }],
      },
      {
        resourceId: NEW_311_RESOURCE_ID,
        sqlIncludes: WARD_ARM_NEW,
        records: [{ case_id: 'BCS-00000001', open_date: '2026-04-01', assigned_department: 'Inspectional Services', street_number: '12', full_address: '12 Example Rd' }],
      },
    ]);
    const result = await serviceRequestsSource.run(identity(), fetchImpl);
    expect(result.rows.map((r) => r.sourceKey).sort()).toEqual(['101000000001', 'BCS-00000001']);
  });

  it('names only the parcel’s own ward and ZIPs, so a twin street in another ward stays out', async () => {
    const queries: string[] = JSON.parse(
      (await serviceRequestsSource.run(identity({ zip: '02135', parcelId: '2200000012' }), fixtureFetch([]))).query,
    );
    for (const q of queries) {
      expect(q).toContain(`"ward"::text IN ('Ward 22','22')`);
      expect(q).not.toMatch(/Ward 18|02126|02131|02136/);
    }
  });

  it('sends the query it sent before when there is no ward arm', async () => {
    for (const id of [identity({ parcelId: null }), identity({ zip: '02129', parcelId: '0200000012' })]) {
      const queries: string[] = JSON.parse((await serviceRequestsSource.run(id, fixtureFetch([]))).query);
      expect(queries.every((q) => !q.includes('"ward"'))).toBe(true);
    }
  });

  it('stays unnarrowed when the page has no ZIP, ward or not', async () => {
    const queries: string[] = JSON.parse((await serviceRequestsSource.run(identity({ zip: null }), fixtureFetch([]))).query);
    expect(queries.every((q) => !q.includes('"ward"') && !q.includes('zipcode') && !q.includes('"zip_code"'))).toBe(true);
  });
});
