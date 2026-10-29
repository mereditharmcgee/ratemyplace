import type { Page } from '@playwright/test';

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
 * Rate every visible rating item in the current step with one score.
 * Each step renders only its own RatingItem components (React conditional rendering),
 * so every button[type="button"] matching the score text belongs to this step.
 */
export async function rateAllItemsInStep(page: Page, score: number): Promise<number> {
  const scoreButtons = page.locator('button[type="button"]').filter({ hasText: new RegExp(`^${score}$`) });
  const count = await scoreButtons.count();
  for (let i = 0; i < count; i++) {
    await scoreButtons.nth(i).click();
  }
  return count;
}
