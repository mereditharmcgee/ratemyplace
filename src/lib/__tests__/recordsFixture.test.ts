import { describe, expect, it } from 'vitest';
import { LANARK_FIXTURE, runLanarkFixture } from '../records/fixture';
import type { FetchLike } from '../records/types';

/** A fetch that answers every CKAN call with an empty result set. */
const emptyFetch: FetchLike = async () =>
  new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });

describe('runLanarkFixture', () => {
  it('names the fixture parcel and address', () => {
    expect(LANARK_FIXTURE.parcelId).toBe('2102098000');
    expect(LANARK_FIXTURE.address).toBe('23-27 Lanark Rd, Boston, MA 02135');
  });

  it('returns one check per assertion and counts failures without throwing', async () => {
    const result = await runLanarkFixture(emptyFetch);
    expect(result.checks.length).toBeGreaterThanOrEqual(12);
    expect(result.checks.every((c) => typeof c.label === 'string' && typeof c.ok === 'boolean' && typeof c.detail === 'string')).toBe(true);
    // Empty responses fail the parcel resolution and every value check.
    expect(result.failures).toBeGreaterThan(0);
    expect(result.checks.find((c) => c.label === 'parcel resolves to 2102098000')?.ok).toBe(false);
  });

  // 10s, not the 5s default: the SAM fetch goes through `fetchAllRows`, which retries a
  // network failure twice behind a 1s + 4s backoff. That backoff is wanted in production —
  // a blip at data.boston.gov must not trip the scheduler's breaker — so the test waits it
  // out rather than the fixture giving it up.
  it('reports a source that throws as a failed check, not an exception', async () => {
    const throwingFetch: FetchLike = async () => {
      throw new Error('boom');
    };
    const result = await runLanarkFixture(throwingFetch);
    expect(result.failures).toBeGreaterThan(0);
    expect(result.sourceErrors.length).toBeGreaterThan(0);
  }, 10_000);
});
