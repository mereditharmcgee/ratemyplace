import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../../pages/api/admin/records/corrections/index';
import { PATCH } from '../../pages/api/admin/records/corrections/[id]';
import { POST as REPULL } from '../../pages/api/admin/records/corrections/[id]/repull';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import permits from './helpers/records/permits-positive.json';
import { sendRecordCorrectionOutcomeEmail } from '../email';

// The route sends through lib/email; the mock keeps Resend out of the test and
// lets us assert on the recipient and outcome the route chose.
vi.mock('../email', () => ({
  sendRecordCorrectionOutcomeEmail: vi.fn(async () => ({ success: true })),
}));

const sendOutcomeEmail = vi.mocked(sendRecordCorrectionOutcomeEmail);

const suite = sqliteAvailable ? describe : describe.skip;

const ADMIN_ID = 'admin';
const BUILDING_ID = 'bldg-lanark';
const BUILDING_ADDRESS = '23-27 Lanark Rd, Boston, MA 02135';
const CORRECTION_ID = 'corr-1';

/** Every Boston source: six assessor years, permits, violations, enforcement, 311, RentSmart. */
const BOSTON_SOURCE_COUNT = 11;

/**
 * record_pulls.triggered_by, record_corrections.resolved_by and
 * audit_logs.admin_user_id are all foreign keys to users(id), which node:sqlite
 * (like D1) enforces — the acting admin has to exist.
 */
async function createDbWithAdmin(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  await db.prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)').bind(ADMIN_ID, 'admin@example.com').run();
  return db;
}

interface CorrectionOverrides {
  id?: string;
  buildingId?: string;
  recordKind?: string | null;
  claim?: string;
  contactEmail?: string | null;
}

async function insertCorrection(db: TestD1Database, overrides: CorrectionOverrides = {}): Promise<string> {
  const id = overrides.id ?? CORRECTION_ID;
  await db
    .prepare('INSERT INTO record_corrections (id, building_id, record_kind, claim, contact_email) VALUES (?, ?, ?, ?, ?)')
    .bind(
      id,
      overrides.buildingId ?? BUILDING_ID,
      overrides.recordKind === undefined ? 'assessment' : overrides.recordKind,
      overrides.claim ?? 'The owner name on the assessment record is out of date by two years.',
      overrides.contactEmail === undefined ? 'filer@example.com' : overrides.contactEmail,
    )
    .run();
  return id;
}

interface ContextOptions {
  user?: { id: string; isAdmin: boolean } | null;
  correctionId?: string;
  search?: string;
  body?: unknown;
  method?: string;
}

