import { describe, expect, it } from 'vitest';
import { LANARK_FIXTURE, runLanarkFixture, type FixtureCheck, type FixtureResult } from '../records/fixture';
import { sourcesForCity } from '../records/jurisdictions';
import { RENTSMART_RESOURCE_ID } from '../records/sources/boston/rentsmart';
import type { FetchLike } from '../records/types';

/** A fetch that answers every CKAN call with an empty result set. */
const emptyFetch: FetchLike = async () =>
  new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });

/** Every Boston adapter runs for the fixture, so this is the arity both accountings add up to. */
const BOSTON_SOURCE_COUNT = sourcesForCity('Boston').length;

/** Resource id by source label, so a test can single a source out without hardcoding one. */
const SOURCE_ID_BY_LABEL = new Map(sourcesForCity('Boston').map((source) => [source.label, source.id]));

function sourceId(label: string): string {
  const id = SOURCE_ID_BY_LABEL.get(label);
  if (!id) throw new Error(`no Boston source labelled ${label}`);
  return id;
}

describe('runLanarkFixture', () => {
  it('names the fixture parcel and address', () => {
    expect(LANARK_FIXTURE.parcelId).toBe('2102098000');
    expect(LANARK_FIXTURE.address).toBe('23-27 Lanark Rd, Boston, MA 02135');
  });

  it('returns one check per assertion and counts failures without throwing', async () => {
    const result = await runLanarkFixture(emptyFetch);
    expect(result.checks.length).toBeGreaterThanOrEqual(12);
    // Empty responses fail the parcel resolution and every value check.
    expect(result.failures).toBeGreaterThan(0);
    expect(result.checks.find((c) => c.label === 'parcel resolves to 2102098000')?.ok).toBe(false);
    expect(result.parcelId).toBeNull();
    expect(result.condominium).toBe(false);
    // Every source is accounted for exactly once: it either threw or reported a row count.
    // With no parcel id the six assessor sources throw, so the rest are what ran.
    expect(result.sourceErrors.length + Object.keys(result.rowsBySource).length).toBe(BOSTON_SOURCE_COUNT);
    for (const err of result.sourceErrors) expect(result.rowsBySource[err.label]).toBeUndefined();
    expect(Object.values(result.rowsBySource).every((n) => n === 0)).toBe(true);
  });

  it('records every other source when one throws, in source-list order however the answers arrive', async () => {
    const throwing = sourceId('Approved Building Permits');
    const slow = sourceId('311 Service Requests');
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        // Every call yields, and 311 comes back last: the sources run concurrently, so the
        // recorded order has to be the source list's, not the order the answers arrived in.
        await new Promise((resolve) => setTimeout(resolve, url.includes(slow) ? 10 : 1));
        if (url.includes(throwing)) throw new Error('permits down');
        return new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });
      } finally {
        inFlight -= 1;
      }
    };

    const result = await runLanarkFixture(fetchImpl, { sleep: async () => {} });

    // The sources are in flight together, not one after another: the daily breaker should not
    // spend eleven sequential timeouts finding out that data.boston.gov is down.
    expect(maxInFlight).toBeGreaterThan(1);

    expect(result.sourceErrors.find((e) => e.label === 'Approved Building Permits')?.message).toContain(
      'permits down',
    );
    // The one that threw is absent; every other source that could run without a parcel id
    // still recorded its count, and they are in source-list order.
    expect(Object.keys(result.rowsBySource)).toEqual([
      'Building and Property Violations',
      'Public Works Code Enforcement',
      '311 Service Requests',
      'RentSmart',
    ]);
    expect(result.sourceErrors.length + Object.keys(result.rowsBySource).length).toBe(BOSTON_SOURCE_COUNT);
  });

  it('reports a source that throws as a failed check, not an exception', async () => {
    const throwingFetch: FetchLike = async () => {
      throw new Error('boom');
    };
    // The injected no-op sleep skips the SAM fetch's 1s + 4s retry backoff. The retry is
    // wanted in production — a blip at data.boston.gov must not trip the scheduler's
    // breaker — so it is stubbed here rather than given up.
    const result = await runLanarkFixture(throwingFetch, { sleep: async () => {} });
    // RentSmart is the one source that never reaches fetch without a parcel id: it returns
    // an empty result instead of throwing. The other ten all report the fetch failure.
    expect(result.sourceErrors).toHaveLength(BOSTON_SOURCE_COUNT - 1);
    expect(Object.keys(result.rowsBySource)).toEqual(['RentSmart']);
    expect(result.checksFailed).toBeGreaterThan(0);
    expect(result.failures).toBe(result.checksFailed + result.sourceErrors.length);
    expect(result.checks.find((c) => c.label === 'parcel resolves to 2102098000')?.detail).toContain(
      'parcel resolution failed',
    );
    expect(result.checks.find((c) => c.label.startsWith('SAM primary point'))?.detail).toContain('SAM fetch failed');
  });
});

