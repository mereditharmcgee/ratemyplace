import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminContext } from './helpers/adminDb';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { FLAGGED_TEXT_FIELDS, VELOCITY_WINDOW_SECONDS, type ReviewFlagCode } from '../reviewFlags';
import { GET } from '../../pages/api/admin/reviews/index';

/**
 * GET /api/admin/reviews adds `integrity_flags` to every row: codes computed when the list is
 * read, advisory only. Rows come back newest first, so every assertion goes by id.
 */

const suite = sqliteAvailable ? describe : describe.skip;
const URL_ = 'https://ratemyplace.org/api/admin/reviews';
const T = 1_700_000_000;
const S = 1_710_000_000;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Row {
  id: string;
  integrity_flags: ReviewFlagCode[];
  [key: string]: unknown;
}

interface ListBody {
  reviews: Row[];
  total: number;
  offset: number;
  limit: number;
  statusCounts: Record<string, number>;
}

async function fresh(): Promise<TestD1Database> {
  const db = schemaDb();
  for (let n = 0; n <= 6; n += 1) {
    await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(`v${n}`, `reviewer${n}@example.com`).run();
  }
  for (const [id, number] of [['ba', 12], ['bb', 14], ['bc', 16], ['bd', 18]] as const) {
    await db
      .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES (?, ?, ?, 'Boston', 'MA')")
      .bind(id, `${number} Example Rd`, `${number}-example-rd-boston`)
      .run();
  }
  return db;
}

async function review(
  db: TestD1Database,
  id: string,
  userId: string,
  buildingId: string,
  createdAt: number,
  extra: { comments?: string; property_manager_name?: string; review_title?: string; status?: string } = {},
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, overall_score, status,
         comments, property_manager_name, review_title, created_at)
       VALUES (?, ?, ?, 2022, 'fall', '1br', 4, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      userId,
      buildingId,
      extra.status ?? 'pending',
      extra.comments ?? null,
      extra.property_manager_name ?? null,
      extra.review_title ?? null,
      createdAt,
    )
    .run();
}

async function list(db: TestD1Database, get: typeof GET = GET): Promise<ListBody> {
  const response = await get(adminContext(db, `${URL_}?limit=500`));
  expect(response.status).toBe(200);
  return (await response.json()) as ListBody;
}

function flagsById(body: ListBody): Record<string, ReviewFlagCode[]> {
  return Object.fromEntries(body.reviews.map((row) => [row.id, row.integrity_flags]));
}

/** Six reviews of building ba by v0 to v5, one second apart from T. */
async function burst(db: TestD1Database): Promise<void> {
  for (let n = 0; n <= 5; n += 1) await review(db, `burst-${n}`, `v${n}`, 'ba', T + n);
}

suite('admin reviews list: building burst', () => {
  it('flags the fifth and later reviews of a building inside the window', async () => {
    const db = await fresh();
    await burst(db);
    const flags = flagsById(await list(db));
    for (const id of ['burst-0', 'burst-1', 'burst-2', 'burst-3']) expect(flags[id]).toEqual([]);
    for (const id of ['burst-4', 'burst-5']) expect(flags[id]).toEqual(['building_velocity']);
  });

  it('holds the window edge from both sides', async () => {
    // 86,401 s after the sixth: only itself is inside its window.
    const afterLast = await fresh();
    await burst(afterLast);
    await review(afterLast, 'late', 'v6', 'ba', T + 5 + VELOCITY_WINDOW_SECONDS + 1);
    const a = flagsById(await list(afterLast));
    expect(a.late).toEqual([]);

    // 86,401 s after the first: burst-2 to burst-5 are still inside, so it is the fifth.
    const afterFirst = await fresh();
    await burst(afterFirst);
    await review(afterFirst, 'late', 'v6', 'ba', T + VELOCITY_WINDOW_SECONDS + 1);
    const b = flagsById(await list(afterFirst));
    expect(b.late).toEqual(['building_velocity']);

    for (const flags of [a, b]) {
      for (const id of ['burst-0', 'burst-1', 'burst-2', 'burst-3']) expect(flags[id]).toEqual([]);
      for (const id of ['burst-4', 'burst-5']) expect(flags[id]).toEqual(['building_velocity']);
    }
  });

  it('breaks a tie at the same second by id', async () => {
    const db = await fresh();
    await review(db, 'tie-1', 'v0', 'bb', S);
    await review(db, 'tie-2', 'v1', 'bb', S + 1);
    await review(db, 'tie-3', 'v2', 'bb', S + 2);
    await review(db, 'tie-a', 'v3', 'bb', S + 3);
    await review(db, 'tie-b', 'v4', 'bb', S + 3);
    const flags = flagsById(await list(db));
    for (const id of ['tie-1', 'tie-2', 'tie-3', 'tie-a']) expect(flags[id]).toEqual([]);
    expect(flags['tie-b']).toEqual(['building_velocity']);
  });
});

