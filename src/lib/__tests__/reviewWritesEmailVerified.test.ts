import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './helpers/fakeD1';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// The three review writes refuse an account without a verified email: 403 right after the
// 401, before the limiter, Turnstile, the ownership read or any other statement. A verified
// account passes exactly as before, and an account whose email changes is refused from its
// next request, because Lucia re-reads the user row on every validateSession.

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async () => ({ success: true })),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

vi.mock('../password', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../password')>()),
  verifyPassword: vi.fn(async () => true),
}));

import { verifyTurnstile } from '../turnstile';
import { initializeLucia } from '../auth';
import { EMAIL_VERIFICATION_REQUIRED } from '../emailVerification';
import { VERIFY_TO_POST_ERROR } from '../contributionCopy';
import { POST as reviewPOST } from '../../pages/api/reviews';
import { PATCH as reviewPATCH } from '../../pages/api/reviews/[id]';
import { POST as buildingPOST } from '../../pages/api/buildings';
import { PATCH as emailPATCH } from '../../pages/api/user/email';

type User = { id: string; email?: string; emailVerified?: unknown; isAdmin?: boolean } | null;

const UNVERIFIED = { id: 'u1', email: 'tenant@example.com', emailVerified: false, isAdmin: false };
const VERIFIED = { id: 'u1', email: 'tenant@example.com', emailVerified: true, isAdmin: false };

