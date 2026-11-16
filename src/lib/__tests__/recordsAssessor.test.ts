import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { resolveParcel, assessorSource, ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import type { AssessmentPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import tarnwick2026 from './helpers/records/assessor-fy2026-tarnwick.json';
import tarnwick2025 from './helpers/records/assessor-fy2025-tarnwick.json';
import tarnwick2024 from './helpers/records/assessor-fy2024-tarnwick.json';
import tarnwick2023 from './helpers/records/assessor-fy2023-tarnwick.json';
import tarnwick2022 from './helpers/records/assessor-fy2022-tarnwick.json';
import tarnwick2021 from './helpers/records/assessor-fy2021-tarnwick.json';
import condo2026 from './helpers/records/assessor-fy2026-condo.json';

const tarnwick = buildIdentity({ id: 'b1', address: '52-68 Tarnwick Pl, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null });
const FY2021_RESOURCE_ID = 'c4b7331e-e213-45a5-adda-052e4dd31d41';

/** The real HTTP 409 body data.boston.gov returns for `SELECT "ZIPCODE" ...`. */
const MISSING_COLUMN_BODY = readFileSync(
  resolve(process.cwd(), 'src', 'lib', '__tests__', 'helpers', 'records', 'ckan-error-missing-column.json'),
  'utf8',
);

const yearFor = (fiscalYear: string) => ASSESSOR_YEARS.find((y) => y.fiscalYear === fiscalYear)!;

/** The recorded body names "ZIPCODE"; swap in a different missing column for other cases. */
function missingColumnBody(columnName: string): string {
  const body = JSON.parse(MISSING_COLUMN_BODY) as { error: { query: string[]; info: { orig: string[] } } };
  body.error.query[0] = body.error.query[0].replace(/ZIPCODE/g, columnName);
  body.error.info.orig[0] = body.error.info.orig[0].replace(/ZIPCODE/g, columnName);
  return JSON.stringify(body);
}

describe('resolveParcel', () => {
  it('finds one whole-building parcel, excluding condo rows in SQL, with one query', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: tarnwick2026 }]);
    expect(await resolveParcel(tarnwick, fetchImpl)).toEqual({
      parcelId: '2109417000', condominium: false, wholeBuildingParcels: 1, condoRows: 0,
    });
    expect(fetchImpl.calls).toHaveLength(1);
    const sql = fetchImpl.calls[0];
    expect(sql).toContain(`"LU" NOT IN ('CD','CM')`);
    expect(tarnwick.streetForms).toEqual(['TARNWICK PL', 'TARNWICK PLACE']);
    for (const form of tarnwick.streetForms) expect(sql).toContain(`'${form}'`);
    expect(sql).toContain(`"ST_NUM" IN ('52','68','52-68')`);
    expect(sql).toContain(`"ST_NUM2" IN ('52','68')`);
  });

  it('counts one parcel when a parcel returns several building rows', async () => {
    const records = [
      { ...tarnwick2026[0], BLDG_SEQ: '1' },
      { ...tarnwick2026[0], BLDG_SEQ: '2' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records }]);
    expect(await resolveParcel(tarnwick, fetchImpl)).toEqual({
      parcelId: '2109417000', condominium: false, wholeBuildingParcels: 1, condoRows: 0,
    });
  });

  it('refuses to guess when two distinct parcels match', async () => {
    const records = [
      { ...tarnwick2026[0], PID: '2109417000' },
      { ...tarnwick2026[0], PID: '2109418000' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records }]);
    expect(await resolveParcel(tarnwick, fetchImpl)).toEqual({
      parcelId: null, condominium: false, wholeBuildingParcels: 2, condoRows: 0,
    });
  });

  it('reports a condominium from the counting query when no whole-building parcel matched', async () => {
    const fetchImpl = fixtureFetch([
      { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'count(*)', records: [{ n: 3 }] },
      { resourceId: FY2026_RESOURCE_ID, records: [] },
    ]);
    const oneTwentySeven = buildIdentity({ id: 'b2', address: '127-129 Tarnwick Pl, Boston, MA', city: 'Boston', state: 'MA', zip_code: null, parcel_id: null, sam_id: null });
    expect(await resolveParcel(oneTwentySeven, fetchImpl)).toEqual({
      parcelId: null, condominium: true, wholeBuildingParcels: 0, condoRows: 3,
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[1]).toContain(`"LU" IN ('CD','CM')`);
    // The condo fixture is what a pre-split query would have returned for this range: the
    // master row and a unit on each of its numbers.
    expect(condo2026.every((r) => r.LU === 'CD' || r.LU === 'CM')).toBe(true);
  });

  it('returns zeros when nothing matches at all', async () => {
    const fetchImpl = fixtureFetch([]);
    expect(await resolveParcel(tarnwick, fetchImpl)).toEqual({
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
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [{ ...tarnwick2026[0], PID: 'PID-1' }] }]);
    expect(await resolveParcel(tarnwick, fetchImpl)).toEqual({
      parcelId: null, condominium: false, wholeBuildingParcels: 0, condoRows: 0,
    });
  });

  it('no longer selects "LU" — the land-use filter lives entirely in the WHERE clause', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: tarnwick2026 }]);
    await resolveParcel(tarnwick, fetchImpl);
    const sql = fetchImpl.calls[0];
    expect(sql).not.toMatch(/SELECT[^F]*"LU"/);
    expect(sql).toContain(`"LU" NOT IN ('CD','CM')`);
  });
});

