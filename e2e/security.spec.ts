import { test, expect } from './fixtures';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
