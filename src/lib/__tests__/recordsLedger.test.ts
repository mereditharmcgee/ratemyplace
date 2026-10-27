import { describe, it, expect } from 'vitest';
import { ledgerModel } from '../records/ledger';
import { CAPPED_REQUESTS_COPY, CAPPED_ROWS_COPY, NOT_RECORDED, STILL_OPEN_NOTE } from '../records/display';
import { ROW_CAP } from '../records/ckan';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import { ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { NEW_311_RESOURCE_ID } from '../records/sources/boston/serviceRequests';
import type { BuildingRecordsView, SourceStatus } from '../records/query';
import type {
  EnforcementTicketPayload,
  PermitPayload,
  RentSmartPayload,
  ServiceRequestPayload,
  ViolationPayload,
} from '../records/types';

/**
 * The per-source view model behind the ledger. It used to be thirty-five lines of derivation
 * in the template's frontmatter, where the only way to check a count was to render the page.
 * Every figure the four rows show is decided here, so it can be checked here.
 */

const NOW = new Date('2026-06-15T12:00:00Z');

function status(overrides: Partial<SourceStatus> = {}): SourceStatus {
  return {
    sourceId: 'source',
    label: 'Source',
    pageUrl: null,
    status: 'ok',
    retrievedAt: 1_770_000_000,
    errorMessage: null,
    ...overrides,
  };
}

function view(overrides: Partial<BuildingRecordsView> = {}): BuildingRecordsView {
  return {
    pulledAt: 1_770_000_000,
    sources: {},
    assessments: [],
    permits: [],
    violations: [],
    enforcement: [],
    serviceRequests: [],
    rentsmart: [],
    invalidKinds: [],
    corrections: [],
    ...overrides,
  };
}

/** Every source pulled successfully, so a section's state is whatever its rows say. */
function allPulled(): Record<string, SourceStatus> {
  return {
    [NEW_311_RESOURCE_ID]: status({ sourceId: NEW_311_RESOURCE_ID }),
    [PERMITS_RESOURCE_ID]: status({ sourceId: PERMITS_RESOURCE_ID }),
    [ENFORCEMENT_RESOURCE_ID]: status({ sourceId: ENFORCEMENT_RESOURCE_ID }),
    [VIOLATIONS_RESOURCE_ID]: status({ sourceId: VIOLATIONS_RESOURCE_ID }),
  };
}

function permit(overrides: Partial<PermitPayload> = {}): PermitPayload {
  return {
    permitNumber: 'P1',
    workType: null,
    permitType: null,
    description: null,
    comments: null,
    applicant: null,
    declaredValuation: null,
    totalFees: null,
    issuedDate: null,
    expirationDate: null,
    status: null,
    occupancyType: null,
    address: null,
    ...overrides,
  };
}

function request(overrides: Partial<ServiceRequestPayload> = {}): ServiceRequestPayload {
  return {
    caseId: 'C1',
    system: 'new',
    openedAt: null,
    closedAt: null,
    status: null,
    closureReason: null,
    title: null,
    subject: 'Inspectional Services',
    reason: 'Housing',
    type: 'Unsatisfactory Living Conditions',
    location: null,
    source: null,
    classification: 'housing',
    ...overrides,
  };
}

function violation(overrides: Partial<ViolationPayload> = {}): ViolationPayload {
  return {
    caseNumber: 'V1',
    code: null,
    value: null,
    description: null,
    status: null,
    statusDate: null,
    address: null,
    contactAddress: null,
    samId: null,
    ...overrides,
  };
}

function ticket(overrides: Partial<EnforcementTicketPayload> = {}): EnforcementTicketPayload {
  return { ...violation(), ticketNumber: 'T1', ...overrides };
}

function rentsmart(overrides: Partial<RentSmartPayload> = {}): RentSmartPayload {
  return {
    rowId: 'R1',
    date: null,
    violationType: null,
    description: null,
    address: null,
    parcel: null,
    ...overrides,
  };
}

describe('ledgerModel counts', () => {
  it('counts each source and qualifies the count with what is still open', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'a', openedAt: '2024-02-01', status: 'Open' }),
          request({ caseId: 'b', openedAt: '2025-02-01', status: 'Closed' }),
          request({ caseId: 'c', reason: 'Street Cleaning', type: 'Requests for Street Cleaning', classification: 'other' }),
        ],
        permits: [
          permit({ permitNumber: 'p1', issuedDate: '2019-04-01', status: 'Open', declaredValuation: 36_500 }),
          permit({ permitNumber: 'p2', issuedDate: '2021-04-01', status: 'Closed', declaredValuation: 1_200 }),
        ],
        enforcement: [ticket({ statusDate: '2022-01-01', status: 'Open' })],
        violations: [],
      }),
      NOW,
    );

    expect(model.living.count).toBe('2');
    expect(model.living.subCount).toBe('1 open');
    expect(model.other.count).toBe(1);
    expect(model.other.line).toBe(
      '1 other 311 request at or near this address, about something like parking, trash pickup or streetlights, falls outside these groups. It is counted here, not listed.',
    );

    expect(model.permits.count).toBe('2');
    expect(model.permits.subCount).toBe('1 open · $37.7K declared');

    expect(model.enforcement.count).toBe('1');
    expect(model.enforcement.subCount).toBe('1 open');

    // Empty is not the same as unknown: the source answered, and it answered with nothing.
    expect(model.violations.count).toBe('0');
    expect(model.violations.subCount).toBe('none on record');
  });

  it('pluralises the other-requests line and drops it when there are none', () => {
    const other = { reason: 'Street Lights', type: 'Street Light Outages', classification: 'other' as const };
    const rows = [request({ caseId: 'x', ...other }), request({ caseId: 'y', ...other })];
    const model = ledgerModel(view({ sources: allPulled(), serviceRequests: rows }), NOW);
    expect(model.other.line).toBe(
      '2 other 311 requests at or near this address, such as parking, trash pickup and streetlights, fall outside these groups. They are counted here, not listed.',
    );
    // The line no longer sits on a group's row, where it read as a second figure for that row's list.
    expect(model.living.note).toBeNull();

    const none = ledgerModel(view({ sources: allPulled() }), NOW);
    expect(none.other.line).toBeNull();
  });

  it('states no other-requests line when 311 was never retrieved', () => {
    const sources = allPulled();
    delete sources[NEW_311_RESOURCE_ID];
    const model = ledgerModel(view({ sources }), NOW);
    expect(model.other.line).toBeNull();
    expect(model.living.count).toBe('—');
    expect(model.buildingRequests.count).toBe('—');
    expect(model.upkeepRequests.count).toBe('—');
  });

  it('breaks the rows down by year and by category', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'a', openedAt: '2024-02-01', type: 'Heat - Excessive  Insufficient' }),
          request({ caseId: 'b', openedAt: '2024-05-01', type: 'Heat - Excessive  Insufficient' }),
          request({ caseId: 'c', openedAt: '2026-05-01', type: 'Bed Bugs' }),
        ],
      }),
      NOW,
    );

    expect(model.living.years.map((entry) => entry.year)).toEqual([2024, 2025, 2026]);
    expect(model.living.years[1].count).toBe(0);
    expect(model.living.types.top).toEqual([
      { key: 'Heat - Excessive  Insufficient', count: 2 },
      { key: 'Bed Bugs', count: 1 },
    ]);
  });
});

