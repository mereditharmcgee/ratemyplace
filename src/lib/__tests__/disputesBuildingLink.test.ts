import type { APIContext } from 'astro';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteAvailable } from './helpers/sqliteD1';
import type { TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { flushBackground } from './helpers/flush';

/**
 * Reviews have no public link of their own, so the dispute form also takes a building page
 * link. The route picks the review from it: the only approved review on the page, or the one
 * whose card shows the dates the landlord gave. It never guesses between two.
 */

vi.mock('../turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) =>
    token === 'good' ? { success: true } : { success: false, error: 'Bot verification failed. Please try again.' },
  ),
}));

vi.mock('../ownerNotify', () => ({ queueOwnerNotice: vi.fn() }));

vi.mock('../email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../email')>()),
  sendDisputeConfirmationEmail: vi.fn(async () => ({ success: true })),
}));

import { DISPUTE_REASONS } from '../disputes';
import { DISPUTE_TARGET_ERRORS } from '../disputeTarget';
import { POST } from '../../pages/api/disputes';

const SLUG = '12-example-rd-boston';
const BUILDING_ID = 'bldg-example';
const PAGE = `https://ratemyplace.org/building/${SLUG}`;

type ReviewSeed = {
  id: string;
  status?: 'approved' | 'pending' | 'rejected';
  move_in_season: string;
  move_in_year: number;
  move_out_year_new: string;
  is_current_tenant?: number;
};

async function disputesDb(reviews: ReviewSeed[]): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(readFileSync(join(process.cwd(), 'migrations', '0012_disputes.sql'), 'utf8'));
  // The shared stub carries only the review columns other tests need; the card's dates need these.
  db.exec(`
    ALTER TABLE reviews ADD COLUMN move_in_season TEXT;
    ALTER TABLE reviews ADD COLUMN move_in_year INTEGER;
    ALTER TABLE reviews ADD COLUMN is_current_tenant INTEGER DEFAULT 0;
  `);
  await db.prepare("INSERT INTO users (id, email) VALUES ('tenant-1', 'tenant@example.com')").run();
  await insertBuilding(db, { id: BUILDING_ID, slug: SLUG, address: '12 Example Rd, Boston, MA 02135' });
  for (const r of reviews) {
    await db
      .prepare(
        'INSERT INTO reviews (id, user_id, building_id, status, move_in_season, move_in_year, move_out_year_new, is_current_tenant) ' +
          "VALUES (?, 'tenant-1', ?, ?, ?, ?, ?, ?)",
      )
      .bind(r.id, BUILDING_ID, r.status ?? 'approved', r.move_in_season, r.move_in_year, r.move_out_year_new, r.is_current_tenant ?? 0)
      .run();
  }
  return db;
}

const base = {
  landlordName: 'Example Holdings LLC',
  landlordEmail: 'owner@example.com',
  landlordPhone: '617-555-0100',
  disputeReasons: [DISPUTE_REASONS[0]],
  disputeExplanation: 'Not a tenant.',
  turnstileToken: 'good',
};

function context(db: TestD1Database, payload: unknown): APIContext {
  const request = new Request('https://ratemyplace.org/api/disputes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.31' },
    body: JSON.stringify(payload),
  });
  return {
    request,
    locals: { user: null, runtime: { env: { DB: db, TURNSTILE_SECRET_KEY: 'secret', RESEND_API_KEY: 'k' } } },
  } as unknown as APIContext;
}

async function disputedReviewIds(db: TestD1Database): Promise<string[]> {
  const rows = await db.prepare('SELECT review_id FROM disputes ORDER BY review_id').all<{ review_id: string }>();
  return (rows.results ?? []).map((r) => r.review_id);
}

const pastTenant: ReviewSeed = { id: 'rev-past', move_in_season: 'summer', move_in_year: 2019, move_out_year_new: '2021' };
const currentTenant: ReviewSeed = { id: 'rev-now', move_in_season: 'fall', move_in_year: 2023, move_out_year_new: 'current', is_current_tenant: 1 };

describe.skipIf(!sqliteAvailable)('POST /api/disputes with a building page link', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('takes the only approved review on the page when no dates are given', async () => {
    const db = await disputesDb([pastTenant, { ...currentTenant, status: 'pending' }]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-past']);
    await flushBackground();
  });

  it('picks the review whose card shows the given dates, however they are typed', async () => {
    const db = await disputesDb([pastTenant, currentTenant]);
    const response = await POST(context(db, { ...base, reviewUrl: `${PAGE}?x=1`, reviewDates: 'FALL 2023 - current' }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-now']);
    await flushBackground();
  });

  it('asks for the dates when the page has more than one review', async () => {
    const db = await disputesDb([pastTenant, currentTenant]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: '   ' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.needDates);
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  it('says so when no review shows those dates', async () => {
    const db = await disputesDb([pastTenant, currentTenant]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: 'Spring 2010 · 2012' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.noMatch);
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  it('checks the dates even when the page has one review', async () => {
    const db = await disputesDb([pastTenant]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.noMatch);
  });

  it('never guesses between two reviews that show the same dates', async () => {
    const db = await disputesDb([currentTenant, { ...currentTenant, id: 'rev-now-2' }]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.manyMatch);
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  it('ignores reviews that are not on the page', async () => {
    const db = await disputesDb([{ ...pastTenant, status: 'rejected' }, { ...currentTenant, status: 'pending' }]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.noReviews);
  });

  it('404s an unknown building page', async () => {
    const db = await disputesDb([pastTenant]);
    const response = await POST(context(db, { ...base, reviewUrl: 'https://ratemyplace.org/building/99-nowhere-st-boston' }));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.buildingNotFound);
  });

  it('rejects a link that is not a building or review link', async () => {
    const db = await disputesDb([pastTenant]);
    for (const reviewUrl of [`https://evil.example/building/${SLUG}`, 'https://ratemyplace.org/search?q=example']) {
      const response = await POST(context(db, { ...base, reviewUrl }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.badLink);
    }
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  it('still takes a review link by id, and ignores dates beside it', async () => {
    const db = await disputesDb([pastTenant, currentTenant]);
    const response = await POST(context(db, { ...base, reviewUrl: `${PAGE}#review-rev-past`, reviewDates: 'Fall 2023 · Current' }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-past']);
    await flushBackground();
  });

  it('keeps Turnstile ahead of the link lookup', async () => {
    const db = await disputesDb([pastTenant]);
    const response = await POST(context(db, { ...base, reviewUrl: 'not a link', turnstileToken: 'bad' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Bot verification failed. Please try again.');
  });
});
