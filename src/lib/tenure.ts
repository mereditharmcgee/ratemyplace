/**
 * The "How long did you live at this address?" answer, stored as whole months in
 * `reviews.tenure_months` (nullable: older reviews and a skipped answer hold NULL). Tenure is
 * collected for moderation and never displayed on a public page.
 *
 * A client leaf (`clientLeafModules.test.ts`): the review edit form imports it, so it has no
 * runtime imports.
 */

/** Whole months from a form value or JSON body: a positive integer, or null when blank or malformed. */
export function parseTenureMonths(raw: unknown): number | null {
  const months = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(months) && months > 0 ? months : null;
}

/**
 * Where the tenure select on the reviewer's edit page starts: the stored answer, so saving
 * without touching it writes back what was there. A review with no stored tenure starts
 * blank; starting at a default would save a tenure the reviewer never gave.
 */
export function tenureEditValue(review: { tenure_months?: number | null }): string {
  const months = review.tenure_months;
  return typeof months === 'number' && Number.isFinite(months) ? String(months) : '';
}

/** The edit page's blank tenure choice, for a review with no stored tenure. Same as the move-out's. */
const TENURE_NOT_GIVEN_CHOICE = 'Select...';

function monthsLabel(value: string): string {
  return value === '1' ? '1 month' : `${value} months`;
}

/**
 * The tenure choices on the reviewer's edit page, as select values: the form's list, plus the
 * stored answer when the list does not hold it (a blank tenure, or a number of months the list
 * does not offer), so the select shows what is stored instead of falling back to its first
 * choice.
 */
export function tenureEditChoices(
  options: ReadonlyArray<{ value: number; label: string }>,
  stored: string,
): Array<{ value: string; label: string }> {
  const choices = options.map((opt) => ({ value: String(opt.value), label: opt.label }));
  if (choices.some((opt) => opt.value === stored)) return choices;
  const label = stored === '' ? TENURE_NOT_GIVEN_CHOICE : monthsLabel(stored);
  return [{ value: stored, label }, ...choices];
}
