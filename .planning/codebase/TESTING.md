# Testing Patterns

**Analysis Date:** 2026-05-02

## Test Framework

**Unit Tests:**
- Framework: Vitest 4.0.18
- Runner: `npm test` or `npm test:watch`
- Environment: happy-dom (lightweight DOM simulation)
- Config: `vitest.config.ts` at project root

**Integration/E2E Tests:**
- Framework: Playwright 1.58.2
- Runner: `npm run e2e` (builds first) or `npm run e2e:headed` (visual)
- Config: `playwright.config.ts` at project root
- Test files: `e2e/*.spec.ts`
- Fixtures: `e2e/fixtures.ts` — custom fixtures for authenticated pages

**Assertion Library:**
- Vitest: built-in `expect()`
- Playwright: `expect()` imported from `@playwright/test`

**Run Commands:**
```bash
npm test                    # Run all unit tests
npm test:watch             # Watch mode for unit tests
npm test -- scoring        # Filter tests by name
npm run e2e                # Run all e2e tests (with build)
npm run e2e:headed         # Run e2e with headed browser (visual)
npm run db:setup           # Fresh DB + seed (run before e2e)
```

## Test File Organization

**Location:**
- Unit tests co-located with source: `src/lib/__tests__/` directory
- E2E tests: `e2e/` directory at project root
- React component tests: `src/lib/__tests__/ComponentName.test.tsx`

**Naming:**
- Unit tests: `[name].test.ts` or `[name].test.tsx`
- E2E tests: `[scenario].spec.ts`
- Test files live in `__tests__/` subdirectory

**Structure:**
```
src/lib/
├── scoring.ts              # Source
├── __tests__/
│   └── scoring.test.ts     # Unit tests
src/pages/api/
├── reviews/create.ts       # Source
└── (no co-located tests; e2e covers API)

e2e/
├── auth.spec.ts            # Signup, signin, signout flows
├── review.spec.ts          # Review submission, editing
├── critical-flows.spec.ts   # Cross-view consistency, audit logging
├── fixtures.ts             # Custom fixtures (authedPage, adminPage)
├── global.setup.ts         # Seed users before all tests
└── playwright/.auth/       # Session storage (user.json, admin.json)
```

## Test Structure

**Unit Test Suite Pattern:**
```typescript
import { describe, it, expect } from 'vitest';
import { calculateDomainScores, UNIT_FIELDS } from '../scoring';

describe('calculateDomainScores', () => {
  it('returns all nulls for empty scores', () => {
    const result = calculateDomainScores({});
    expect(result.unit).toBeNull();
  });

  it('calculates correct score when all fields are the same value', () => {
    // When all fields = 3, weighted average should still be 3.0
    const result = calculateDomainScores(allScores(3));
    expect(result.overall).toBe(3.0);
  });
});
```

**Patterns:**
- Use `describe()` to group related tests
- Each `it()` is a single assertion or logical check
- Comments explain *why*, not *what*
- Section headings with visual separators (═══════) for clarity

**Setup/Teardown:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Database operations', () => {
  let db: MockDatabase;

  beforeEach(() => {
    db = setupMockDB();
  });

  afterEach(() => {
    cleanup(db);
  });

  it('inserts record', async () => {
    await db.insert(...);
  });
});
```

## Mocking

**Framework:** `vi` from Vitest

**Database Mocking Pattern:**
```typescript
function mockDB(shouldError: boolean = false) {
  const runFn = shouldError
    ? vi.fn().mockRejectedValue(new Error('DB error'))
    : vi.fn().mockResolvedValue({});

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: runFn,
      }),
    }),
    _runFn: runFn,  // Expose for assertion
  };
}
```

**What to Mock:**
- External services: Resend email API, D1 database, Google Places API
- Time-dependent operations: `Date.now()`, `unixepoch()`
- Async functions: use `vi.fn().mockResolvedValue()` or `.mockRejectedValue()`

**What NOT to Mock:**
- Pure functions: scoring, validation, formatting — always test real implementation
- TypeScript type checking: types are compile-time only, no runtime mocks needed
- Utility functions within same module: test against real implementation

**Assertion on Mocks:**
```typescript
// Verify function was called with correct parameters
expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT'));

// Verify error was logged (spy on console)
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
// ... code that should log error ...
expect(consoleSpy).toHaveBeenCalledWith('Failed to create audit log:', expect.any(Error));
consoleSpy.mockRestore();
```

## Fixtures and Factories

**Test Data Helpers:**
```typescript
// src/lib/__tests__/scoring.test.ts
function allScores(value: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const field of ALL_SCORE_FIELDS) {
    scores[field] = value;
  }
  return scores;
}

function domainScores(fields: readonly string[], value: number): Record<string, number | null> {
  const scores: Record<string, number | null> = {};
  for (const field of ALL_SCORE_FIELDS) {
    scores[field] = null;
  }
  for (const field of fields) {
    scores[field] = value;
  }
  return scores;
}

// Usage in tests
it('calculates unit score only', () => {
  const result = calculateDomainScores(domainScores(UNIT_FIELDS, 4));
  expect(result.unit).toBe(4.0);
});
```

**E2E Fixtures (Custom Playwright Fixtures):**
Located in `e2e/fixtures.ts`:

```typescript
import { test as base, expect } from '@playwright/test';

type CustomFixtures = {
  authedPage: import('@playwright/test').Page;
  adminPage: import('@playwright/test').Page;
};

