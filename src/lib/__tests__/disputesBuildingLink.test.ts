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
 * whose card shows the dates the landlord gave. When two cards show the same dates, the
 * review's title or first words tell them apart. It never guesses between two.
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
  move_in_given?: 'season_and_year' | 'year_only' | 'none' | null;
  move_out_year_new: string;
  is_current_tenant?: number;
  review_title?: string | null;
  review_text?: string | null;
  comments?: string | null;
};

async function disputesDb(reviews: ReviewSeed[]): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  db.exec(readFileSync(join(process.cwd(), 'migrations', '0012_disputes.sql'), 'utf8'));
  // The shared stub carries only the review columns other tests need; the card's dates need these.
  db.exec(`
    ALTER TABLE reviews ADD COLUMN move_in_season TEXT;
    ALTER TABLE reviews ADD COLUMN move_in_year INTEGER;
    ALTER TABLE reviews ADD COLUMN is_current_tenant INTEGER DEFAULT 0;
    ALTER TABLE reviews ADD COLUMN review_title TEXT;
    ALTER TABLE reviews ADD COLUMN review_text TEXT;
    ALTER TABLE reviews ADD COLUMN comments TEXT;
  `);
  db.exec(readFileSync(join(process.cwd(), 'migrations', '0034_review_move_in_given.sql'), 'utf8'));
  await db.prepare("INSERT INTO users (id, email) VALUES ('tenant-1', 'tenant@example.com')").run();
  await insertBuilding(db, { id: BUILDING_ID, slug: SLUG, address: '12 Example Rd, Boston, MA 02135' });
  for (const r of reviews) {
    await db
      .prepare(
        'INSERT INTO reviews (id, user_id, building_id, status, move_in_season, move_in_year, move_in_given, move_out_year_new, is_current_tenant, review_title, review_text, comments) ' +
          "VALUES (?, 'tenant-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        r.id, BUILDING_ID, r.status ?? 'approved', r.move_in_season, r.move_in_year, r.move_in_given ?? null,
        r.move_out_year_new, r.is_current_tenant ?? 0, r.review_title ?? null, r.review_text ?? null, r.comments ?? null,
      )
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

  // The card of a review whose move-in was skipped shows only the move-out; the placeholder
  // in the NOT NULL columns is never shown, so it never matches.
  const skippedMoveIn: ReviewSeed = {
    id: 'rev-skipped', move_in_season: 'winter', move_in_year: 2026, move_in_given: 'none', move_out_year_new: '2025',
  };
  const yearOnlyMoveIn: ReviewSeed = {
    id: 'rev-year-only', move_in_season: 'winter', move_in_year: 2022, move_in_given: 'year_only', move_out_year_new: '2024',
  };

  it('matches a skipped move-in by the dates its card shows', async () => {
    const db = await disputesDb([pastTenant, skippedMoveIn]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: '2025' }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-skipped']);
    await flushBackground();
  });

  it('never matches the placeholder of a skipped move-in', async () => {
    const db = await disputesDb([pastTenant, skippedMoveIn]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: 'Winter 2026 · 2025' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.noMatch);
  });

  it('matches a year-only move-in by the year its card shows', async () => {
    const db = await disputesDb([pastTenant, yearOnlyMoveIn]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: '2022 · 2024' }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-year-only']);
    await flushBackground();
  });

  it('matches a review written before migration 0034 by its dates as stored', async () => {
    const db = await disputesDb([pastTenant, { ...currentTenant, id: 'rev-old', move_in_season: 'winter', move_in_year: 2026 }]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: 'Winter 2026 · Current' }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-old']);
    await flushBackground();
  });

  it('never guesses between two reviews that show the same dates', async () => {
    const db = await disputesDb([currentTenant, { ...currentTenant, id: 'rev-now-2' }]);
    const response = await POST(context(db, { ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.manyMatch);
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  // A skipped move-in shows no move-in (and before migration 0034 it was stored as winter of
  // the current year), so many current tenants share one range. The title, or the first words
  // of the review, picks between them.
  const titled: ReviewSeed = { ...currentTenant, id: 'rev-titled', review_title: 'Quiet street, slow repairs', comments: 'The heat took a week.' };
  const untitled: ReviewSeed = { ...currentTenant, id: 'rev-untitled', comments: "Heat's fine. The mail room is a mess." };

  it('tells two same-date reviews apart by the title', async () => {
    const db = await disputesDb([titled, untitled]);
    const response = await POST(context(db, {
      ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current', reviewWords: 'QUIET STREET slow',
    }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-titled']);
    await flushBackground();
  });

  it('tells them apart by the first words of an untitled review, however punctuated', async () => {
    const db = await disputesDb([titled, untitled]);
    const response = await POST(context(db, {
      ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current', reviewWords: 'heat’s fine the mail',
    }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-untitled']);
    await flushBackground();
  });

  it('reads the review text before the older comments column, as the card does', async () => {
    const db = await disputesDb([
      { ...untitled, review_text: 'Rent went up twice.', comments: 'Ignored by the card.' },
      titled,
    ]);
    const response = await POST(context(db, {
      ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current', reviewWords: 'Rent went up',
    }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-untitled']);
    await flushBackground();
  });

  it('matches whole words only', async () => {
    const db = await disputesDb([titled, untitled]);
    const response = await POST(context(db, {
      ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current', reviewWords: 'Quiet str',
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.noWordsMatch);
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  it('says so when no review with those dates starts with those words', async () => {
    const db = await disputesDb([titled, untitled]);
    const response = await POST(context(db, {
      ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current', reviewWords: 'Great landlord',
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.noWordsMatch);
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  it('still refuses when the words fit both reviews', async () => {
    const db = await disputesDb([titled, { ...titled, id: 'rev-titled-2' }]);
    const response = await POST(context(db, {
      ...base, reviewUrl: PAGE, reviewDates: 'Fall 2023 · Current', reviewWords: 'Quiet street',
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(DISPUTE_TARGET_ERRORS.stillMany);
    expect(await disputedReviewIds(db)).toEqual([]);
  });

  it('ignores the words when the dates already name one review', async () => {
    const db = await disputesDb([pastTenant, titled]);
    const response = await POST(context(db, {
      ...base, reviewUrl: PAGE, reviewDates: 'Summer 2019 · 2021', reviewWords: 'Quiet street',
    }));
    expect(response.status).toBe(201);
    expect(await disputedReviewIds(db)).toEqual(['rev-past']);
    await flushBackground();
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
