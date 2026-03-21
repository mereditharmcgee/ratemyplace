import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectAdapter } from '../enrichment/dispatcher';
import { NullAdapter } from '../enrichment/adapters/null';
import { BostonAdapter } from '../enrichment/adapters/boston';
import {
  inferOwnerEntity,
  parseStreetAddress,
  normalizeStreetName,
} from '../enrichment/helpers';
import type { BuildingRecord } from '../enrichment/types';

// ── Dispatcher tests ──

describe('selectAdapter', () => {
  it('routes "boston" to BostonAdapter', () => {
    const adapter = selectAdapter('boston');
    expect(adapter).toBeInstanceOf(BostonAdapter);
  });

  it('routes "Boston" (mixed case) to BostonAdapter', () => {
    const adapter = selectAdapter('Boston');
    expect(adapter).toBeInstanceOf(BostonAdapter);
  });

  it('routes "Boston, MA" (with state suffix) to BostonAdapter', () => {
    const adapter = selectAdapter('Boston, MA');
    expect(adapter).toBeInstanceOf(BostonAdapter);
  });

  it('routes null to NullAdapter', () => {
    const adapter = selectAdapter(null);
    expect(adapter).toBeInstanceOf(NullAdapter);
  });

  it('routes unknown city to NullAdapter', () => {
    const adapter = selectAdapter('springfield');
    expect(adapter).toBeInstanceOf(NullAdapter);
  });
});

// ── NullAdapter tests ──

describe('NullAdapter', () => {
  it('returns well-formed unsupported response', async () => {
    const adapter = new NullAdapter();
    const building: BuildingRecord = {
      id: 'bld-1',
      address: '123 Unknown St',
      city: 'Nowhere',
      state: 'MA',
      zip_code: '00000',
    };
    const result = await adapter.enrich(building);
    expect(result.address).toBe('123 Unknown St');
    expect(result.results).toEqual([]);
    expect(result.unsupported).toBe(true);
    expect(result.message).toBe('No auto-research data available for this city.');
  });
});

// ── Helper: inferOwnerEntity ──

describe('inferOwnerEntity', () => {
  it('returns "llc" for LLC owner names', () => {
    expect(inferOwnerEntity('SMITH LLC')).toBe('llc');
    expect(inferOwnerEntity('Acme Properties LLC')).toBe('llc');
  });

  it('returns "trust" for trust/trustee names', () => {
    expect(inferOwnerEntity('John Smith TRUST')).toBe('trust');
    expect(inferOwnerEntity('Jane TRUSTEE')).toBe('trust');
    expect(inferOwnerEntity('Brown TRSTEE')).toBe('trust');
  });

  it('returns "corporation" for corp/inc names', () => {
    expect(inferOwnerEntity('Acme CORP')).toBe('corporation');
    expect(inferOwnerEntity('Smith INC')).toBe('corporation');
    expect(inferOwnerEntity('Widgets INCORPORATED')).toBe('corporation');
  });

  it('returns "individual" for plain person names', () => {
    expect(inferOwnerEntity('John Smith')).toBe('individual');
    expect(inferOwnerEntity('Mary O\'Brien')).toBe('individual');
  });
});

// ── Helper: parseStreetAddress ──

describe('parseStreetAddress', () => {
  it('parses a standard address', () => {
    const result = parseStreetAddress('123 Main St');
    expect(result).toEqual({ number: '123', street: 'Main St' });
  });

  it('parses a hyphenated street number', () => {
    const result = parseStreetAddress('123-125 Main St');
    expect(result).toEqual({ number: '123-125', street: 'Main St' });
  });

  it('returns null for an address with no number', () => {
    const result = parseStreetAddress('invalid');
    expect(result).toBeNull();
  });
});

// ── Helper: normalizeStreetName ──

describe('normalizeStreetName', () => {
  it('removes comma suffix and uppercases', () => {
    const result = normalizeStreetName('Main St, Boston, MA');
    expect(result).toBe('MAIN ST');
  });

  it('uppercases a plain street name', () => {
    const result = normalizeStreetName('elm street');
    expect(result).toBe('ELM STREET');
  });
});

// ── BostonAdapter tests ──

describe('BostonAdapter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const building: BuildingRecord = {
    id: 'bld-boston-1',
    address: '123 Main St',
    city: 'Boston',
    state: 'MA',
    zip_code: '02101',
  };

  const fakeCkanResponse = {
    result: {
      records: [
        {
          ST_NUM: '123',
          ST_NAME: 'MAIN ST',
          CITY: 'BOSTON',
          ZIP_CODE: '02101',
          OWNER: 'SMITH LLC',
          YR_BUILT: '1985',
          RES_UNITS: '4',
          COM_UNITS: '0',
          LU_DESC: 'THREE FAMILY',
          BLDG_TYPE: '101',
          NUM_BLDGS: '1',
          GROSS_AREA: '3200',
          LIVING_AREA: '2800',
          TOTAL_VALUE: '850000',
          BED_RMS: '8',
          FULL_BTH: '4',
          STRUCTURE_CLASS: 'R',
          OVERALL_COND: 'A',
          YR_REMODEL: '0',
        },
      ],
    },
  };

  it('returns EnrichResponse with correct field mapping', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => fakeCkanResponse,
    }));

    const adapter = new BostonAdapter();
    const result = await adapter.enrich(building);

    expect(result.address).toBe('123 Main St');
    expect(result.results).toHaveLength(1);
    const r = result.results[0];
    expect(r.address).toBe('123 MAIN ST');
    expect(r.city).toBe('BOSTON');
    expect(r.owner).toBe('SMITH LLC');
    expect(r.ownerEntityInferred).toBe('llc');
    expect(r.yearBuilt).toBe(1985);
    expect(r.residentialUnits).toBe(4);
    expect(r.totalValue).toBe(850000);
    expect(r.buildingType).toBe('Three Family');
    expect(result.source).toBe('Boston Assessing');
  });

  it('triggers fuzzy fallback when exact match returns empty records', async () => {
    const emptyResponse = { result: { records: [] } };
    const fuzzyResponse = {
      result: {
        records: [
          {
            ST_NUM: '123',
            ST_NAME: 'MAIN ST',
            CITY: 'BOSTON',
            ZIP_CODE: '02101',
            OWNER: 'JONES TRUST',
            YR_BUILT: '1960',
            RES_UNITS: '2',
            COM_UNITS: '0',
            LU_DESC: 'TWO FAMILY',
            BLDG_TYPE: '102',
            NUM_BLDGS: '1',
            GROSS_AREA: '2000',
            LIVING_AREA: '1800',
            TOTAL_VALUE: '600000',
            BED_RMS: '4',
            FULL_BTH: '2',
            STRUCTURE_CLASS: 'R',
            OVERALL_COND: 'A',
            YR_REMODEL: '0',
          },
        ],
      },
    };

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => emptyResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => fuzzyResponse })
    );

    const adapter = new BostonAdapter();
    const result = await adapter.enrich(building);

    expect(result.fuzzyMatch).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].owner).toBe('JONES TRUST');
  });

  it('returns empty results with message when address cannot be parsed', async () => {
    const badBuilding: BuildingRecord = {
      id: 'bld-2',
      address: 'BadAddress',
      city: 'Boston',
      state: 'MA',
      zip_code: '02101',
    };
    const adapter = new BostonAdapter();
    const result = await adapter.enrich(badBuilding);
    expect(result.results).toEqual([]);
    expect(result.message).toBe('Could not parse address');
  });
});
