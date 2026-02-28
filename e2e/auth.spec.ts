import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root for wrangler CLI calls (e2e/ is one level below root)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Seed user credentials (created in Phase 5)
const SEED_EMAIL = 'user@test.ratemyplace.local';
const SEED_PASSWORD = 'TestPassword123!';

test.describe('Signup', () => {
  test('user can sign up with email and password', async ({ page }) => {
    // Generate a unique email using Date.now() to avoid collisions across runs
    const uniqueEmail = `signup-${Date.now()}@test.local`;

    await page.goto('/auth/signup');
    await page.fill('input[name="email"]', uniqueEmail);
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.fill('input[name="confirmPassword"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // On success, JS does window.location.href = '/'
    await page.waitForURL('/');

    // Signed-in state is confirmed by the presence of the signout form
    await expect(page.locator('form[action="/api/auth/signout"]')).toBeVisible();
  });

  test('duplicate email shows error', async ({ page }) => {
    // Use seed user email which already exists in the database
    await page.goto('/auth/signup');
    await page.fill('input[name="email"]', SEED_EMAIL);
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.fill('input[name="confirmPassword"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // Should NOT redirect — error message should appear
    await expect(page.locator('#error-message')).toBeVisible();
  });
});

test.describe('Signin and Signout', () => {
  test('user can sign in with valid credentials', async ({ page }) => {
    await page.goto('/auth/signin');
    await page.fill('input[name="email"]', SEED_EMAIL);
    await page.fill('input[name="password"]', SEED_PASSWORD);
    await page.click('button[type="submit"]');

    // On success, JS does window.location.href = '/'
    await page.waitForURL('/');

    // Signed-in state confirmed by signout form
    await expect(page.locator('form[action="/api/auth/signout"]')).toBeVisible();
  });

  test('user can sign out', async ({ authedPage }) => {
    await authedPage.goto('/');

    // Click the signout button in the form (use .first() for desktop nav)
    await authedPage
      .locator('form[action="/api/auth/signout"] button[type="submit"]')
      .first()
      .click();

    await authedPage.waitForURL('/');

    // After signout, the Sign In link should be visible and signout form gone
    await expect(authedPage.locator('header a[href="/auth/signin"]')).toBeVisible();
    await expect(authedPage.locator('form[action="/api/auth/signout"]')).not.toBeVisible();
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/auth/signin');
    await page.fill('input[name="email"]', SEED_EMAIL);
    await page.fill('input[name="password"]', 'WrongPassword999!');
    await page.click('button[type="submit"]');

    // Should remain on signin page with error message
    await expect(page.locator('#error-message')).toBeVisible();
    expect(page.url()).toContain('/auth/signin');
  });
});

test.describe('Password Reset', () => {
  test('user can request password reset', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    await page.fill('input[name="email"]', SEED_EMAIL);
    await page.click('button[type="submit"]');

    // API always returns 200 (prevents user enumeration) — success message appears
    await expect(page.locator('#success-message')).toBeVisible();
    const successText = await page.locator('#success-message').textContent();
    expect(successText).toBeTruthy();
  });

  test('user can complete full password reset flow', async ({ page }) => {
    // RECOMMENDED approach: sign up a fresh user for this test to avoid
    // breaking the seed user credentials that other tests depend on.
    const resetEmail = `reset-${Date.now()}@test.local`;
    const originalPassword = 'TestPassword123!';
    const newPassword = 'NewTestPassword456!';

    // Step 0: Create a fresh test user to reset
    await page.goto('/auth/signup');
    await page.fill('input[name="email"]', resetEmail);
    await page.fill('input[name="password"]', originalPassword);
    await page.fill('input[name="confirmPassword"]', originalPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Step 1: Request password reset for this new user
    await page.goto('/auth/forgot-password');
    await page.fill('input[name="email"]', resetEmail);
    await page.click('button[type="submit"]');
    await expect(page.locator('#success-message')).toBeVisible();

    // Step 2: Read token from local D1 via wrangler CLI
    const wranglerCommand = `npx wrangler d1 execute ratemyplace-db --local --command "SELECT pr.token FROM password_reset_tokens pr JOIN users u ON pr.user_id = u.id WHERE u.email = '${resetEmail}' ORDER BY pr.expires_at DESC LIMIT 1"`;

    let token: string;
    try {
      const rawOutput = execSync(wranglerCommand, {
        cwd: PROJECT_ROOT,
        timeout: 30000,
        encoding: 'utf8',
      });

      // Wrangler outputs JSON. Try structured parse first, then regex fallback.
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawOutput);
        const results = (parsed as { results?: { token?: string }[] }[])[0]?.results;
        const tokenValue = results?.[0]?.token;
        if (!tokenValue) {
          throw new Error('Token not found in parsed output');
        }
        token = tokenValue;
      } catch {
        // Fallback: extract token from raw output using regex
        const match = rawOutput.match(/"token"\s*:\s*"([^"]+)"/);
        if (!match || !match[1]) {
          throw new Error(
            `Could not extract token from wrangler output. Raw output:\n${rawOutput}`
          );
        }
        token = match[1];
      }
    } catch (err) {
      throw new Error(
        `Failed to read password reset token from D1. ` +
          `Ensure local D1 is populated and wrangler is available. Error: ${String(err)}`
      );
    }

    // Step 3: Navigate to reset password page and set new password
    await page.goto(`/auth/reset-password?token=${token}`);
    await page.fill('input[name="password"]', newPassword);
    await page.fill('input[name="confirmPassword"]', newPassword);
    await page.click('button[type="submit"]');

    // Success container should become visible
    await expect(page.locator('#success-container')).toBeVisible();
    await expect(page.locator('#success-container')).toContainText('Password Reset Successfully');

    // Step 4: Sign in with the new password to verify it works
    await page.goto('/auth/signin');
    await page.fill('input[name="email"]', resetEmail);
    await page.fill('input[name="password"]', newPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Confirm signed-in state
    await expect(page.locator('form[action="/api/auth/signout"]')).toBeVisible();
  });

  test('invalid reset token shows error', async ({ page }) => {
    // Navigate with a clearly invalid token
    await page.goto('/auth/reset-password?token=invalid-token-12345');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.fill('input[name="confirmPassword"]', 'TestPassword123!');
    await page.click('button[type="submit"]');

    // Error should appear and success container should NOT be visible
    await expect(page.locator('#error-message')).toBeVisible();
    await expect(page.locator('#success-container')).not.toBeVisible();
  });
});