describe('ledgerModel spans', () => {
  it('states the span as the years the source actually has rows for', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [request({ caseId: 'a', openedAt: '2024-02-01' })],
      }),
      NOW,
    );
    // The one request is filed in 2024; the chart's axis runs on to the current year, but the
    // coverage label must not claim 2025 and 2026 as years the records reach into.
    expect(model.living.span).toBe('2024');
  });

  it('ignores a garbage year and a 1900 sentinel rather than widening the permit span', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        permits: [
          permit({ permitNumber: 'junk', issuedDate: '0201-01-01' }),
          permit({ permitNumber: 'sentinel', issuedDate: '1900-01-01' }),
          permit({ permitNumber: 'real', issuedDate: '2019-04-01' }),
        ],
      }),
      NOW,
    );

    // Permits are on record from 2006, so the bars still run the full window and neither bad
    // date can drag it back. Unbounded, `0201` alone would have drawn one thousand eight
    // hundred and twenty-six bars. The coverage label, though, is the one real permit's year —
    // not the window the bars are drawn across.
    expect(model.permits.span).toBe('2019');
    expect(model.permits.years[0].year).toBe(2006);
    expect(model.permits.years).toHaveLength(21);
    // The rows are still counted; only their place on the axis was unusable.
    expect(model.permits.count).toBe('3');
  });

  it('states no span when no row carried a readable date', () => {
    const model = ledgerModel(view({ sources: allPulled(), violations: [violation()] }), NOW);
    expect(model.violations.span).toBeNull();
  });

  it('drops a 1900 sentinel from the violations year series rather than widening it back to 1900', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        violations: [
          violation({ caseNumber: 'sentinel', statusDate: '1900-01-01' }),
          violation({ caseNumber: 'real', statusDate: '2020-01-01' }),
        ],
      }),
      NOW,
    );

    // With the sentinel dropped, the series runs 2020 through the current year (2026) — seven
    // entries, not the hundred and twenty-seven a floor of 1800 would have produced.
    expect(model.violations.years).toHaveLength(7);
    expect(model.violations.years[0].year).toBe(2020);
    expect(model.violations.years[model.violations.years.length - 1].year).toBe(2026);
  });

  it('states no span for a source whose only dates fall outside the drawn window', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        permits: [permit({ permitNumber: 'sentinel', issuedDate: '1900-01-01' })],
      }),
      NOW,
    );

    // The sentinel is dropped, so no year in the window has a row — the bars still run the
    // full coverage window, but there is no observed extent to name a span for.
    expect(model.permits.span).toBeNull();
    expect(model.permits.years[0].year).toBe(2006);
    expect(model.permits.years).toHaveLength(21);
    expect(model.permits.years.every((entry) => entry.count === 0)).toBe(true);
  });
});

