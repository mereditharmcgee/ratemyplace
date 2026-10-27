// What the review form does once POST /api/reviews answers.
//
// LEAF MODULE: no runtime imports. ReviewForm (a React island) imports it, so anything it
// imported would ship to every visitor (`clientLeafModules.test.ts` enforces it).

/** The route's legacy success shape is `{ success, reviewId, buildingSlug, domainScores }`. */
export interface ReviewSubmitResponse {
  reviewId?: unknown;
  buildingSlug?: unknown;
  error?: unknown;
}

export type SubmitOutcome =
  | { kind: 'navigate'; url: string } // 2xx with a usable slug and id
  | { kind: 'submitted' } // 2xx, but the body is unusable: the review exists, there is no link
  | { kind: 'auth-expired' } // 401
  | { kind: 'error'; message: string }; // any other non-2xx

export const SUBMIT_FAILED_COPY = 'Failed to submit review';
export const SUBMIT_NETWORK_COPY = 'An error occurred. Please try again.';
export const SUBMITTED_NO_LINK_COPY =
  'Your review was submitted and is waiting for moderation. You can find it on your profile.';

const SLUG = /^[a-z0-9-]+$/;

/**
 * `navigate` only for a 2xx carrying a slug-shaped `buildingSlug` and a non-empty
 * `reviewId`; any other 2xx is `submitted`, never a link to `/building/undefined`. A 401 is
 * `auth-expired`; every other failure is `error`, with the body's message when it has one.
 */
export function submitOutcome(status: number, ok: boolean, body: ReviewSubmitResponse | null): SubmitOutcome {
  if (ok) {
    const slug = body?.buildingSlug;
    const reviewId = body?.reviewId;
    if (typeof slug === 'string' && SLUG.test(slug) && typeof reviewId === 'string' && reviewId !== '') {
      return { kind: 'navigate', url: `/building/${slug}?submitted=true&reviewId=${encodeURIComponent(reviewId)}` };
    }
    return { kind: 'submitted' };
  }
  if (status === 401) return { kind: 'auth-expired' };
  const message = typeof body?.error === 'string' && body.error !== '' ? body.error : SUBMIT_FAILED_COPY;
  return { kind: 'error', message };
}

/**
 * A failed attempt sent its Turnstile token with the POST, and tokens are single-use, so it
 * needs a fresh one: true for `auth-expired`, `error` and `null` (a network failure). Never
 * for a 2xx — the review exists, and a reset would only invite a second one.
 */
export function needsFreshToken(outcome: SubmitOutcome | null): boolean {
  return outcome === null || outcome.kind === 'auth-expired' || outcome.kind === 'error';
}
