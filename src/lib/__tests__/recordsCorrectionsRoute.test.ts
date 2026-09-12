import type { APIContext } from 'astro';
import { describe, it, expect, vi } from 'vitest';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';

// Mock Turnstile BEFORE importing the route so it picks up the mock instead of
// making a real network call. Token 'good' succeeds; anything else fails.
vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) => {
    if (token === 'good') return { success: true };
    return { success: false, error: 'Bot verification failed. Please try again.' };
  }),
}));

import { POST } from '../../pages/api/records/corrections';

const suite = sqliteAvailable ? describe : describe.skip;

interface ContextOptions {
  ip?: string;
  body?: unknown;
  contentType?: string | null;
}

function createContext(db: TestD1Database, options: ContextOptions = {}): APIContext {
  const { ip = '203.0.113.10', body, contentType = 'application/json' } = options;

  const headers: Record<string, string> = { 'CF-Connecting-IP': ip };
  if (contentType !== null) {
    headers['Content-Type'] = contentType;
  }

  const init: RequestInit = { method: 'POST', headers };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const request = new Request('https://ratemyplace.org/api/records/corrections', init);

  return {
    request,
    locals: {
      user: null,
      runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } },
    },
  } as unknown as APIContext;
}

/**
 * A building whose records panel actually exists: the route refuses a report for a
 * building with no `record_pulls` row, because no panel — and so no form — renders there.
 */
async function insertPulledBuilding(db: TestD1Database, id = 'bldg-lanark'): Promise<string> {
  await insertBuilding(db, { id });
  await db
    .prepare(
      'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count) ' +
        "VALUES (?, ?, 'boston', 'boston.permits', 'Approved Building Permits', 'q', 'ok', 2)",
    )
    .bind(`pull-${id}`, id)
    .run();
  return id;
}

const validBody = {
  buildingId: 'bldg-lanark',
  recordKind: 'permit',
  claim: 'This permit lists the wrong applicant name for the 2023 renovation.',
  turnstileToken: 'good',
};