describe('ledgerModel provenance', () => {
  it('shows a dash and no span for a source that has never been pulled', () => {
    const sources = allPulled();
    delete sources[VIOLATIONS_RESOURCE_ID];
    const model = ledgerModel(view({ sources }), NOW);

    expect(model.violations.status).toBeNull();
    expect(model.violations.count).toBe('—');
    expect(model.violations.subCount).toBe('');
    // "2024–2026 · not retrieved" over a dash would state coverage for a count that is not there.
    expect(model.violations.span).toBeNull();
  });

  it('shows a dash for a source whose only attempt failed', () => {
    const sources = allPulled();
    sources[PERMITS_RESOURCE_ID] = status({ sourceId: PERMITS_RESOURCE_ID, status: 'error' });
    const model = ledgerModel(view({ sources }), NOW);

    expect(model.permits.count).toBe('—');
    expect(model.permits.span).toBeNull();
  });

  it('still counts the rows a failed re-pull left behind', () => {
    const sources = allPulled();
    sources[PERMITS_RESOURCE_ID] = status({ sourceId: PERMITS_RESOURCE_ID, status: 'error' });
    const model = ledgerModel(
      view({ sources, permits: [permit({ permitNumber: 'p1', issuedDate: '2019-04-01' })] }),
      NOW,
    );

    expect(model.permits.count).toBe('1');
    expect(model.permits.span).toBe('2019');
  });

  it('flags a section that hit the row cap and names the note the section uses', () => {
    const permits = Array.from({ length: ROW_CAP }, (_unused, index) =>
      permit({ permitNumber: 'p' + index, issuedDate: '2019-04-01' }),
    );
    const requests = Array.from({ length: ROW_CAP }, (_unused, index) => request({ caseId: 'c' + index }));

    const model = ledgerModel(view({ sources: allPulled(), permits, serviceRequests: requests }), NOW);

    expect(model.permits.cappedNote).toBe(CAPPED_ROWS_COPY);
    // 311's cap bites before the grouping, so its note says "considered", not "shown", and every
    // group carries it.
    expect(model.living.cappedNote).toBe(CAPPED_REQUESTS_COPY);
    expect(model.buildingRequests.cappedNote).toBe(CAPPED_REQUESTS_COPY);
    expect(model.upkeepRequests.cappedNote).toBe(CAPPED_REQUESTS_COPY);
    expect(ledgerModel(view({ sources: allPulled() }), NOW).permits.cappedNote).toBeNull();
  });
});

