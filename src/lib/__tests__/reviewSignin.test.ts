import { describe, expect, it } from 'vitest';
import {
  loadReviewSigninContext,
  REVIEW_SIGNIN_COPY,
  reviewFormTarget,
  reviewPlaceLabel,
} from '../reviewSignin';
import type { RecordsDb } from '../records/types';
import { createMemoryDatabase, sqliteAvailable, TestD1Database } from './helpers/sqliteD1';

const suite = sqliteAvailable ? describe : describe.skip;

function makeDb(): RecordsDb {
  const database = createMemoryDatabase();
  database.exec(`
    CREATE TABLE buildings (id TEXT PRIMARY KEY, address TEXT NOT NULL, city TEXT, admin_notes TEXT, owner_name TEXT);
    INSERT INTO buildings (id, address, city, admin_notes, owner_name)
      VALUES ('b-1', '12 Example Rd', 'Boston', 'SENTINEL-ADMIN-NOTE', 'SENTINEL-OWNER');
    INSERT INTO buildings (id, address, city) VALUES ('b-2', '40 Sample St', '');
  `);
  return new TestD1Database(database) as unknown as RecordsDb;
}

describe('reviewFormTarget', () => {
  it('reads the building id from a review-form return path', () => {
    expect(reviewFormTarget('/review/new?building=b-1')).toEqual({ buildingId: 'b-1' });
    expect(reviewFormTarget('/review/new?building=b-1&partOf=1')).toEqual({ buildingId: 'b-1' });
  });

  it('is the review form with no building for the bare form and the homepage handoff', () => {
    expect(reviewFormTarget('/review/new')).toEqual({ buildingId: null });
    expect(reviewFormTarget('/review/new?placeId=abc')).toEqual({ buildingId: null });
    expect(reviewFormTarget('/review/new?building=')).toEqual({ buildingId: null });
    expect(reviewFormTarget(`/review/new?building=${'x'.repeat(200)}`)).toEqual({ buildingId: null });
  });

  it('is null for any other page, a missing value or an unsafe one', () => {
    for (const raw of [
      null,
      undefined,
      '',
      '/',
      '/profile',
      '/review/edit/abc',
      '/review/newer?building=b-1',
      '//evil.example/review/new?building=b-1',
      '/.//evil.example/review/new?building=b-1',
      'https://evil.example/review/new?building=b-1',
      '/review/../review/new?building=b-1',
    ]) {
      expect(reviewFormTarget(raw), String(raw)).toBeNull();
    }
  });
});

describe('reviewPlaceLabel', () => {
  it('adds the city after the address', () => {
    expect(reviewPlaceLabel({ address: '12 Example Rd', city: 'Boston' })).toBe('12 Example Rd, Boston');
  });

  it('keeps the address alone when the city is blank or the address already has one', () => {
    expect(reviewPlaceLabel({ address: '12 Example Rd', city: null })).toBe('12 Example Rd');
    expect(reviewPlaceLabel({ address: '12 Example Rd', city: '  ' })).toBe('12 Example Rd');
    expect(reviewPlaceLabel({ address: '12 Example Rd, Boston', city: 'Boston' })).toBe('12 Example Rd, Boston');
  });

  it('is null with no address to show', () => {
    expect(reviewPlaceLabel({ address: null, city: 'Boston' })).toBeNull();
    expect(reviewPlaceLabel({ address: ' ', city: 'Boston' })).toBeNull();
  });
});

const EM_DASH = String.fromCharCode(0x2014);

describe('REVIEW_SIGNIN_COPY', () => {
  it('is plain: no em dashes and no exclamation points', () => {
    const strings = [
      REVIEW_SIGNIN_COPY.heading,
      REVIEW_SIGNIN_COPY.reviewing('12 Example Rd, Boston'),
      REVIEW_SIGNIN_COPY.privacy,
      REVIEW_SIGNIN_COPY.createAccount,
      REVIEW_SIGNIN_COPY.emailDivider,
    ];
    for (const s of strings) {
      expect(s).not.toContain(EM_DASH);
      expect(s).not.toContain('!');
    }
  });
});

suite('loadReviewSigninContext', () => {
  it('names the building for a review-form path with a known id', async () => {
    expect(await loadReviewSigninContext(makeDb(), '/review/new?building=b-1')).toEqual({ place: '12 Example Rd, Boston' });
    expect(await loadReviewSigninContext(makeDb(), '/review/new?building=b-2')).toEqual({ place: '40 Sample St' });
  });

  it('has no place for an unknown id, the bare form, or no database', async () => {
    expect(await loadReviewSigninContext(makeDb(), '/review/new?building=nope')).toEqual({ place: null });
    expect(await loadReviewSigninContext(makeDb(), '/review/new')).toEqual({ place: null });
    expect(await loadReviewSigninContext(undefined, '/review/new?building=b-1')).toEqual({ place: null });
  });

  it('is null away from the review form, and an unsafe path never reaches the database', async () => {
    let queried = false;
    const spy = {
      prepare() {
        queried = true;
        throw new Error('should not query');
      },
      batch: async () => [],
    } as unknown as RecordsDb;
    expect(await loadReviewSigninContext(spy, '/profile')).toBeNull();
    expect(await loadReviewSigninContext(spy, '//evil.example/review/new?building=b-1')).toBeNull();
    expect(await loadReviewSigninContext(spy, '/.//evil.example/review/new?building=b-1')).toBeNull();
    expect(queried).toBe(false);
  });

  it('falls back to no place when the query fails', async () => {
    const broken = {
      prepare() {
        throw new Error('D1 down');
      },
      batch: async () => [],
    } as unknown as RecordsDb;
    expect(await loadReviewSigninContext(broken, '/review/new?building=b-1')).toEqual({ place: null });
  });
});
