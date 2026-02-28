import { test, expect } from './fixtures';

test.describe('Homepage', () => {
  test('loads with hero section and search', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    // Search form should be present
    await expect(page.locator('form input[name="q"]').first()).toBeVisible();
  });

  test('has How It Works section', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=How It Works')).toBeVisible();
    await expect(page.locator('text=Evidence-Based Scoring')).toBeVisible();
  });
});

test.describe('Search page', () => {
  test('loads with default listings', async ({ page }) => {
    await page.goto('/search');
    await expect(page.locator('input[name="q"]').first()).toBeVisible();
    // Should show some content — reviewed buildings/landlords section headers
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('search form submits and shows results', async ({ page }) => {
    await page.goto('/search');
    const searchInput = page.locator('input[name="q"]');
    await searchInput.fill('test');
    await searchInput.press('Enter');
    // Should navigate to search results page
    await expect(page).toHaveURL(/\/search\?q=test/);
  });
});

test.describe('About page', () => {
  test('loads with scoring transparency section', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('text=Scoring Transparency')).toBeVisible();
  });

  test('has methodology link', async ({ page }) => {
    await page.goto('/about');
    const methodologyLink = page.locator('a[href="/methodology"]').first();
    await expect(methodologyLink).toBeVisible();
  });

  test('has privacy protection section', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('text=Privacy Protection')).toBeVisible();
  });
});

test.describe('Methodology page', () => {
  test('loads with scoring methodology content', async ({ page }) => {
    await page.goto('/methodology');
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('Static pages load without errors', () => {
  const pages = [
    { path: '/contact', heading: 'Contact' },
    { path: '/guidelines', heading: 'Guidelines' },
    { path: '/privacy', heading: 'Privacy' },
    { path: '/terms', heading: 'Terms' },
  ];

  for (const { path, heading } of pages) {
    test(`${path} loads successfully`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      // Verify the page has actual content (not an error page)
      const bodyText = await page.textContent('body');
      expect(bodyText).not.toContain('Internal Server Error');
    });
  }
});

test.describe('Auth pages', () => {
  test('sign-in page has email and password fields', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('sign-up page has email, password, and confirm fields', async ({ page }) => {
    await page.goto('/auth/signup');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('sign-in page has link to sign up', async ({ page }) => {
    await page.goto('/auth/signin');
    // Use the main content area link (not the header nav)
    await expect(page.locator('main a[href="/auth/signup"]').first()).toBeVisible();
  });

  test('sign-up page has link to sign in', async ({ page }) => {
    await page.goto('/auth/signup');
    // Use the main content area link (not the header nav)
    await expect(page.locator('main a[href="/auth/signin"]').first()).toBeVisible();
  });
});
