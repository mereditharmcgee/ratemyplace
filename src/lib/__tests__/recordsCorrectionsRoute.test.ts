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
    const db = createRecordsTestDb();
    const context = createContext(db, { contentType: null, body: validBody });

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

  it('rate limits after 3 submissions per hour per IP', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'bldg-lanark' });
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
    await insertBuilding(db, { id: 'bldg-lanark' });
    const context = createContext(db, { ip: '198.51.100.2', body: { ...validBody, turnstileToken: 'bad' } });

    const response = await POST(context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Bot verification failed. Please try again.' });
  });

  it('400s on a claim that is too short, with a field-tagged detail', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'bldg-lanark' });
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

  it('stores a pending correction with a lowercased email and null record_kind for panel', async () => {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id: 'bldg-lanark' });
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
    await insertBuilding(db, { id: 'bldg-lanark' });
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
    await insertBuilding(db, { id: 'bldg-lanark' });
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
    await insertBuilding(db, { id: 'bldg-lanark' });
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
