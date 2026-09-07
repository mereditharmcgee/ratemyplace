import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { resolveParcel, assessorSource, ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import type { AssessmentPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import lanark2025 from './helpers/records/assessor-fy2025-lanark.json';
import lanark2024 from './helpers/records/assessor-fy2024-lanark.json';
import lanark2023 from './helpers/records/assessor-fy2023-lanark.json';
import lanark2022 from './helpers/records/assessor-fy2022-lanark.json';
import lanark2021 from './helpers/records/assessor-fy2021-lanark.json';
import condo2026 from './helpers/records/assessor-fy2026-condo.json';

const lanark = buildIdentity({ id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null });
const FY2021_RESOURCE_ID = 'c4b7331e-e213-45a5-adda-052e4dd31d41';

/** The real HTTP 409 body data.boston.gov returns for `SELECT "ZIPCODE" ...`. */
const MISSING_COLUMN_BODY = readFileSync(
  resolve(process.cwd(), 'src', 'lib', '__tests__', 'helpers', 'records', 'ckan-error-missing-column.json'),
  'utf8',
);

const yearFor = (fiscalYear: string) => ASSESSOR_YEARS.find((y) => y.fiscalYear === fiscalYear)!;

describe('resolveParcel', () => {
  it('finds one whole-building parcel, excluding condo rows in SQL, with one query', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({
      parcelId: '2102098000', condominium: false, wholeBuildingParcels: 1, condoRows: 0,
    });
    expect(fetchImpl.calls).toHaveLength(1);
    const sql = fetchImpl.calls[0];
    expect(sql).toContain(`"LU" NOT IN ('CD','CM')`);
    expect(lanark.streetForms).toEqual(['LANARK RD', 'LANARK ROAD']);
    for (const form of lanark.streetForms) expect(sql).toContain(`'${form}'`);
    expect(sql).toContain(`"ST_NUM" IN ('23','27','23-27')`);
    expect(sql).toContain(`"ST_NUM2" IN ('23','27')`);
  });

  it('counts one parcel when a parcel returns several building rows', async () => {
    const records = [
      { ...lanark2026[0], BLDG_SEQ: '1' },
      { ...lanark2026[0], BLDG_SEQ: '2' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records }]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({
      parcelId: '2102098000', condominium: false, wholeBuildingParcels: 1, condoRows: 0,
    });
  });

  it('refuses to guess when two distinct parcels match', async () => {
    const records = [
      { ...lanark2026[0], PID: '2102098000' },
      { ...lanark2026[0], PID: '2102099000' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records }]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({
      parcelId: null, condominium: false, wholeBuildingParcels: 2, condoRows: 0,
    });
  });

  it('reports a condominium from the counting query when no whole-building parcel matched', async () => {
    const fetchImpl = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'count(*)', records: [{ n: 3 }] },
      { resourceId: FY2026_RESOURCE_ID, records: [] },
    ]);
    const fiftyFive = buildIdentity({ id: 'b2', address: '55 Lanark Rd, Boston, MA', city: 'Boston', state: 'MA', zip_code: null, parcel_id: null, sam_id: null });
    expect(await resolveParcel(fiftyFive, fetchImpl)).toEqual({
      parcelId: null, condominium: true, wholeBuildingParcels: 0, condoRows: 3,
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[1]).toContain(`"LU" IN ('CD','CM')`);
    // The condo fixture is what a pre-split query would have returned for this address.
    expect(condo2026.every((r) => r.LU === 'CD' || r.LU === 'CM')).toBe(true);
  });

  it('returns zeros when nothing matches at all', async () => {
    const fetchImpl = fixtureFetch([]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({
      parcelId: null, condominium: false, wholeBuildingParcels: 0, condoRows: 0,
    });
  });

  it('escapes an apostrophe in the street name', async () => {
    const fetchImpl = fixtureFetch([]);
    const obrien = buildIdentity({ id: 'b3', address: "10 O'Brien Ct, Boston, MA", city: 'Boston', state: 'MA', zip_code: null, parcel_id: null, sam_id: null });
    await resolveParcel(obrien, fetchImpl);
    expect(fetchImpl.calls[0]).toContain(`'O''BRIEN CT'`);
  });

  it('drops a PID that is not a parcel id at all', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [{ ...lanark2026[0], PID: 'PID-1' }] }]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({
      parcelId: null, condominium: false, wholeBuildingParcels: 0, condoRows: 0,
    });
  });
});