describe('ledgerModel rows', () => {
  it('lists violations open first, then the rest, each keeping the query order', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        violations: [
          violation({ caseNumber: 'closed-new', status: 'Closed', code: '780', statusDate: '2026-01-01' }),
          violation({ caseNumber: 'open-old', status: 'Open', code: '105', statusDate: '2020-01-01' }),
          violation({ caseNumber: 'closed-old', status: 'Closed', code: '110', statusDate: '2019-01-01' }),
        ],
      }),
      NOW,
    );

    expect(model.violations.rows.map((row) => row.label)).toEqual(['105', '780', '110']);
  });

  it('builds a permit label from the type and the description', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        permits: [permit({ permitType: 'ELECTRICAL', description: 'Rewire' })],
      }),
      NOW,
    );
    expect(model.permits.rows[0].label).toBe('ELECTRICAL · Rewire');
  });

  it('names a ticket the city left blank rather than printing nothing', () => {
    const model = ledgerModel(view({ sources: allPulled(), enforcement: [ticket()] }), NOW);
    expect(model.enforcement.rows[0].label).toBe('Not recorded');
  });

  it('carries the closed date as trailing text on the full request list only', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'a', openedAt: '2024-12-01', closedAt: '2024-12-20', status: 'Closed' }),
          request({ caseId: 'b', openedAt: '2024-11-01', status: 'Open' }),
        ],
      }),
      NOW,
    );

    expect(model.living.rows[0].trailing).toBe(' · closed Dec 20, 2024');
    expect(model.living.openRows).toHaveLength(1);
    expect(model.living.openRows[0].trailing).toBeNull();
  });

  it('notes a RentSmart roll-up that claims more complaints than the 311 rows show', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        rentsmart: [
          rentsmart({ violationType: 'Housing Complaints' }),
          rentsmart({ violationType: 'Housing Complaints' }),
        ],
      }),
      NOW,
    );
    expect(model.other.rentSmartNote).toContain('2 housing complaints');
  });
});

/**
 * "Open" is the city's word for a case with no recorded closing action, and a request from a
 * decade ago that was never closed still reads "Open" today. Every such row is kept; what
 * changes is the wording, so a reader is told where the status comes from rather than that the
 * problem is current. Permits are the exception: an open permit is an active one, so its status stays
 * exactly as the city recorded it.
 */
