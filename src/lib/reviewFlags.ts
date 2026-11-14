// Advisory moderation signals for the admin reviews queue.
//
// LEAF MODULE: no runtime imports. The admin badge island (components/admin/ReviewFlags.tsx)
// imports its labels, so anything it imported would ship to the browser
// (`clientLeafModules.test.ts` enforces it).
//
// Signals are computed when GET /api/admin/reviews is read and returned as codes only, never the
// matched text or where it was. Nothing stores them, so nothing goes stale or needs a backfill,
// and nothing outside the admin list computes or carries them. They never decide anything:
// approval, rejection, flagging, deletion and visibility do not read them.
//
// The text scan runs over account-written fields on every list read, so every pattern runs in
// linear time: no nested quantifiers, no two adjacent quantified parts that can match the same
// characters, and a bound on every repeat. They also avoid lookbehind, which older Safari
// cannot parse, because the badge island bundles this file.

/** A review is a burst signal when it is at least this many reviews of its building in the window. */
export const BUILDING_VELOCITY_MIN = 5;
/** The window for the building burst: the 24 hours ending at the review's own `created_at`. */
export const VELOCITY_WINDOW_SECONDS = 86_400;

/** Every code, in display order. */
export const REVIEW_FLAG_CODES = [
  'possible_email',
  'possible_phone',
  'possible_link',
  'building_velocity',
  'repeat_reviewer',
] as const;
export type ReviewFlagCode = (typeof REVIEW_FLAG_CODES)[number];

/** The prose a reviewer writes. `unit_number` is private by design and never scanned. */
export const FLAGGED_TEXT_FIELDS = [
  'review_title',
  'review_text',
  'comments',
  'landlord_name',
  'property_manager_name',
] as const;
export type FlaggedTextField = (typeof FLAGGED_TEXT_FIELDS)[number];

const VELOCITY_WINDOW_HOURS = VELOCITY_WINDOW_SECONDS / 3_600;

/** Admin-only labels. */
export const REVIEW_FLAG_LABELS: Readonly<Record<ReviewFlagCode, string>> = {
  possible_email: 'Possible email address',
  possible_phone: 'Possible phone number',
  possible_link: 'Possible web link',
  building_velocity: `${BUILDING_VELOCITY_MIN} or more reviews of this building in ${VELOCITY_WINDOW_HOURS} hours`,
  repeat_reviewer: 'This account has another review of this building',
};

/** The accessible name of a row's list of signals. */
export const REVIEW_FLAGS_LIST_LABEL = 'Moderation signals';

export function isReviewFlagCode(value: unknown): value is ReviewFlagCode {
  return typeof value === 'string' && (REVIEW_FLAG_CODES as readonly string[]).includes(value);
}

// An address: a bounded local part, "@" or "(at)" / "[at]", then two to five bounded labels
// joined by "." or "(dot)" / "[dot]". Each part's characters differ from its neighbours'.
const EMAIL_HINT = /@|[(\[]\s{0,2}at\s{0,2}[)\]]/;
const EMAIL_ALL =
  /[a-z0-9._%+-]{1,64}(?:@|\s{0,3}[(\[]\s{0,2}at\s{0,2}[)\]]\s{0,3})[a-z0-9-]{1,63}(?:(?:\.|\s{0,3}[(\[]\s{0,2}dot\s{0,2}[)\]]\s{0,3})[a-z0-9-]{1,63}){1,4}/g;

// A 10-digit North American number with an optional +1, parentheses, spaces, dots or dashes,
// not inside a longer digit run: a non-digit (or the start) before it, no digit after it.
const PHONE =
  /(?:^|\D)(?:\+?1[\s.-]{0,2})?(?:\(\s{0,2}\d{3}\s{0,2}\)|\d{3})[\s.-]{0,3}\d{3}[\s.-]{0,3}\d{4}(?!\d)/;

// A scheme, "www.", or a bare domain ending in a common top-level domain. Run after email
// matches are removed, so an address is not also a link.
const LINK_SCHEME = /https?:\/\//;
const LINK_WWW = /(?:^|[^a-z0-9-])www\./;
const LINK_BARE = /(?:^|[^a-z0-9-])[a-z0-9-]{1,63}\.(?:com|net|org|edu|gov|io|co|info|biz|app|xyz)(?![a-z0-9-])/;

/**
 * The text signals in the listed fields, in code order. Each field is scanned on its own,
 * after NFKC and lowercasing. A value that is not a string (a legacy blob, a number) is
 * skipped, never coerced.
 */
export function textFlags(text: Partial<Record<FlaggedTextField, string | null>>): ReviewFlagCode[] {
  let email = false;
  let phone = false;
  let link = false;
  for (const field of FLAGGED_TEXT_FIELDS) {
    const raw: unknown = text?.[field];
    if (typeof raw !== 'string' || raw === '') continue;
    const value = raw.normalize('NFKC').toLowerCase();
    let rest = value;
    if (EMAIL_HINT.test(value)) {
      rest = value.replace(EMAIL_ALL, ' ');
      if (rest !== value) email = true;
    }
    if (!phone && PHONE.test(rest)) phone = true;
    if (!link && (LINK_SCHEME.test(rest) || LINK_WWW.test(rest) || LINK_BARE.test(rest))) link = true;
  }
  const found: ReviewFlagCode[] = [];
  if (email) found.push('possible_email');
  if (phone) found.push('possible_phone');
  if (link) found.push('possible_link');
  return found;
}

/**
 * Every signal for one review, in code order, no duplicates. `buildingOrdinal` is the review's
 * place among its building's reviews in the window ending at its own time (ties by id);
 * `otherReviewsHere` counts the same account's other reviews of the same building.
 */
export function reviewFlags(input: {
  text: Partial<Record<FlaggedTextField, string | null>>;
  buildingOrdinal: number;
  otherReviewsHere: number;
}): ReviewFlagCode[] {
  const found = new Set<ReviewFlagCode>(textFlags(input.text));
  if (Number(input.buildingOrdinal) >= BUILDING_VELOCITY_MIN) found.add('building_velocity');
  if (Number(input.otherReviewsHere) > 0) found.add('repeat_reviewer');
  return REVIEW_FLAG_CODES.filter((code) => found.has(code));
}
