import { describe, expect, it } from 'vitest';
import {
  needsFreshToken,
  SUBMIT_FAILED_COPY,
  submitOutcome,
  type ReviewSubmitResponse,
  type SubmitOutcome,
} from '../reviewSubmitOutcome';

// What the review form does after POST /api/reviews answers. A 2xx always means the review
// exists, so it never resets Turnstile or re-enables Submit; only a usable slug and id
// navigate, and anything else says "submitted" without inventing a /building/undefined link.

const cases: Array<[string, number, boolean, ReviewSubmitResponse | null, SubmitOutcome]> = [
  ['200 with a slug and an id', 200, true, { buildingSlug: '45-melnea-cass-blvd', reviewId: 'r1' }, { kind: 'navigate', url: '/building/45-melnea-cass-blvd?submitted=true&reviewId=r1' }],
  ['200 with an empty body', 200, true, {}, { kind: 'submitted' }],
  ['200 whose JSON did not parse', 200, true, null, { kind: 'submitted' }],
  ['200 with a slug that is not a slug', 200, true, { buildingSlug: '../x', reviewId: 'r1' }, { kind: 'submitted' }],
  ['200 with an empty review id', 200, true, { buildingSlug: 'a', reviewId: '' }, { kind: 'submitted' }],
  ['401', 401, false, { error: 'Authentication required' }, { kind: 'auth-expired' }],
  ['400 with a message', 400, false, { error: 'Bot verification failed. Please try again.' }, { kind: 'error', message: 'Bot verification failed. Please try again.' }],
  ['500 with no message', 500, false, {}, { kind: 'error', message: SUBMIT_FAILED_COPY }],
  ['429 with a non-string error', 429, false, { error: 123 }, { kind: 'error', message: SUBMIT_FAILED_COPY }],
];

describe('submitOutcome', () => {
  it.each(cases)('%s', (_label, status, ok, body, expected) => {
    expect(submitOutcome(status, ok, body)).toEqual(expected);
  });

  it('encodes the review id in the URL', () => {
    expect(submitOutcome(200, true, { buildingSlug: 'a', reviewId: 'r 1&x' })).toEqual({
      kind: 'navigate',
      url: '/building/a?submitted=true&reviewId=r%201%26x',
    });
  });

  it('the default copy is the one the form has always shown', () => {
    expect(SUBMIT_FAILED_COPY).toBe('Failed to submit review');
  });
});

describe('needsFreshToken', () => {
  it('is true after a failed attempt, which spent its token', () => {
    expect(needsFreshToken({ kind: 'auth-expired' })).toBe(true);
    expect(needsFreshToken({ kind: 'error', message: 'x' })).toBe(true);
    expect(needsFreshToken(null)).toBe(true);
  });

  it('is never true after a 2xx', () => {
    expect(needsFreshToken({ kind: 'navigate', url: '/building/a' })).toBe(false);
    expect(needsFreshToken({ kind: 'submitted' })).toBe(false);
  });
});
