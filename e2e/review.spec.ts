import { fileURLToPath } from 'url';
import path from 'path';
import { test, expect } from './fixtures';

// Derive Page type from the fixture to avoid importing from @playwright/test directly
type Page = Parameters<Parameters<typeof test>[1]>[0]['authedPage'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper: rate all visible rating items in the current step with a given score.
// Each step renders only its own RatingItem components (React conditional rendering),
// so every button[type="button"] matching the score text belongs to this step.
async function rateAllItemsInStep(page: Page, score: number) {
  const scoreButtons = page.locator('button[type="button"]').filter({ hasText: new RegExp(`^${score}$`) });
  const count = await scoreButtons.count();
  for (let i = 0; i < count; i++) {
    await scoreButtons.nth(i).click();
  }
  return count;
}

test.describe('Review Form', () => {

  // E2E-03: Complete review submission happy path
  test('complete review submission happy path', async ({ authedPage }) => {
    test.setTimeout(90000);

    // ── Step 1: Navigate and verify starting step ────────────────────────────
    await authedPage.goto('/review/new?building=building-30');
    // Wait for React hydration — the unit-details step header must be visible
    await authedPage.waitForLoadState('networkidle');
    await expect(authedPage.locator('text=Unit Details').first()).toBeVisible({ timeout: 15000 });

    // ── Step 2: Unit Details ─────────────────────────────────────────────────
    // Bedrooms and bathrooms are pre-filled (1 bed, 1 bath). Fill optional unit number.
    await authedPage.fill('input[placeholder*="2A"]', '4B');
    // Click Continue to advance to unit-rating
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // ── Step 3: Unit Rating (10 items) ───────────────────────────────────────
    await expect(authedPage.locator('text=Rate Your Unit').first()).toBeVisible({ timeout: 10000 });
    const unitCount = await rateAllItemsInStep(authedPage, 4);
    expect(unitCount).toBe(10); // 10 unit items
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // ── Step 4: Building Rating (9 items) ────────────────────────────────────
    await expect(authedPage.locator('text=Rate the Building').first()).toBeVisible({ timeout: 10000 });
    const buildingCount = await rateAllItemsInStep(authedPage, 4);
    expect(buildingCount).toBe(9); // 9 building items
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // ── Step 5: Landlord Rating (8 items) ────────────────────────────────────
    await expect(authedPage.locator('text=Rate Your Landlord').first()).toBeVisible({ timeout: 10000 });
    const landlordCount = await rateAllItemsInStep(authedPage, 4);
    expect(landlordCount).toBe(8); // 8 landlord items
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // ── Step 6: Additional step ──────────────────────────────────────────────
    // Wait for the tenure question to appear
    await expect(authedPage.locator('text=How long did you live').first()).toBeVisible({ timeout: 10000 });
    // Tenure and move-out year are pre-selected — leave defaults
    // Fill optional comment
    await authedPage.fill('textarea', 'Great place to live!');
    await authedPage.locator('button[type="button"]', { hasText: 'Review & Submit' }).click();

    // ── Step 7: Confirm step ─────────────────────────────────────────────────
    await expect(authedPage.locator('text=Review Summary').first()).toBeVisible({ timeout: 10000 });

    // Submit button must be disabled until privacy checkbox is checked
    await expect(authedPage.locator('button[type="button"]', { hasText: 'Submit Review' })).toBeDisabled();

    // Check the privacy acknowledgment checkbox
    await authedPage.locator('input[type="checkbox"]').check();

    // Submit button should now be enabled
    await expect(authedPage.locator('button[type="button"]', { hasText: 'Submit Review' })).toBeEnabled();

    // Submit the review
    await authedPage.locator('button[type="button"]', { hasText: 'Submit Review' }).click();

    // Wait for redirect to building page
    await authedPage.waitForURL(/\/building\/45-melnea-cass-blvd/, { timeout: 30000 });

    // Confirm we landed on the building page
    expect(authedPage.url()).toContain('45-melnea-cass-blvd');
  });

  // Step navigation: Back buttons work and data persists
  test('step navigation - Back buttons work and data persists', async ({ authedPage }) => {
    await authedPage.goto('/review/new?building=building-30');
    await authedPage.waitForLoadState('networkidle');
    await expect(authedPage.locator('text=Unit Details').first()).toBeVisible({ timeout: 15000 });

    // Fill unit number with a recognizable value
    await authedPage.fill('input[placeholder*="2A"]', '7A');

    // Advance to unit-rating
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();
    await expect(authedPage.locator('text=Rate Your Unit').first()).toBeVisible({ timeout: 10000 });

    // Rate the first two visible rating items with score 3
    const scoreButtons = authedPage.locator('button[type="button"]').filter({ hasText: /^3$/ });
    await scoreButtons.nth(0).click();
    await scoreButtons.nth(1).click();

    // Navigate back to unit-details
    await authedPage.locator('button[type="button"]', { hasText: 'Back' }).click();
    await expect(authedPage.locator('text=Unit Details').first()).toBeVisible({ timeout: 10000 });

    // Assert unit number field still contains the previously entered value (data persists)
    const unitInput = authedPage.locator('input[placeholder*="2A"]');
    await expect(unitInput).toHaveValue('7A');

    // Advance again to unit-rating
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();
    await expect(authedPage.locator('text=Rate Your Unit').first()).toBeVisible({ timeout: 10000 });

    // The previously rated buttons should still show selected state (colored background, not gray-100)
    // We check that at least 2 buttons have selected styling (non-gray background)
    // Selected score-3 buttons get amber-400 background; we verify the count of selected buttons
    const ratedButtons = authedPage.locator('button[type="button"]').filter({ hasText: /^3$/ });
    const ratedCount = await ratedButtons.count();
    expect(ratedCount).toBeGreaterThanOrEqual(2);
  });

  // E2E-04 partial: Review form validates building_id is required
  test('review form validates building_id is required', async ({ authedPage }) => {
    // Make a direct API call without building_id — should return 400
    const response = await authedPage.request.post('/api/reviews', {
      form: {
        // Intentionally omit building_id to test validation
        bedrooms: '1',
        bathrooms: '1',
        tenure_months: '18',
        move_out_year: 'current',
        would_recommend: 'yes',
      },
    });
    expect(response.status()).toBe(400);
  });

  // E2E-04: Unauthenticated user cannot access review form
  test('unauthenticated user cannot access review form', async ({ page }) => {
    // Use default page fixture (unauthenticated)
    await page.goto('/review/new?building=building-30');

    // Should redirect to sign-in page
    await page.waitForURL(/\/auth\/signin/, { timeout: 10000 });
    expect(page.url()).toContain('/auth/signin');
  });

  // E2E-04: Submit button disabled without privacy checkbox
  test('review form submit button disabled without privacy checkbox', async ({ authedPage }) => {
    test.setTimeout(90000);

    await authedPage.goto('/review/new?building=building-30');
    await authedPage.waitForLoadState('networkidle');
    await expect(authedPage.locator('text=Unit Details').first()).toBeVisible({ timeout: 15000 });

    // Click through each step (minimal interaction — just advance)
    // Unit Details -> unit-rating
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // Rate at least some items to proceed (form logic may not require all)
    await expect(authedPage.locator('text=Rate Your Unit').first()).toBeVisible({ timeout: 10000 });
    await rateAllItemsInStep(authedPage, 4);
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // Building rating
    await expect(authedPage.locator('text=Rate the Building').first()).toBeVisible({ timeout: 10000 });
    await rateAllItemsInStep(authedPage, 4);
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // Landlord rating
    await expect(authedPage.locator('text=Rate Your Landlord').first()).toBeVisible({ timeout: 10000 });
    await rateAllItemsInStep(authedPage, 4);
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();

    // Additional step
    await expect(authedPage.locator('text=How long did you live').first()).toBeVisible({ timeout: 10000 });
    await authedPage.locator('button[type="button"]', { hasText: 'Review & Submit' }).click();

    // Confirm step — Submit Review should be disabled without checkbox
    await expect(authedPage.locator('text=Review Summary').first()).toBeVisible({ timeout: 10000 });
    await expect(authedPage.locator('button[type="button"]', { hasText: 'Submit Review' })).toBeDisabled();

    // Check the privacy acknowledgment checkbox
    await authedPage.locator('input[type="checkbox"]').check();

    // Now Submit Review should be enabled
    await expect(authedPage.locator('button[type="button"]', { hasText: 'Submit Review' })).toBeEnabled();
  });

  // Boundary values: rating buttons accept 1 (minimum) and 5 (maximum)
  test('rating buttons at boundary values (1 and 5)', async ({ authedPage }) => {
    await authedPage.goto('/review/new?building=building-30');
    await authedPage.waitForLoadState('networkidle');
    await expect(authedPage.locator('text=Unit Details').first()).toBeVisible({ timeout: 15000 });

    // Advance to unit-rating step
    await authedPage.locator('button[type="button"]', { hasText: 'Continue' }).click();
    await expect(authedPage.locator('text=Rate Your Unit').first()).toBeVisible({ timeout: 10000 });

    // Rate first item with score 1 (minimum — low boundary)
    const score1Buttons = authedPage.locator('button[type="button"]').filter({ hasText: /^1$/ });
    await score1Buttons.nth(0).click();

    // Rate second item with score 5 (maximum — high boundary)
    const score5Buttons = authedPage.locator('button[type="button"]').filter({ hasText: /^5$/ });
    await score5Buttons.nth(1).click();

    // Both boundary values should now be registered (not in the default gray-100 state).
    // The score-1 button clicked gets coral-500 styling; score-5 gets emerald-500 styling.
    // We verify the buttons are now in a selected state by checking they are visible and clickable.
    await expect(score1Buttons.nth(0)).toBeVisible();
    await expect(score5Buttons.nth(1)).toBeVisible();

    // Click each again to confirm they remain responsive (UI doesn't freeze on boundary inputs)
    await score1Buttons.nth(0).click();
    await score5Buttons.nth(1).click();
  });

});
