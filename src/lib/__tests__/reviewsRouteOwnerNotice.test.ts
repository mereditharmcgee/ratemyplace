import type { APIContext } from 'astro';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeD1 } from './helpers/fakeD1';
import type { FakeCall } from './helpers/fakeD1';

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) =>
    token === 'good' ? { success: true } : { success: false, error: 'Bot verification failed. Please try again.' },
  ),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

import { queueOwnerNotice } from '../ownerNotify';
import { POST } from '../../pages/api/reviews';
import { PATCH } from '../../pages/api/reviews/[id]';

const queued = vi.mocked(queueOwnerNotice);

beforeEach(() => {
  queued.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function context(db: unknown, request: Request, user: { id: string } | null, params: Record<string, string> = {}): APIContext {
  return {
    request,
    params,
    locals: { user, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret' } } },
  } as unknown as APIContext;
}

function reviewForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields = { building_id: 'b1', unit_structural: '4', 'cf-turnstile-response': 'good', ...overrides };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

function postRequest(form: FormData): Request {
  return new Request('https://ratemyplace.org/api/reviews', { method: 'POST', body: form });
}

/** A database that knows building b1 and accepts every write, unless told otherwise. */
function postDb(options: { building?: boolean; insertFails?: boolean } = {}) {
  const { building = true, insertFails = false } = options;
  return fakeD1((call: FakeCall) => {
    if (call.sql.includes('SELECT id, slug FROM buildings')) return building ? { id: 'b1', slug: 'b1-slug' } : null;
    if (call.sql.includes('INSERT INTO reviews') && insertFails) throw new Error('D1_ERROR: insert failed');
    return undefined;
  });
}

describe('POST /api/reviews owner notice', () => {
  it('queues exactly a review_submitted notice for the building after the insert', async () => {
    const { db, calls } = postDb();
    const response = await POST(context(db, postRequest(reviewForm()), { id: 'u1' }));

    expect(response.status).toBe(200);
    expect(calls.some((call) => call.sql.includes('INSERT INTO reviews'))).toBe(true);
    expect(queued).toHaveBeenCalledOnce();
    expect(queued.mock.calls[0][1]).toEqual({ kind: 'review_submitted', buildingId: 'b1' });
  });

  it('does not queue for an unknown building', async () => {
    const { db } = postDb({ building: false });
    const response = await POST(context(db, postRequest(reviewForm()), { id: 'u1' }));
    expect(response.status).toBe(404);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue for an out-of-range score', async () => {
    const { db } = postDb();
    const response = await POST(context(db, postRequest(reviewForm({ unit_structural: '9' })), { id: 'u1' }));
    expect(response.status).toBe(400);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue when Turnstile fails', async () => {
    const { db } = postDb();
    const response = await POST(context(db, postRequest(reviewForm({ 'cf-turnstile-response': 'bad' })), { id: 'u1' }));
    expect(response.status).toBe(400);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue when the insert fails (the notice comes after the write)', async () => {
    const { db } = postDb({ insertFails: true });
    const response = await POST(context(db, postRequest(reviewForm()), { id: 'u1' }));
    expect(response.status).toBe(500);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue for a signed-out request', async () => {
    const { db } = postDb();
    const response = await POST(context(db, postRequest(reviewForm()), null));
    expect(response.status).toBe(401);
    expect(queued).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/reviews/[id] owner notice', () => {
  function patchRequest(): Request {
    return new Request('https://ratemyplace.org/api/reviews/r1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_structural: 4 }),
    });
  }

  function patchDb(status: string, options: { owner?: string; updateFails?: boolean } = {}) {
    const { owner = 'u1', updateFails = false } = options;
    return fakeD1((call: FakeCall) => {
      if (call.sql.startsWith('SELECT user_id, building_id, unit_type, status FROM reviews')) {
        return { user_id: owner, building_id: 'b1', unit_type: '1br', status };
      }
      if (call.sql.includes('UPDATE reviews SET') && updateFails) throw new Error('D1_ERROR: update failed');
      if (call.sql.includes('SELECT slug FROM buildings')) return { slug: 'b1-slug' };
      return undefined;
    });
  }

  it.each(['approved', 'rejected', 'flagged'])('queues review_edited when an %s review is edited back to pending', async (status) => {
    const { db } = patchDb(status);
    const response = await PATCH(context(db, patchRequest(), { id: 'u1' }, { id: 'r1' }));
    expect(response.status).toBe(200);
    expect(queued).toHaveBeenCalledOnce();
    expect(queued.mock.calls[0][1]).toEqual({ kind: 'review_edited', buildingId: 'b1' });
  });

  it('does not queue when the review was already pending', async () => {
    const { db } = patchDb('pending');
    const response = await PATCH(context(db, patchRequest(), { id: 'u1' }, { id: 'r1' }));
    expect(response.status).toBe(200);
    expect(queued).not.toHaveBeenCalled();
  });

  it("does not queue for someone else's review", async () => {
    const { db } = patchDb('approved', { owner: 'someone-else' });
    const response = await PATCH(context(db, patchRequest(), { id: 'u1' }, { id: 'r1' }));
    expect(response.status).toBe(403);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue when the update fails', async () => {
    const { db } = patchDb('approved', { updateFails: true });
    const response = await PATCH(context(db, patchRequest(), { id: 'u1' }, { id: 'r1' }));
    expect(response.status).toBe(500);
    expect(queued).not.toHaveBeenCalled();
  });
});
