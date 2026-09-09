import { describe, expect, it } from 'vitest';
import { LANARK_FIXTURE, runLanarkFixture } from '../records/fixture';
import { sourcesForCity } from '../records/jurisdictions';
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