/** 06:00 UTC on 2026-11-14, the planner's hour. Sixty days back is 2026-09-15. */
const PLAN_TIME_MS = Date.UTC(2026, 10, 14, 6);
const WINDOW_START = '2026-09-15';

const PARCEL_CHECK = 'RentSmart answers the parcel query';
const RECENT_CHECK = 'RentSmart has a row from the last 60 days with a ten-digit parcel';

type CkanRow = Record<string, string | number | null>;

function ckanAnswer(records: CkanRow[]): Response {
  return new Response(JSON.stringify({ success: true, result: { records } }), { status: 200 });
}

function ckanFailure(status: number, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { message } }), { status });
}

/** What the city returned for the newest RentSmart rows on 2026-11-14 (the parcel is another building's). */
const RECENT_ROW: CkanRow = { date: '2026-11-12 00:00:00+00', parcel: '1803161000' };

interface RentSmartAnswers {
  /** The adapter's own query, `WHERE "parcel" IN (...)`. */
  parcel: () => Response;
  /** The fixture's city-wide query on the same resource, `WHERE "date" >= ...`. */
  recent: () => Response;
}

/**
 * Resolves the fixture parcel, then routes the two RentSmart queries to `answers`. Every other
 * call gets an empty result, so only the RentSmart checks are under test. Each RentSmart SQL
 * statement is recorded in `seen`.
 */
function rentSmartFetch(answers: RentSmartAnswers, seen: string[] = []): FetchLike {
  return async (input) => {
    const sql = new URL(String(input)).searchParams.get('sql') ?? '';
    if (sql.startsWith('SELECT "PID"')) return ckanAnswer([{ PID: LANARK_FIXTURE.parcelId }]);
    if (sql.includes(RENTSMART_RESOURCE_ID)) {
      seen.push(sql);
      if (sql.includes('WHERE "parcel" IN')) return answers.parcel();
      if (sql.includes('WHERE "date" >=')) return answers.recent();
    }
    return ckanAnswer([]);
  };
}

const runOptions = { sleep: async (): Promise<void> => {}, clockMs: () => PLAN_TIME_MS };

function rentSmartChecks(result: FixtureResult): FixtureCheck[] {
  return result.checks.filter((c) => c.label.startsWith('RentSmart'));
}

function checkNamed(result: FixtureResult, label: string): FixtureCheck | undefined {
  return result.checks.find((c) => c.label === label);
}

