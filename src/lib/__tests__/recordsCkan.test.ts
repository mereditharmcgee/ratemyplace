import { describe, it, expect } from 'vitest';
import { ckanSql, sqlLiteral, parseMoney, parseIntOrNull, ROW_CAP } from '../records/ckan';
import { SourceError } from '../records/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('sqlLiteral', () => {
  it('quotes and doubles embedded single quotes', () => {
    expect(sqlLiteral("O'BRIEN ST")).toBe("'O''BRIEN ST'");
  });
});

describe('parseMoney / parseIntOrNull', () => {
  it('handles every assessor value format seen in the wild', () => {
    expect(parseMoney('6,720,200')).toBe(6720200);
    expect(parseMoney('6780500')).toBe(6780500);
    expect(parseMoney('$6,649,200.00 ')).toBe(6649200);
    expect(parseMoney('$36,500.00')).toBe(36500);
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseIntOrNull('1920')).toBe(1920);
    expect(parseIntOrNull(null)).toBeNull();
    expect(parseIntOrNull('abc')).toBeNull();
  });
});

describe('ckanSql', () => {
  it('returns records and caps rows', async () => {
    const records = Array.from({ length: ROW_CAP + 5 }, (_, i) => ({ n: i }));
    const fetchImpl = async () => jsonResponse({ success: true, result: { records } });
    const rows = await ckanSql<{ n: number }>('SELECT 1', fetchImpl);
    expect(rows).toHaveLength(ROW_CAP);
  });

  it('throws SourceError carrying the query on HTTP failure', async () => {
    const fetchImpl = async () => new Response('nope', { status: 503 });
    await expect(ckanSql('SELECT 2', fetchImpl)).rejects.toMatchObject({ name: 'SourceError', query: 'SELECT 2' });
  });

  it('throws SourceError with the CKAN error message when success is false', async () => {
    const fetchImpl = async () => jsonResponse({ success: false, error: { info: { orig: ['column "ZIPCODE" does not exist'] } } }, 409);
    await expect(ckanSql('SELECT 3', fetchImpl)).rejects.toThrow(/does not exist/);
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
});
