import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { resolveParcel, assessorSource, ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import type { AssessmentPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import condo2026 from './helpers/records/assessor-fy2026-condo.json';
import lanark2021 from './helpers/records/assessor-fy2021-lanark.json';

const lanark = buildIdentity({ id: 'b1', address: '23-27 Lanark Rd, Boston, MA 02135', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null });
const FY2021_RESOURCE_ID = 'c4b7331e-e213-45a5-adda-052e4dd31d41';

describe('resolveParcel', () => {
  it('finds a whole-building parcel by ST_NUM or ST_NUM2 with case-folded street', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]);
    const result = await resolveParcel(lanark, fetchImpl);
    expect(result).toEqual({ parcelId: '2102098000', condominium: false, candidates: 1 });
    expect(fetchImpl.calls[0]).toContain(`upper("ST_NAME") = 'LANARK RD'`);
    expect(fetchImpl.calls[0]).toContain(`"ST_NUM" IN ('23','27','23-27')`);
    expect(fetchImpl.calls[0]).toContain(`"ST_NUM2" IN ('23','27')`);
  });

  it('reports a condominium when only CD and CM rows match, and stores no parcel', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: condo2026 }]);
    const fiftyFive = buildIdentity({ id: 'b2', address: '55 Lanark Rd, Boston, MA', city: 'Boston', state: 'MA', zip_code: null, parcel_id: null, sam_id: null });
    expect(await resolveParcel(fiftyFive, fetchImpl)).toEqual({ parcelId: null, condominium: true, candidates: 3 });
  });

  it('returns no parcel and the candidate count when several whole-building rows match', async () => {
    const two = [
      { ...lanark2026[0], PID: '1' },
      { ...lanark2026[0], PID: '2' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: two }]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({ parcelId: null, condominium: false, candidates: 2 });
  });

  it('returns zero candidates when nothing matches', async () => {
    const fetchImpl = fixtureFetch([]);
    expect(await resolveParcel(lanark, fetchImpl)).toEqual({ parcelId: null, condominium: false, candidates: 0 });
  });
});

describe('assessorSource', () => {
  const withParcel = { ...lanark, parcelId: '2102098000', parcelNumeric: '2102098000' };

  it('has six fiscal years, newest first, each owning its own source key', () => {
    expect(ASSESSOR_YEARS.map((y) => y.fiscalYear)).toEqual(['FY2026', 'FY2025', 'FY2024', 'FY2023', 'FY2022', 'FY2021']);
    expect(assessorSource(ASSESSOR_YEARS[0]).ownsSourceKey).toBe('FY2026');
    expect(assessorSource(ASSESSOR_YEARS[0]).kinds).toEqual(['assessment']);
  });

  it('maps a modern row to an AssessmentPayload with parsed numbers', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]);
    const result = await assessorSource(ASSESSOR_YEARS[0]).run(withParcel, fetchImpl);
    expect(result.query).toContain(`"PID" IN ('2102098000')`);
    expect(result.rows).toHaveLength(1);
    const payload = result.rows[0].payload as AssessmentPayload;
    expect(result.rows[0].sourceKey).toBe('FY2026');
    expect(payload).toMatchObject({
      fiscalYear: 'FY2026', parcelId: '2102098000', owner: 'LANARK ROAD LLC MASS LLC',
      mailAddressee: 'C/O ATT DENNIS CLAIR', mailStreet: 'PO BOX 35006', mailCity: 'BOSTON', mailState: 'MA', mailZip: '02135',
      landUse: 'A', landUseDescription: 'APT 7-30 UNITS', yearBuilt: 1920, yearRemodel: 1980,
      grossArea: 34650, livingArea: 27720, residentialUnits: null, commercialUnits: null,
      totalValue: 6720200, landValue: 1620500, buildingValue: 5099700, condominium: false,
    });
  });

  it('maps a legacy FY2021 row through its column map', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, records: lanark2021 }]);
    const year = ASSESSOR_YEARS.find((y) => y.fiscalYear === 'FY2021')!;
    const result = await assessorSource(year).run(withParcel, fetchImpl);
    const payload = result.rows[0].payload as AssessmentPayload;
    expect(payload).toMatchObject({ fiscalYear: 'FY2021', mailStreet: 'PO BOX 35006', mailZip: '02135', totalValue: 6649200, landValue: 1488900 });
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
    expect((current.rows[0].payload as AssessmentPayload)).toMatchObject({ condominium: true, owner: null, parcelId: null });
    const history = await assessorSource(ASSESSOR_YEARS[1]).run(condo, fetchImpl);
    expect(history.rows).toEqual([]);
    expect(fetchImpl.calls).toEqual([]);
  });

  it('treats a missing-column error as empty, and rethrows any other error', async () => {
    const missing = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 409, errorMessage: 'column "ZIPCODE" does not exist' }]);
    const year = ASSESSOR_YEARS.find((y) => y.fiscalYear === 'FY2021')!;
    expect((await assessorSource(year).run(withParcel, missing)).rows).toEqual([]);

    const outage = fixtureFetch([{ resourceId: FY2021_RESOURCE_ID, errorStatus: 503, errorMessage: 'gateway' }]);
    await expect(assessorSource(year).run(withParcel, outage)).rejects.toThrow(/503/);
  });

  it('throws when the parcel is unresolved and the building is not a condominium', async () => {
    await expect(assessorSource(ASSESSOR_YEARS[0]).run(lanark, fixtureFetch([]))).rejects.toThrow(/parcel/i);
  });
});
