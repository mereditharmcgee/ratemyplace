import type { APIContext } from 'astro';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReviewListItem from '../../components/profile/ReviewListItem';
import { GET } from '../../pages/api/reviews/user';
import type { UserReview } from '../api-types';
import { VERIFICATION_COPY, verificationPrompt } from '../verificationNotice';
import { schemaDb } from './helpers/migratedDb';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';

// Where the profile used to show "Verify your tenancy" for every unverified review, it now
// says where the person's last document stands: waiting for review, or not accepted and why,
// with a way to send a different one. Every name and place here is fictional.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('verificationPrompt', () => {
  const base = { is_verified: false, verification_status: null, verification_rejection_reason: null } as const;

  it('shows nothing for a verified review', () => {
    expect(verificationPrompt({ ...base, is_verified: true })).toEqual({ kind: 'none' });
    expect(verificationPrompt({ ...base, is_verified: true, verification_status: 'rejected' })).toEqual({ kind: 'none' });
  });

  it('asks for a document when none was sent, or the last one was approved but the badge is off', () => {
    expect(verificationPrompt(base)).toEqual({ kind: 'verify' });
    expect(verificationPrompt({ ...base, verification_status: 'approved' })).toEqual({ kind: 'verify' });
  });

  it('says a document is waiting while one is pending', () => {
    expect(verificationPrompt({ ...base, verification_status: 'pending' })).toEqual({ kind: 'pending' });
  });

  it('gives the reason for a rejection, or none when it is blank', () => {
    expect(verificationPrompt({ ...base, verification_status: 'rejected', verification_rejection_reason: ' Too blurry to read. ' })).toEqual({
      kind: 'rejected',
      reason: 'Too blurry to read.',
    });
    expect(verificationPrompt({ ...base, verification_status: 'rejected', verification_rejection_reason: '  ' })).toEqual({
      kind: 'rejected',
      reason: null,
    });
  });
});

function review(overrides: Partial<UserReview> = {}): UserReview {
  return {
    id: 'rev-1',
    building_id: 'bldg-a',
    building_address: 'Sample Building',
    building_slug: 'sample-building',
    neighborhood: null,
    city: 'Boston',
    overall_score: 3.5,
    status: 'approved',
    is_verified: false,
    created_at: 1767225600,
    updated_at: null,
    review_title: null,
    moderation_notes: null,
    has_open_dispute: false,
    verification_status: null,
    verification_rejection_reason: null,
    ...overrides,
  };
}

describe('ReviewListItem verification line', () => {
  it('keeps the original prompt and Verify button when no document was sent', () => {
    const onVerify = vi.fn();
    render(<ReviewListItem review={review()} onVerifyClick={onVerify} />);
    expect(screen.getByText(VERIFICATION_COPY.prompt)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: VERIFICATION_COPY.verifyButton }));
    expect(onVerify).toHaveBeenCalledWith('rev-1', expect.any(HTMLElement));
  });

  it('says only that the document is waiting while it is pending', () => {
    render(<ReviewListItem review={review({ verification_status: 'pending' })} onVerifyClick={vi.fn()} />);
    expect(screen.getByText(VERIFICATION_COPY.pending)).toBeTruthy();
    expect(screen.queryByText(VERIFICATION_COPY.prompt)).toBeNull();
    expect(screen.queryByRole('button', { name: VERIFICATION_COPY.verifyButton })).toBeNull();
    expect(screen.queryByRole('button', { name: VERIFICATION_COPY.tryAgainButton })).toBeNull();
  });

  it('shows a rejection, its reason and a way to send a different document', () => {
    const onVerify = vi.fn();
    render(
      <ReviewListItem
        review={review({ verification_status: 'rejected', verification_rejection_reason: 'The document has no <address> on it.' })}
        onVerifyClick={onVerify}
      />,
    );
    expect(screen.getByText(VERIFICATION_COPY.rejected)).toBeTruthy();
    expect(screen.getByText(VERIFICATION_COPY.reasonLabel)).toBeTruthy();
    // Rendered as text, never as markup.
    expect(screen.getByText('The document has no <address> on it.', { exact: false })).toBeTruthy();
    expect(screen.getByText(VERIFICATION_COPY.tryAgain)).toBeTruthy();
    expect(screen.queryByText(VERIFICATION_COPY.prompt)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: VERIFICATION_COPY.tryAgainButton }));
    expect(onVerify).toHaveBeenCalledWith('rev-1', expect.any(HTMLElement));
  });

  it('leaves the reason line out when the moderator gave none', () => {
    render(<ReviewListItem review={review({ verification_status: 'rejected' })} onVerifyClick={vi.fn()} />);
    expect(screen.getByText(VERIFICATION_COPY.rejected)).toBeTruthy();
    expect(screen.queryByText(VERIFICATION_COPY.reasonLabel)).toBeNull();
  });

  it('shows no verification line on a verified review', () => {
    render(<ReviewListItem review={review({ is_verified: true, verification_status: 'approved' })} onVerifyClick={vi.fn()} />);
    expect(screen.queryByText(VERIFICATION_COPY.prompt)).toBeNull();
    expect(screen.queryByText(VERIFICATION_COPY.pending)).toBeNull();
    expect(screen.queryByText(VERIFICATION_COPY.rejected)).toBeNull();
  });
});

