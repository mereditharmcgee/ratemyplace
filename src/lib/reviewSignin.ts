// What /auth/signin and /auth/signup say to someone sent there by "Write a review".
//
// The return path is run through safeRedirectPath again here, so a caller that hands over
// the raw `?redirect=` value still cannot get an address onto the page from an unsafe one.
// The building is looked up by id with a read-only SELECT of two columns; an unknown id, a
// missing database or a failed query falls back to the line without an address.
//
// Server-only: the auth pages call this from their frontmatter, never from a page script.
import { safeRedirectPath } from './authRedirect';
import { logError } from './logger';
import type { RecordsDb } from './records/types'; // type-only: erased at build time

export const REVIEW_FORM_PATH = '/review/new';
const SENTINEL = 'https://return.invalid';
/** Real building ids are short (`seed-<parcel>`, UUIDs); anything longer is not looked up. */
const MAX_BUILDING_ID_LENGTH = 128;

/**
 * Every user-facing string the review sign-in context adds to the auth pages.
 *
 * `privacy` must stay true to the code. Today: review cards show no name, email or account
 * detail (ReviewCard.astro); reviewer emails are read only by admin routes; landlord-facing
 * email (dispute receipt and outcome) carries the landlord's own submission, the building
 * address and the admin's resolution notes; owner notices go only to OWNER_NOTIFY_EMAIL.
 * Change this line if any of that changes.
 */
export const REVIEW_SIGNIN_COPY = {
  heading: 'Sign in or create an account',
  reviewing: (place: string): string => `You're reviewing ${place}.`,
  privacy: 'Your name and email do not appear on your review and are not given to the landlord.',
  createAccount: 'Create an account',
  emailDivider: 'Or sign in with email',
} as const;

export interface ReviewSigninContext {
  /** The building being reviewed ("address, city"), or null when the path names none we can show. */
  place: string | null;
}

/**
 * Whether a return path is the review form, and which building it names. Null when the
 * path is not the review form (or is unsafe, which safeRedirectPath turns into '/').
 */
export function reviewFormTarget(raw: string | null | undefined): { buildingId: string | null } | null {
  const path = safeRedirectPath(raw);
  if (path === '/') return null;
  let url: URL;
  try {
    url = new URL(path, SENTINEL);
  } catch {
    return null;
  }
  if (url.origin !== SENTINEL || url.pathname !== REVIEW_FORM_PATH) return null;
  const id = url.searchParams.get('building')?.trim() ?? '';
  return { buildingId: id.length > 0 && id.length <= MAX_BUILDING_ID_LENGTH ? id : null };
}

/** "12 Example Rd, Boston"; the address alone when the city is blank or already in it. */
export function reviewPlaceLabel(row: { address: string | null; city: string | null }): string | null {
  const address = row.address?.trim() ?? '';
  if (!address) return null;
  const city = row.city?.trim() ?? '';
  if (!city || address.includes(',')) return address;
  return `${address}, ${city}`;
}

/**
 * The context for an auth page, or null when the visitor did not come from the review form.
 * Never throws: the sign-in page must render whatever the database does.
 */
export async function loadReviewSigninContext(
  db: RecordsDb | undefined,
  raw: string | null | undefined,
): Promise<ReviewSigninContext | null> {
  const target = reviewFormTarget(raw);
  if (!target) return null;
  if (!target.buildingId || !db) return { place: null };
  try {
    const row = await db
      .prepare('SELECT address, city FROM buildings WHERE id = ?')
      .bind(target.buildingId)
      .first<{ address: string | null; city: string | null }>();
    return { place: row ? reviewPlaceLabel(row) : null };
  } catch (error) {
    logError('review_signin_context_failed', { error: error instanceof Error ? error.message : String(error) });
    return { place: null };
  }
}
