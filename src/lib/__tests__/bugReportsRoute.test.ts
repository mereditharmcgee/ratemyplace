import type { APIContext } from 'astro';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb } from './helpers/recordsDb';

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) =>
    token === 'good' ? { success: true } : { success: false, error: 'Bot verification failed. Please try again.' },
  ),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

import { queueOwnerNotice } from '../ownerNotify';
import { POST } from '../../pages/api/bug-reports';

const queued = vi.mocked(queueOwnerNotice);

function bugDb(): TestD1Database {
  const db = createRecordsTestDb();
  db.exec(readFileSync(join(process.cwd(), 'migrations', '0018_bug_reports.sql'), 'utf8'));
  return db;
}

function context(db: TestD1Database, body: BodyInit, headers: Record<string, string> = {}): APIContext {
  const request = new Request('https://ratemyplace.org/api/bug-reports', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.20', ...headers },
    body,
  });
  return {
    request,
    locals: { user: null, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields = {
    category: 'bug',
    description: 'The map does not load on my phone.',
    'cf-turnstile-response': 'good',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe.skipIf(!sqliteAvailable)('POST /api/bug-reports owner notice', () => {
  beforeEach(() => {
    queued.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('inserts the report and queues exactly a bug_report notice with no building', async () => {
    const db = bugDb();
    const response = await POST(context(db, form()));

    expect(response.status).toBe(200);
    const row = await db.prepare('SELECT COUNT(*) AS n FROM bug_reports').first<{ n: number }>();
    expect(row?.n).toBe(1);
    expect(queued).toHaveBeenCalledOnce();
    expect(queued.mock.calls[0][1]).toEqual({ kind: 'bug_report', buildingId: null });
  });

  it('does not queue for an empty description', async () => {
    const response = await POST(context(bugDb(), form({ description: '' })));
    expect(response.status).toBe(400);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue when Turnstile fails', async () => {
    const response = await POST(context(bugDb(), form({ 'cf-turnstile-response': 'bad' })));
    expect(response.status).toBe(400);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue for a JSON body', async () => {
    const response = await POST(context(bugDb(), JSON.stringify({ description: 'x' }), { 'Content-Type': 'application/json' }));
    expect(response.status).toBe(415);
    expect(queued).not.toHaveBeenCalled();
  });
});