describe('assessorSource', () => {
  const withParcel = { ...tarnwick, parcelId: '2109417000', parcelNumeric: '2109417000' };

  it('has six fiscal years, newest first, each owning its own source key', () => {
    expect(ASSESSOR_YEARS.map((y) => y.fiscalYear)).toEqual(['FY2026', 'FY2025', 'FY2024', 'FY2023', 'FY2022', 'FY2021']);
    expect(assessorSource(ASSESSOR_YEARS[0]).ownsSourceKey).toBe('FY2026');
    expect(assessorSource(ASSESSOR_YEARS[0]).kinds).toEqual(['assessment']);
  });

  const RECORDED_ROWS: Array<[string, unknown[]]> = [
    ['FY2026', tarnwick2026],
    ['FY2025', tarnwick2025],
    ['FY2024', tarnwick2024],
    ['FY2023', tarnwick2023],
    ['FY2022', tarnwick2022],
    ['FY2021', tarnwick2021],
  ];

  it.each(RECORDED_ROWS)('maps the recorded-shape 52-68 Tarnwick Pl row for %s through its column map', async (fiscalYear, records) => {
    const year = yearFor(fiscalYear);
    const fetchImpl = fixtureFetch([{ resourceId: year.resourceId, records }]);
    const result = await assessorSource(year).run(withParcel, fetchImpl);
    expect(result.rows).toHaveLength(1);
    const payload = result.rows[0].payload as AssessmentPayload;
    expect(payload.fiscalYear).toBe(fiscalYear);
    expect(payload.parcelId).toBe('2109417000');
    expect(payload.owner).toMatch(/WRENFIELD REALTY LLC/);
    expect(payload.mailStreet).toContain('88 FELLWICK AV');
    expect(payload.mailZip).toBe('02481');
    expect(payload.totalValue).toBeGreaterThan(4_000_000);
    expect(payload.yearBuilt).toBe(1948);
    expect(payload.yearRemodel).toBe(1996);
    expect(payload.grossArea).toBe(21648);
  });

  // The fictional building's figures are invented as a set. A year left holding an older lot size
  // or floor count would describe a different building, so every year that records them agrees.
  it('gives 52-68 Tarnwick Pl one lot size and one floor count in every year that records them', () => {
    const raw = (records: unknown[]) => records[0] as Record<string, unknown>;
    const area = (value: unknown) => Number(String(value ?? '').replace(/[^0-9.]/g, ''));
    const years = [tarnwick2025, tarnwick2024, tarnwick2023, tarnwick2022].map(raw);
    expect(years.map((row) => area(row.LAND_SF))).toEqual([13940, 13940, 13940, 13940]);
    expect(years.map((row) => row.RES_FLOOR)).toEqual(['3', '3', '3', '3']);
  });

  it('maps the full modern payload and orders by BLDG_SEQ', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: tarnwick2026 }]);
    const result = await assessorSource(ASSESSOR_YEARS[0]).run(withParcel, fetchImpl);
    expect(result.query).toContain(`"PID" IN ('2109417000')`);
    expect(result.query).toContain('ORDER BY "BLDG_SEQ"');
    expect(result.rows[0].sourceKey).toBe('FY2026');
    expect(result.rows[0].payload as AssessmentPayload).toMatchObject({
      fiscalYear: 'FY2026', parcelId: '2109417000', owner: 'WRENFIELD REALTY LLC',
      mailAddressee: null, mailStreet: '88 FELLWICK AV', mailCity: 'WELLESLEY', mailState: 'MA', mailZip: '02481',
      landUse: 'A', landUseDescription: 'APT 7-30 UNITS', yearBuilt: 1948, yearRemodel: 1996,
      grossArea: 21648, livingArea: 12716, residentialUnits: null, commercialUnits: null,
      totalValue: 4520600, landValue: 1302900, buildingValue: 3217700, condominium: false,
    });
  });

  it("splits FY2023's single combined mail column from the end, keeping commas in the street", async () => {
    const year = yearFor('FY2023');
    const fetchImpl = fixtureFetch([{ resourceId: year.resourceId, records: tarnwick2023 }]);
    const payload = (await assessorSource(year).run(withParcel, fetchImpl)).rows[0].payload as AssessmentPayload;
    expect(payload).toMatchObject({
      mailStreet: '88 FELLWICK AV', mailCity: 'WELLESLEY', mailState: 'MA', mailZip: '02481',
    });
  });

  it('keeps the whole combined value as the street when it has no state/zip tail', async () => {
    const year = yearFor('FY2023');
    const records = [{ ...tarnwick2023[0], 'OWNER MAIL ADDRESS': '88 FELLWICK AV, WELLESLEY' }];
    const fetchImpl = fixtureFetch([{ resourceId: year.resourceId, records }]);
    const payload = (await assessorSource(year).run(withParcel, fetchImpl)).rows[0].payload as AssessmentPayload;
    expect(payload).toMatchObject({ mailStreet: '88 FELLWICK AV, WELLESLEY', mailCity: null, mailState: null, mailZip: null });
  });

  it('queries both parcel forms when the parcel has a leading zero', async () => {
    const fetchImpl = fixtureFetch([]);
    const zero = { ...tarnwick, parcelId: '0100001000', parcelNumeric: '100001000' };
    const result = await assessorSource(ASSESSOR_YEARS[0]).run(zero, fetchImpl);
    expect(result.query).toContain(`"PID" IN ('0100001000','100001000')`);
    expect(result.rows).toEqual([]);
  });

  it('emits a single owner-less condominium row for the current year and nothing for history', async () => {
    const fetchImpl = fixtureFetch([]);
    const condo = { ...tarnwick, condominium: true };
    const current = await assessorSource(ASSESSOR_YEARS[0]).run(condo, fetchImpl);
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0].payload as AssessmentPayload).toMatchObject({
      condominium: true, owner: null, parcelId: null, landUse: null, landUseDescription: null,
    });
    const history = await assessorSource(ASSESSOR_YEARS[1]).run(condo, fetchImpl);
    expect(history.rows).toEqual([]);
    expect(fetchImpl.calls).toEqual([]);
  });

  it('swallows a missing mail column, recording why in the returned query', async () => {
    const year = yearFor('FY2021');
    const missing = fixtureFetch([
      { resourceId: FY2021_RESOURCE_ID, errorStatus: 409, rawBody: missingColumnBody('MAIL_ZIPCODE') },
    ]);
    const result = await assessorSource(year).run(withParcel, missing);
    expect(result.rows).toEqual([]);
    expect(result.query).toContain('skipped: column "MAIL_ZIPCODE"');
  });

  it('rethrows when the missing column is not one of this year\'s mail columns', async () => {
    const year = yearFor('FY2021');
    // The recorded 409 body names "ZIPCODE", not FY2021's mail column ("MAIL_ZIPCODE").
    const missing = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 409, rawBody: MISSING_COLUMN_BODY }]);
    await expect(assessorSource(year).run(withParcel, missing)).rejects.toThrow(/ZIPCODE/);
  });

  it('rethrows when a fixed column like BLDG_SEQ is missing', async () => {
    const year = yearFor('FY2021');
    const missing = fixtureFetch([
      { resourceId: FY2021_RESOURCE_ID, errorStatus: 409, rawBody: missingColumnBody('BLDG_SEQ') },
    ]);
    await expect(assessorSource(year).run(withParcel, missing)).rejects.toThrow(/BLDG_SEQ/);
  });

  it('rethrows any other error, e.g. an outage', async () => {
    const year = yearFor('FY2021');
    const outage = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 503, errorMessage: 'gateway' }]);
    await expect(assessorSource(year).run(withParcel, outage)).rejects.toThrow(/503/);
  });

  it('throws when the parcel is unresolved and the building is not a condominium', async () => {
    await expect(assessorSource(ASSESSOR_YEARS[0]).run(tarnwick, fixtureFetch([]))).rejects.toThrow(/parcel/i);
  });
});
