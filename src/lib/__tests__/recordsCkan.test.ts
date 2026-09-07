import { describe, it, expect, vi } from 'vitest';
import { addressLikeClauses, ckanSql, sqlLiteral, parseMoney, parseIntOrNull, ROW_CAP, FETCH_TIMEOUT_MS } from '../records/ckan';
import { SourceError, type BuildingIdentity, type RecordRow } from '../records/types';

/** Minimal BuildingIdentity stub — addressLikeClauses only reads the two address-form fields. */
function identityWithForms(addressFormsShort: string[], addressFormsLong: string[] = []): BuildingIdentity {
  return {
    buildingId: 'b', numbers: [], rangeForm: null, streetShort: '', streetLong: '', streetBase: '',
    streetForms: [], addressFormsShort, addressFormsLong, parcelId: null, parcelNumeric: null,
    condominium: false, zip: null, samId: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('sqlLiteral', () => {
  it('quotes and doubles embedded single quotes', () => {
    expect(sqlLiteral("O'BRIEN ST")).toBe("'O''BRIEN ST'");
  });
});

describe('addressLikeClauses', () => {
  it('escapes single quotes, percent, and underscore, then appends the LIKE wildcard', () => {
    const [clause] = addressLikeClauses('address', identityWithForms([`O'BRIEN_50%`]));
    expect(clause).toBe(`upper("address") LIKE 'O''BRIEN\\_50\\%%' ESCAPE '\\'`);
  });

  it('throws on a column name that is not a safe lowercase identifier', () => {
    expect(() => addressLikeClauses('address; DROP TABLE x', identityWithForms(['55 LANARK RD']))).toThrow();
    expect(() => addressLikeClauses('Address', identityWithForms(['55 LANARK RD']))).toThrow();
  });

  it('the emitted pattern is a true prefix match: matches an address extension, not a longer number sharing the prefix', () => {
    const [clause] = addressLikeClauses('address', identityWithForms(['55 LANARK RD']));
    const inner = clause.match(/LIKE '(.*)%' ESCAPE/)![1];
    const regex = new RegExp('^' + inner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*$');
    expect(regex.test('55 LANARK RD REAR')).toBe(true);
    expect(regex.test('551 LANARK RD')).toBe(false);
  });
});

describe('parseMoney', () => {
  it.each([
    ['6,720,200', 6720200],
    ['6780500', 6780500],
    ['$6,649,200.00 ', 6649200],
    ['$36,500.00', 36500],
    [6551400, 6551400],
    [null, null],
    ['', null],
  ])('parseMoney(%p) -> %p', (input, expected) => {
    expect(parseMoney(input as string | number | null)).toBe(expected);
  });
});

describe('parseIntOrNull', () => {
  it.each([
    ['1920', 1920],
    ['34650.00000', 34650],
    ['27720.0', 27720],
    ['1,150', 1150],
    [1234.5, 1234],
    ['-5', -5],
    [null, null],
    ['abc', null],
    ['', null],
  ])('parseIntOrNull(%p) -> %p', (input, expected) => {
    expect(parseIntOrNull(input as string | number | null)).toBe(expected);
  });
});

describe('ckanSql', () => {
  it('returns records and caps rows, keeping the first rows not the last', async () => {
    const records = Array.from({ length: ROW_CAP + 5 }, (_, i) => ({ n: i }));
    const fetchImpl = async () => jsonResponse({ success: true, result: { records } });
    const rows = await ckanSql<{ n: number }>('SELECT 1', fetchImpl);
    expect(rows).toHaveLength(ROW_CAP);
    expect(rows[0].n).toBe(0);
  });

  it('returns an empty array when result is absent', async () => {
    const fetchImpl = async () => jsonResponse({ success: true });
    const rows = await ckanSql('SELECT 1', fetchImpl);
    expect(rows).toEqual([]);
  });

  it('throws SourceError carrying the query on HTTP failure', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 });
    await expect(ckanSql('SELECT 2', fetchImpl)).rejects.toMatchObject({ name: 'SourceError', query: 'SELECT 2' });
  });

  it('throws SourceError with the CKAN error message when success is false', async () => {
    const fetchImpl = async () => jsonResponse({ success: false, error: { info: { orig: ['column "ZIPCODE" does not exist'] } } }, 409);
    await expect(ckanSql('SELECT 3', fetchImpl)).rejects.toThrow(/does not exist/);
  });

  it('throws SourceError when a 200 response reports success: false', async () => {
    const fetchImpl = async () => jsonResponse({ success: false, error: 'bad sql' }, 200);
    await expect(ckanSql('SELECT 3b', fetchImpl)).rejects.toBeInstanceOf(SourceError);
  });

  it('includes a snippet of the body when a 200 response is not JSON', async () => {
    const fetchImpl = async () => new Response('<html>nope</html>', { status: 200 });
    await expect(ckanSql('SELECT 3c', fetchImpl)).rejects.toThrow(/non-JSON body: <html/);
  });

  it('sends the SQL url-encoded to the datastore_search_sql endpoint', async () => {
    let seen = '';
    const fetchImpl = async (input: string) => { seen = input; return jsonResponse({ success: true, result: { records: [] } }); };
    await ckanSql("SELECT * FROM \"abc\" WHERE x = 'y'", fetchImpl);
    expect(seen.startsWith('https://data.boston.gov/api/3/action/datastore_search_sql?sql=')).toBe(true);
    expect(decodeURIComponent(seen.split('sql=')[1])).toBe("SELECT * FROM \"abc\" WHERE x = 'y'");
  });

  it('is a SourceError, not a bare Error, when fetch itself rejects', async () => {
    const fetchImpl = async () => { throw new TypeError('network down'); };
    const err = await ckanSql('SELECT 4', fetchImpl).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.message).toContain('network down');
  });

  it('preserves the original error as cause when fetch rejects', async () => {
    const fetchImpl = async () => { throw new TypeError('network down'); };
    const err = await ckanSql('SELECT 4b', fetchImpl).catch((e) => e);
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it('passes an abort signal and reports a timeout as a timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (_u: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
      const pending = ckanSql('SELECT 1', fetchImpl).catch((e) => e);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1);
      const err = await pending;
      expect(err).toBeInstanceOf(SourceError);
      expect(err.message).toMatch(/timed out after 10000ms/);
      expect(err.query).toBe('SELECT 1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('RecordRow discriminates payload by kind', () => {
    const row: RecordRow = { kind: 'permit', sourceKey: 'A1', payload: { permitNumber: 'A1', workType: null, permitType: null, description: null, comments: null, applicant: null, declaredValuation: null, totalFees: null, issuedDate: null, expirationDate: null, status: null, occupancyType: null, address: null } };
    if (row.kind === 'permit') expect(row.payload.permitNumber).toBe('A1');
    // @ts-expect-error an assessment payload cannot ride under kind 'permit'
    const wrong: RecordRow = { kind: 'permit', sourceKey: 'x', payload: { fiscalYear: 'FY2026', parcelId: null, owner: null, mailAddressee: null, mailStreet: null, mailCity: null, mailState: null, mailZip: null, landUse: null, landUseDescription: null, yearBuilt: null, yearRemodel: null, grossArea: null, livingArea: null, residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null, buildingValue: null, condominium: false } };
    void wrong;
  });
});
