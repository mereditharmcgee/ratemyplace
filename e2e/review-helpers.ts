import type { Page } from '@playwright/test';

// Shared by review.spec.ts and a11y.spec.ts, so a change to how a rating is chosen (the
// A11Y-04 radio groups) is made in one place.

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