function ctx(db: unknown, request: Request, user: User, params: Record<string, string> = {}): APIContext {
  return {
    request,
    params,
    locals: { user, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

function formRequest(fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request('https://ratemyplace.org/api/reviews', { method: 'POST', body: form });
}

function jsonRequest(url: string, method: string, body: unknown, contentType = 'application/json'): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const REVIEW_FIELDS = {
  building_id: 'b-1',
  unit_structural: '4',
  bedrooms: '2',
  move_out_year: 'current',
  'cf-turnstile-response': 'good',
};

const BUILDING_BODY = { streetAddress: '12 Example Rd', city: 'Boston', state: 'MA', zipCode: '02101' };

async function expectGate(res: Response): Promise<void> {
  expect(res.status).toBe(403);
  expect(res.headers.get('Content-Type')).toBe('application/json');
  expect(await res.json()).toEqual({ error: VERIFY_TO_POST_ERROR, details: { reason: EMAIL_VERIFICATION_REQUIRED } });
}

beforeEach(() => {
  vi.mocked(verifyTurnstile).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('an unverified account is refused before anything runs', () => {
  it('POST /api/reviews: 403 before the limiter, Turnstile or any statement', async () => {
    const { db, calls } = fakeD1(() => undefined);
    const res = await reviewPOST(ctx(db, formRequest(REVIEW_FIELDS), UNVERIFIED));
    await expectGate(res);
    expect(calls).toHaveLength(0);
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it.each([['r-1'], ['does-not-exist']])(
    'PATCH /api/reviews/%s: 403 before the ownership read, whether or not the review exists',
    async (id) => {
      const { db, calls } = fakeD1((call) =>
        call.sql.includes('FROM reviews') && call.binds[0] === 'r-1' ? { user_id: 'u1', building_id: 'b-1' } : undefined,
      );
      const res = await reviewPATCH(
        ctx(db, jsonRequest(`https://ratemyplace.org/api/reviews/${id}`, 'PATCH', { review_text: 'x' }), UNVERIFIED, { id }),
      );
      await expectGate(res);
      expect(calls).toHaveLength(0);
    },
  );

  it('POST /api/buildings: 403 before the content-type guard and the limiter', async () => {
    const { db, calls } = fakeD1(() => undefined);
    const res = await buildingPOST(
      ctx(db, jsonRequest('https://ratemyplace.org/api/buildings', 'POST', 'x', 'text/plain'), UNVERIFIED),
    );
    await expectGate(res);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['a missing flag', { id: 'u1' }],
    ['a numeric flag', { id: 'u1', emailVerified: 1 }],
    ['a string flag', { id: 'u1', emailVerified: 'true' }],
  ])('%s is not verified', async (_label, user) => {
    const { db, calls } = fakeD1(() => undefined);
    await expectGate(await reviewPOST(ctx(db, formRequest(REVIEW_FIELDS), user)));
    expect(calls).toHaveLength(0);
  });
});

describe('signed out is still 401 first', () => {
  it.each([
    ['POST /api/reviews', () => reviewPOST],
    ['PATCH /api/reviews/[id]', () => reviewPATCH],
    ['POST /api/buildings', () => buildingPOST],
  ] as const)('%s', async (_label, route) => {
    const { db, calls } = fakeD1(() => undefined);
    const res = await route()(ctx(db, jsonRequest('https://ratemyplace.org/api/x', 'POST', {}), null, { id: 'r-1' }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

const suite = sqliteAvailable ? describe : describe.skip;

async function seed(db: TestD1Database, emailVerified: 0 | 1): Promise<void> {
  await db
    .prepare("INSERT INTO users (id, email, email_verified, hashed_password) VALUES ('u1', 'tenant@example.com', ?, 'h')")
    .bind(emailVerified)
    .run();
  await db
    .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES ('b-1', '12 Example Rd', '12-example-rd-boston', 'Boston', 'MA')")
    .run();
}

async function submitAs(db: TestD1Database, user: User): Promise<string> {
  const res = await reviewPOST(ctx(db, formRequest(REVIEW_FIELDS), user));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { reviewId: string };
  expect(typeof body.reviewId).toBe('string');
  return body.reviewId;
}

function patchAs(db: TestD1Database, user: User, reviewId: string, body: Record<string, unknown>): Promise<Response> {
  return reviewPATCH(
    ctx(
      db,
      jsonRequest(`https://ratemyplace.org/api/reviews/${reviewId}`, 'PATCH', {
        unit_structural: 4,
        move_out_year_new: 'current',
        ...body,
      }),
      user,
      { id: reviewId },
    ),
  );
}

async function changeEmail(db: TestD1Database, user: User, newEmail: string): Promise<void> {
  const res = await emailPATCH(
    ctx(db, jsonRequest('https://ratemyplace.org/api/user/email', 'PATCH', { currentPassword: 'pw', newEmail }), user),
  );
  expect(res.status).toBe(200);
}

async function reviewText(db: TestD1Database, id: string): Promise<string | null> {
  const row = await db.prepare('SELECT review_text FROM reviews WHERE id = ?').bind(id).first<{ review_text: string | null }>();
  if (!row) throw new Error(`no review ${id}`);
  return row.review_text;
}

suite('a verified account passes the gate (every migration)', () => {
  it('creates a review, edits it and creates a building as before', async () => {
    const db = schemaDb();
    await seed(db, 1);
    const reviewId = await submitAs(db, VERIFIED);
    expect(verifyTurnstile).toHaveBeenCalledTimes(1);

    const patched = await patchAs(db, VERIFIED, reviewId, { review_text: 'Quiet building.' });
    expect(patched.status).toBe(200);
    expect(await reviewText(db, reviewId)).toBe('Quiet building.');

    const created = await buildingPOST(
      ctx(db, jsonRequest('https://ratemyplace.org/api/buildings', 'POST', { ...BUILDING_BODY, streetAddress: '14 Example Rd' }), VERIFIED),
    );
    expect([200, 201]).toContain(created.status);
  });

  it('an unverified account writes no building and no review', async () => {
    const db = schemaDb();
    await seed(db, 0);
    await expectGate(await reviewPOST(ctx(db, formRequest(REVIEW_FIELDS), UNVERIFIED)));
    await expectGate(
      await buildingPOST(ctx(db, jsonRequest('https://ratemyplace.org/api/buildings', 'POST', BUILDING_BODY), UNVERIFIED)),
    );
    const counts = await db
      .prepare('SELECT (SELECT COUNT(*) FROM reviews) AS reviews, (SELECT COUNT(*) FROM buildings) AS buildings, (SELECT COUNT(*) FROM rate_limits) AS limits')
      .first<{ reviews: number; buildings: number; limits: number }>();
    expect(counts).toEqual({ reviews: 0, buildings: 1, limits: 0 });
  });
});

suite('an account that becomes unverified', () => {
  it('is refused on its next edit after changing its email, and the stored review is unchanged', async () => {
    const db = schemaDb();
    await seed(db, 1);
    const lucia = initializeLucia(db as unknown as D1Database);
    const session = await lucia.createSession('u1', {});

    let { user } = await lucia.validateSession(session.id);
    expect(user?.emailVerified).toBe(true);
    const reviewId = await submitAs(db, user);
    const patched = await patchAs(db, user, reviewId, { review_text: 'First words.' });
    expect(patched.status).toBe(200);

    await changeEmail(db, user, 'moved@example.com');

    ({ user } = await lucia.validateSession(session.id));
    expect(user?.email).toBe('moved@example.com');
    expect(user?.emailVerified).toBe(false);
    await expectGate(await patchAs(db, user, reviewId, { review_text: 'changed' }));
    expect(await reviewText(db, reviewId)).toBe('First words.');
  });
});
