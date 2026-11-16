import { describe, it, expect } from 'vitest';
import { buildIdentity } from '../records/identity';
import { bareStreetName, suffixSpellings } from '../records/sources/boston/violationFeeds';
import { enforcementSource, ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { violationsSource, VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import type { EnforcementTicketPayload, ViolationPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import tarnwickRows from './helpers/records/enforcement-tarnwick.json';

const tarnwick = buildIdentity({
  id: 'b1', address: '52-68 Tarnwick Pl, Boston, MA', city: 'Boston', state: 'MA',
  zip_code: '02135', parcel_id: null, sam_id: '58344',
});

describe('violationFeeds helpers', () => {
  it('bareStreetName strips a leading directional when a word follows', () => {
    expect(bareStreetName({ streetBase: 'W NEWTON' })).toBe('NEWTON');
    expect(bareStreetName({ streetBase: 'TARNWICK' })).toBe('TARNWICK');
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
  it('builds the exact query shape for the practice identity', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: tarnwickRows }]);
    const result = await enforcementSource.run(tarnwick, fetchImpl);
    expect(result.query).toContain(`upper("violation_street") = 'TARNWICK'`);
    expect(result.query).toContain(`"violation_stno" IN ('52','54','56','58','60','62','64','66','68')`);
    expect(result.query).toContain(`"violation_sthigh" IN ('52','54','56','58','60','62','64','66','68')`);
    expect(result.query).toContain(`upper("violation_suffix") IN ('PL','PLACE')`);
    expect(result.query).toContain(`("violation_zip" IS NULL OR "violation_zip" = '' OR "violation_zip" = '02135')`);
    expect(result.query).toContain(`ORDER BY "status_dttm" DESC NULLS LAST, "case_no", "code", "_id" LIMIT 500`);
    expect(result.query).not.toContain('52-68');
  });

  it('maps rows and keys, dedupes on case_no:code', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: tarnwickRows }]);
    const result = await enforcementSource.run(tarnwick, fetchImpl);
    expect(result.rows.map((r) => r.sourceKey)).toEqual([
      'CE0916:1', 'CE0916:3', 'CE0915:1', 'CE0914:1', 'CE0914:21a', 'CE0913:17a',
      'CE0913:17c', 'CE0912:24', 'CE0912:1', 'CE0911:3', 'CE0911:25', 'CE0910:1',
      'CE0910:3', 'CE0909:1', 'CE0909:25', 'CE0908:17a', 'CE0907:1', 'CE0907:24',
      'CE0906:1', 'CE0906:3', 'CE0905:21a', 'CE0905:1', 'CE0904:24', 'CE0904:25',
      'CE0903:1', 'CE0902:1', 'CE0902:3', 'CE0901:1', 'CE0901:3',
    ]);
    const first = result.rows[0];
    expect(first.kind).toBe('enforcement_ticket');
    expect(first.payload as EnforcementTicketPayload).toMatchObject({
      caseNumber: 'CE0916', ticketNumber: 'T16', code: '1', description: 'Improper storage trash: res',
      status: 'Open', statusDate: '2025-01-23 08:31:00', address: '52 Tarnwick PL',
      contactAddress: '88 FELLWICK  AV', samId: '58344',
    });
  });

  it('reconstructs a ranged address from stno/sthigh', async () => {
    const ranged = [{ ...tarnwickRows[0], case_no: 'CE9999', code: '1', violation_stno: '127', violation_sthigh: '129' }];
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: ranged }]);
    const result = await enforcementSource.run(tarnwick, fetchImpl);
    expect((result.rows[0].payload as EnforcementTicketPayload).address).toBe('127-129 Tarnwick PL');
  });

  it('dedupes, keeping the first of two rows sharing case_no and code', async () => {
    const dup = [
      { ...tarnwickRows[0], description: 'first' },
      { ...tarnwickRows[0], description: 'second' },
    ];
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: dup }]);
    const result = await enforcementSource.run(tarnwick, fetchImpl);
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
      id: 'b6', address: '120A Tarnwick Pl, Boston, MA', city: 'Boston', state: 'MA',
      zip_code: '02135', parcel_id: null, sam_id: null,
    });
    const row = { ...tarnwickRows[0], case_no: 'CE8888', code: '1', violation_stno: '120', violation_sthigh: 'A' };
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: [row] }]);
    const result = await enforcementSource.run(lettered, fetchImpl);
    expect(result.query).toContain(`"violation_stno" IN ('120A','120')`);
    expect(result.query).toContain(`'120A'`);
    expect(result.query).toContain(`'120'`);
    expect((result.rows[0].payload as EnforcementTicketPayload).address).toBe('120A Tarnwick PL');
  });

  it('still maps a row with a null violation_suffix and tolerates it in the SQL', async () => {
    const row = { ...tarnwickRows[0], case_no: 'CE4444', code: '1', violation_suffix: null };
    const fetchImpl = fixtureFetch([{ resourceId: ENFORCEMENT_RESOURCE_ID, records: [row] }]);
    const result = await enforcementSource.run(tarnwick, fetchImpl);
    expect(result.query).toContain(`"violation_suffix" IS NULL OR "violation_suffix" = ''`);
    expect((result.rows[0].payload as EnforcementTicketPayload).address).toBe('52 Tarnwick');
  });
});