const suite = sqliteAvailable ? describe : describe.skip;

suite('GET /api/reviews/user reports the latest document', () => {
  async function seeded(): Promise<TestD1Database> {
    const db = schemaDb();
    for (const id of ['author-1', 'author-2']) {
      await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, `${id}@example.test`).run();
    }
    await db
      .prepare("INSERT INTO buildings (id, address, slug, city, state) VALUES ('bldg-a', 'Sample Building', 'sample-building', 'Boston', 'MA')")
      .run();
    const reviews: Array<[string, string, number]> = [
      ['rev-none', 'author-1', 1767225600],
      ['rev-pending', 'author-1', 1767225700],
      ['rev-rejected', 'author-1', 1767225800],
      ['rev-other', 'author-2', 1767225900],
    ];
    for (const [id, user, createdAt] of reviews) {
      await db
        .prepare(
          "INSERT INTO reviews (id, user_id, building_id, move_in_year, move_in_season, unit_type, status, created_at) VALUES (?, ?, 'bldg-a', 2022, 'fall', '1br', 'approved', ?)",
        )
        .bind(id, user, createdAt)
        .run();
    }
    const docs: Array<[string, string, string, string, string | null, number]> = [
      // An earlier rejection, then a new document now waiting: the reason is history.
      ['ver-1', 'rev-pending', 'author-1', 'rejected', 'Too blurry to read.', 1767226000],
      ['ver-2', 'rev-pending', 'author-1', 'pending', null, 1767226100],
      // Two rejections in the same second: the later row wins.
      ['ver-3', 'rev-rejected', 'author-1', 'rejected', 'First reason.', 1767226200],
      ['ver-4', 'rev-rejected', 'author-1', 'rejected', 'Second reason.', 1767226200],
      ['ver-5', 'rev-other', 'author-2', 'rejected', 'Someone else.', 1767226300],
    ];
    for (const [id, reviewId, user, status, reason, uploadedAt] of docs) {
      await db
        .prepare(
          "INSERT INTO verification_images (id, review_id, user_id, r2_key, filename, content_type, size_bytes, status, rejection_reason, uploaded_at) VALUES (?, ?, ?, 'key', '', 'application/pdf', 1, ?, ?, ?)",
        )
        .bind(id, reviewId, user, status, reason, uploadedAt)
        .run();
    }
    return db;
  }

  it('returns each review\'s latest status, and a reason only for a rejection', async () => {
    const db = await seeded();
    const res = await GET({
      request: new Request('https://ratemyplace.org/api/reviews/user'),
      locals: { user: { id: 'author-1' }, runtime: { env: { DB: db } } },
    } as unknown as APIContext);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reviews: UserReview[] };
    const byId = Object.fromEntries(
      body.reviews.map((r) => [r.id, { status: r.verification_status, reason: r.verification_rejection_reason }]),
    );
    expect(byId).toEqual({
      'rev-none': { status: null, reason: null },
      'rev-pending': { status: 'pending', reason: null },
      'rev-rejected': { status: 'rejected', reason: 'Second reason.' },
    });
  });
});