describe('runLanarkFixture RentSmart checks', () => {
  it('passes when the fixture parcel has no rows but the source answers and has recent rows', async () => {
    // The city reloaded RentSmart on 2026-11-13 and the fixture parcel's rows went with it.
    // The source still answered, so the old "rows present" rule paused the fill for nothing.
    const seen: string[] = [];
    const result = await runLanarkFixture(
      rentSmartFetch({ parcel: () => ckanAnswer([]), recent: () => ckanAnswer([RECENT_ROW]) }, seen),
      runOptions,
    );

    expect(rentSmartChecks(result).map((c) => [c.label, c.ok])).toEqual([
      [PARCEL_CHECK, true],
      [RECENT_CHECK, true],
    ]);
    expect(checkNamed(result, PARCEL_CHECK)?.detail).toBe(`got 0 rows for parcel ${LANARK_FIXTURE.parcelId}`);
    expect(result.rowsBySource.RentSmart).toBe(0);
    expect(result.sourceErrors.find((e) => e.label === 'RentSmart')).toBeUndefined();

    // Both queries go to the same resource. The city-wide one asks for rows from the window's
    // first day on, quoted the way the adapter quotes its parcel ids.
    const recentSql = seen.find((sql) => sql.includes('WHERE "date" >='));
    expect(recentSql).toContain(`FROM "${RENTSMART_RESOURCE_ID}"`);
    expect(recentSql).toContain(`"date" >= '${WINDOW_START}'`);
    expect(seen.some((sql) => sql.includes(`"parcel" IN ('${LANARK_FIXTURE.parcelId}')`))).toBe(true);
  });

  it('still passes when the fixture parcel has rows', async () => {
    const result = await runLanarkFixture(
      rentSmartFetch({
        parcel: () => ckanAnswer([{ _id: 7, date: '2026-07-01 00:00:00+00', violation_type: 'Housing Complaints', parcel: LANARK_FIXTURE.parcelId }]),
        recent: () => ckanAnswer([RECENT_ROW]),
      }),
      runOptions,
    );
    expect(rentSmartChecks(result).every((c) => c.ok)).toBe(true);
    expect(result.rowsBySource.RentSmart).toBe(1);
  });

  it('fails when the parcel query throws, even with recent rows city-wide', async () => {
    const result = await runLanarkFixture(
      rentSmartFetch({ parcel: () => ckanFailure(500, 'parcel query broke'), recent: () => ckanAnswer([RECENT_ROW]) }),
      runOptions,
    );
    const parcelCheck = checkNamed(result, PARCEL_CHECK);
    expect(parcelCheck?.ok).toBe(false);
    expect(parcelCheck?.detail).toContain('"RentSmart" source failed to fetch');
    expect(result.sourceErrors.find((e) => e.label === 'RentSmart')?.message).toContain('parcel query broke');
    expect(result.rowsBySource.RentSmart).toBeUndefined();
    expect(result.failures).toBeGreaterThan(0);
  });

  it('fails the parcel check when there is no parcel to query', async () => {
    // With no parcel the adapter returns no rows without asking the city. That is not an answer.
    const result = await runLanarkFixture(emptyFetch, runOptions);
    const parcelCheck = checkNamed(result, PARCEL_CHECK);
    expect(parcelCheck?.ok).toBe(false);
    expect(parcelCheck?.detail).toBe('no parcel id, so the parcel query never ran');
  });

  it.each([
    ['returns no rows', [], `no rows dated on or after ${WINDOW_START}`],
    [
      'returns a row older than the window',
      [{ date: '2026-09-14 00:00:00+00', parcel: '1803161000' }],
      `newest row dated 2026-09-14 00:00:00+00, parcel 1803161000 (window starts ${WINDOW_START})`,
    ],
    [
      'returns a row whose parcel is not ten digits',
      [{ date: '2026-11-12 00:00:00+00', parcel: '1803161000_' }],
      `newest row dated 2026-11-12 00:00:00+00, parcel 1803161000_ (window starts ${WINDOW_START})`,
    ],
    [
      'returns a row with no date',
      [{ date: null, parcel: '1803161000' }],
      `newest row dated none, parcel 1803161000 (window starts ${WINDOW_START})`,
    ],
  ] as Array<[string, CkanRow[], string]>)('fails when the city-wide query %s', async (_case, rows, detail) => {
    const result = await runLanarkFixture(
      rentSmartFetch({ parcel: () => ckanAnswer([]), recent: () => ckanAnswer(rows) }),
      runOptions,
    );
    expect(checkNamed(result, PARCEL_CHECK)?.ok).toBe(true);
    const recentCheck = checkNamed(result, RECENT_CHECK);
    expect(recentCheck?.ok).toBe(false);
    expect(recentCheck?.detail).toBe(detail);
  });

  it('fails when the city-wide query throws, and counts that failure once', async () => {
    const result = await runLanarkFixture(
      rentSmartFetch({ parcel: () => ckanAnswer([]), recent: () => ckanFailure(502, 'portal down') }),
      runOptions,
    );
    const recentCheck = checkNamed(result, RECENT_CHECK);
    expect(recentCheck?.ok).toBe(false);
    expect(recentCheck?.detail).toContain('RentSmart recent-rows query failed');
    expect(recentCheck?.detail).toContain('portal down');
    // The parcel query answered, so RentSmart is not a source that threw: the failed check is
    // the one place this failure is counted, as with the SAM check.
    expect(result.sourceErrors.find((e) => e.label === 'RentSmart')).toBeUndefined();
    expect(result.rowsBySource.RentSmart).toBe(0);
  });
});
