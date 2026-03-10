# Phase 9: Security E2E - Research

**Researched:** 2026-03-09
**Domain:** Security testing (auth bypass, privilege escalation, injection, rate limiting)
**Confidence:** HIGH

## Summary

Phase 9 validates that existing security controls work correctly under adversarial conditions. The codebase already implements all the security mechanisms being tested: auth checks (401/403), rate limiting via D1 `rate_limits` table, parameterized SQL queries, `sanitizeText()` for input sanitization, and auto-escaping via Astro/React templating. This phase writes E2E tests that prove these controls hold.

All five requirements map cleanly to Playwright test scenarios using the existing fixtures (`authedPage` for regular user, `adminPage` for admin, unauthenticated `page` for no-auth). The test approach is API-level `request` calls for SEC-04/05/06 (HTTP status assertions) and browser-level rendering checks for SEC-07/08 (content safety).

**Primary recommendation:** Create a single `security.spec.ts` file with describe blocks for each security domain (auth bypass, privilege escalation, rate limiting, SQL injection, XSS). Use Playwright's `request` API for direct HTTP calls without browser overhead where possible.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-04 | Unauthenticated requests to protected API endpoints return 401 | All protected endpoints use `if (!context.locals.user)` guard returning 401. Test with bare `request.get`/`request.post` (no session cookie). |
| SEC-05 | Non-admin requests to admin API endpoints return 403 | All admin endpoints check `if (!context.locals.user.isAdmin)` returning 403. Test with `authedPage.request` (regular user session). |
| SEC-06 | Rate limiting returns 429 after threshold is exceeded | Rate limits: signin (5/15min), signup (3/hr), forgot-password (3/hr), resend-verification (3/hr), dispute (3/hr). Test by sending N+1 rapid requests. |
| SEC-07 | SQL injection probes in text input fields are safely handled | All queries use `.bind()` parameterized queries. Test by submitting reviews/disputes with SQL injection strings and verifying stored literal text. |
| SEC-08 | Stored user content is XSS-safe on render | Astro `{value}` and React JSX `{value}` auto-escape HTML. `sanitizeText()` strips HTML tags on input. Test by storing `<script>` payloads and verifying escaped output. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Playwright | (project version) | E2E test runner | Already configured in project with fixtures |
| Playwright `request` API | built-in | Direct HTTP calls | Bypass browser for API-level security tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| e2e/fixtures.ts | project | `authedPage`, `adminPage` fixtures | Regular user and admin session tests |

No new libraries needed. All testing uses existing Playwright infrastructure.

## Architecture Patterns

### Recommended Test Structure
```
e2e/
  security.spec.ts         # All security E2E tests (SEC-04 through SEC-08)
```

Single file is appropriate because all tests are security-domain and share similar setup patterns. Internal organization uses `test.describe` blocks.

### Pattern 1: Unauthenticated API Request (SEC-04)
**What:** Send requests without session cookie, assert 401
**When to use:** Testing auth bypass protection
**Example:**
```typescript
// Use bare request context (no storageState) for unauthenticated calls
test('protected endpoint returns 401 without auth', async ({ request }) => {
  const response = await request.get('/api/reviews/user');
  expect(response.status()).toBe(401);
});
```

### Pattern 2: Non-Admin API Request (SEC-05)
**What:** Send requests with regular user session, assert 403
**When to use:** Testing privilege escalation protection
**Example:**
```typescript
test('admin endpoint returns 403 for regular user', async ({ authedPage }) => {
  const response = await authedPage.request.get('/api/admin/reviews');
  expect(response.status()).toBe(403);
});
```

### Pattern 3: Rate Limit Exhaustion (SEC-06)
**What:** Send rapid requests exceeding threshold, assert 429
**When to use:** Testing rate limiting
**Example:**
```typescript
test('signin returns 429 after 5 rapid attempts', async ({ request }) => {
  const formData = new URLSearchParams({ email: 'fake@test.local', password: 'wrong' });
  for (let i = 0; i < 5; i++) {
    await request.post('/api/auth/signin', { form: { email: 'fake@test.local', password: 'wrong' } });
  }
  const blocked = await request.post('/api/auth/signin', { form: { email: 'fake@test.local', password: 'wrong' } });
  expect(blocked.status()).toBe(429);
});
```

### Pattern 4: SQL Injection Probe (SEC-07)
**What:** Submit malicious SQL strings via review/dispute forms, verify literal storage
**When to use:** Testing parameterized query safety
**Example:**
```typescript
// Submit review with SQL injection in comments field
// Then verify the literal text is stored and displayed without DB error
```

