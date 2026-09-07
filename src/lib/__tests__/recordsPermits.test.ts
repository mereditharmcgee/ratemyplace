import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { permitsSource, PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import type { PermitPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import positive from './helpers/records/permits-positive.json';

const fiftyFive = {
  ...buildIdentity({ id: 'b2', address: '55-65 Lanark Rd, Boston, MA', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: '2102110000', sam_id: null }),
};

describe('permitsSource', () => {
  it('queries by numeric parcel and every address form, both suffix spellings', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(fiftyFive, fetchImpl);
    expect(result.query).toContain('"parcel_id" = 2102110000');
    expect(result.query).toContain(`upper("address") LIKE '55 LANARK RD%' ESCAPE '\\'`);
    expect(result.query).toContain(`upper("address") LIKE '55-65 LANARK ROAD%' ESCAPE '\\'`);
    expect(result.query).toContain('ORDER BY "issued_date" DESC');
  });

  it('maps rows, parses money, and deduplicates on permit number', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: PERMITS_RESOURCE_ID, records: positive }]);
    const result = await permitsSource.run(fiftyFive, fetchImpl);
    expect(result.rows.map((r) => r.sourceKey)).toEqual(['A1000569', 'E123']);
    const first = result.rows[0].payload as PermitPayload;
    expect(first).toMatchObject({
      permitNumber: 'A1000569', permitType: 'Amendment to a Long Form', declaredValuation: 36500, totalFees: 390,
      issuedDate: '2021-01-28T16:29:26', status: 'Closed', address: '55-65 Lanark RD',
    });
    expect(result.rows[0].kind).toBe('permit');
  });

  it('omits the parcel clause when the building has no parcel', async () => {
    const noParcel = { ...fiftyFive, parcelId: null, parcelNumeric: null };
    const fetchImpl = fixtureFetch([]);
    const result = await permitsSource.run(noParcel, fetchImpl);
    expect(result.query).not.toContain('parcel_id');
    expect(result.rows).toEqual([]);
  });
});