describe('ledgerModel open-case wording', () => {
  it('labels an open 311 request as still open in city records, with the year it was filed', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'a', openedAt: '2013-04-02 09:30:00', status: 'Open' }),
          request({ caseId: 'b', openedAt: '2024-12-01', closedAt: '2024-12-20', status: 'Closed' }),
        ],
      }),
      NOW,
    );

    expect(model.living.openRows.map((row) => row.statusLabel)).toEqual([
      'Still open in city records, filed 2013',
    ]);
    // The full list says the same thing about the same row, and leaves closed rows as recorded.
    expect(model.living.rows.map((row) => row.statusLabel)).toEqual([
      'Closed',
      'Still open in city records, filed 2013',
    ]);
    // The city's own word is still on the row for anything that needs it.
    expect(model.living.openRows[0].status).toBe('Open');
  });

  it('keeps every open request rather than dropping old ones', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'a', openedAt: '2013-04-02', status: 'Open' }),
          request({ caseId: 'b', openedAt: '2017-05-09', status: 'Open' }),
          request({ caseId: 'c', openedAt: '2026-05-01', status: 'Open' }),
        ],
      }),
      NOW,
    );

    expect(model.living.openRows).toHaveLength(3);
    expect(model.living.count).toBe('3');
  });

  it('explains what open means only where a section lists an open case', () => {
    const open = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [request({ openedAt: '2013-04-02', status: 'Open' })],
        violations: [violation({ status: 'Open', statusDate: '2017-05-09' })],
        enforcement: [ticket({ status: 'Open', statusDate: '2016-03-02' })],
        permits: [permit({ status: 'Open', issuedDate: '2019-05-02' })],
      }),
      NOW,
    );
    expect(open.living.openNote).toBe(STILL_OPEN_NOTE);
    expect(open.violations.openNote).toBe(STILL_OPEN_NOTE);
    expect(open.enforcement.openNote).toBe(STILL_OPEN_NOTE);
    // An open permit is an active permit. Nothing to explain away.
    expect(open.permits.openNote).toBeNull();

    const closed = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [request({ openedAt: '2013-04-02', closedAt: '2013-05-01', status: 'Closed' })],
        violations: [violation({ status: 'Closed', statusDate: '2017-05-09' })],
        enforcement: [ticket({ status: 'Closed', statusDate: '2016-03-02' })],
      }),
      NOW,
    );
    expect(closed.living.openNote).toBeNull();
    expect(closed.violations.openNote).toBeNull();
    expect(closed.enforcement.openNote).toBeNull();
  });

  it('labels open ISD violations and Public Works tickets without a filing year their feeds do not carry', () => {
    // These feeds carry a status date, which is not the date a case was filed, so no year is
    // put next to "filed".
    const model = ledgerModel(
      view({
        sources: allPulled(),
        violations: [
          violation({ caseNumber: 'V1', status: 'Open', code: '105', statusDate: '2017-05-09' }),
          violation({ caseNumber: 'V2', status: 'Closed', code: '110', statusDate: '2017-05-09' }),
        ],
        enforcement: [ticket({ status: 'Open', statusDate: '2016-03-02' })],
      }),
      NOW,
    );

    expect(model.violations.rows.map((row) => row.statusLabel)).toEqual(['Still open in city records', 'Closed']);
    expect(model.enforcement.rows[0].statusLabel).toBe('Still open in city records');
  });

  it("keeps a permit's status exactly as the city recorded it", () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        permits: [
          permit({ permitNumber: 'P1', status: 'Open', issuedDate: '2019-05-02' }),
          permit({ permitNumber: 'P2', status: 'Issued', issuedDate: '2020-05-02' }),
          permit({ permitNumber: 'P3', status: null, issuedDate: '2021-05-02' }),
        ],
      }),
      NOW,
    );

    expect(model.permits.rows.map((row) => row.statusLabel)).toEqual(['Open', 'Issued', NOT_RECORDED]);
  });

  it('names a blank status rather than printing nothing', () => {
    const model = ledgerModel(
      view({ sources: allPulled(), violations: [violation({ status: '  ' })], enforcement: [ticket()] }),
      NOW,
    );
    expect(model.violations.rows[0].statusLabel).toBe(NOT_RECORDED);
    expect(model.enforcement.rows[0].statusLabel).toBe(NOT_RECORDED);
  });
});

/**
 * The three groups the panel shows, in the owner's order: living conditions, building safety and
 * code, property upkeep. 311 requests are split across them by the type the city recorded; ISD
 * violations are counted by case and Public Works tickets by ticket number, never by line.
 */