describe('assessorSource', () => {
  const withParcel = { ...lanark, parcelId: '2102098000', parcelNumeric: '2102098000' };

  it('has six fiscal years, newest first, each owning its own source key', () => {
    expect(ASSESSOR_YEARS.map((y) => y.fiscalYear)).toEqual(['FY2026', 'FY2025', 'FY2024', 'FY2023', 'FY2022', 'FY2021']);
    expect(assessorSource(ASSESSOR_YEARS[0]).ownsSourceKey).toBe('FY2026');
    expect(assessorSource(ASSESSOR_YEARS[0]).kinds).toEqual(['assessment']);
  });

  const REAL_ROWS: Array<[string, unknown[]]> = [
    ['FY2026', lanark2026],
    ['FY2025', lanark2025],
    ['FY2024', lanark2024],
    ['FY2023', lanark2023],
    ['FY2022', lanark2022],
    ['FY2021', lanark2021],
  ];

  it.each(REAL_ROWS)('maps the real 23-27 Lanark Rd row for %s through its column map', async (fiscalYear, records) => {
    const year = yearFor(fiscalYear);
    const fetchImpl = fixtureFetch([{ resourceId: year.resourceId, records }]);
    const result = await assessorSource(year).run(withParcel, fetchImpl);
    expect(result.rows).toHaveLength(1);
    const payload = result.rows[0].payload as AssessmentPayload;
    expect(payload.fiscalYear).toBe(fiscalYear);
    expect(payload.parcelId).toBe('2102098000');
    expect(payload.owner).toMatch(/LANARK ROAD LLC/);
    expect(payload.mailStreet).toContain('PO BOX 35006');
    expect(payload.mailZip).toBe('02135');
    expect(payload.totalValue).toBeGreaterThan(6_000_000);
    expect(payload.yearBuilt).toBe(1920);
    expect(payload.yearRemodel).toBe(1980);
    expect(payload.grossArea).toBe(34650);
  });

  it('maps the full modern payload and orders by BLDG_SEQ', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]);
    const result = await assessorSource(ASSESSOR_YEARS[0]).run(withParcel, fetchImpl);
    expect(result.query).toContain(`"PID" IN ('2102098000')`);
    expect(result.query).toContain('ORDER BY "BLDG_SEQ"');
    expect(result.rows[0].sourceKey).toBe('FY2026');
    expect(result.rows[0].payload as AssessmentPayload).toMatchObject({
      fiscalYear: 'FY2026', parcelId: '2102098000', owner: 'LANARK ROAD LLC MASS LLC',
      mailAddressee: 'C/O ATT DENNIS CLAIR', mailStreet: 'PO BOX 35006', mailCity: 'BOSTON', mailState: 'MA', mailZip: '02135',
      landUse: 'A', landUseDescription: 'APT 7-30 UNITS', yearBuilt: 1920, yearRemodel: 1980,
      grossArea: 34650, livingArea: 27720, residentialUnits: null, commercialUnits: null,
      totalValue: 6720200, landValue: 1620500, buildingValue: 5099700, condominium: false,
    });
  });

  it("splits FY2023's single combined mail column from the end, keeping commas in the street", async () => {
    const year = yearFor('FY2023');
    const fetchImpl = fixtureFetch([{ resourceId: year.resourceId, records: lanark2023 }]);
    const payload = (await assessorSource(year).run(withParcel, fetchImpl)).rows[0].payload as AssessmentPayload;
    expect(payload).toMatchObject({
      mailStreet: 'PO BOX 35006 C/O ATT DENNIS CLAIR', mailCity: 'BOSTON', mailState: 'MA', mailZip: '02135',
    });
  });

  it('keeps the whole combined value as the street when it has no state/zip tail', async () => {
    const year = yearFor('FY2023');
    const records = [{ ...lanark2023[0], 'OWNER MAIL ADDRESS': 'PO BOX 35006, BOSTON' }];
    const fetchImpl = fixtureFetch([{ resourceId: year.resourceId, records }]);
    const payload = (await assessorSource(year).run(withParcel, fetchImpl)).rows[0].payload as AssessmentPayload;
    expect(payload).toMatchObject({ mailStreet: 'PO BOX 35006, BOSTON', mailCity: null, mailState: null, mailZip: null });
  });

  it('queries both parcel forms when the parcel has a leading zero', async () => {
    const fetchImpl = fixtureFetch([]);
    const zero = { ...lanark, parcelId: '0100001000', parcelNumeric: '100001000' };
    const result = await assessorSource(ASSESSOR_YEARS[0]).run(zero, fetchImpl);
    expect(result.query).toContain(`"PID" IN ('0100001000','100001000')`);
    expect(result.rows).toEqual([]);
  });

  it('emits a single owner-less condominium row for the current year and nothing for history', async () => {
    const fetchImpl = fixtureFetch([]);
    const condo = { ...lanark, condominium: true };
    const current = await assessorSource(ASSESSOR_YEARS[0]).run(condo, fetchImpl);
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0].payload as AssessmentPayload).toMatchObject({
      condominium: true, owner: null, parcelId: null, landUse: null, landUseDescription: null,
    });
    const history = await assessorSource(ASSESSOR_YEARS[1]).run(condo, fetchImpl);
    expect(history.rows).toEqual([]);
    expect(fetchImpl.calls).toEqual([]);
  });

  it('treats a missing-column error as empty, and rethrows any other error', async () => {
    const year = yearFor('FY2021');
    const missing = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 409, rawBody: MISSING_COLUMN_BODY }]);
    expect((await assessorSource(year).run(withParcel, missing)).rows).toEqual([]);

    const outage = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 503, errorMessage: 'gateway' }]);
    await expect(assessorSource(year).run(withParcel, outage)).rejects.toThrow(/503/);
  });

  it('throws when the parcel is unresolved and the building is not a condominium', async () => {
    await expect(assessorSource(ASSESSOR_YEARS[0]).run(lanark, fixtureFetch([]))).rejects.toThrow(/parcel/i);
  });
});
