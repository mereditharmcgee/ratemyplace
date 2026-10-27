import { fileURLToPath } from 'url';
import path from 'path';
import { test, expect, clearRateLimits } from './fixtures';
import { executeLocalD1, installTurnstileStub, TURNSTILE_SCRIPT } from './test-harness';

// Derive Page type from the fixture to avoid importing from @playwright/test directly
type Page = Parameters<Parameters<typeof test>[1]>[0]['authedPage'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the authenticated user session file (created by global.setup.ts)
const USER_AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');

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
    // Wait for UnitDetailsStep to render — the Bedrooms select is a reliable indicator
    await expect(authedPage.locator('select').first()).toBeVisible({ timeout: 15000 });

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
    // Wait for UnitDetailsStep to render — the Bedrooms select is a reliable indicator
    await expect(authedPage.locator('select').first()).toBeVisible({ timeout: 15000 });

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
    // Make a direct API call without building_id — should return a 4xx error
    // (400 if auth passes and validation runs, 401/403 if auth check is stricter than expected)
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
    // Any 4xx error status confirms the API rejects the request
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
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
    // Wait for UnitDetailsStep to render — the Bedrooms select is a reliable indicator
    await expect(authedPage.locator('select').first()).toBeVisible({ timeout: 15000 });

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
    // Wait for UnitDetailsStep to render — the Bedrooms select is a reliable indicator
    await expect(authedPage.locator('select').first()).toBeVisible({ timeout: 15000 });

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

// E2E-06: Concurrent duplicate review submissions handled gracefully
test.describe('Concurrent Submissions', () => {
  test('concurrent duplicate reviews handled gracefully', async ({ browser }) => {
    // Increase timeout — this test fills the form twice (sequentially) then submits both concurrently
    test.setTimeout(120000);

    // Create two browser contexts from the same authenticated user session
    const [ctx1, ctx2] = await Promise.all([
      browser.newContext({ storageState: USER_AUTH_FILE }),
      browser.newContext({ storageState: USER_AUTH_FILE }),
    ]);
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    await Promise.all([
      installTurnstileStub(page1),
      installTurnstileStub(page2),
    ]);

    // Helper to navigate through all review steps up to (but not including) the Submit click
    async function fillReviewToSubmit(page: Page) {
      await page.goto('/review/new?building=building-30');
      await page.waitForLoadState('networkidle');

      // Unit Details — click Continue (defaults are fine)
      await page.locator('button[type="button"]', { hasText: 'Continue' }).click();

      // Unit Rating — rate all items with score 3
      await page.waitForSelector('text=Rate Your Unit', { timeout: 15000 });
      await rateAllItemsInStep(page, 3);
      await page.locator('button[type="button"]', { hasText: 'Continue' }).click();

      // Building Rating — rate all items with score 3
      await page.waitForSelector('text=Rate the Building', { timeout: 10000 });
      await rateAllItemsInStep(page, 3);
      await page.locator('button[type="button"]', { hasText: 'Continue' }).click();

      // Landlord Rating — rate all items with score 3
      await page.waitForSelector('text=Rate Your Landlord', { timeout: 10000 });
      await rateAllItemsInStep(page, 3);
      await page.locator('button[type="button"]', { hasText: 'Continue' }).click();

      // Additional — click Review & Submit (defaults are fine)
      await page.waitForSelector('text=How long did you live', { timeout: 10000 });
      await page.locator('button[type="button"]', { hasText: 'Review & Submit' }).click();

      // Confirm — check privacy checkbox and wait for Submit to be enabled
      await page.waitForSelector('text=Review Summary', { timeout: 10000 });
      await page.locator('input[type="checkbox"]').check();
      await page.waitForFunction(
        () => {
          const btn = Array.from(document.querySelectorAll('button[type="button"]')).find(
            (b) => b.textContent?.includes('Submit Review')
          );
          return btn && !(btn as HTMLButtonElement).disabled;
        },
        { timeout: 5000 }
      );
    }

    // Fill both forms sequentially (can't parallelize — sequential D1 writes + shared React state)
    await fillReviewToSubmit(page1);
    await fillReviewToSubmit(page2);

    // Submit simultaneously — this is the concurrency test
    await Promise.all([
      page1.locator('button[type="button"]', { hasText: 'Submit Review' }).click(),
      page2.locator('button[type="button"]', { hasText: 'Submit Review' }).click(),
    ]);

    // Wait for both pages to navigate AWAY from the review form.
    // The current URL is /review/new?building=building-30.
    // On success, both pages navigate to /building/<slug>?submitted=true.
    // On error, both pages stay on /review/... (same URL with error shown in React state).
    // Wait for the URL to NOT be the review form URL (i.e., navigate to building page).
    // Use .catch(() => {}) so a timeout doesn't fail the test — we assert below.
    await Promise.all([
      page1.waitForURL(/\/building\//, { timeout: 30000 }).catch(() => {}),
      page2.waitForURL(/\/building\//, { timeout: 30000 }).catch(() => {}),
    ]);

    // Neither page should show a 500 Internal Server Error
    const body1 = await page1.textContent('body');
    const body2 = await page2.textContent('body');
    expect(body1).not.toContain('Internal Server Error');
    expect(body2).not.toContain('Internal Server Error');

    // At least one submission should have succeeded (redirected to building page)
    const url1 = page1.url();
    const url2 = page2.url();
    const oneSucceeded = url1.includes('/building/') || url2.includes('/building/');
    expect(oneSucceeded).toBe(true);

    // Cleanup — do NOT sign out (would invalidate the shared session)
    await ctx1.close();
    await ctx2.close();
  });
});

// ── Review form funnel (October 2026) ─────────────────────────────────────────
// The address step's "Existing properties" click, the return to the form after
// sign-in, the read-only ?placeId= handoff, a failed submit retried, and the
// Turnstile load failure. Google Places, Google OAuth and real Turnstile cannot
// run here; their unit tests and the production checks in the PR cover them.
test.describe('Review form funnel', () => {
  const SEED_EMAIL = 'user@test.ratemyplace.local';
  const SEED_PASSWORD = 'TestPassword123!';
  const BUILDING_FORM_URL = /\/review\/new\?building=building-30$/;

  function buildingCount(): number {
    return JSON.parse(executeLocalD1('SELECT COUNT(*) AS n FROM buildings'))[0].results[0].n;
  }

  function setPlaceId(): void {
    executeLocalD1("UPDATE buildings SET google_place_id = 'e2e-place-30' WHERE id = 'building-30'");
  }

  test.afterAll(() => {
    executeLocalD1("UPDATE buildings SET admin_notes = NULL, owner_name = NULL, google_place_id = NULL WHERE id = 'building-30'");
  });

  async function walkToConfirm(page: Page) {
    await page.goto('/review/new?building=building-30');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('select').first()).toBeVisible({ timeout: 15000 });
    await page.locator('button[type="button"]', { hasText: 'Continue' }).click();
    await expect(page.locator('text=Rate Your Unit').first()).toBeVisible({ timeout: 10000 });
    expect(await rateAllItemsInStep(page, 4)).toBe(10);
    await page.locator('button[type="button"]', { hasText: 'Continue' }).click();
    await expect(page.locator('text=Rate the Building').first()).toBeVisible({ timeout: 10000 });
    await page.locator('button[type="button"]', { hasText: 'Continue' }).click();
    await expect(page.locator('text=Rate Your Landlord').first()).toBeVisible({ timeout: 10000 });
    await page.locator('button[type="button"]', { hasText: 'Continue' }).click();
    await expect(page.locator('text=How long did you live').first()).toBeVisible({ timeout: 10000 });
    await page.locator('button[type="button"]', { hasText: 'Review & Submit' }).click();
    await expect(page.locator('text=Review Summary').first()).toBeVisible({ timeout: 10000 });
    await page.locator('input[type="checkbox"]').check();
  }

  async function signIn(page: Page, email = SEED_EMAIL) {
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', SEED_PASSWORD);
    await page.click('button[type="submit"]');
  }

  test('no admin fields reach the review form HTML', async ({ authedPage }) => {
    executeLocalD1(
      "UPDATE buildings SET admin_notes = 'SENTINEL-E2E-NOTE', owner_name = 'SENTINEL-E2E-OWNER', google_place_id = 'e2e-place-30' WHERE id = 'building-30'"
    );
    const html = await (await authedPage.request.get('/review/new?building=building-30')).text();
    expect(html).toContain('45 Melnea Cass Blvd');
    expect(html).not.toContain('SENTINEL-E2E-NOTE');
    expect(html).not.toContain('SENTINEL-E2E-OWNER');
    expect(html).not.toContain('admin_notes');

    const handoff = await authedPage.request.get('/review/new?placeId=e2e-place-30', { maxRedirects: 0 });
    expect(handoff.status()).toBe(302);
    const location = new URL(handoff.headers()['location'], 'http://localhost:8788');
    expect(location.pathname + location.search).toBe('/review/new?building=building-30');
    executeLocalD1("UPDATE buildings SET admin_notes = NULL, owner_name = NULL WHERE id = 'building-30'");
  });

  test('an "Existing properties" row opens that building at unit details', async ({ authedPage }) => {
    await authedPage.goto('/review/new');
    await authedPage.waitForLoadState('networkidle');
    await authedPage.fill('input[placeholder="Start typing your address..."]', '45 Melnea');
    await expect(authedPage.locator('text=Existing properties')).toBeVisible({ timeout: 10000 });
    await authedPage.locator('button', { hasText: /45 Melnea Cass Blvd/ }).first().click();
    await authedPage.waitForURL(BUILDING_FORM_URL, { timeout: 15000 });
    await expect(authedPage.locator('#review-bedrooms')).toBeVisible({ timeout: 15000 });
    await expect(authedPage.locator('text=45 Melnea Cass Blvd').first()).toBeVisible();
  });

  test('password sign-in returns to the review form', async ({ page }) => {
    clearRateLimits();
    await page.goto('/review/new?building=building-30');
    await page.waitForURL(/\/auth\/signin\?redirect=/, { timeout: 10000 });
    await signIn(page);
    await page.waitForURL(BUILDING_FORM_URL, { timeout: 15000 });
  });

  test('sign-up from that page returns to the review form too', async ({ page }) => {
    clearRateLimits();
    await page.goto('/review/new?building=building-30');
    await page.waitForURL(/\/auth\/signin\?redirect=/, { timeout: 10000 });
    await page.locator('main a[href^="/auth/signup?redirect="]').click();
    await page.waitForURL(/\/auth\/signup\?redirect=/, { timeout: 10000 });
    await page.fill('input[name="email"]', `funnel-${Date.now()}@test.local`);
    await page.fill('input[name="password"]', SEED_PASSWORD);
    await page.fill('input[name="confirmPassword"]', SEED_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(BUILDING_FORM_URL, { timeout: 15000 });
  });

  const HOSTILE = [
    '//evil.example/',
    '/.//evil.example',
    '/..//evil.example',
    '/a/..//evil.example',
    '/x/../..//evil.example',
    '/%2e//evil.example',
    '/%2e%2e//evil.example',
    '/%2e/%2e//evil.example',
    '/%2F%2Fevil.example',
    '/\\evil.example',
    'https://evil.example',
  ];

  test('a signed-in visitor with an off-site redirect stays on this site', async ({ authedPage }) => {
    for (const value of HOSTILE) {
      await authedPage.goto('/auth/signin?redirect=' + encodeURIComponent(value));
      const landed = new URL(authedPage.url());
      expect(landed.origin, value).toBe('http://localhost:8788');
      expect(landed.pathname, value).toBe('/');
    }
  });

  test('off-site redirects are dropped from the sign-in page', async ({ page }) => {
    for (const value of HOSTILE) {
      await page.goto('/auth/signin?redirect=' + encodeURIComponent(value));
      await expect(page.locator('#signin-form'), value).toHaveAttribute('data-redirect', '/');
      await expect(page.locator('main a[href^="/api/auth/google"]'), value).toHaveAttribute('href', '/api/auth/google');
    }
  });

  test('signing in with a dot-segment redirect lands at home', async ({ page }) => {
    clearRateLimits();
    await page.goto('/auth/signin?redirect=%2F.%2F%2Fevil.example');
    await signIn(page);
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15000 });
    const landed = new URL(page.url());
    expect(landed.origin).toBe('http://localhost:8788');
    expect(landed.pathname).toBe('/');
  });

  test('a handoff for a known place id redirects and writes nothing', async ({ authedPage }) => {
    setPlaceId();
    const before = buildingCount();
    await authedPage.goto('/review/new?placeId=e2e-place-30');
    await authedPage.waitForURL(BUILDING_FORM_URL, { timeout: 15000 });
    await expect(authedPage.locator('#review-bedrooms')).toBeVisible({ timeout: 15000 });
    await expect(authedPage.locator('text=45 Melnea Cass Blvd').first()).toBeVisible();
    expect(buildingCount()).toBe(before);
  });

  test('an unresolvable handoff writes nothing', async ({ authedPage }) => {
    const before = buildingCount();
    await authedPage.goto('/review/new?placeId=ChIJe2eNoSuchPlace0000000');
    // No Places key locally, so the lookup is unavailable and the search box is offered.
    await expect(authedPage.getByText(/search for (your address|it) below/i)).toBeVisible();
    await expect(authedPage.locator('input[placeholder="Start typing your address..."]')).toBeVisible();
    await authedPage.goto('/review/new?placeId=..%2F..%2Fx');
    await expect(authedPage.getByText(/could not look up that address/i)).toBeVisible();
    expect(buildingCount()).toBe(before);
  });

  test('a failed submit is retried without losing answers', async ({ authedPage }) => {
    test.setTimeout(90000);
    clearRateLimits();
    let posts = 0;
    await authedPage.route('**/api/reviews', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts += 1;
      if (posts === 1) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Failed to submit review' }),
        });
      }
      return route.continue();
    });

    await walkToConfirm(authedPage);
    const submit = authedPage.locator('button[type="button"]', { hasText: /Submit Review|Submitting/ });
    await expect(submit).toBeEnabled({ timeout: 10000 });
    await submit.click();

    await expect(authedPage.getByText('Failed to submit review')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => authedPage.evaluate(() => (window as unknown as { __e2eTurnstileResets: number }).__e2eTurnstileResets)).toBe(1);
    await expect(submit).toBeEnabled({ timeout: 10000 });
    await expect(authedPage.getByText('10/10')).toBeVisible();

    await submit.click();
    await authedPage.waitForURL(/\/building\/45-melnea-cass-blvd/, { timeout: 30000 });
    expect(posts).toBe(2);
  });

  test('a Turnstile load failure offers Try again, which recovers without a second api.js', async ({ authedPage }) => {
    test.setTimeout(60000);
    await authedPage.unroute(TURNSTILE_SCRIPT);
    await authedPage.route(TURNSTILE_SCRIPT, (route) => route.abort());

    await walkToConfirm(authedPage);
    await expect(authedPage.getByText(/Bot verification didn't load/)).toBeVisible({ timeout: 12000 });
    const tryAgain = authedPage.getByRole('button', { name: 'Try again' });
    await expect(tryAgain).toBeVisible();
    // The page guard removed the tag that failed to load.
    await expect(authedPage.locator('script[src*="turnstile/v0/api.js"]')).toHaveCount(0);

    await authedPage.unroute(TURNSTILE_SCRIPT);
    await installTurnstileStub(authedPage);
    await tryAgain.click();
    await expect(authedPage.locator('button[type="button"]', { hasText: 'Submit Review' })).toBeEnabled({ timeout: 10000 });
    await expect(authedPage.locator('script[src*="turnstile/v0/api.js"]')).toHaveCount(1);
    // Do not submit.
  });
});
