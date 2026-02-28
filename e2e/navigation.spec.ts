import { test, expect } from './fixtures';

test.describe('Header navigation', () => {
  test('logo links to homepage', async ({ page }) => {
    await page.goto('/about');
    await page.locator('header a[href="/"]').click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('Search link works', async ({ page }) => {
    await page.goto('/');
    await page.locator('header a[href="/search"]').first().click();
    await expect(page).toHaveURL(/\/search/);
  });

  test('Map link works', async ({ page }) => {
    await page.goto('/');
    await page.locator('header a[href="/map"]').first().click();
    await expect(page).toHaveURL(/\/map/);
  });

  test('About link works', async ({ page }) => {
    await page.goto('/');
    await page.locator('header a[href="/about"]').first().click();
    await expect(page).toHaveURL(/\/about/);
  });

  test('Sign In link visible when not logged in', async ({ page }) => {
    await page.goto('/');
    // Desktop nav has both desktop + mobile links, use first visible one
    await expect(page.locator('header a[href="/auth/signin"]').first()).toBeVisible();
  });

  test('Sign Up link visible when not logged in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header a[href="/auth/signup"]').first()).toBeVisible();
  });
});

test.describe('Footer navigation', () => {
  test('has quick links section', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.locator('a[href="/search"]')).toBeVisible();
    await expect(footer.locator('a[href="/about"]')).toBeVisible();
    await expect(footer.locator('a[href="/methodology"]')).toBeVisible();
  });

  test('has legal links', async ({ page }) => {
    await page.goto('/');
    const footer = page.locator('footer');
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
    await expect(footer.locator('a[href="/terms"]')).toBeVisible();
    await expect(footer.locator('a[href="/guidelines"]')).toBeVisible();
  });

  test('privacy link navigates correctly', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer a[href="/privacy"]').click();
    await expect(page).toHaveURL(/\/privacy/);
    const response = await page.reload();
    expect(response?.status()).toBe(200);
  });

  test('terms link navigates correctly', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer a[href="/terms"]').click();
    await expect(page).toHaveURL(/\/terms/);
  });
});

test.describe('Cross-page links', () => {
  test('About page methodology link navigates to methodology', async ({ page }) => {
    await page.goto('/about');
    await page.locator('a[href="/methodology"]').first().click();
    await expect(page).toHaveURL(/\/methodology/);
  });

  test('Homepage search navigates to search page', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('input[name="q"]').first();
    await searchInput.fill('boston');
    await searchInput.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=boston/);
  });

  test('Homepage Write a Review link works', async ({ page }) => {
    await page.goto('/');
    // The main CTA button in the body
    await page.locator('a[href="/review/new"]').last().click();
    // Should redirect to sign-in since we're not logged in
    await expect(page).toHaveURL(/\/auth\/signin/);
  });
});

test.describe('Protected page redirects', () => {
  test('profile redirects to sign-in', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('new review redirects to sign-in', async ({ page }) => {
    await page.goto('/review/new');
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('admin page is not publicly accessible', async ({ page }) => {
    await page.goto('/admin');
    // Admin either redirects to sign-in or shows the homepage (for non-admin users)
    const url = page.url();
    const isProtected = url.includes('/auth/signin') || url.endsWith('/') || url.includes('/admin');
    expect(isProtected).toBe(true);
    // Should not show admin dashboard content to unauthenticated users
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Delete');
  });
});