### Pattern 5: XSS Payload Render Check (SEC-08)
**What:** Store HTML/script content, verify it renders as escaped text
**When to use:** Testing output encoding
**Example:**
```typescript
// After submitting content with <script>alert('xss')</script>
// Navigate to the page and verify the text appears literally,
// not as executable markup
await expect(page.locator('text=<script>')).toBeVisible();
// Or check that no script executed
await expect(page.locator('text=alert')).toBeVisible();
```

### Anti-Patterns to Avoid
- **Do not test every admin endpoint individually for 401/403:** Pick a representative sample (3-4 endpoints covering GET/POST/PUT/DELETE) to keep tests fast. The pattern is identical across all endpoints.
- **Do not use real user credentials for rate limit tests:** Use fake emails/passwords to avoid locking out seed test users.
- **Do not forget to clear rate_limits table:** Rate limit state persists across tests with `workers: 1`. Either use unique IPs or clear the table between tests.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unauthenticated requests | Custom fetch without cookies | Playwright `request` fixture (no storageState) | Built-in, handles base URL |
| Admin session simulation | Manual cookie crafting | `authedPage.request` from fixtures | Already manages session state |
| Rate limit DB cleanup | Manual SQL in test | `db:fresh` before test suite | Seed scripts already handle this |

## Common Pitfalls

### Pitfall 1: Rate Limit State Pollution
**What goes wrong:** Rate limit tests exhaust limits, causing subsequent auth tests (in other spec files) to fail with 429
**Why it happens:** `rate_limits` table persists across all specs in a single `workers: 1` run
**How to avoid:** Use unique fake emails/IPs for rate limit tests that don't collide with seed user emails. Or run rate limit tests last. Or clear `rate_limits` table via direct D1 command after rate limit tests.
**Warning signs:** Auth tests that pass independently but fail when run after security tests

### Pitfall 2: Wrangler Local Dev Auth Behavior
**What goes wrong:** Admin page access control tests expect HTTP redirects but get 200 with empty body
**Why it happens:** Wrangler pages dev has a known `ResponseSentError` behavior where SSR pages return 200 instead of 302 when DB queries run before auth checks
**How to avoid:** For API endpoints (not pages), responses are reliable (401/403). Only SSR admin pages have this quirk. Stick to API endpoint testing for SEC-04/SEC-05.
**Warning signs:** Getting 200 status when expecting 401/403 on page routes (not API routes)

### Pitfall 3: Form vs JSON Request Bodies
**What goes wrong:** API returns 400 instead of expected auth error
**Why it happens:** Auth endpoints (signin, signup) expect `formData`, not JSON. Disputes endpoint expects JSON.
**How to avoid:** Match request content type to what the endpoint expects: `form:` for auth endpoints, `data:` (JSON) for dispute API.

### Pitfall 4: SQL Injection Test Requires Full Review Submission
**What goes wrong:** Test tries to inject via a simple text field but review API requires 27+ fields
**Why it happens:** Review submission has many required fields and complex validation
**How to avoid:** Use the dispute form for SQL injection testing (fewer required fields: reviewUrl, landlordName, landlordEmail, landlordPhone, disputeReasons, disputeExplanation). Or use the review comments field with a full form submission from the existing review test pattern.

### Pitfall 5: XSS Test Needs Content Visible on a Page
**What goes wrong:** Content is stored but never rendered in test
**Why it happens:** Reviews go to `pending` status and don't appear on the building page until approved
**How to avoid:** For review XSS: submit review, approve it via admin API, then check building page. For dispute XSS: submit dispute, check admin disputes page (which renders dispute_explanation).

### Pitfall 6: Rate Limit Test Timing
**What goes wrong:** Rate limit test is flaky, sometimes passes, sometimes fails
**Why it happens:** Rate limit uses timestamp-based windows; if there are existing entries from global.setup.ts signin, the count may already be partially consumed
**How to avoid:** Use a unique `endpoint` key path (different fake email) so rate limit entries don't collide with setup's signin attempts. Better: directly clear `rate_limits` table before the rate limit test block.

## Code Examples

### SEC-04: Auth Bypass Test Endpoints

Protected non-admin endpoints that return 401:
```
GET  /api/reviews/user       — requires auth
POST /api/reviews             — requires auth
POST /api/verification/upload — requires auth
```

### SEC-05: Admin Endpoints That Return 403

Admin endpoints (auth + admin check):
```
GET  /api/admin/reviews       — 401 (no auth) or 403 (non-admin)
GET  /api/admin/users         — same pattern
GET  /api/admin/buildings     — same pattern
GET  /api/admin/audit         — same pattern
POST /api/admin/reviews/[id]  — same pattern (use any review ID)
```

### SEC-06: Rate Limited Endpoints