describe('violationsSource', () => {
  it('queries the violations resource and maps rows without a ticketNumber field', async () => {
    const row = { ...tarnwickRows[0] };
    delete (row as Record<string, unknown>).ticket_no;
    const fetchImpl = fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [row] }]);
    const result = await violationsSource.run(tarnwick, fetchImpl);
    expect(result.query).toContain(VIOLATIONS_RESOURCE_ID);
    expect(result.rows[0].kind).toBe('violation');
    const payload = result.rows[0].payload as ViolationPayload;
    expect(payload).not.toHaveProperty('ticketNumber');
    expect(payload.caseNumber).toBe('CE0916');
  });

  it('returns an empty row list for an empty feed', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [] }]);
    const result = await violationsSource.run(tarnwick, fetchImpl);
    expect(result.rows).toEqual([]);
  });

  it('does not select ticket_no', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [] }]);
    const result = await violationsSource.run(tarnwick, fetchImpl);
    expect(result.query).not.toContain('"ticket_no"');
  });
});

// The feeds store the bare street ('GRAMPIAN') and the suffix apart (WY, HW, PW, CI, RO, AL, CR,
// LN). Before the October 2026 suffixes, an unknown suffix stayed glued to the street name, so
// `violation_street = 'GRAMPIAN WY'` matched nothing for every one of these buildings.
describe('violation feeds on the assessor suffixes added in October 2026', () => {
  function identityFor(address: string) {
    return buildIdentity({ id: 'n', address, city: 'Boston', state: 'MA', zip_code: '02125', parcel_id: null, sam_id: null });
  }

  it('splits GRAMPIAN off WY and offers both spellings of the suffix', async () => {
    const grampian = identityFor('9 Grampian Wy');
    expect(bareStreetName(grampian)).toBe('GRAMPIAN');
    expect(suffixSpellings(grampian)).toEqual(['WY', 'WAY']);
    const result = await violationsSource.run(grampian, fixtureFetch([{ resourceId: VIOLATIONS_RESOURCE_ID, records: [] }]));
    expect(result.query).toContain(`upper("violation_street") = 'GRAMPIAN'`);
    expect(result.query).toContain(`upper("violation_suffix") IN ('WY','WAY')`);
  });

  it('offers LA, LN and LANE for an assessor La street', () => {
    expect(suffixSpellings(identityFor('11 Radford La'))).toEqual(['LA', 'LN', 'LANE']);
  });

  it('strips the directional and splits the new suffix off together', async () => {
    const roxbury = identityFor('566 W Roxbury Pw');
    expect(bareStreetName(roxbury)).toBe('ROXBURY');
    expect(suffixSpellings(roxbury)).toEqual(['PW', 'PKWY', 'PARKWAY']);
    const result = await enforcementSource.run(roxbury, fixtureFetch([]));
    expect(result.query).toContain(`upper("violation_street") = 'ROXBURY'`);
    expect(result.query).toContain(`upper("violation_suffix") IN ('PW','PKWY','PARKWAY')`);
  });
});
