/**
 * Smoke Test Script for RateMyPlace Boston
 *
 * Hits every public page and checks for successful responses.
 * Run: npm run smoke
 * Run against a specific URL: npm run smoke -- https://your-preview-url.pages.dev
 */

const BASE_URL = process.argv[2] || 'https://b3b57132.ratemyplace-64y.pages.dev';

interface TestResult {
  path: string;
  status: number;
  ok: boolean;
  error?: string;
  timeMs: number;
}

// Public pages that should return 200
const publicPages = [
  { path: '/', expect: 'Know Before You Sign' },
  { path: '/about', expect: 'About' },
  { path: '/contact', expect: 'Contact' },
  { path: '/guidelines', expect: 'Guidelines' },
  { path: '/map', expect: null },
  { path: '/methodology', expect: 'Methodology' },
  { path: '/privacy', expect: 'Privacy' },
  { path: '/search', expect: 'Search' },
  { path: '/terms', expect: 'Terms' },
  { path: '/auth/signin', expect: 'Sign In' },
  { path: '/auth/signup', expect: 'Sign Up' },
];

// Protected pages that should redirect (302/303) to sign-in
const protectedPages = [
  '/profile',
  '/review/new',
];

// Admin pages redirect via component layout (returns 200 then client redirects)
// We test these separately with a follow-redirect check
const adminPages = [
  '/admin',
];

async function testPage(path: string, expectedContent: string | null): Promise<TestResult> {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();

  try {
    const response = await fetch(url, { redirect: 'follow' });
    const timeMs = Date.now() - start;
    const body = await response.text();

    // Check for server errors in the response body
    const hasError = body.includes('Internal Server Error') ||
      body.includes('Application error') ||
      body.includes('500 Error');

    if (hasError) {
      return { path, status: response.status, ok: false, error: 'Page contains error content', timeMs };
    }

    // Check for expected content
    if (expectedContent && !body.includes(expectedContent)) {
      return { path, status: response.status, ok: false, error: `Missing expected content: "${expectedContent}"`, timeMs };
    }

    return { path, status: response.status, ok: response.status === 200, timeMs };
  } catch (err) {
    return { path, status: 0, ok: false, error: `Fetch failed: ${(err as Error).message}`, timeMs: Date.now() - start };
  }
}

async function testProtectedPage(path: string): Promise<TestResult> {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();

  try {
    // Don't follow redirects — we want to see the 302/303
    const response = await fetch(url, { redirect: 'manual' });
    const timeMs = Date.now() - start;
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location') || '';
    const redirectsToAuth = location.includes('/auth/signin') || location.includes('/auth/') || location === '/';

    if (isRedirect && redirectsToAuth) {
      return { path, status: response.status, ok: true, timeMs };
    }

    // If it returned 200, it might be an SSR page that handles auth inline
    // or the admin page which redirects via component layout
    if (response.status === 200) {
      const body = await response.text();
      if (body.includes('Sign In') || body.includes('sign-in') || body.includes('signin')) {
        return { path, status: response.status, ok: true, timeMs };
      }
    }

    return {
      path,
      status: response.status,
      ok: false,
      error: `Expected redirect to /auth/signin, got ${response.status} → ${location || '(no redirect)'}`,
      timeMs,
    };
  } catch (err) {
    return { path, status: 0, ok: false, error: `Fetch failed: ${(err as Error).message}`, timeMs: Date.now() - start };
  }
}

async function run() {
  console.log(`\n  Smoke testing: ${BASE_URL}\n`);

  const results: TestResult[] = [];

  // Test public pages
  console.log('  Public pages:');
  for (const page of publicPages) {
    const result = await testPage(page.path, page.expect);
    results.push(result);
    const icon = result.ok ? '\x1b[32m  ✓\x1b[0m' : '\x1b[31m  ✗\x1b[0m';
    const detail = result.ok ? `${result.status} (${result.timeMs}ms)` : `${result.status} — ${result.error}`;
    console.log(`${icon} ${result.path} — ${detail}`);
  }

  // Test protected pages
  console.log('\n  Protected pages (expect redirect):');
  for (const path of protectedPages) {
    const result = await testProtectedPage(path);
    results.push(result);
    const icon = result.ok ? '\x1b[32m  ✓\x1b[0m' : '\x1b[31m  ✗\x1b[0m';
    const detail = result.ok ? `${result.status} redirect (${result.timeMs}ms)` : `${result.status} — ${result.error}`;
    console.log(`${icon} ${result.path} — ${detail}`);
  }

  // Test admin pages (just verify no server error — auth is handled at component level)
  console.log('\n  Admin pages (expect no server error):');
  for (const path of adminPages) {
    const result = await testPage(path, null);
    results.push(result);
    const icon = result.ok ? '\x1b[32m  ✓\x1b[0m' : '\x1b[31m  ✗\x1b[0m';
    const detail = result.ok ? `${result.status} (${result.timeMs}ms)` : `${result.status} — ${result.error}`;
    console.log(`${icon} ${result.path} — ${detail}`);
  }

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);

  console.log(`\n  ─────────────────────────────────`);
  if (failed === 0) {
    console.log(`\x1b[32m  ✓ All ${passed} pages passed (${totalTime}ms)\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m  ✗ ${failed} failed\x1b[0m, ${passed} passed (${totalTime}ms)\n`);
    process.exit(1);
  }
}

run();
