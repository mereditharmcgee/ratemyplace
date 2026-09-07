import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { bareStreetName, suffixSpellings } from '../records/sources/boston/violationFeeds';
import { enforcementSource, ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { violationsSource, VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import type { EnforcementTicketPayload, ViolationPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import lanarkRows from './helpers/records/enforcement-lanark.json';

const lanark = buildIdentity({
  id: 'b1', address: '23-27 Lanark Rd, Boston, MA', city: 'Boston', state: 'MA',
  zip_code: '02135', parcel_id: null, sam_id: '83763',
});

describe('violationFeeds helpers', () => {
  it('bareStreetName strips a leading directional when a word follows', () => {
    expect(bareStreetName({ streetBase: 'W NEWTON' })).toBe('NEWTON');
    expect(bareStreetName({ streetBase: 'LANARK' })).toBe('LANARK');
    expect(bareStreetName({ streetBase: 'NORTH' })).toBe('NORTH');
  });

  it('suffixSpellings derives every non-base spelling from streetForms', () => {
    expect(suffixSpellings({ streetBase: 'COMMONWEALTH', streetForms: ['COMMONWEALTH AV', 'COMMONWEALTH AVE', 'COMMONWEALTH AVENUE'] })).toEqual(['AV', 'AVE', 'AVENUE']);
    expect(suffixSpellings({ streetBase: 'UNION', streetForms: ['UNION PK', 'UNION PARK'] })).toEqual(['PK', 'PARK']);
    expect(suffixSpellings({ streetBase: 'BROADWAY', streetForms: ['BROADWAY'] })).toEqual([]);
  });

  it('bareStreetName and suffixSpellings agree with buildIdentity on a real address', () => {
    const identity = buildIdentity({
      id: 'b5', address: '5 St. Botolph St, Boston, MA', city: 'Boston', state: 'MA',
      zip_code: '02116', parcel_id: null, sam_id: null,
    });
    expect(bareStreetName(identity)).toBe('ST BOTOLPH');
    expect(suffixSpellings(identity)).toEqual(['ST', 'STREET']);
  });
});

describe('enforcementSource', () => {
  it('builds the exact query shape for the Lanark identity', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: lanarkRows }]);
    const result = await enforcementSource.run(lanark, fetchImpl);
    expect(result.query).toContain(`upper("violation_street") = 'LANARK'`);
    expect(result.query).toContain(`"violation_stno" IN ('23','27')`);
    expect(result.query).toContain(`"violation_sthigh" IN ('23','27')`);
    expect(result.query).toContain(`upper("violation_suffix") IN ('RD','ROAD')`);
    expect(result.query).toContain(`("violation_zip" IS NULL OR "violation_zip" = '' OR "violation_zip" = '02135')`);
    expect(result.query).toContain(`ORDER BY "status_dttm" DESC NULLS LAST, "case_no", "code", "_id" LIMIT 500`);
    expect(result.query).not.toContain('23-27');
  });

  it('maps rows and keys, dedupes on case_no:code', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: lanarkRows }]);
    const result = await enforcementSource.run(lanark, fetchImpl);
    expect(result.rows.map((r) => r.sourceKey)).toEqual(['CE7067:1', 'CE7067:9a', 'CE5252:9b']);
    const first = result.rows[0];
    expect(first.kind).toBe('enforcement_ticket');
    expect(first.payload as EnforcementTicketPayload).toMatchObject({
      caseNumber: 'CE7067', ticketNumber: 'T1', code: '1', description: 'Improper storage trash: res',
      status: 'Closed', statusDate: '2008-08-30 09:42:00', address: '23 Lanark RD',
      contactAddress: '1505 COMMONWEALTH  AV', samId: '83763',
    });
  });

  it('reconstructs a ranged address from stno/sthigh', async () => {
    const ranged = [{ ...lanarkRows[0], case_no: 'CE9999', code: '1', violation_stno: '55', violation_sthigh: '65' }];
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: ranged }]);
    const result = await enforcementSource.run(lanark, fetchImpl);
    expect((result.rows[0].payload as EnforcementTicketPayload).address).toBe('55-65 Lanark RD');
  });

  it('dedupes, keeping the first of two rows sharing case_no and code', async () => {
    const dup = [
      { ...lanarkRows[0], description: 'first' },
      { ...lanarkRows[0], description: 'second' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: dup }]);
    const result = await enforcementSource.run(lanark, fetchImpl);
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0].payload as EnforcementTicketPayload).description).toBe('first');
  });

  it('keeps the directional off the street and splits a range into numbers', async () => {
    const wNewton = buildIdentity({ id: 'b2', address: '84-86 W Newton St, Boston, MA', city: 'Boston', state: 'MA', zip_code: '02118', parcel_id: null, sam_id: null });
    const fetchImpl = fixtureFetch([]);
    const result = await enforcementSource.run(wNewton, fetchImpl);
    expect(result.query).toContain(`upper("violation_street") = 'NEWTON'`);
    expect(result.query).toContain(`"violation_stno" IN ('84','86')`);
  });

  it('keeps a bare directional word as the street name', async () => {
    const north = buildIdentity({ id: 'b3', address: '12 North St, Boston, MA', city: 'Boston', state: 'MA', zip_code: '02118', parcel_id: null, sam_id: null });
    const fetchImpl = fixtureFetch([]);
    const result = await enforcementSource.run(north, fetchImpl);
    expect(result.query).toContain(`upper("violation_street") = 'NORTH'`);
  });

  it('omits the suffix and zip predicates when the identity has neither', async () => {
    const broadway = buildIdentity({ id: 'b4', address: '10 Broadway, Boston, MA', city: 'Boston', state: 'MA', zip_code: null, parcel_id: null, sam_id: null });
    const fetchImpl = fixtureFetch([]);
    const result = await enforcementSource.run(broadway, fetchImpl);
    expect(result.query).not.toContain('upper("violation_suffix")');
    expect(result.query).not.toContain('"violation_zip"');
  });

  it('matches a lettered number and reconstructs the lettered address with no hyphen', async () => {
    const lettered = buildIdentity({
      id: 'b6', address: '120A Lanark Rd, Boston, MA', city: 'Boston', state: 'MA',
      zip_code: '02135', parcel_id: null, sam_id: null,
    });
    const row = { ...lanarkRows[0], case_no: 'CE8888', code: '1', violation_stno: '120', violation_sthigh: 'A' };
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: [row] }]);
    const result = await enforcementSource.run(lettered, fetchImpl);
    expect(result.query).toContain(`"violation_stno" IN ('120A','120')`);
    expect(result.query).toContain(`'120A'`);
    expect(result.query).toContain(`'120'`);
    expect((result.rows[0].payload as EnforcementTicketPayload).address).toBe('120A Lanark RD');
  });

  it('still maps a row with a null violation_suffix and tolerates it in the SQL', async () => {
    const row = { ...lanarkRows[0], case_no: 'CE4444', code: '1', violation_suffix: null };
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: [row] }]);
    const result = await enforcementSource.run(lanark, fetchImpl);
    expect(result.query).toContain(`"violation_suffix" IS NULL OR "violation_suffix" = ''`);
    expect((result.rows[0].payload as EnforcementTicketPayload).address).toBe('23 Lanark');
  });
});

describe('violationsSource', () => {
  it('queries the violations resource and maps rows without a ticketNumber field', async () => {
    const row = { ...lanarkRows[0] };
    delete (row as Record<string, unknown>).ticket_no;
    const fetchImpl = fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [row] }]);
    const result = await violationsSource.run(lanark, fetchImpl);
    expect(result.query).toContain(VIOLATIONS_RESOURCE_ID);
    expect(result.rows[0].kind).toBe('violation');
    const payload = result.rows[0].payload as ViolationPayload;
    expect(payload).not.toHaveProperty('ticketNumber');
    expect(payload.caseNumber).toBe('CE7067');
  });

  it('returns an empty row list for an empty feed', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [] }]);
    const result = await violationsSource.run(lanark, fetchImpl);
    expect(result.rows).toEqual([]);
  });

  it('does not select ticket_no', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [] }]);
    const result = await violationsSource.run(lanark, fetchImpl);
    expect(result.query).not.toContain('"ticket_no"');
  });
});
