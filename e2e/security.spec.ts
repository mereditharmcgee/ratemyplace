import { test, expect } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8788';

function clearRateLimits() {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM rate_limits"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

// Remove any disputes created by previous security test runs for the reserved review IDs.
// This makes injection/XSS tests re-runnable without a full db:setup.
function clearSecurityTestDisputes() {
  const reviewIds = ['review-030', 'review-040', 'review-060', 'review-070'];
  const idList = reviewIds.map((id) => `'${id}'`).join(', ');
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM disputes WHERE review_id IN (${idList})"`,
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

// Dispute payload helper — each test uses a different reviewId to avoid UNIQUE constraint.
// URL uses the /review/edit/{id} pattern which extractReviewIdFromUrl accepts.
function makeDisputePayload(reviewId: string, explanation: string) {
  return {
    reviewUrl: `${BASE_URL}/review/edit/${reviewId}`,
    landlordName: 'Test Landlord',
    landlordEmail: `sec-test-${reviewId}@test.local`,
    landlordPhone: '555-0000',
    disputeReasons: ['inaccurate_info'],
    disputeExplanation: explanation,
  };
}

// Expand the dispute card matching a given landlord email and return whether it was found
async function expandDisputeByEmail(adminPage: import('@playwright/test').Page, email: string): Promise<boolean> {
  const allCards = adminPage.locator('.bg-white.rounded-xl');
  const count = await allCards.count();
  for (let i = 0; i < count; i++) {
    const card = allCards.nth(i);
    await card.click();
    await adminPage.waitForTimeout(400);
    const emailVisible = await adminPage.locator(`text=${email}`).isVisible().catch(() => false);
    if (emailVisible) {
      return true;
    }
    // Collapse this card before trying the next
    await card.click();
    await adminPage.waitForTimeout(200);
  }
  return false;
}

test.describe('Auth Bypass (SEC-04)', () => {
  test('GET /api/reviews/user returns 401 without auth', async ({ request }) => {
    const response = await request.get('/api/reviews/user');
    expect(response.status()).toBe(401);
  });

  test('POST /api/reviews rejects unauthenticated request', async ({ request }) => {
    const response = await request.post('/api/reviews', {
      multipart: { building_id: 'building-01' },
      headers: { Origin: BASE_URL },
    });
    expect(response.status()).toBe(401);
  });

  test('POST /api/verification/upload rejects unauthenticated request', async ({ request }) => {
    const response = await request.post('/api/verification/upload', {
      multipart: { review_id: 'test' },
      headers: { Origin: BASE_URL },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('Privilege Escalation (SEC-05)', () => {
  test('GET /api/admin/reviews returns 403 for non-admin user', async ({ authedPage }) => {
    const response = await authedPage.request.get('/api/admin/reviews');
    expect(response.status()).toBe(403);
  });

  test('GET /api/admin/users returns 403 for non-admin user', async ({ authedPage }) => {
    const response = await authedPage.request.get('/api/admin/users');
    expect(response.status()).toBe(403);
  });

  test('GET /api/admin/buildings returns 403 for non-admin user', async ({ authedPage }) => {
    const response = await authedPage.request.get('/api/admin/buildings');
    expect(response.status()).toBe(403);
  });

  test('GET /api/admin/audit returns 403 for non-admin user', async ({ authedPage }) => {
    const response = await authedPage.request.get('/api/admin/audit');
    expect(response.status()).toBe(403);
  });

  test('PATCH /api/admin/reviews/review-001 returns 403 for non-admin user', async ({ authedPage }) => {
    const response = await authedPage.request.patch('/api/admin/reviews/review-001', {
      data: { status: 'approved' },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('Rate Limiting (SEC-06)', () => {
  // Wrangler Pages dev enforces CSRF: form POST requests require matching Origin header.
  // Include Origin: http://localhost:8788 so requests reach the rate limit handler.
  const ORIGIN = BASE_URL;

  test('signin returns 429 after 5 rapid attempts', async ({ request }) => {
    test.setTimeout(60000);
    clearRateLimits();
    const email = `ratelimit-signin-${Date.now()}@fake.local`;
    // Use a password >= 6 chars so it passes input validation and reaches the rate limit handler
    const wrongPassword = 'wrongpassword';
    for (let i = 0; i < 5; i++) {
      await request.post('/api/auth/signin', {
        form: { email, password: wrongPassword },
        headers: { Origin: ORIGIN },
      });
    }
    const blocked = await request.post('/api/auth/signin', {
      form: { email, password: wrongPassword },
      headers: { Origin: ORIGIN },
    });
    expect(blocked.status()).toBe(429);
  });

  test('signup returns 429 after 3 rapid attempts', async ({ request }) => {
    test.setTimeout(60000);
    clearRateLimits();
    const ts = Date.now();
    for (let i = 0; i < 3; i++) {
      await request.post('/api/auth/signup', {
        form: {
          email: `ratelimit-signup-${i}-${ts}@fake.local`,
          password: 'TestPassword123!',
          confirmPassword: 'TestPassword123!',
        },
        headers: { Origin: ORIGIN },
      });
    }
    const blocked = await request.post('/api/auth/signup', {
      form: {
        email: `ratelimit-signup-3-${ts}@fake.local`,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
      },
      headers: { Origin: ORIGIN },
    });
    expect(blocked.status()).toBe(429);
  });
});

test.describe('SQL Injection (SEC-07)', () => {
  test.beforeEach(() => {
    // Clear rate limits and any leftover security test disputes so tests are re-runnable
    clearRateLimits();
    clearSecurityTestDisputes();
  });

  test("SQL probe ' OR '1'='1 in dispute explanation is stored as literal text", async ({ request, adminPage }) => {
    test.setTimeout(60000);
    const injection = "' OR '1'='1; DROP TABLE users; --";
    const response = await request.post('/api/disputes', {
      data: makeDisputePayload('review-030', injection),
    });
    // 201 = stored successfully, not a 500 DB error
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    // Navigate to admin disputes page with admin session
    await adminPage.goto('/admin/disputes');
    await adminPage.waitForLoadState('networkidle');

    // Expand the dispute card matching this test's landlord email
    const found = await expandDisputeByEmail(adminPage, 'sec-test-review-030@test.local');
    expect(found).toBe(true);

    // The SQL probe was sanitized (no HTML tags to strip) and stored verbatim.
    // Verify the literal injection text appears as visible text on the page.
    await expect(adminPage.locator("text=OR '1'='1")).toBeVisible({ timeout: 5000 });
  });

  test("Bobby Tables injection Robert'); DROP TABLE reviews; is stored safely", async ({ request, adminPage }) => {
    test.setTimeout(60000);
    const injection = "Robert'); DROP TABLE reviews;--";
    const response = await request.post('/api/disputes', {
      data: makeDisputePayload('review-040', injection),
    });
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    await adminPage.goto('/admin/disputes');
    await adminPage.waitForLoadState('networkidle');

    const found = await expandDisputeByEmail(adminPage, 'sec-test-review-040@test.local');
    expect(found).toBe(true);

    // Literal injection text appears as text content (DB still intact, no table was dropped)
    await expect(adminPage.locator('text=DROP TABLE reviews')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('XSS Prevention (SEC-08)', () => {
  test.beforeEach(() => {
    clearRateLimits();
    clearSecurityTestDisputes();
  });

  test('script tag in dispute explanation is sanitized and does not execute', async ({ request, adminPage }) => {
    test.setTimeout(60000);
    const xssPayload = "<script>window.__xss_sec08_script=true;alert('XSS')</script>";
    const response = await request.post('/api/disputes', {
      data: makeDisputePayload('review-060', xssPayload),
    });
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    await adminPage.goto('/admin/disputes');
    await adminPage.waitForLoadState('networkidle');

    // Expand the card — triggers React rendering of stored dispute_explanation
    const found = await expandDisputeByEmail(adminPage, 'sec-test-review-060@test.local');
    expect(found).toBe(true);

    // sanitizeText strips <script> tags before storage, so the script never reaches the DOM.
    // Verify the XSS marker was never set.
    const xssFired = await adminPage.evaluate(() => (window as any).__xss_sec08_script);
    expect(xssFired).toBeUndefined();
  });

  test('img onerror XSS payload is neutralized before storage and does not execute', async ({ request, adminPage }) => {
    test.setTimeout(60000);
    const xssPayload = '<img src=x onerror="window.__xss_sec08_img=true;alert(\'XSS\')">';
    const response = await request.post('/api/disputes', {
      data: makeDisputePayload('review-070', xssPayload),
    });
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);

    await adminPage.goto('/admin/disputes');
    await adminPage.waitForLoadState('networkidle');

    // Expand the card to trigger rendering of the stored content
    const found = await expandDisputeByEmail(adminPage, 'sec-test-review-070@test.local');
    expect(found).toBe(true);

    // sanitizeText strips the entire <img ...> tag before storage.
    // The onerror handler is never inserted into the DOM and never executes.
    const xssFired = await adminPage.evaluate(() => (window as any).__xss_sec08_img);
    expect(xssFired).toBeUndefined();
  });
});
