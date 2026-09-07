import type { APIContext } from 'astro';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../pages/api/admin/buildings/[id]/records/pull';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';

const suite = sqliteAvailable ? describe : describe.skip;

const ADMIN_ID = 'admin';

/** Every Boston source: six assessor years, permits, violations, enforcement, 311, RentSmart. */
const BOSTON_SOURCE_COUNT = 11;

/**
 * record_pulls.triggered_by and audit_logs.admin_user_id are both foreign keys to
 * users(id), and node:sqlite (like D1) enforces it, so the acting admin has to exist.
 */
async function createDbWithAdmin(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  await db.prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)').bind(ADMIN_ID, 'admin@example.com').run();
  return db;
}

interface ContextOptions {
  user?: { id: string; isAdmin: boolean } | null;
  buildingId?: string;
  body?: unknown;
  withContentType?: boolean;
  withBody?: boolean;
}

function createContext(db: TestD1Database, options: ContextOptions = {}): APIContext {
  const {
    user = { id: ADMIN_ID, isAdmin: true },
    buildingId = 'bldg-lanark',
    body,
    withContentType = true,
    withBody = true,
  } = options;

  const headers: Record<string, string> = { 'CF-Connecting-IP': '203.0.113.10' };
  if (withContentType) {
    headers['Content-Type'] = 'application/json';
  }

  const init: RequestInit = { method: 'POST', headers };
  if (withBody) {
    init.body = JSON.stringify(body ?? {});
  }

  const request = new Request(`https://ratemyplace.org/api/admin/buildings/${buildingId}/records/pull`, init);

  return {
    params: { id: buildingId },
    request,
    url: new URL(request.url),
    locals: {
      user,
      runtime: { env: { DB: db } },
    },
  } as unknown as APIContext;
}

suite('POST /api/admin/buildings/[id]/records/pull', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a non-admin user', async () => {
    const db = await createDbWithAdmin();
    const context = createContext(db, { user: { id: 'user-1', isAdmin: false } });

    const response = await POST(context);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Admin access required' });
  });

  it('rejects a request with no signed-in user', async () => {
    const db = await createDbWithAdmin();
    const context = createContext(db, { user: null });

    const response = await POST(context);

    expect(response.status).toBe(403);
  });

  it('404s for an unknown building', async () => {
    const db = await createDbWithAdmin();
    const context = createContext(db, { buildingId: 'does-not-exist' });

    const response = await POST(context);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Building not found' });
  });

  it('400s for a malformed parcel id override', async () => {
    const db = await createDbWithAdmin();
    await insertBuilding(db);
    const context = createContext(db, { body: { parcelId: '12ab' } });

    const response = await POST(context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Validation failed',
      details: [{ field: 'parcelId', message: 'Parcel id must be 9 or 10 digits.' }],
    });
  });

  it('pulls records, applies a parcel override, and writes two audit logs', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    vi.stubGlobal('fetch', fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: lanark2026 }]));

    try {
      const context = createContext(db, { buildingId, body: { parcelId: '2102098000' } });

      const response = await POST(context);
      const payload = (await response.json()) as { data: { parcelId: string | null; sources: unknown[] } };

      expect(response.status).toBe(200);
      expect(payload.data.parcelId).toBe('2102098000');
      expect(payload.data.sources).toHaveLength(BOSTON_SOURCE_COUNT);

      const auditRows = await db
        .prepare(
          'SELECT action_type, entity_type, entity_id, admin_user_id, old_value, new_value, notes FROM audit_logs WHERE entity_id = ? ORDER BY id',
        )
        .bind(buildingId)
        .all<{
          action_type: string;
          entity_type: string;
          entity_id: string;
          admin_user_id: string;
          old_value: string | null;
          new_value: string | null;
          notes: string | null;
        }>();

      expect(auditRows.results).toHaveLength(2);

      const overrideRow = auditRows.results[0];
      expect(overrideRow).toMatchObject({
        action_type: 'building_updated',
        entity_type: 'building',
        entity_id: buildingId,
        admin_user_id: ADMIN_ID,
      });
      expect(JSON.parse(overrideRow.old_value ?? 'null')).toMatchObject({ parcelId: null });
      expect(JSON.parse(overrideRow.new_value ?? 'null')).toMatchObject({ parcelId: '2102098000' });

      const pulledRow = auditRows.results[1];
      expect(pulledRow).toMatchObject({
        action_type: 'records_pulled',
        entity_type: 'building',
        entity_id: buildingId,
        admin_user_id: ADMIN_ID,
      });
      expect(pulledRow.notes ?? '').toContain('parcel override 2102098000');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('works with no request body and no content-type header', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db, { parcel_id: '2102098000' });
    vi.stubGlobal('fetch', fixtureFetch([]));

    try {
      const context = createContext(db, { buildingId, withContentType: false, withBody: false });

      const response = await POST(context);

      expect(response.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores a parcelId sent with a non-JSON content type', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    vi.stubGlobal('fetch', fixtureFetch([]));

    try {
      const context = createContext(db, {
        buildingId,
        body: { parcelId: '2102098000' },
        withContentType: false,
      });

      const response = await POST(context);

      expect(response.status).toBe(200);

      const auditRows = await db
        .prepare("SELECT action_type FROM audit_logs WHERE entity_id = ? AND action_type = 'building_updated'")
        .bind(buildingId)
        .all<{ action_type: string }>();
      expect(auditRows.results).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('debounces a second immediate pull for the same building with 429', async () => {
    const db = await createDbWithAdmin();
    const buildingId = await insertBuilding(db);
    vi.stubGlobal('fetch', fixtureFetch([]));

    try {
      const first = await POST(createContext(db, { buildingId }));
      expect(first.status).toBe(200);

      const second = await POST(createContext(db, { buildingId }));
      expect(second.status).toBe(429);
      expect(await second.json()).toEqual({
        error: 'A pull for this building is already running or just finished. Try again in a minute.',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