function createContext(db: TestD1Database, options: ContextOptions = {}): APIContext {
  const {
    user = { id: ADMIN_ID, isAdmin: true },
    correctionId = CORRECTION_ID,
    search = '',
    body,
    method = 'POST',
  } = options;

  const url = `https://ratemyplace.org/api/admin/records/corrections${search}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
  };
  if (method !== 'GET' && body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const request = new Request(url, init);

  return {
    params: { id: correctionId },
    request,
    url: new URL(url),
    locals: {
      user,
      runtime: {
        env: { DB: db, RESEND_API_KEY: 'test-key', SITE_URL: 'https://ratemyplace.org' },
      },
    },
  } as unknown as APIContext;
}

/** Boston fixture routing: FY2026 assessment plus the permits feed; every other source returns empty. */
function bostonFixtures(): ReturnType<typeof fixtureFetch> {
  return fixtureFetch([
    { resourceId: FY2026_RESOURCE_ID, records: lanark2026 },
    { resourceId: PERMITS_RESOURCE_ID, records: permits },
  ]);
}

suite('admin record correction routes', () => {
  beforeEach(() => {
    sendOutcomeEmail.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('GET /api/admin/records/corrections', () => {
    it('rejects a non-admin user', async () => {
      const db = await createDbWithAdmin();
      const response = await GET(createContext(db, { user: { id: 'user-1', isAdmin: false }, method: 'GET' }));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Admin access required' });
    });

    it('400s for an unknown status filter', async () => {
      const db = await createDbWithAdmin();
      const response = await GET(createContext(db, { method: 'GET', search: '?status=nope' }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid status' });
    });

    it('lists pending corrections with their building address and slug', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db);

      const response = await GET(createContext(db, { method: 'GET' }));
      const payload = (await response.json()) as {
        data: Array<{
          id: string;
          status: string;
          record_kind: string | null;
          has_contact_email: number;
          building_address: string;
          building_slug: string;
        }>;
      };

      expect(response.status).toBe(200);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]).toMatchObject({
        id: CORRECTION_ID,
        status: 'pending',
        record_kind: 'assessment',
        has_contact_email: 1,
        building_address: BUILDING_ADDRESS,
        building_slug: BUILDING_ID,
      });
      // The filer's address never leaves the server; the queue only needs to know
      // whether resolving will email someone.
      expect(payload.data[0]).not.toHaveProperty('contact_email');
    });

    it('reports an anonymous report as has_contact_email 0', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db, { contactEmail: null });

      const response = await GET(createContext(db, { method: 'GET' }));
      const payload = (await response.json()) as { data: Array<Record<string, unknown>> };

      expect(response.status).toBe(200);
      expect(payload.data[0].has_contact_email).toBe(0);
      expect(payload.data[0]).not.toHaveProperty('contact_email');
    });
  });

  describe('POST /api/admin/records/corrections/[id]/repull', () => {
    it('404s for an unknown correction', async () => {
      const db = await createDbWithAdmin();
      const response = await REPULL(createContext(db, { correctionId: 'nope' }));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Correction not found' });
    });

    it('re-pulls every source, tags the pulls with the correction, and diffs the result', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db, { parcel_id: '2102098000' });
      await insertCorrection(db);
      vi.stubGlobal('fetch', bostonFixtures());

      const response = await REPULL(createContext(db));
      const payload = (await response.json()) as {
        data: {
          summary: { sources: unknown[] };
          diff: { added: unknown[]; removed: unknown[]; changed: unknown[] };
        };
      };

      expect(response.status).toBe(200);
      expect(payload.data.summary.sources).toHaveLength(BOSTON_SOURCE_COUNT);
      // Nothing stored before, so everything the fixtures return is 'added': the
      // FY2026 assessment plus the two distinct permits (the third fixture row
      // is a deliberate duplicate).
      expect(payload.data.diff.added).toHaveLength(3);
      expect(payload.data.diff.removed).toHaveLength(0);
      expect(payload.data.diff.changed).toHaveLength(0);

      const pulls = await db
        .prepare('SELECT correction_id FROM record_pulls WHERE building_id = ?')
        .bind(BUILDING_ID)
        .all<{ correction_id: string | null }>();

      expect(pulls.results).toHaveLength(BOSTON_SOURCE_COUNT);
      expect(pulls.results.every((row) => row.correction_id === CORRECTION_ID)).toBe(true);
    });

    it('debounces a second immediate re-pull for the same building with 429', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db);
      vi.stubGlobal('fetch', fixtureFetch([]));

      const first = await REPULL(createContext(db));
      expect(first.status).toBe(200);

      const second = await REPULL(createContext(db));
      expect(second.status).toBe(429);
      expect(await second.json()).toEqual({
        error: 'A pull for this building is already running or just finished. Try again in a minute.',
      });
    });

    it('audits the re-pull against the building with the correction id in the notes', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db, { parcel_id: '2102098000' });
      await insertCorrection(db);
      vi.stubGlobal('fetch', bostonFixtures());

      expect((await REPULL(createContext(db))).status).toBe(200);

      const audit = await db
        .prepare('SELECT entity_type, entity_id, admin_user_id, new_value, notes FROM audit_logs WHERE action_type = ?')
        .bind('records_pulled')
        .all<{
          entity_type: string;
          entity_id: string;
          admin_user_id: string;
          new_value: string | null;
          notes: string | null;
        }>();

      expect(audit.results).toHaveLength(1);
      expect(audit.results[0]).toMatchObject({
        entity_type: 'building',
        entity_id: BUILDING_ID,
        admin_user_id: ADMIN_ID,
      });
      expect(audit.results[0].notes ?? '').toContain(CORRECTION_ID);

      const newValue = JSON.parse(audit.results[0].new_value ?? 'null') as {
        correctionId: string;
        parcelId: string | null;
        condominium: boolean;
        sources: Array<{ label: string; status: string; rowCount: number }>;
      };
      expect(newValue.correctionId).toBe(CORRECTION_ID);
      expect(newValue.parcelId).toBe('2102098000');
      expect(newValue.condominium).toBe(false);
      expect(newValue.sources).toHaveLength(BOSTON_SOURCE_COUNT);
      expect(newValue.sources.every((source) => typeof source.label === 'string')).toBe(true);
    });
  });

  describe('PATCH /api/admin/records/corrections/[id]', () => {
    it('rejects a non-admin user', async () => {
      const db = await createDbWithAdmin();
      const response = await PATCH(
        createContext(db, {
          method: 'PATCH',
          user: { id: 'user-1', isAdmin: false },
          body: { resolution: 'repulled_unchanged' },
        }),
      );

      expect(response.status).toBe(403);
    });

    it('400s for an unknown resolution', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db);

      const response = await PATCH(createContext(db, { method: 'PATCH', body: { resolution: 'fixed_it_by_hand' } }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Validation failed',
        details: [{ field: 'resolution', message: 'Choose a resolution.' }],
      });
    });

    it('400s for a source mismatch with no public note', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db);

      const response = await PATCH(
        createContext(db, { method: 'PATCH', body: { resolution: 'source_mismatch_noted' } }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Validation failed',
        details: [{ field: 'notes', message: 'A source mismatch needs a public note of at least 10 characters.' }],
      });
    });

    it('400s for notes over the length cap', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db);

      const response = await PATCH(
        createContext(db, {
          method: 'PATCH',
          body: { resolution: 'repulled_unchanged', notes: 'x'.repeat(1001) },
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'Validation failed',
        details: [{ field: 'notes', message: 'Keep notes under 1000 characters.' }],
      });
    });

    it('409s when no re-pull has been run for the correction', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db);

      const response = await PATCH(createContext(db, { method: 'PATCH', body: { resolution: 'repulled_unchanged' } }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Re-pull from the source before resolving' });
      expect(sendOutcomeEmail).not.toHaveBeenCalled();
    });

    it('resolves after a re-pull: stores the outcome, audits it, and emails the filer', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db, { parcel_id: '2102098000' });
      await insertCorrection(db);
      vi.stubGlobal('fetch', bostonFixtures());

      expect((await REPULL(createContext(db))).status).toBe(200);

      const notes = 'The city assessment still lists the prior owner; we noted the mismatch on the page.';
      const response = await PATCH(
        createContext(db, { method: 'PATCH', body: { resolution: 'source_mismatch_noted', notes } }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        data: { id: CORRECTION_ID, status: 'resolved', resolution: 'source_mismatch_noted' },
      });

      const row = await db
        .prepare(
          'SELECT status, resolution, resolution_notes, resolved_by, resolved_at FROM record_corrections WHERE id = ?',
        )
        .bind(CORRECTION_ID)
        .first<{
          status: string;
          resolution: string;
          resolution_notes: string;
          resolved_by: string;
          resolved_at: number;
        }>();

      expect(row).toMatchObject({
        status: 'resolved',
        resolution: 'source_mismatch_noted',
        resolution_notes: notes,
        resolved_by: ADMIN_ID,
      });
      expect(row?.resolved_at).toBeGreaterThan(0);

      const audit = await db
        .prepare(
          'SELECT action_type, entity_type, entity_id, admin_user_id, old_value, new_value, notes FROM audit_logs WHERE action_type = ?',
        )
        .bind('record_correction_resolved')
        .all<{
          action_type: string;
          entity_type: string;
          entity_id: string;
          admin_user_id: string;
          old_value: string | null;
          new_value: string | null;
          notes: string | null;
        }>();

      expect(audit.results).toHaveLength(1);
      expect(audit.results[0]).toMatchObject({
        entity_type: 'building',
        entity_id: BUILDING_ID,
        admin_user_id: ADMIN_ID,
      });
      expect(JSON.parse(audit.results[0].old_value ?? 'null')).toEqual({ status: 'pending' });
      const newValue = JSON.parse(audit.results[0].new_value ?? 'null') as {
        resolution: string;
        repullRetrievedAt: number | null;
        sourceStatuses: { ok: number; empty: number; error: number };
      };
      expect(newValue).toMatchObject({ status: 'resolved', resolution: 'source_mismatch_noted' });
      // The whole re-pull group is the evidence, not one row of it.
      expect(newValue.repullRetrievedAt).toBeGreaterThan(0);
      expect(newValue.sourceStatuses.error).toBe(0);
      expect(newValue.sourceStatuses.ok + newValue.sourceStatuses.empty).toBe(BOSTON_SOURCE_COUNT);
      expect(audit.results[0].notes ?? '').toContain(CORRECTION_ID);

      expect(sendOutcomeEmail).toHaveBeenCalledTimes(1);
      expect(sendOutcomeEmail).toHaveBeenCalledWith(
        'test-key',
        'filer@example.com',
        BUILDING_ADDRESS,
        `https://ratemyplace.org/building/${BUILDING_ID}#public-records`,
        'source_mismatch_noted',
      );

      const second = await PATCH(
        createContext(db, { method: 'PATCH', body: { resolution: 'source_mismatch_noted', notes } }),
      );
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ error: 'Correction has already been resolved' });
    });

    it('does not email when the filer left no contact address', async () => {
      const db = await createDbWithAdmin();
      // A parcel id, so the pull resolves and every source lands 'empty' rather than
      // 'error' — an all-error group no longer satisfies the resolve gate.
      await insertBuilding(db, { parcel_id: '2102098000' });
      await insertCorrection(db, { contactEmail: null });
      vi.stubGlobal('fetch', fixtureFetch([]));

      expect((await REPULL(createContext(db))).status).toBe(200);

      const response = await PATCH(createContext(db, { method: 'PATCH', body: { resolution: 'repulled_unchanged' } }));

      expect(response.status).toBe(200);
      expect(sendOutcomeEmail).not.toHaveBeenCalled();

      const row = await db
        .prepare('SELECT resolution_notes FROM record_corrections WHERE id = ?')
        .bind(CORRECTION_ID)
        .first<{ resolution_notes: string | null }>();
      expect(row?.resolution_notes).toBeNull();
    });

    it('409s when every source in the re-pull failed', async () => {
      const db = await createDbWithAdmin();
      // No parcel id and no assessor fixture: the parcel never resolves, so every
      // source gets an error row. Pull rows exist, but nothing was read from the city.
      await insertBuilding(db);
      await insertCorrection(db);
      vi.stubGlobal('fetch', fixtureFetch([]));

      expect((await REPULL(createContext(db))).status).toBe(200);

      const statuses = await db
        .prepare('SELECT status FROM record_pulls WHERE correction_id = ?')
        .bind(CORRECTION_ID)
        .all<{ status: string }>();
      expect(statuses.results).toHaveLength(BOSTON_SOURCE_COUNT);
      expect(statuses.results.every((row) => row.status === 'error')).toBe(true);

      const response = await PATCH(createContext(db, { method: 'PATCH', body: { resolution: 'repulled_unchanged' } }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: 'The last re-pull failed for every source; run it again before resolving',
      });
      expect(sendOutcomeEmail).not.toHaveBeenCalled();

      const row = await db
        .prepare('SELECT status FROM record_corrections WHERE id = ?')
        .bind(CORRECTION_ID)
        .first<{ status: string }>();
      expect(row?.status).toBe('pending');
    });

    it('ignores a successful pull stamped with a different correction id', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db);
      await insertCorrection(db);
      await insertCorrection(db, { id: 'corr-other', contactEmail: null });
      // A successful pull for the *other* report on the same building. The gate is
      // per correction, so this one must not count as evidence for corr-1.
      await db
        .prepare(
          'INSERT INTO record_pulls (id, building_id, jurisdiction, source_id, source_label, query, status, row_count, correction_id) ' +
            "VALUES (?, ?, 'boston', 'boston.permits', 'Building permits', 'q', 'ok', 2, ?)",
        )
        .bind('pull-other', BUILDING_ID, 'corr-other')
        .run();

      const response = await PATCH(createContext(db, { method: 'PATCH', body: { resolution: 'repulled_unchanged' } }));

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'Re-pull from the source before resolving' });
      expect(sendOutcomeEmail).not.toHaveBeenCalled();
    });

    it('resolves once when two admins resolve the same correction at the same time', async () => {
      const db = await createDbWithAdmin();
      await insertBuilding(db, { parcel_id: '2102098000' });
      await insertCorrection(db);
      vi.stubGlobal('fetch', bostonFixtures());

      expect((await REPULL(createContext(db))).status).toBe(200);

      // Both requests are in flight before either writes: they interleave at their
      // awaits, so both clear the read-then-409 fast path and the conditional UPDATE
      // is the only thing standing between them and two resolutions of one report.
      const [first, second] = await Promise.all([
        PATCH(createContext(db, { method: 'PATCH', body: { resolution: 'repulled_unchanged' } })),
        PATCH(createContext(db, { method: 'PATCH', body: { resolution: 'repulled_updated' } })),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const loser = first.status === 409 ? first : second;
      expect(await loser.json()).toEqual({ error: 'Correction has already been resolved' });

      const audit = await db
        .prepare('SELECT id FROM audit_logs WHERE action_type = ?')
        .bind('record_correction_resolved')
        .all<{ id: number }>();
      expect(audit.results).toHaveLength(1);

      // One outcome stored, and the filer hears about it exactly once.
      const row = await db
        .prepare('SELECT status, resolution FROM record_corrections WHERE id = ?')
        .bind(CORRECTION_ID)
        .first<{ status: string; resolution: string }>();
      expect(row?.status).toBe('resolved');
      expect(sendOutcomeEmail).toHaveBeenCalledTimes(1);
    });
  });
});