suite('POST /api/records/corrections', () => {
  it('415s for a form content type, before reading the body', async () => {
    const db = createRecordsTestDb();
    const context = createContext(db, { contentType: 'application/x-www-form-urlencoded', body: 'a=1' });

    const response = await POST(context);

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Unsupported Media Type' });
  });

  it('415s when the Content-Type header is missing entirely', async () => {
    // No body at all: a string body (even via createContext's own
    // JSON.stringify) makes the Fetch API auto-add a `text/plain` Content-Type
    // header, which would defeat the "header truly absent" case this test
    // means to cover.
    const db = createRecordsTestDb();
    const context = createContext(db, { contentType: null, body: undefined });

    const response = await POST(context);

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: 'Unsupported Media Type' });
  });

  it('400s on a null JSON body', async () => {
    const db = createRecordsTestDb();
    const context = createContext(db, { ip: '198.51.100.20', body: 'null' });

    const response = await POST(context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Validation failed',
      details: [{ field: 'buildingId', message: 'Building is required.' }],
    });
  });

  it('400s on an array JSON body', async () => {
    const db = createRecordsTestDb();
    const context = createContext(db, { ip: '198.51.100.21', body: '[]' });

    const response = await POST(context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Validation failed',
      details: [{ field: 'buildingId', message: 'Building is required.' }],
    });
  });

  it('400s on a body that is not JSON at all, with no log line', async () => {
    // `{` with a JSON content type used to throw SyntaxError into the generic catch: a 500
    // and a logError line per attempt, for what is a client error and nothing of ours.
    const db = createRecordsTestDb();
    const context = createContext(db, { ip: '198.51.100.22', body: '{' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await POST(context);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Validation failed',
        details: [{ field: 'body', message: 'Request body must be JSON.' }],
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('rate limits after 3 submissions per hour per IP', async () => {
    const db = createRecordsTestDb();
    await insertPulledBuilding(db);
    const ip = '198.51.100.1';

    for (let i = 0; i < 3; i++) {
      const response = await POST(createContext(db, { ip, body: validBody }));
      expect(response.status).toBe(201);
    }

    const fourth = await POST(createContext(db, { ip, body: validBody }));

    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'Too many reports. Please try again later.' });
    expect(fourth.headers.get('Retry-After')).not.toBeNull();
  });

  it('400s on a bad Turnstile token', async () => {
    const db = createRecordsTestDb();
    await insertPulledBuilding(db);
    const context = createContext(db, { ip: '198.51.100.2', body: { ...validBody, turnstileToken: 'bad' } });

    const response = await POST(context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Bot verification failed. Please try again.' });
  });

  it('400s on a claim that is too short, with a field-tagged detail', async () => {
    const db = createRecordsTestDb();
    await insertPulledBuilding(db);
    const context = createContext(db, { ip: '198.51.100.3', body: { ...validBody, claim: 'too short' } });

    const response = await POST(context);
    const payload = (await response.json()) as { error: string; details: Array<{ field: string }> };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details[0].field).toBe('claim');
  });

  it('404s for a building that does not exist', async () => {
    const db = createRecordsTestDb();
    const context = createContext(db, { ip: '198.51.100.4', body: { ...validBody, buildingId: 'does-not-exist' } });

    const response = await POST(context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Building not found' });
  });

  it('404s for a real building that has never been pulled, so no panel or form renders there', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'bldg-lanark' });
    const context = createContext(db, { ip: '198.51.100.9', body: validBody });

    const response = await POST(context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Building not found' });

    const stored = await db
      .prepare('SELECT count(*) AS n FROM record_corrections')
      .first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it('stores a pending correction with a lowercased email and null record_kind for panel', async () => {
    const db = createRecordsTestDb();
    await insertPulledBuilding(db);
    const context = createContext(db, {
      ip: '198.51.100.5',
      body: {
        buildingId: 'bldg-lanark',
        recordKind: 'panel',
        claim: 'The entire records panel fails to load for this building address.',
        contactEmail: 'Tenant@Example.com',
        turnstileToken: 'good',
      },
    });

    const response = await POST(context);
    const payload = (await response.json()) as { data: { id: string } };

    expect(response.status).toBe(201);
    expect(payload.data.id).toEqual(expect.any(String));

    const row = await db
      .prepare('SELECT building_id, record_kind, claim, contact_email, status FROM record_corrections WHERE id = ?')
      .bind(payload.data.id)
      .first<{ building_id: string; record_kind: string | null; claim: string; contact_email: string; status: string }>();

    expect(row).toMatchObject({
      building_id: 'bldg-lanark',
      record_kind: null,
      claim: 'The entire records panel fails to load for this building address.',
      contact_email: 'tenant@example.com',
      status: 'pending',
    });
  });

  it('stores a non-panel kind as its own record_kind value', async () => {
    const db = createRecordsTestDb();
    await insertPulledBuilding(db);
    const context = createContext(db, { ip: '198.51.100.6', body: validBody });

    const response = await POST(context);
    const payload = (await response.json()) as { data: { id: string } };

    expect(response.status).toBe(201);

    const row = await db
      .prepare('SELECT record_kind FROM record_corrections WHERE id = ?')
      .bind(payload.data.id)
      .first<{ record_kind: string | null }>();

    expect(row).toMatchObject({ record_kind: 'permit' });
  });

  it('400s on an all-markup claim (sanitizes to nothing) with a claim field error', async () => {
    const db = createRecordsTestDb();
    await insertPulledBuilding(db);
    const context = createContext(db, {
      ip: '198.51.100.7',
      body: { ...validBody, claim: '<b></b><i></i><em></em>'.repeat(2) },
    });

    const response = await POST(context);
    const payload = (await response.json()) as { error: string; details: Array<{ field: string }> };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Validation failed');
    expect(payload.details[0].field).toBe('claim');
  });

  it('stores a claim with line breaks preserved', async () => {
    const db = createRecordsTestDb();
    await insertPulledBuilding(db);
    const multilineClaim = 'This permit is wrong.\nThe applicant name does not match the 2023 renovation records.';
    const context = createContext(db, {
      ip: '198.51.100.8',
      body: { ...validBody, claim: multilineClaim },
    });

    const response = await POST(context);
    const payload = (await response.json()) as { data: { id: string } };

    expect(response.status).toBe(201);

    const row = await db
      .prepare('SELECT claim FROM record_corrections WHERE id = ?')
      .bind(payload.data.id)
      .first<{ claim: string }>();

    expect(row?.claim).toBe(multilineClaim);
  });
});