describe('ledgerModel groups', () => {
  it('splits 311 requests across the three groups and counts the rest once', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'heat', reason: 'Housing', type: 'Heat - Excessive  Insufficient', openedAt: '2024-01-02' }),
          request({
            caseId: 'rodent',
            reason: 'Environmental Services',
            type: 'Rodent Activity',
            classification: 'other',
            openedAt: '2023-07-01',
          }),
          request({ caseId: 'permit', reason: 'Building', type: 'Work w/out Permit', openedAt: '2022-03-04' }),
          request({
            caseId: 'snow',
            reason: 'Code Enforcement',
            type: 'Unshoveled Sidewalk',
            status: 'Open',
            openedAt: '2021-02-01',
          }),
          request({
            caseId: 'park',
            reason: 'Enforcement & Abandoned Vehicles',
            type: 'Parking Enforcement',
            classification: 'other',
          }),
        ],
      }),
      NOW,
    );

    expect(model.living.count).toBe('2');
    expect(model.living.rows.map((row) => row.label)).toEqual(['Heat - Excessive  Insufficient', 'Rodent Activity']);
    expect(model.buildingRequests.count).toBe('1');
    expect(model.upkeepRequests.count).toBe('1');
    // The open sidewalk request is listed under upkeep, not under living conditions.
    expect(model.living.openRows).toHaveLength(0);
    expect(model.upkeepRequests.openRows.map((row) => row.label)).toEqual(['Unshoveled Sidewalk']);
    expect(model.other.count).toBe(1);
  });

  it('says none on record for a group the source answered with nothing', () => {
    const model = ledgerModel(
      view({ sources: allPulled(), serviceRequests: [request({ reason: 'Housing', type: 'Bed Bugs' })] }),
      NOW,
    );
    expect(model.living.count).toBe('1');
    expect(model.buildingRequests.count).toBe('0');
    expect(model.buildingRequests.subCount).toBe('none on record');
    expect(model.upkeepRequests.subCount).toBe('none on record');
  });

  it('labels each full list in the right number', () => {
    const one = ledgerModel(view({ sources: allPulled(), serviceRequests: [request()] }), NOW);
    expect(one.living.showAll).toBe('Show 1 request');

    const two = ledgerModel(
      view({ sources: allPulled(), serviceRequests: [request({ caseId: 'a' }), request({ caseId: 'b' })] }),
      NOW,
    );
    expect(two.living.showAll).toBe('Show all 2 requests');
  });

  it('compares the RentSmart roll-up against every listed 311 request, not one group', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'a', reason: 'Housing', type: 'Bed Bugs' }),
          request({ caseId: 'b', reason: 'Building', type: 'Work w/out Permit' }),
        ],
        rentsmart: [rentsmart({ violationType: 'Housing Complaints' }), rentsmart({ violationType: 'Housing Complaints' })],
      }),
      NOW,
    );
    // Two complaints in the roll-up, two requests listed across the groups: nothing to note.
    expect(model.other.rentSmartNote).toBeNull();
  });
});

