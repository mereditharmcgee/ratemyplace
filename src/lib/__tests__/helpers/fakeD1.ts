import type { RecordsDb, RecordsPreparedStatement } from '../../records/types';

export interface FakeCall {
  sql: string;
  binds: unknown[];
  method: 'first' | 'all' | 'run';
}

/**
 * A scripted D1 double for routes whose statements the sqlite stub cannot hold (the review
 * routes bind 60 columns the stub schema does not have). `respond` sees every executed
 * statement and returns its answer; returning `undefined` takes the default, and throwing
 * simulates a failing statement.
 *
 * Defaults: `run()` → `{ success: true, meta: { changes: 1 } }`; `all()` → `{ results: [] }`;
 * `first()` → `{ attempt_count: 0, first_attempt: null }` for checkRateLimit's count, else null.
 */
export function fakeD1(respond: (call: FakeCall) => unknown): { db: RecordsDb; calls: FakeCall[] } {
  const calls: FakeCall[] = [];

  function execute(sql: string, binds: unknown[], method: FakeCall['method']): unknown {
    const call: FakeCall = { sql, binds, method };
    calls.push(call);
    const answer = respond(call);
    if (answer !== undefined) return answer;
    if (method === 'run') return { success: true, meta: { changes: 1 } };
    if (method === 'all') return { results: [] };
    if (/SELECT COUNT\(\*\) as attempt_count/i.test(sql)) return { attempt_count: 0, first_attempt: null };
    return null;
  }

  function statement(sql: string, binds: unknown[]): RecordsPreparedStatement {
    return {
      bind: (...values: unknown[]) => statement(sql, values),
      first: async <T>() => execute(sql, binds, 'first') as T | null,
      all: async <T>() => execute(sql, binds, 'all') as { results: T[] },
      run: async () => execute(sql, binds, 'run') as { success?: boolean; meta?: { changes?: number } },
    };
  }

  const db: RecordsDb = {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: RecordsPreparedStatement[]) => {
      const results: unknown[] = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
  };
  return { db, calls };
}
