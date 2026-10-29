import { expect, type Page } from '@playwright/test';

// Shared by review.spec.ts, a11y.spec.ts and a11y-keyboard.spec.ts, so a change to how a
// rating is chosen (the A11Y-04 radio groups) or to how a page is kept off Google is made in
// one place. A spec cannot import another spec, so shared helpers live here.

const GOOGLE_API = /^https:\/\/(maps|places)\.googleapis\.com\//;
const PLACES_AUTOCOMPLETE = /\/api\/places\/autocomplete(\?|$)/;
const PLACES_DETAILS = /\/api\/places\/details(\?|$)/;

/** The one fictional suggestion the two Places proxies answer with. */
export const FAKE_PREDICTIONS = [
  {
    placeId: 'e2e-a11y-place-1',
    description: '100 Example St, Boston, MA, USA',
    mainText: '100 Example St',
    secondaryText: 'Boston, MA, USA',
    existing: null,
  },
];

/**
 * Size the page and keep it off Google: Maps and Places are refused at the browser, and the
 * two Places proxies answer with FAKE_PREDICTIONS and no place details.
 */
export async function prepare(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.route(GOOGLE_API, (route) => route.abort());
  await page.route(PLACES_AUTOCOMPLETE, (route) => route.fulfill({ json: { predictions: FAKE_PREDICTIONS } }));
  await page.route(PLACES_DETAILS, (route) => route.fulfill({ json: { place: null } }));
}

/**
 * Rate every rating question in the current step with one score, and return how many there
 * were. Each step renders only its own questions (React conditional rendering), and each
 * question is a radio group. The click goes to the visible label, as a user's would: the
 * radio itself is visually hidden, so a click aimed at it would land on the label anyway.
 */
export async function rateAllItemsInStep(page: Page, score: number): Promise<number> {
  const groups = page.getByRole('radiogroup');
  const count = await groups.count();
  for (let i = 0; i < count; i++) {
    const group = groups.nth(i);
    await group.locator('label').filter({ hasText: new RegExp(`^${score}$`) }).click();
    await expect(group.getByRole('radio', { name: String(score), exact: true })).toBeChecked();
  }
  return count;
}