| Endpoint | Max Attempts | Window | Key |
|----------|-------------|--------|-----|
| POST /api/auth/signin | 5 | 15 min (900s) | `signin:{IP}` |
| POST /api/auth/signup | 3 | 1 hr (3600s) | `signup:{IP}` |
| POST /api/auth/forgot-password | 3 | 1 hr (3600s) | `password_reset:{IP}` |
| POST /api/auth/resend-verification | 3 | 1 hr (3600s) | `verify_email_resend:{IP}` |
| POST /api/disputes | 3 | 1 hr (3600s) | `dispute:{IP}` |

**Best candidate for testing:** `signin` with 5 attempts (quickest to exhaust). Use fake credentials to avoid affecting seed user.

### SEC-07: SQL Injection Probe Strings

Standard probes to test:
```
' OR '1'='1
'; DROP TABLE users; --
' UNION SELECT * FROM users --
Robert'); DROP TABLE reviews;--
```

Submit via dispute `disputeExplanation` field (simplest form) or review `comments` field.

### SEC-08: XSS Payload Strings

Standard payloads to test:
```
<script>alert('XSS')</script>
<img src=x onerror="alert('XSS')">
<div onmouseover="alert('XSS')">hover me</div>
```

Submit via dispute form, then verify on admin disputes page that text renders literally (escaped).

### Clearing Rate Limits Between Tests

```typescript
import { execSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..');

function clearRateLimits() {
  execSync(
    'npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM rate_limits"',
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}
```

### Dispute Submission for Injection/XSS Tests

```typescript
// Dispute form requires fewer fields than review form
const payload = {
  reviewUrl: `http://localhost:8788/building/test-building/review/review-001`,
  landlordName: "Test Landlord",
  landlordEmail: "test-injection@test.local",
  landlordPhone: "555-0000",
  disputeReasons: ["inaccurate_info"],
  disputeExplanation: "<script>alert('XSS')</script>"
};
const response = await request.post('/api/disputes', { data: payload });
```

**Note:** Dispute API has a UNIQUE constraint per review. Each test probe needs a different review ID, or clear disputes table between probes.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual security audits | Automated E2E security tests | Standard practice | Repeatable, regression-proof |
| `innerHTML` for user content | Framework auto-escaping (Astro/React) | Always | XSS prevention by default |
| String concatenation SQL | Parameterized `.bind()` queries | Always in D1 | SQL injection prevention by default |

## Open Questions

1. **Rate limit table cleanup strategy**
   - What we know: Rate limit entries from global.setup.ts signin may partially fill the window
   - What's unclear: Whether the test IP (`127.0.0.1` or `unknown`) matches between setup and test requests
   - Recommendation: Clear `rate_limits` table before rate limit tests using wrangler CLI

2. **Dispute UNIQUE constraint for multiple injection tests**
   - What we know: Each dispute is unique per review_id (UNIQUE constraint)
   - What's unclear: How many seeded reviews can be used as targets without conflicting with seeded disputes
   - Recommendation: Use review IDs that don't have existing disputes (check seed data), or clear disputes table before injection tests

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright (project version) |
| Config file | `playwright.config.ts` |
| Quick run command | `npx playwright test e2e/security.spec.ts` |
| Full suite command | `npx playwright test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-04 | Unauthed requests return 401 | e2e | `npx playwright test e2e/security.spec.ts -g "401"` | No - Wave 0 |
| SEC-05 | Non-admin requests return 403 | e2e | `npx playwright test e2e/security.spec.ts -g "403"` | No - Wave 0 |
| SEC-06 | Rate limit returns 429 | e2e | `npx playwright test e2e/security.spec.ts -g "429"` | No - Wave 0 |
| SEC-07 | SQL injection safely handled | e2e | `npx playwright test e2e/security.spec.ts -g "injection"` | No - Wave 0 |
| SEC-08 | XSS-safe rendering | e2e | `npx playwright test e2e/security.spec.ts -g "XSS"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx playwright test e2e/security.spec.ts`
- **Per wave merge:** `npx playwright test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `e2e/security.spec.ts` -- covers SEC-04, SEC-05, SEC-06, SEC-07, SEC-08

*(No framework or fixture gaps -- existing Playwright infrastructure is sufficient)*

## Sources

### Primary (HIGH confidence)
- Project source code: `src/pages/api/` -- all auth/admin guards verified by direct code inspection
- `src/lib/rateLimit.ts` -- rate limiting implementation and thresholds verified
- `src/lib/validation.ts` -- `sanitizeText()` implementation verified
- `e2e/fixtures.ts` -- existing test fixture patterns
- `playwright.config.ts` -- test configuration
- `scripts/db-seed.ts` -- seed data and test credentials

### Secondary (MEDIUM confidence)
- Astro/React auto-escaping behavior -- well-established framework feature, consistent across versions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries needed, all existing infrastructure
- Architecture: HIGH - patterns directly derived from existing E2E specs in project
- Pitfalls: HIGH - identified from project-specific key decisions (STATE.md) and code inspection

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- no external dependencies)
