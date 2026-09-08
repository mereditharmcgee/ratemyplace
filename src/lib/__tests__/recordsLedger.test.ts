import { describe, it, expect } from 'vitest';
import { ledgerModel } from '../records/ledger';
import { CAPPED_REQUESTS_COPY, CAPPED_ROWS_COPY } from '../records/display';
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
    subject: null,
    reason: null,
    type: null,
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
          request({ caseId: 'c', classification: 'other' }),
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

    expect(model.requests.count).toBe('2');
    expect(model.requests.subCount).toBe('1 open');
    expect(model.requests.otherCount).toBe(1);
    expect(model.requests.note).toBe('1 other request not shown');

    expect(model.permits.count).toBe('2');
    expect(model.permits.subCount).toBe('1 open · $37.7K declared');

    expect(model.enforcement.count).toBe('1');
    expect(model.enforcement.subCount).toBe('1 open');

    // Empty is not the same as unknown: the source answered, and it answered with nothing.
    expect(model.violations.count).toBe('0');
    expect(model.violations.subCount).toBe('none on record');
  });

  it('pluralises the other-requests note and drops it when there are none', () => {
    const rows = [request({ caseId: 'x', classification: 'other' }), request({ caseId: 'y', classification: 'other' })];
    const model = ledgerModel(view({ sources: allPulled(), serviceRequests: rows }), NOW);
    expect(model.requests.note).toBe('2 other requests not shown');

    const none = ledgerModel(view({ sources: allPulled() }), NOW);
    expect(none.requests.note).toBeNull();
  });

  it('breaks the rows down by year and by category', () => {
    const model = ledgerModel(
      view({
        sources: allPulled(),
        serviceRequests: [
          request({ caseId: 'a', openedAt: '2024-02-01', type: 'Heat' }),
          request({ caseId: 'b', openedAt: '2024-05-01', type: 'Heat' }),
          request({ caseId: 'c', openedAt: '2026-05-01', type: 'Pests' }),
        ],
      }),
      NOW,
    );

    expect(model.requests.years.map((entry) => entry.year)).toEqual([2024, 2025, 2026]);
    expect(model.requests.years[1].count).toBe(0);
    expect(model.requests.types.top).toEqual([
      { key: 'Heat', count: 2 },
      { key: 'Pests', count: 1 },
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
    expect(model.requests.span).toBe('2024');
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
    expect(model.violations.countable).toBe(false);
    expect(model.violations.count).toBe('—');
    expect(model.violations.subCount).toBe('');
    // "2024–2026 · not retrieved" over a dash would state coverage for a count that is not there.
    expect(model.violations.span).toBeNull();
  });

  it('shows a dash for a source whose only attempt failed', () => {
    const sources = allPulled();
    sources[PERMITS_RESOURCE_ID] = status({ sourceId: PERMITS_RESOURCE_ID, status: 'error' });
    const model = ledgerModel(view({ sources }), NOW);

    expect(model.permits.countable).toBe(false);
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

    expect(model.permits.countable).toBe(true);
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
    // 311's cap bites before the housing filter, so its note says "considered", not "shown".
    expect(model.requests.cappedNote).toBe(CAPPED_REQUESTS_COPY);
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

    expect(model.requests.rows[0].trailing).toBe(' · closed Dec 20, 2024');
    expect(model.requests.openRows).toHaveLength(1);
    expect(model.requests.openRows[0].trailing).toBeNull();
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
    expect(model.requests.rentSmartNote).toContain('2 housing complaints');
  });
});
