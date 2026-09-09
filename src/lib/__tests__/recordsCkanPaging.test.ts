import { describe, expect, it } from 'vitest';
import { CKAN_SEARCH_ENDPOINT, fetchAllRows } from '../records/ckan';
import type { FetchLike } from '../records/types';

/** Retries must not sleep in tests; every failing-path case injects this. */
const noSleep = async (): Promise<void> => {};

function fakeCkan(total: number, pageSize: number): { fetchImpl: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    const offset = Number(url.searchParams.get('offset') ?? '0');
    // The fake serves no more than its own page size, whatever limit the caller asked for.
    const limit = Math.min(Number(url.searchParams.get('limit')), pageSize);
    const records = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ _id: offset + i + 1 }));
    return new Response(JSON.stringify({ success: true, result: { records, total } }), { status: 200 });
  };
  return { fetchImpl, urls };
}

describe('fetchAllRows', () => {
  it('pages through a resource until a short page and concatenates the rows', async () => {
    const { fetchImpl, urls } = fakeCkan(7, 3);
    const rows = await fetchAllRows<{ _id: number }>('res-1', { fields: ['_id'], pageSize: 3 }, fetchImpl);
    expect(rows.map((r) => r._id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(`${CKAN_SEARCH_ENDPOINT}?`);
    expect(urls[0]).toContain('resource_id=res-1');
    expect(urls[0]).toContain('fields=_id');
    expect(urls[2]).toContain('offset=6');
  });

  it('sends filters as JSON and stops after an exact multiple of the page size', async () => {
    const { fetchImpl, urls } = fakeCkan(6, 3);
    const rows = await fetchAllRows<{ _id: number }>('res-1', { pageSize: 3, filters: { LU: ['A', 'R2'] } }, fetchImpl);
    expect(rows).toHaveLength(6);
    expect(urls).toHaveLength(3); // third call returns 0 rows and ends the loop
    expect(decodeURIComponent(urls[0])).toContain('filters={"LU":["A","R2"]}');
  });

  it('asks for JSON explicitly', async () => {
    const seen: (RequestInit | undefined)[] = [];
    const fetchImpl: FetchLike = async (_input, init) => {
      seen.push(init);
      return new Response(JSON.stringify({ success: true, result: { records: [] } }), { status: 200 });
    };
    await fetchAllRows('res-1', { pageSize: 5 }, fetchImpl);
    expect(new Headers(seen[0]?.headers).get('accept')).toBe('application/json');
  });

  it('throws on a non-success response with the resource in the message', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({ success: false, error: { message: 'nope' } }), { status: 409 });
    await expect(fetchAllRows('res-2', { sleep: noSleep }, fetchImpl)).rejects.toThrow(/res-2/);
  });

  it('reports a non-JSON body with the status and the first of the body', async () => {
    const fetchImpl: FetchLike = async () => new Response('<html>502</html>', { status: 502 });
    await expect(fetchAllRows('res-1', { sleep: noSleep }, fetchImpl)).rejects.toThrow(/res-1.*offset 0.*HTTP 502.*<html>502<\/html>/);
  });

  it('aborts a request that outlives the timeout', async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    await expect(fetchAllRows('res-1', { timeoutMs: 10, sleep: noSleep }, fetchImpl)).rejects.toThrow(/res-1.*offset 0.*timed out/);
  });

  it('retries a transient 5xx and returns the page it eventually gets', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls <= 2) return new Response('upstream unavailable', { status: 503 });
      return new Response(JSON.stringify({ success: true, result: { records: [{ _id: 1 }] } }), { status: 200 });
    };
    const rows = await fetchAllRows<{ _id: number }>('res-1', { pageSize: 5, sleep: noSleep }, fetchImpl);
    expect(rows).toEqual([{ _id: 1 }]);
    expect(calls).toBe(3);
  });

  it('does not retry a 4xx', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      return new Response(JSON.stringify({ success: false, error: { message: 'no such resource' } }), { status: 404 });
    };
    await expect(fetchAllRows('res-3', { sleep: noSleep }, fetchImpl)).rejects.toThrow(/res-3/);
    expect(calls).toBe(1);
  });

  it('rejects a page size below one instead of looping forever', async () => {
    const { fetchImpl } = fakeCkan(4, 2);
    await expect(fetchAllRows('res-1', { pageSize: 0 }, fetchImpl)).rejects.toThrow(/pageSize/);
  });

  it('reports cumulative rows per page', async () => {
    const { fetchImpl } = fakeCkan(4, 2);
    const seen: number[] = [];
    await fetchAllRows('res-1', { pageSize: 2, onPage: (count) => seen.push(count) }, fetchImpl);
    expect(seen).toEqual([2, 4]);
  });

  it('reports the final partial page too', async () => {
    const { fetchImpl } = fakeCkan(5, 2);
    const seen: number[] = [];
    await fetchAllRows('res-1', { pageSize: 2, onPage: (count) => seen.push(count) }, fetchImpl);
    expect(seen).toEqual([2, 4, 5]);
  });
});
