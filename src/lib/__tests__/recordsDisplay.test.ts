import { describe, it, expect } from 'vitest';
import {
  BANNED_WORDS,
  PANEL_FRAMING_COPY,
  ZERO_PERMITS_COPY,
  DECLARED_VALUATION_CAVEAT,
  OTHER_REQUESTS_COPY,
  CONDOMINIUM_COPY,
  showMailingAddress,
  formatDollars,
  formatRecordDate,
  permitSummary,
  splitServiceRequests,
  rentSmartDisagreement,
} from '../records/display';
import type { PermitPayload, RentSmartPayload, ServiceRequestPayload } from '../records/types';

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

function serviceRequest(overrides: Partial<ServiceRequestPayload> = {}): ServiceRequestPayload {
  return {
    caseId: 'C1',
    system: 'legacy',
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
    classification: 'other',
    ...overrides,
  };
}

function rentSmartRow(overrides: Partial<RentSmartPayload> = {}): RentSmartPayload {
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

describe('showMailingAddress', () => {
  it('returns false for a null owner', () => {
    expect(showMailingAddress(null)).toBe(false);
  });

  it('returns true for an LLC owner', () => {
    expect(showMailingAddress('LANARK ROAD LLC MASS LLC')).toBe(true);
  });

  it('returns true for a limited partnership owner', () => {
    expect(showMailingAddress('KELLEHER FAMILY LP MASS LP')).toBe(true);
  });

  it('returns true for a condo trust owner spelled with a bare TR suffix', () => {
    expect(showMailingAddress('GRAND LANARK CONDO TR')).toBe(true);
  });

  it('returns true for a realty trust owner', () => {
    expect(showMailingAddress('LANARK ROAD REALTY TRUST')).toBe(true);
  });

  it('returns false for an individual owner', () => {
    expect(showMailingAddress('PASCUCCI CARLO')).toBe(false);
  });

  // The privacy failure this gate exists to prevent: a substring test for entity tokens
  // matches INC inside PRINCE, LP inside no surname here but CORP inside CORPUS, and
  // would publish a private individual's home address as a "business" mailing address.
  it.each(['PRINCE JOHN P', 'VINCENT MARIA', 'HINCKLEY SARAH', 'CORPUS DANIEL'])(
    'returns false for %s, whose name merely contains an entity token',
    (owner) => {
      expect(showMailingAddress(owner)).toBe(false);
    },
  );
});

describe('formatDollars', () => {
  it('formats a dollar amount with thousands separators', () => {
    expect(formatDollars(6720200)).toBe('$6,720,200');
  });

  it('returns "Not recorded" for null', () => {
    expect(formatDollars(null)).toBe('Not recorded');
  });

  it('returns "Not recorded" for a non-finite number', () => {
    expect(formatDollars(Number.NaN)).toBe('Not recorded');
    expect(formatDollars(Number.POSITIVE_INFINITY)).toBe('Not recorded');
  });
});

describe('formatRecordDate', () => {
  it('formats a "YYYY-MM-DD HH:MM:SS" timestamp', () => {
    expect(formatRecordDate('2008-08-30 09:42:00')).toBe('Aug 30, 2008');
  });

  it('formats an ISO "T"-separated timestamp', () => {
    expect(formatRecordDate('2021-01-28T16:29:26')).toBe('Jan 28, 2021');
  });

  it('formats a timestamp with a UTC offset suffix', () => {
    expect(formatRecordDate('2026-07-17 13:56:00+00')).toBe('Jul 17, 2026');
  });

  it('returns "Date not recorded" for null', () => {
    expect(formatRecordDate(null)).toBe('Date not recorded');
  });

  it('returns "Date not recorded" for a garbage string', () => {
    expect(formatRecordDate('garbage')).toBe('Date not recorded');
  });
});

describe('permitSummary', () => {
  it('counts permits, sums only the declared valuations present, and finds earliest/latest issued dates', () => {
    const permits = [
      permit({ permitNumber: 'A', declaredValuation: 1000, issuedDate: '2020-01-01' }),
      permit({ permitNumber: 'B', declaredValuation: null, issuedDate: '2022-06-15' }),
      permit({ permitNumber: 'C', declaredValuation: 500, issuedDate: null }),
    ];

    expect(permitSummary(permits)).toEqual({
      count: 3,
      declaredTotal: 1500,
      declaredCount: 2,
      earliest: '2020-01-01',
      latest: '2022-06-15',
    });
  });

  it('reports a null total when no permit carried a declared valuation', () => {
    const permits = [permit({ permitNumber: 'A' }), permit({ permitNumber: 'B' })];

    expect(permitSummary(permits)).toMatchObject({ count: 2, declaredTotal: null, declaredCount: 0 });
  });

  it('returns a null total and null dates for an empty list', () => {
    expect(permitSummary([])).toEqual({ count: 0, declaredTotal: null, declaredCount: 0, earliest: null, latest: null });
  });
});

describe('ZERO_PERMITS_COPY', () => {
  it('derives the coverage year from PERMIT_COVERAGE_START and explains the absence', () => {
    expect(ZERO_PERMITS_COPY).toContain('No permitted work on record since 2006');
    expect(ZERO_PERMITS_COPY).toContain('not that no maintenance was done');
  });
});

describe('splitServiceRequests', () => {
  it('sorts housing requests newest first and counts the rest', () => {
    const rows = [
      serviceRequest({ caseId: 'H1', classification: 'housing', openedAt: '2020-01-01' }),
      serviceRequest({ caseId: 'H2', classification: 'housing', openedAt: '2022-01-01' }),
      serviceRequest({ caseId: 'H3', classification: 'housing', openedAt: null }),
      serviceRequest({ caseId: 'O1', classification: 'other' }),
      serviceRequest({ caseId: 'O2', classification: 'other' }),
    ];

    const { housing, otherCount } = splitServiceRequests(rows);

    expect(housing.map((r) => r.caseId)).toEqual(['H2', 'H1', 'H3']);
    expect(otherCount).toBe(2);
  });

  it('handles an empty list', () => {
    expect(splitServiceRequests([])).toEqual({ housing: [], otherCount: 0 });
  });
});

describe('rentSmartDisagreement', () => {
  it('returns null when RentSmart housing-complaint count matches the 311 count', () => {
    const rows = [rentSmartRow({ violationType: 'Housing Complaints' })];
    expect(rentSmartDisagreement(rows, 1)).toBeNull();
  });

  it('returns the disagreement sentence when RentSmart reports more complaints than 311 shows', () => {
    const rows = [rentSmartRow({ violationType: 'Housing Complaints' }), rentSmartRow({ violationType: 'Housing Complaints' })];
    expect(rentSmartDisagreement(rows, 1)).toBe(
      "The city's RentSmart summary reports 2 housing complaints for this address; the 311 records above show 1.",
    );
  });

  it('writes the singular noun for a single complaint', () => {
    const rows = [rentSmartRow({ violationType: 'Housing Complaints' })];
    expect(rentSmartDisagreement(rows, 0)).toBe(
      "The city's RentSmart summary reports 1 housing complaint for this address; the 311 records above show 0.",
    );
  });

  it('matches the violation type regardless of case and surrounding whitespace', () => {
    const rows = [rentSmartRow({ violationType: '  housing complaints ' })];
    expect(rentSmartDisagreement(rows, 0)).toContain('reports 1 housing complaint ');
  });

  it('stays silent when the RentSmart roll-up lags the 311 records', () => {
    expect(rentSmartDisagreement([rentSmartRow({ violationType: 'Housing Complaints' })], 4)).toBeNull();
  });

  it('returns null for an empty RentSmart list', () => {
    expect(rentSmartDisagreement([], 0)).toBeNull();
  });
});

describe('panel copy stays free of banned words', () => {
  const bannedPattern = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'i');
  const copyConstants: Array<[string, string]> = [
    ['PANEL_FRAMING_COPY', PANEL_FRAMING_COPY],
    ['ZERO_PERMITS_COPY', ZERO_PERMITS_COPY],
    ['DECLARED_VALUATION_CAVEAT', DECLARED_VALUATION_CAVEAT],
    ['OTHER_REQUESTS_COPY', OTHER_REQUESTS_COPY],
    ['CONDOMINIUM_COPY', CONDOMINIUM_COPY],
  ];

  it.each(copyConstants)('%s does not contain a banned word', (_name, copy) => {
    expect(bannedPattern.test(copy)).toBe(false);
  });
});