export const test = base.extend<CustomFixtures>({
  authedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: USER_AUTH_FILE,  // Load saved session
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});
```

**Global Setup:**
- File: `e2e/global.setup.ts`
- Runs once before all e2e tests
- Creates test users in seeded database
- Saves session storage to `.auth/user.json` and `.auth/admin.json`

**Database Helpers in E2E:**
```typescript
// e2e/critical-flows.spec.ts
function cleanupPhase20Reviews(): void {
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM reviews WHERE building_id = 'building-e2e-01'"`,
    { cwd: PROJECT_ROOT, stdio: 'pipe' }
  );
}

// Called in beforeEach and afterEach for test isolation
```

## Coverage

**Requirements:** None enforced (no coverage threshold in config)

**View Coverage:** Not configured (would require adding coverage reporter to vitest.config.ts)

**Current Coverage:**
- Unit tests: 19 test files, ~3000 lines of test code
- Critical library functions heavily tested: scoring, validation, password, audit
- E2E tests: 8 spec files, ~1800 lines, covering main user flows
- Admin features covered in e2e: audit logs, disputes, bug reports, verification

## Test Types

**Unit Tests:**
- Scope: Single function or module
- Speed: Fast (ms)
- Location: `src/lib/__tests__/*.test.ts(x)`
- Examples:
  - `scoring.test.ts` — weight calculation, domain averaging, recency weighting
  - `validation.test.ts` — form validation, email format, zip codes
  - `password.test.ts` — hash generation, password verification
  - `audit.test.ts` — database operations, error handling

**Integration Tests:**
- Scope: Function + dependencies (e.g., function + mocked database)
- Speed: Fast to moderate
- Examples:
  - `formatScore()` + score rounding
  - `calculateAggregatedScores()` + recency weight application

**E2E Tests:**
- Scope: Full user flows through browser
- Speed: Slow (multiple seconds per test)
- Location: `e2e/*.spec.ts`
- Setup: Database fresh from seed, page navigates to URL
- Verification: DOM content, form submission, page redirects
- Examples:
  - Auth flow: signup → signin → signout
  - Review submission: form fill → validation → success
  - Admin actions: filter → update → audit log recorded

## Common Patterns

**Async Testing (Vitest):**
```typescript
it('returns true for correct password', async () => {
  const hash = await hashPassword('mypassword123');
  const result = await verifyPassword('mypassword123', hash);
  expect(result).toBe(true);
});
```

**Error Testing:**
```typescript
it('returns false for wrong password', async () => {
  const hash = await hashPassword('mypassword123');
  const result = await verifyPassword('wrongpassword', hash);
  expect(result).toBe(false);
});

it('handles empty password', async () => {
  const hash = await hashPassword('');
  const result = await verifyPassword('', hash);
  expect(result).toBe(true);
});
```

**E2E Form Submission:**
```typescript
test('user can sign up with email and password', async ({ page }) => {
  const uniqueEmail = `signup-${Date.now()}@test.local`;

  await page.goto('/auth/signup');
  await page.fill('input[name="email"]', uniqueEmail);
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.fill('input[name="confirmPassword"]', 'TestPassword123!');
  await page.click('button[type="submit"]');

  // Verify redirect
  await page.waitForURL('/');

  // Verify signed-in state
  await expect(page.locator('form[action="/api/auth/signout"]').first()).toBeVisible();
});
```

**E2E API Submission (Using authedPage Fixture):**
```typescript
async function submitReviewAsAuthedUser(
  authedPage: import('@playwright/test').Page,
  buildingId: string
): Promise<string> {
  const formFields: Record<string, string> = {
    'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    building_id: buildingId,
    // ... all 27 score fields + metadata
  };

  const res = await authedPage.request.post('/api/reviews', {
    multipart: formFields,
    headers: { Origin: BASE_URL },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.reviewId as string;
}
```

**React Component Testing:**
```typescript
import { render, cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

it('renders title inside an h3 with correct classes', () => {
  const { container } = render(
    <EmptyState title="Nothing here" description="Try again later." />
  );
  const h = container.querySelector('h3');
  expect(h!.textContent).toBe('Nothing here');
  expect(h!.className).toContain('text-lg');
});
```

## Test Isolation

**Unit Tests:**
- Each test function is independent
- Use helpers to create consistent test data (`allScores()`, `domainScores()`)
- Mock external dependencies (database, API)

**E2E Tests:**
- Database reset before suite: `npm run db:setup`
- Per-test cleanup: `beforeEach()` and `afterEach()` clear test-specific data
- Test buildings isolated: use dedicated `building-e2e-01` for Phase 20 tests, never touch seed data
- Session persistence: authenticated pages use `.auth/*.json` fixtures, reused across tests

**Cleanup Strategy:**
```typescript
// e2e/critical-flows.spec.ts
function cleanupPhase20Reviews(): void {
  // Find reviews for test building and delete audit_logs first
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM audit_logs WHERE entity_id IN (SELECT id FROM reviews WHERE building_id = 'building-e2e-01')"`
  );
  // Then delete reviews
  execSync(
    `npx wrangler d1 execute ratemyplace-db --local --command "DELETE FROM reviews WHERE building_id = 'building-e2e-01'"`
  );
}

test.beforeEach(() => cleanupPhase20Reviews());
test.afterEach(() => cleanupPhase20Reviews());
```

## When to Write Tests

**Write unit tests for:**
- Pure functions: scoring, validation, formatting
- Business logic: weighted averages, recency decay, aggregate calculations
- Edge cases: empty inputs, boundary values, special characters
- Error paths: invalid input, database failures, missing data

**Write e2e tests for:**
- Full user flows: signup → review → view results
- Form submission with validation
- Authentication flows
- Admin actions with audit logging
- Cross-view consistency: verify same data displays correctly on multiple pages

**Skip tests for:**
- Trivial getters/setters
- Type definitions (compile-time only)
- UI layout (visual regression testing out of scope)

---

*Testing analysis: 2026-05-02*
