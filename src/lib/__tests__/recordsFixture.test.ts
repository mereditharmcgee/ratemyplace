import { describe, expect, it } from 'vitest';
import { LANARK_FIXTURE, runLanarkFixture } from '../records/fixture';
import { sourcesForCity } from '../records/jurisdictions';
import type { FetchLike } from '../records/types';

/** A fetch that answers every CKAN call with an empty result set. */
const emptyFetch: FetchLike = async () =>
  new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });

/** Every Boston adapter runs for the fixture, so this is the arity both accountings add up to. */
const BOSTON_SOURCE_COUNT = sourcesForCity('Boston').length;

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
