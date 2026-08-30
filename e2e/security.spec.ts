import { test, expect, clearRateLimits } from './fixtures';
import {
  executeLocalD1,
  resolveLocalE2EBaseURL,
  TURNSTILE_TEST_TOKEN,
} from './test-harness';

const BASE_URL = resolveLocalE2EBaseURL();

// Remove any disputes created by previous security test runs for the reserved review IDs.
// This makes injection/XSS tests re-runnable without a full db:setup.
function clearSecurityTestDisputes() {
  const reviewIds = ['review-030', 'review-040', 'review-060', 'review-070'];
  const idList = reviewIds.map((id) => `'${id}'`).join(', ');
  executeLocalD1(`DELETE FROM disputes WHERE review_id IN (${idList})`);
}

// Dispute payload helper — each test uses a different reviewId to avoid UNIQUE constraint.
// URL uses the /review/edit/{id} pattern which extractReviewIdFromUrl accepts.
function makeDisputePayload(reviewId: string, explanation: string) {
  return {
    reviewUrl: `${BASE_URL}/review/edit/${reviewId}`,
    landlordName: 'Test Landlord',
    landlordEmail: `sec-test-${reviewId}@test.local`,
    landlordPhone: '555-0000',
    disputeReasons: ['Factually incorrect information'],
    disputeExplanation: explanation,
    turnstileToken: TURNSTILE_TEST_TOKEN,
  };
}