suite('admin reviews list: repeat reviewer and text', () => {
  it('flags both reviews of a legacy pair and not another account on the building', async () => {
    const db = await fresh();
    await review(db, 'pair-a', 'v0', 'bc', T, { status: 'approved' });
    await review(db, 'pair-b', 'v0', 'bc', T + 400 * 86_400, { status: 'approved' });
    await review(db, 'other', 'v1', 'bc', T + 500 * 86_400);
    const flags = flagsById(await list(db));
    expect(flags['pair-a']).toEqual(['repeat_reviewer']);
    expect(flags['pair-b']).toEqual(['repeat_reviewer']);
    expect(flags.other).toEqual([]);
  });

  it('scans the comments and the property manager name', async () => {
    const db = await fresh();
    await review(db, 'contact', 'v0', 'bd', T, { comments: 'write to someone@example.com', property_manager_name: '617-555-0123' });
    expect(flagsById(await list(db)).contact).toEqual(['possible_email', 'possible_phone']);
  });
});

suite('admin reviews list: payload', () => {
  it('adds integrity_flags and keeps the order, totals and counts', async () => {
    const db = await fresh();
    await review(db, 'old', 'v0', 'ba', T, { status: 'approved' });
    await review(db, 'mid', 'v1', 'ba', T + 10, { status: 'rejected' });
    await review(db, 'new', 'v2', 'bb', T + 20);
    const body = await list(db);
    expect(body.reviews.map((row) => row.id)).toEqual(['new', 'mid', 'old']);
    for (const row of body.reviews) {
      expect(Array.isArray(row.integrity_flags)).toBe(true);
      expect(row).not.toHaveProperty('building_ordinal');
      expect(row).not.toHaveProperty('other_reviews_here');
    }
    expect(body.total).toBe(3);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(500);
    expect(body.statusCounts).toEqual({ all: 3, pending: 1, approved: 1, rejected: 1, flagged: 0 });
  });

  it('still refuses a non-admin', async () => {
    const db = await fresh();
    const response = await GET(adminContext(db, URL_, { isAdmin: false }));
    expect(response.status).toBe(403);
  });
});

suite('admin reviews list: one bad row', () => {
  afterEach(() => {
    vi.doUnmock('../reviewFlags');
    vi.resetModules();
  });

  it('answers the list with an empty signal list for that row and logs no text', async () => {
    const SENTINEL = 'SENTINEL-TITLE-THAT-THROWS';
    vi.resetModules();
    vi.doMock('../reviewFlags', async () => {
      const actual = await vi.importActual<typeof import('../reviewFlags')>('../reviewFlags');
      return {
        ...actual,
        reviewFlags: (input: Parameters<typeof actual.reviewFlags>[0]) => {
          if (input.text.review_title === SENTINEL) throw new TypeError('scan failed');
          return actual.reviewFlags(input);
        },
      };
    });
    const { GET: isolatedGet } = await import('../../pages/api/admin/reviews/index');

    const db = await fresh();
    await review(db, 'bad', 'v0', 'ba', T, { review_title: SENTINEL, comments: 'call 617-555-0123' });
    await review(db, 'good', 'v1', 'bb', T + 10, { comments: 'write to someone@example.com' });
    const body = await list(db, isolatedGet);
    const flags = flagsById(body);
    expect(flags.bad).toEqual([]);
    expect(flags.good).toEqual(['possible_email']);

    const logged = consoleError.mock.calls
      .map((args: unknown[]) => (typeof args[0] === 'string' ? args[0] : ''))
      .filter((line: string) => line.includes('review_flags_failed'));
    expect(logged).toHaveLength(1);
    const payload = JSON.parse(logged[0]) as Record<string, unknown>;
    expect(payload).toMatchObject({ event: 'review_flags_failed', review_id: 'bad', error_name: 'TypeError' });
    for (const value of [SENTINEL, 'call 617-555-0123']) expect(logged[0]).not.toContain(value);
    for (const field of FLAGGED_TEXT_FIELDS) expect(payload).not.toHaveProperty(field);
  });
});
