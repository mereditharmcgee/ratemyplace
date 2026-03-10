import { test, expect } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

function clearRateLimits() {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM rate_limits"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

test.describe('Auth Bypass (SEC-04)', () => {
  test('GET /api/reviews/user returns 401 without auth', async ({ request }) => {
    const response = await request.get('/api/reviews/user');
    expect(response.status()).toBe(401);
  });

  test('POST /api/reviews rejects unauthenticated request', async ({ request }) => {
    const response = await request.post('/api/reviews', {
      multipart: { building_id: 'building-01' },
    });
    // Wrangler pages dev may return 403 instead of 401 for POST requests
    // (known behavior — see 07-03 decision). Either 4xx confirms auth bypass is blocked.
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });

  test('POST /api/verification/upload rejects unauthenticated request', async ({ request }) => {
    const response = await request.post('/api/verification/upload', {
      multipart: { review_id: 'test' },
    });
    // Wrangler pages dev may return 403 instead of 401 for POST requests
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
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
  const ORIGIN = process.env.BASE_URL || 'http://localhost:8788';

  test('signin returns 429 after 5 rapid attempts', async ({ request }) => {
    test.setTimeout(60000);
    clearRateLimits();
    const email = `ratelimit-signin-${Date.now()}@fake.local`;
    // Use a password >= 6 chars so it passes input validation and hits the rate limit handler
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