describe('ledgerModel ISD cases', () => {
  it('counts ISD violations by case and keeps every code line under its case number', () => {
    const line = (caseNumber: string, code: string, description: string, statusWord: string, statusDate: string) =>
      violation({ caseNumber, code, description, status: statusWord, statusDate });
    const model = ledgerModel(
      view({
        sources: allPulled(),
        violations: [
          line('V900001', '1', 'Line one', 'Closed', '2013-04-02 09:00:00'),
          line('V900001', '2', 'Line two', 'Closed', '2013-04-02 09:00:00'),
          line('V900001', '3', 'Line three', 'Closed', '2013-04-02 09:00:00'),
          line('V900002', '4', 'Line four', 'Open', '2012-01-05 09:00:00'),
        ],
      }),
      NOW,
    );

    expect(model.violations.count).toBe('2');
    expect(model.violations.subCount).toBe('1 open');
    expect(model.violations.note).toBe('4 code lines in 2 cases');
    // The open case is listed first, under its own number; every line is still there.
    expect(model.violations.cases.map((entry) => entry.label)).toEqual(['Case V900002', 'Case V900001']);
    expect(model.violations.cases[1].lines.map((entry) => entry.label)).toEqual([
      '1 · Line one',
      '2 · Line two',
      '3 · Line three',
    ]);
    expect(model.violations.rows).toHaveLength(4);
    expect(model.violations.showAll).toBe('Show all 2 cases');
  });

  it('dates a case by its latest line and dates a line only where it differs', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        violations: [
          violation({ caseNumber: 'V1', code: 'a', status: 'Closed', statusDate: '2020-03-01 10:00:00' }),
          violation({ caseNumber: 'V1', code: 'b', status: 'Closed', statusDate: '2019-01-15 10:00:00' }),
        ],
      }),
      NOW,
    );
    const [entry] = model.violations.cases;
    expect(entry.date).toBe('2020-03-01 10:00:00');
    expect(entry.lines.map((row) => row.trailing)).toEqual([null, ' · Jan 15, 2019']);
  });

  it('adds no lines note when every case has one line', () => {
    const model = ledgerModel(
      view({ sources: allPulled(), violations: [violation({ caseNumber: 'V1' }), violation({ caseNumber: 'V2' })] }),
      NOW,
    );
    expect(model.violations.count).toBe('2');
    expect(model.violations.note).toBeNull();
  });
});

describe('ledgerModel Public Works tickets', () => {
  it('counts distinct tickets, not violation lines', () => {
    const line = (caseNumber: string, ticketNumber: string, code: string, description: string, statusWord: string, statusDate: string) =>
      ticket({ caseNumber, ticketNumber, code, description, status: statusWord, statusDate });
    const model = ledgerModel(
      view({
        sources: allPulled(),
        enforcement: [
          line('CE1', 'T-A', '1', 'Improper storage trash: res', 'Closed', '2018-05-01 09:00:00'),
          line('CE1', 'T-A', '24', 'Overgrown Weeds On Property', 'Closed', '2018-05-01 09:00:00'),
          line('CE2', 'T-B', '1', 'Improper storage trash: res', 'Open', '2024-06-03 09:00:00'),
        ],
      }),
      NOW,
    );

    expect(model.enforcement.count).toBe('2');
    expect(model.enforcement.subCount).toBe('1 open');
    expect(model.enforcement.note).toBe('3 violation lines on 2 tickets');
    expect(model.enforcement.cases.map((entry) => entry.label)).toEqual(['Ticket T-B', 'Ticket T-A']);
    expect(model.enforcement.showAll).toBe('Show all 2 tickets');
    // What was ticketed still counts each line the city recorded.
    expect(model.enforcement.types.top).toEqual([
      { key: 'Improper storage trash: res', count: 2 },
      { key: 'Overgrown Weeds On Property', count: 1 },
    ]);
  });

  it('falls back to the case number for a ticket the feed left unnumbered', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        enforcement: [
          ticket({ caseNumber: 'CE7', ticketNumber: null, code: '1' }),
          ticket({ caseNumber: 'CE7', ticketNumber: '  ', code: '2' }),
          ticket({ caseNumber: 'CE8', ticketNumber: null, code: '1' }),
        ],
      }),
      NOW,
    );
    expect(model.enforcement.count).toBe('2');
    expect(model.enforcement.cases.map((entry) => entry.label)).toEqual(['Case CE7', 'Case CE8']);
    expect(model.enforcement.showAll).toBe('Show all 2 tickets');
  });

  it('says one ticket in the singular', () => {
    const model = ledgerModel(view({ sources: allPulled(), enforcement: [ticket()] }), NOW);
    expect(model.enforcement.showAll).toBe('Show 1 ticket');
    expect(model.enforcement.note).toBeNull();
  });
});