// Expand the dispute card matching a given landlord email and return whether it was found
async function expandDisputeByEmail(adminPage: import('@playwright/test').Page, email: string): Promise<boolean> {
  const disputeHeaders = adminPage.locator('.cursor-pointer');
  const count = await disputeHeaders.count();
  for (let i = 0; i < count; i++) {
    const header = disputeHeaders.nth(i);
    await header.click();
    await adminPage.waitForTimeout(400);
    const emailVisible = await adminPage.locator(`text=${email}`).isVisible().catch(() => false);
    if (emailVisible) {
      return true;
    }
    // Collapse this card before trying the next
    await header.click();
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
        form: { email, password: wrongPassword, 'cf-turnstile-response': TURNSTILE_TEST_TOKEN },
        headers: { Origin: ORIGIN },
      });
    }
    const blocked = await request.post('/api/auth/signin', {
      form: { email, password: wrongPassword, 'cf-turnstile-response': TURNSTILE_TEST_TOKEN },
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
          'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
        },
        headers: { Origin: ORIGIN },
      });
    }
    const blocked = await request.post('/api/auth/signup', {
      form: {
        email: `ratelimit-signup-3-${ts}@fake.local`,
        password: 'TestPassword123!',
        confirmPassword: 'TestPassword123!',
        'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 17: Public Endpoint Security
// Reserved review IDs for this block: review-080, review-081, review-082
// (Do NOT reuse these IDs in other test blocks — see clearSecurityTestDisputes
//  for the existing review-030/040/060/070 reservations.)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 17: Public Endpoint Security', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(() => {
    clearRateLimits();
  });

  // ─── SEC-04: bug-reports rate limit ───
  test('SEC-04: 6th /api/bug-reports POST in 1hr returns 429 with Retry-After', async ({ request }) => {
    test.setTimeout(60000);
    // 5 successful posts (rate limit allows 5/hr)
    for (let i = 0; i < 5; i++) {
      const res = await request.post('/api/bug-reports', {
        multipart: {
          'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
          description: `bug report number ${i} with enough characters to pass length check`,
          category: 'bug',
        },
        headers: { Origin: BASE_URL },
      });
      // Note: status may be 200 or 400 (Turnstile fails in test env), but rate limit MUST count attempts
      expect([200, 400]).toContain(res.status());
    }
    // 6th attempt — must be 429
    const sixth = await request.post('/api/bug-reports', {
      multipart: {
        'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
        description: 'sixth attempt should be rate-limited',
        category: 'bug',
      },
      headers: { Origin: BASE_URL },
    });
    expect(sixth.status()).toBe(429);
    expect(sixth.headers()['retry-after']).toBeDefined();
    expect(Number(sixth.headers()['retry-after'])).toBeGreaterThan(0);
  });

  // ─── SEC-05: search/results rate limit ───
  test('SEC-05: 61st /api/search/results GET in 1min returns 429 with Retry-After', async ({ request }) => {
    test.setTimeout(120000);
    for (let i = 0; i < 60; i++) {
      const res = await request.get('/api/search/results?q=test');
      expect([200, 500]).toContain(res.status());
    }
    const overflow = await request.get('/api/search/results?q=test');
    expect(overflow.status()).toBe(429);
    expect(overflow.headers()['retry-after']).toBeDefined();
  });

  // ─── SEC-05: search/autocomplete rate limit ───
  test('SEC-05: 121st /api/search/autocomplete GET in 1min returns 429', async ({ request }) => {
    test.setTimeout(180000);
    for (let i = 0; i < 120; i++) {
      const res = await request.get('/api/search/autocomplete?q=ab');
      expect([200, 500]).toContain(res.status());
    }
    const overflow = await request.get('/api/search/autocomplete?q=ab');
    expect(overflow.status()).toBe(429);
    expect(overflow.headers()['retry-after']).toBeDefined();
  });

  // ─── VAL-01 + content-type guard: disputes ───
  test('VAL-01: POST /api/disputes with text/plain returns 415', async ({ request }) => {
    const res = await request.post('/api/disputes', {
      data: 'not json',
      headers: { 'Content-Type': 'text/plain', Origin: BASE_URL },
    });
    expect(res.status()).toBe(415);
  });

  // ─── VAL-01: dispute landlordEmail format ───
  test('VAL-01: POST /api/disputes with landlordEmail "notanemail" returns 400 with field error', async ({ request }) => {
    const res = await request.post('/api/disputes', {
      data: makeDisputePayload('review-080', 'a valid explanation'),
      // override email to bad value
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    // Re-issue with explicit bad email (makeDisputePayload generates valid email)
    const badRes = await request.post('/api/disputes', {
      data: { ...makeDisputePayload('review-081', 'a valid explanation'), landlordEmail: 'notanemail' },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(badRes.status()).toBe(400);
    const body = await badRes.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.some((d: any) => d.field === 'landlordEmail')).toBe(true);
  });

  // ─── VAL-01: dispute explanation length ───
  test('VAL-01: POST /api/disputes with disputeExplanation > 5000 chars returns 400', async ({ request }) => {
    const res = await request.post('/api/disputes', {
      data: makeDisputePayload('review-082', 'a'.repeat(5001)),
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.details.some((d: any) => d.field === 'disputeExplanation')).toBe(true);
  });

  // ─── VAL-02 + content-type guard: bug-reports ───
  test('VAL-02: POST /api/bug-reports with application/json returns 415', async ({ request }) => {
    const res = await request.post('/api/bug-reports', {
      data: { description: 'hello world long enough', category: 'bug' },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(res.status()).toBe(415);
  });

  // ─── VAL-03 + content-type guard: contact ───
  test('VAL-03: POST /api/contact with application/json returns 415', async ({ request }) => {
    const res = await request.post('/api/contact', {
      data: { name: 'X', email: 'x@y.z', message: 'hello world long enough' },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(res.status()).toBe(415);
  });

  // ─── VAL-04: search query length cap ───
  test('VAL-04: GET /api/search/results?q=<201 chars> returns 400', async ({ request }) => {
    const longQuery = 'a'.repeat(201);
    const res = await request.get(`/api/search/results?q=${encodeURIComponent(longQuery)}`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.some((d: any) => d.field === 'q')).toBe(true);
  });

  // ─── VAL-04: SQL LIKE wildcard escape (literal % search) ───
  test('VAL-04: GET /api/search/autocomplete?q=5%25 escapes % literal (does not error)', async ({ request }) => {
    // Search for literal '5%' (URL-encoded as 5%25). Should return 200 with empty or matching results.
    const res = await request.get('/api/search/autocomplete?q=5%25');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 21: Rate Limit Headers (SEC-07, SEC-08)
// Proves that rate-limit headers land on the wire for both 429 and 200 paths.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Phase 21: Rate Limit Headers', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(() => {
    clearRateLimits();
  });

  // ─── Test A: POST /api/contact 4th hit → 429 has Retry-After + X-RateLimit-* ───
  test('SEC-07/SEC-08: 4th POST /api/contact returns 429 with Retry-After, x-ratelimit-limit=3, x-ratelimit-remaining=0', async ({ request }) => {
    test.setTimeout(60000);
    // Rate limit is 3/hr — rate-limit check runs BEFORE Turnstile, so 429 fires regardless of token.
    for (let i = 0; i < 3; i++) {
      await request.post('/api/contact', {
        multipart: {
          name: 'Test User',
          email: 'test@example.com',
          category: 'general',
          message: 'Phase 21 header test message',
          'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
        },
        headers: { Origin: BASE_URL },
      });
    }
    // 4th attempt — must be 429 (rate limit exhausted)
    const res = await request.post('/api/contact', {
      multipart: {
        name: 'Test User',
        email: 'test@example.com',
        category: 'general',
        message: 'Phase 21 header test message fourth',
        'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
      },
      headers: { Origin: BASE_URL },
    });
    expect(res.status()).toBe(429);
    expect(res.headers()['retry-after']).toBeDefined();
    expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
    expect(res.headers()['x-ratelimit-limit']).toBe('3');
    expect(res.headers()['x-ratelimit-remaining']).toBe('0');
  });

  // ─── Test B: GET /api/search/results → 200 has X-RateLimit-* but no Retry-After ───
  test('SEC-08: GET /api/search/results returns x-ratelimit-limit=60 and x-ratelimit-remaining on success', async ({ request }) => {
    const res = await request.get('/api/search/results?q=test');
    // Accept 200 (success) or 400 (validation rejects query) — assertion is on headers
    expect([200, 400]).toContain(res.status());
    expect(res.headers()['x-ratelimit-limit']).toBe('60');
    expect(res.headers()['x-ratelimit-remaining']).toBeDefined();
    expect(Number(res.headers()['x-ratelimit-remaining'])).toBeLessThan(60);
    // Success path must NOT have Retry-After
    expect(res.headers()['retry-after']).toBeUndefined();
  });

  // ─── Test C: POST /api/bug-reports (under limit) → 200 has X-RateLimit-* but no Retry-After ───
  test('SEC-08: POST /api/bug-reports under limit returns x-ratelimit-limit=5 and x-ratelimit-remaining on success', async ({ request }) => {
    const res = await request.post('/api/bug-reports', {
      multipart: {
        'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
        description: 'Phase 21 header test bug report with enough characters to pass length check',
        category: 'bug',
      },
      headers: { Origin: BASE_URL },
    });
    // Accept 200 (success) or 400 (Turnstile fails in test env) — assertion is on headers
    expect([200, 400]).toContain(res.status());
    expect(res.headers()['x-ratelimit-limit']).toBe('5');
    expect(res.headers()['x-ratelimit-remaining']).toBeDefined();
    // Success/validation-fail path must NOT have Retry-After
    expect(res.headers()['retry-after']).toBeUndefined();
  });
});
