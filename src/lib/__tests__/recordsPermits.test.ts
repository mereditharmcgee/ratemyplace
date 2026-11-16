import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { permitsSource, PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import type { PermitPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import positive from './helpers/records/permits-positive.json';

const oneTwentySeven = {
  ...buildIdentity({ id: 'b2', address: '127-129 Tarnwick Pl, Boston, MA', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: '2108871000', sam_id: null }),
};

describe('permitsSource', () => {
  it('queries by numeric parcel and every address form, both suffix spellings', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(oneTwentySeven, fetchImpl);
    expect(result.query).toContain('"parcel_id" = 2108871000');
    expect(result.query).toContain(`upper("address") LIKE '127 TARNWICK PL%' ESCAPE '!'`);
    expect(result.query).toContain(`upper("address") LIKE '127-129 TARNWICK PLACE%' ESCAPE '!'`);
    expect(result.query).toContain('ORDER BY "issued_date" DESC');
  });

  it('maps rows, parses money, and deduplicates on permit number, keeping the first row', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(oneTwentySeven, fetchImpl);
    expect(result.rows.map((r) => r.sourceKey)).toEqual(['SF437182', 'E123']);
    const first = result.rows[0].payload as PermitPayload;
    expect(first).toMatchObject({
      permitNumber: 'SF437182', permitType: 'Short Form Bldg Permit', declaredValuation: 23600, totalFees: 263,
      issuedDate: '2022-12-05T11:24:37', status: 'Closed', address: '127-129 Tarnwick PL',
    });
    expect(result.rows[0].kind).toBe('permit');
    const second = result.rows[1].payload as PermitPayload;
    expect(second.description).toBe('Electrical');
  });

  it('omits the parcel clause when the building has no parcel', async () => {
    const noParcel = { ...oneTwentySeven, parcelId: null, parcelNumeric: null };
    const fetchImpl = fixtureFetch([]);
    const result = await permitsSource.run(noParcel, fetchImpl);
    expect(result.query).not.toContain('"parcel_id" =');
    expect(result.rows).toEqual([]);
  });

  it('qualifies the address arm by zip when the identity has a 5-digit zip', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(oneTwentySeven, fetchImpl);
    expect(result.query).toContain(`("zip" IS NULL OR "zip" = '02135')`);
  });

  it('omits the zip qualifier when the identity has no zip', async () => {
    const noZip = { ...oneTwentySeven, zip: null };
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(noZip, fetchImpl);
    expect(result.query).not.toContain('"zip"');
  });

  it('orders deterministically by issued_date, then permitnumber, then _id', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(oneTwentySeven, fetchImpl);
    expect(result.query).toContain('ORDER BY "issued_date" DESC, "permitnumber", "_id" LIMIT 500');
  });

  it('tries the long form of an assessor-only suffix: GRAMPIAN WY and GRAMPIAN WAY', async () => {
    const grampian = buildIdentity({ id: 'g', address: '9 Grampian Wy', city: 'Boston', state: 'MA', zip_code: '02125', parcel_id: '1302537000', sam_id: null });
    const result = await permitsSource.run(grampian, fixtureFetch([]));
    expect(result.query).toContain(`upper("address") LIKE '9 GRAMPIAN WY%' ESCAPE '!'`);
    expect(result.query).toContain(`upper("address") LIKE '9 GRAMPIAN WAY%' ESCAPE '!'`);
  });

  it('tries LN for an assessor La street, since the permits feed writes RADFORD LN', async () => {
    const radford = buildIdentity({ id: 'r', address: '11 Radford La', city: 'Boston', state: 'MA', zip_code: '02132', parcel_id: null, sam_id: null });
    const result = await permitsSource.run(radford, fixtureFetch([]));
    expect(result.query).toContain(`upper("address") LIKE '11 RADFORD LN%' ESCAPE '!'`);
  });
});
