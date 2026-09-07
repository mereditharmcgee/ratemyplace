import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { ROW_CAP } from '../records/ckan';
import {
  HOUSING_DEPARTMENT_PREFIX,
  HOUSING_REASONS,
  LEGACY_311_RESOURCES,
  NEW_311_RESOURCE_ID,
  classifyLegacy,
  classifyNew,
  serviceRequestsSource,
} from '../records/sources/boston/serviceRequests';
import type { RecordRow, ServiceRequestPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import lanark2024 from './helpers/records/311-2024-lanark.json';
import lanarkNew from './helpers/records/311-new-lanark.json';

const lanark = buildIdentity({
  id: 'b1', address: '23-27 Lanark Rd, Boston, MA', city: 'Boston', state: 'MA', zip_code: '02135', parcel_id: null, sam_id: null,
});

function payloadOf(row: RecordRow): ServiceRequestPayload {
  return row.payload as ServiceRequestPayload;
}

const year2024 = LEGACY_311_RESOURCES.find((r) => r.year === 2024)!;
const year2023 = LEGACY_311_RESOURCES.find((r) => r.year === 2023)!;

describe('serviceRequestsSource', () => {
  it('lists legacy resources newest first, from 2026 down to 2011', () => {
    expect(LEGACY_311_RESOURCES.map((r) => r.year)).toEqual(Array.from({ length: 16 }, (_, i) => 2026 - i));
  });

  it('is identified by the new-system resource id and owns only service_request rows', () => {
    expect(serviceRequestsSource.id).toBe(NEW_311_RESOURCE_ID);
    expect(serviceRequestsSource.kinds).toEqual(['service_request']);
  });

  it('runs exactly 17 queries and stores them as a JSON array', async () => {
    const fetchImpl = fixtureFetch([]);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    expect(fetchImpl.calls).toHaveLength(17);
    const queries = JSON.parse(result.query);
    expect(Array.isArray(queries)).toBe(true);
    expect(queries).toHaveLength(17);
  });

  it('builds the expected legacy query shape, address forms and zip predicate', async () => {
    const fetchImpl = fixtureFetch([]);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    const queries: string[] = JSON.parse(result.query);
    const q = queries.find((sql) => sql.includes(year2024.resourceId));
    expect(q).toBeDefined();
    expect(q).toContain(`upper("location") LIKE '23-27 LANARK RD%' ESCAPE '\\'`);
    expect(q).toContain(`upper("location") LIKE '27 LANARK ROAD%' ESCAPE '\\'`);
    expect(q).toContain(`("location_zipcode" IS NULL OR "location_zipcode" = '02135')`);
    expect(q).toContain(`ORDER BY "open_dt" DESC, "case_enquiry_id" LIMIT 500`);
  });

  it('builds the expected new-system query shape, street forms, numbers and zip predicate', async () => {
    const fetchImpl = fixtureFetch([]);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    const queries: string[] = JSON.parse(result.query);
    const q = queries.find((sql) => sql.includes(NEW_311_RESOURCE_ID));
    expect(q).toBeDefined();
    expect(q).toContain(`upper("street_name") IN ('LANARK RD','LANARK ROAD')`);
    expect(q).toContain(`"street_number" IN ('23','27','23-27')`);
    expect(q).toContain(`("zip_code" IS NULL OR "zip_code" = '02135')`);
    expect(q).toContain(`ORDER BY "open_date" DESC, "case_id" LIMIT 500`);
  });

  it('maps, classifies, and dedupes rows across legacy years and the new system', async () => {
    const fetchImpl = fixtureFetch([
      { resourceId: year2024.resourceId, records: lanark2024 },
      { resourceId: year2023.resourceId, records: [lanark2024[0]] },
      { resourceId: NEW_311_RESOURCE_ID, records: lanarkNew },
    ]);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    expect(result.rows).toHaveLength(7);

    const sanitation = payloadOf(result.rows.find((r) => payloadOf(r).caseId === '101005238959')!);
    expect(sanitation).toMatchObject({
      system: 'legacy', classification: 'other', reason: 'Sanitation', openedAt: '2024-01-06 12:20:00', status: 'Open',
    });

    const housing = payloadOf(result.rows.find((r) => payloadOf(r).caseId === '101009999999')!);
    expect(housing.classification).toBe('housing');
    expect(housing.closedAt).toBe('2024-12-20 08:00:00');

    const newRow = payloadOf(result.rows.find((r) => payloadOf(r).caseId === 'BCS-00300001')!);
    expect(newRow).toMatchObject({
      system: 'new', classification: 'housing', title: 'Unsatisfactory Living Conditions', location: '27 Lanark Rd, Boston, MA 02135',
    });
  });

  it('fails the whole source when any single query fails', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: year2024.resourceId, errorStatus: 503 }]);
    await expect(serviceRequestsSource.run(lanark, fetchImpl)).rejects.toThrow(/503/);
  });

  it('caps the total row count at ROW_CAP after cross-query dedupe', async () => {
    const routes = LEGACY_311_RESOURCES.map(({ resourceId }, yearIdx) => ({
      resourceId,
      records: Array.from({ length: 40 }, (_, i) => ({
        case_enquiry_id: `Y${yearIdx}-${i}`,
        open_dt: '2020-01-01 00:00:00',
        closed_dt: null,
        case_status: 'Open',
        closure_reason: null,
        case_title: 'Test',
        subject: 'Public Works Department',
        reason: 'Sanitation',
        type: 'Test',
        location: '23 Lanark Rd  Brighton  MA  02135',
        source: 'Constituent Call',
      })),
    }));
    const fetchImpl = fixtureFetch(routes);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    expect(result.rows).toHaveLength(ROW_CAP);
  });

  it('classifies legacy and new-system rows via the published lists', () => {
    expect(HOUSING_REASONS).toEqual(['Housing', 'Building', 'Code Enforcement']);
    expect(classifyLegacy('Housing')).toBe('housing');
    expect(classifyLegacy('Street Cleaning')).toBe('other');
    expect(classifyLegacy(null)).toBe('other');
    expect(HOUSING_DEPARTMENT_PREFIX).toBe('Inspectional Services');
    expect(classifyNew('Inspectional Services Department (ISD)')).toBe('housing');
    expect(classifyNew('Public Works Department (PWD)')).toBe('other');
    expect(classifyNew(null)).toBe('other');
  });

  it('omits zip predicates from both query shapes when identity has no zip', async () => {
    const noZip = { ...lanark, zip: null };
    const fetchImpl = fixtureFetch([]);
    const result = await serviceRequestsSource.run(noZip, fetchImpl);
    const queries: string[] = JSON.parse(result.query);
    for (const q of queries) {
      expect(q).not.toMatch(/location_zipcode|zip_code/);
    }
  });
});
