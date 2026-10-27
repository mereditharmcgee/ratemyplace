import type { APIContext } from 'astro';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeD1 } from './helpers/fakeD1';
import type { FakeCall } from './helpers/fakeD1';

vi.mock('../storage', () => ({
  uploadVerificationImage: vi.fn(async () => ({
    success: true,
    key: 'k',
    filename: 'lease.pdf',
    contentType: 'application/pdf',
    sizeBytes: 3,
  })),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

import { queueOwnerNotice } from '../ownerNotify';
import { uploadVerificationImage } from '../storage';
import { POST } from '../../pages/api/verification/upload';

const queued = vi.mocked(queueOwnerNotice);
const upload = vi.mocked(uploadVerificationImage);

beforeEach(() => {
  queued.mockClear();
  upload.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

interface ReviewState {
  owner?: string;
  verified?: number;
  pending?: boolean;
}

function uploadDb(state: ReviewState = {}) {
  const { owner = 'u1', verified = 0, pending = false } = state;
  return fakeD1((call: FakeCall) => {
    if (call.sql.includes('FROM reviews WHERE id')) return { user_id: owner, is_verified: verified, building_id: 'b1' };
    if (call.sql.includes('FROM verification_images') && call.method === 'first') return pending ? { id: 'v0' } : null;
    return undefined;
  });
}

function context(db: unknown): APIContext {
  const form = new FormData();
  form.set('review_id', 'r1');
  form.set('file', new File(['abc'], 'lease.pdf', { type: 'application/pdf' }));
  const request = new Request('https://ratemyplace.org/api/verification/upload', { method: 'POST', body: form });
  return {
    request,
    locals: { user: { id: 'u1' }, runtime: { env: { DB: db, VERIFICATION_BUCKET: {} } } },
  } as unknown as APIContext;
}

describe('POST /api/verification/upload owner notice', () => {
  it('queues exactly a verification_upload notice for the review building after the insert', async () => {
    const { db, calls } = uploadDb();
    const response = await POST(context(db));

    expect(response.status).toBe(200);
    expect(calls.some((call) => call.sql.includes('INSERT INTO verification_images'))).toBe(true);
    expect(queued).toHaveBeenCalledOnce();
    expect(queued.mock.calls[0][1]).toEqual({ kind: 'verification_upload', buildingId: 'b1' });
  });

  it('does not queue for an already verified review', async () => {
    const response = await POST(context(uploadDb({ verified: 1 }).db));
    expect(response.status).toBe(400);
    expect(queued).not.toHaveBeenCalled();
  });

  it("does not queue for someone else's review", async () => {
    const response = await POST(context(uploadDb({ owner: 'someone-else' }).db));
    expect(response.status).toBe(403);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue when an upload is already pending', async () => {
    const response = await POST(context(uploadDb({ pending: true }).db));
    expect(response.status).toBe(400);
    expect(queued).not.toHaveBeenCalled();
  });

  it('does not queue when the upload fails', async () => {
    upload.mockResolvedValueOnce({ success: false, error: 'Invalid file type. Allowed: JPG, PNG, HEIC, PDF' });
    const response = await POST(context(uploadDb().db));
    expect(response.status).toBe(400);
    expect(queued).not.toHaveBeenCalled();
  });
});
