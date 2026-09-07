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
import { fixtureFetch, type FixtureRoute } from './helpers/records/fixtureFetch';
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

  it('has 17 distinct resource ids across all legacy years and the new system', () => {
    const ids = [...LEGACY_311_RESOURCES.map((r) => r.resourceId), NEW_311_RESOURCE_ID];
    expect(new Set(ids).size).toBe(ids.length);
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
    expect(q).toContain(`upper("street_number") IN ('23','27','23-27')`);
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
    expect(result.rows).toHaveLength(8);

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

    // Documents current behavior: "Code Enforcement" is in HOUSING_REASONS (see that
    // constant's comment), so a trash-barrel complaint about the property's exterior
    // classifies as "housing" here, same as an interior heat or pest complaint.
    const codeEnforcement = payloadOf(result.rows.find((r) => payloadOf(r).caseId === '101005890001')!);
    expect(codeEnforcement).toMatchObject({
      system: 'legacy', reason: 'Code Enforcement', type: 'Improper Storage of Trash (Barrels)', classification: 'housing',
    });
  });

  it('fails the whole source when any single query fails', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: year2024.resourceId, errorStatus: 503 }]);
    await expect(serviceRequestsSource.run(lanark, fetchImpl)).rejects.toThrow(/503/);
  });

  it('caps at the count of distinct ids after dedupe, not at the raw pre-dedupe row count', async () => {
    // Two years repeat the same 300 case ids as each other. Raw rows across the two years
    // (600) exceed ROW_CAP, but distinct ids (300) do not. If the cap were ever applied to
    // the raw, undeduped stream, this would truncate to ROW_CAP; deduping first must leave
    // all 300 distinct rows untouched.
    const sharedRecords = Array.from({ length: 300 }, (_, i) => ({
      case_enquiry_id: `SHARED-${i}`,
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
    }));
    const [yearA, yearB] = LEGACY_311_RESOURCES;
    const fetchImpl = fixtureFetch([
      { resourceId: yearA.resourceId, records: sharedRecords },
      { resourceId: yearB.resourceId, records: sharedRecords },
    ]);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    expect(result.rows).toHaveLength(300);
    expect(new Set(result.rows.map((r) => payloadOf(r).caseId)).size).toBe(300);
  });

  it('keeps the ROW_CAP newest rows, across both systems, when distinct rows exceed the cap', async () => {
    const legacyCount = 40;
    const totalLegacy = LEGACY_311_RESOURCES.length * legacyCount; // 640, exceeds ROW_CAP
    // Monotonically increasing timestamps so "newest" has an unambiguous, checkable order.
    function ts(n: number): string {
      return new Date(Date.UTC(2000, 0, 1) + n * 1000).toISOString().replace('T', ' ').replace('Z', '');
    }
    const routes: FixtureRoute[] = LEGACY_311_RESOURCES.map(({ resourceId }, yearIdx) => ({
      resourceId,
      records: Array.from({ length: legacyCount }, (_, i) => {
        const n = yearIdx * legacyCount + i;
        return {
          case_enquiry_id: `Y${yearIdx}-${i}`,
          open_dt: ts(n),
          closed_dt: null,
          case_status: 'Open',
          closure_reason: null,
          case_title: 'Test',
          subject: 'Public Works Department',
          reason: 'Sanitation',
          type: 'Test',
          location: '23 Lanark Rd  Brighton  MA  02135',
          source: 'Constituent Call',
        };
      }),
    }));
    routes.push({
      resourceId: NEW_311_RESOURCE_ID,
      records: [{
        case_id: 'BCS-NEWEST',
        open_date: ts(totalLegacy + 1000), // newer than every legacy row
        close_date: null,
        case_status: 'Open',
        closure_reason: null,
        case_topic: 'Test',
        service_name: 'Test',
        assigned_department: 'Public Works Department (PWD)',
        full_address: '27 Lanark Rd, Boston, MA 02135',
        street_number: '27',
        street_name: 'Lanark Rd',
        zip_code: '02135',
        report_source: 'BOS311',
      }],
    });

    const fetchImpl = fixtureFetch(routes);
    const result = await serviceRequestsSource.run(lanark, fetchImpl);
    expect(result.rows).toHaveLength(ROW_CAP);

    const survivingIds = new Set(result.rows.map((r) => payloadOf(r).caseId));
    expect(survivingIds.has('BCS-NEWEST')).toBe(true);

    // Cross-system newest row plus the newest (ROW_CAP - 1) legacy rows should survive;
    // everything older should not.
    const cutoffN = totalLegacy - (ROW_CAP - 1);
    for (let n = 0; n < totalLegacy; n++) {
      const yearIdx = Math.floor(n / legacyCount);
      const i = n % legacyCount;
      const caseId = `Y${yearIdx}-${i}`;
      expect(survivingIds.has(caseId)).toBe(n >= cutoffN);
    }
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
