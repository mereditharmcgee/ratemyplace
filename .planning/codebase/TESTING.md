# Testing Patterns

**Analysis Date:** 2026-04-26

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts`
- Environment: `happy-dom` (lightweight DOM implementation for component testing)

**Assertion Library:**
- Vitest built-in expect() (compatible with Jest API)

**E2E Framework:**
- Playwright 1.58.2
- Config: `playwright.config.ts`

**Run Commands:**
```bash
npm test              # Run all unit tests
npm test -- scoring   # Filter tests by name pattern
npm test:watch        # Watch mode (rerun on file changes)
npm e2e               # Run E2E tests (requires build + fresh DB)
npm e2e:headed        # E2E tests in headed browser (visible)
```

## Test File Organization

**Location:**
- Unit tests: `src/lib/__tests__/[name].test.ts` (co-located with implementation)
- Component tests: Same directory pattern (planned, not yet in use for React components)
- E2E tests: `e2e/[feature].spec.ts`

**Naming:**
- Test files: `[module].test.ts` (e.g., `scoring.test.ts`, `validation.test.ts`, `notifications.test.ts`)
- E2E test files: `[feature].spec.ts` (e.g., `review.spec.ts`, `auth.spec.ts`, `admin-actions.spec.ts`)

**Structure:**
```
src/lib/__tests__/
├── audit.test.ts
├── disputes.test.ts
├── enrichment.test.ts
├── format.test.ts
├── notifications.test.ts
├── scoring.test.ts
└── [15+ more test files]

e2e/
├── fixtures.ts           # Custom Playwright fixtures
├── global.setup.ts       # Auth setup before tests
├── admin-actions.spec.ts
├── review.spec.ts
└── [7 more spec files]
```

## Test Structure

**Suite Organization:**

Unit test example from `src/lib/__tests__/scoring.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calculateDomainScores, getRecencyWeight, ITEM_WEIGHTS } from '../scoring';

describe('Field definitions', () => {
  it('has 10 unit fields', () => {
    expect(UNIT_FIELDS).toHaveLength(10);
  });

  it('has weights defined for every field', () => {
    for (const field of ALL_SCORE_FIELDS) {
      expect(ITEM_WEIGHTS[field]).toBeDefined();
      expect(ITEM_WEIGHTS[field]).toBeGreaterThanOrEqual(1.0);
    }
  });
});

describe('Health/safety weights', () => {
  it('pests have 1.5x weight', () => {
    expect(ITEM_WEIGHTS.unit_pests).toBe(1.5);
  });
});
```

**Patterns:**
- Setup: Helper functions at file top (e.g., `function allScores(value: number)`, `function domainScores(...)`)
- Test groups: Nested `describe()` blocks with section headers
- Section separators: Visual ASCII dividers (e.g., `// ═══════════════════════════════════════════════════`)
- Assertions: Direct expect() chains, multiple assertions per test when logically related
- Snapshot testing: Not used; prefer explicit assertions

## Mocking

**Framework:** Vitest's `vi` (vi.fn(), vi.spyOn())

**Patterns from `src/lib/__tests__/notifications.test.ts`:**
```typescript
import { vi } from 'vitest';

// Mock object factory
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
    _runFn: runFn,  // Expose for assertions
  };
}

// Usage in test
it('inserts a row into notifications table', async () => {
  const db = mockDB();
  await createNotification(db, { userId: 'user-123', ... });
  expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'));
});

// Spy on console
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
expect(consoleSpy).toHaveBeenCalled();
consoleSpy.mockRestore();
```

**What to Mock:**
- Database connections (always mocked in unit tests)
- Console methods when testing error handling
- Exported functions when testing integration (e.g., `validateDisputeForm` mocked when testing API that uses it)
- Never mock: core business logic (scoring, calculations), validation functions

**What NOT to Mock:**
- Core utility functions like `calculateDomainScores`, `validateReviewForm`
- Type/interface definitions
- Pure calculations
- For these, call the real function and assert on output

## Fixtures and Factories

**Test Data:**

Example helper from `src/lib/__tests__/scoring.test.ts`:
```typescript
// Helper: create a scores object with all fields set to a value
function allScores(value: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const field of ALL_SCORE_FIELDS) {
    scores[field] = value;
  }
  return scores;
}

// Helper: create a scores object for one domain only
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

// Usage
const result = calculateDomainScores(allScores(3));
expect(result.overall).toBe(3.0);
```

**E2E Fixtures from `e2e/fixtures.ts`:**
```typescript
import { test as base, expect } from '@playwright/test';

type CustomFixtures = {
  authedPage: import('@playwright/test').Page;
  adminPage: import('@playwright/test').Page;
};

export const test = base.extend<CustomFixtures>({
  authedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: USER_AUTH_FILE,  // Pre-authenticated session
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: ADMIN_AUTH_FILE,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});
```

**Location:**
- Test helpers: Defined at top of `.test.ts` file (no separate factory files)
- E2E fixtures: `e2e/fixtures.ts` (extended Playwright test object)
- Auth state: `playwright/.auth/user.json`, `playwright/.auth/admin.json` (created by `e2e/global.setup.ts`)

## Coverage

**Requirements:** No coverage enforcement

**View Coverage:**
- Vitest coverage not configured in `vitest.config.ts`
- To enable: Add `coverage: { provider: 'v8' }` to vitest config
- Currently no coverage thresholds or reports

**Current State:**
- 171 unit tests passing (from git status memory)
- 15+ E2E tests defined
- No automated coverage reporting

## Test Types

**Unit Tests:**
- Scope: Individual functions and utilities (non-React)
- Approach: Direct function calls with mocked dependencies
- Examples: `scoring.test.ts`, `validation.test.ts`, `disputes.test.ts`
- Pattern: Create test data → call function → assert output
- Database: Always mocked (no real DB connections in unit tests)

**Integration Tests:**
- E2E tests act as integration tests (real database, real Astro runtime)
- Scope: Full user workflows across multiple components/APIs
- Approach: Browser automation via Playwright
- Examples: `review.spec.ts` (complete review submission), `auth.spec.ts` (login flows)

**E2E Tests:**
- Framework: Playwright 1.58.2
- Config: `playwright.config.ts` with setup phase
- Run with: `npm e2e` (requires build + fresh database via `npm run db:setup`)
- Browser: Chromium (single worker for serial execution)
- Auth: Pre-authenticated sessions via fixtures
- Timeouts: 30s per test, first-failure trace collection
- Database: Fresh seed before E2E run (`npm run db:fresh && npm run db:seed`)

**E2E Test Structure from `e2e/review.spec.ts`:**
```typescript
import { test, expect } from './fixtures';

// Helper: rate all visible items with given score
async function rateAllItemsInStep(page: Page, score: number) {
  const scoreButtons = page.locator('button[type="button"]').filter({ hasText: new RegExp(`^${score}$`) });
  const count = await scoreButtons.count();
  for (let i = 0; i < count; i++) {
    await scoreButtons.nth(i).click();
  }
  return count;
}

test.describe('Review Form', () => {
  test('complete review submission happy path', async ({ authedPage }) => {
    test.setTimeout(90000);

    // Step 1: Navigate
    await authedPage.goto('/review/new?building=building-30');
    await authedPage.waitForLoadState('networkidle');

    // Step 2: Interact
    await authedPage.fill('input[placeholder*="2A"]', '4B');
    await authedPage.locator('button', { hasText: 'Continue' }).click();

    // Step 3: Verify
    await expect(authedPage.locator('text=Rate Your Unit')).toBeVisible();
  });
});
```

## Common Patterns

**Async Testing:**

Unit test with async/await:
```typescript
it('swallows errors and does not throw when DB call fails', async () => {
  const db = mockDB(true);  // Mock that rejects
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  await expect(
    createNotification(db, { userId: 'user-123', ... })
  ).resolves.toBeUndefined();  // Should NOT throw

  expect(consoleSpy).toHaveBeenCalled();
  consoleSpy.mockRestore();
});
```

E2E with async/await:
```typescript
test('complete review submission happy path', async ({ authedPage }) => {
  await authedPage.goto('/review/new?building=building-30');
  await authedPage.waitForLoadState('networkidle');
  await authedPage.fill('input[placeholder*="2A"]', '4B');
  await expect(authedPage.locator('text=Rate Your Unit')).toBeVisible();
});
```

**Error Testing:**

```typescript
describe('Error handling', () => {
  it('returns error message on invalid data', () => {
    const errors = validateDisputeForm({ landlordEmail: 'invalid-email' });
    expect(errors.some(e => e.field === 'landlordEmail')).toBe(true);
  });

  it('catches and logs DB errors without throwing', async () => {
    const db = mockDB(true);  // Rejects
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(createAuditLog(db, { ... })).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Failed to create audit log/)
    );
    consoleSpy.mockRestore();
  });
});
```

**Setup/Teardown:**
- Setup: Done per-test via test helpers and fixtures (e.g., `mockDB()`)
- Teardown: Via `mockRestore()` for spies, Playwright context cleanup handled by fixtures
- Global setup: `e2e/global.setup.ts` authenticates users before E2E tests run
- No beforeEach/afterEach blocks in unit tests (each test is self-contained)

## Best Practices Observed

1. **Test isolation:** Each test is independent; no shared state between tests
2. **Descriptive names:** Test names match the behavior being tested (e.g., `'returns 1.0 for current year'`)
3. **Arrange-Act-Assert:** Clear separation in test structure
4. **No magic:** Helper functions named semantically (e.g., `allScores()` not `createScores()`)
5. **Realistic data:** E2E tests use real database snapshots; unit tests use simple fixtures
6. **Single assertion focus:** Most tests assert one behavior (some multi-assert when logically grouped)
7. **Error path coverage:** Both happy path and error cases tested (e.g., DB error handling)
8. **No test interdependencies:** Tests can run in any order

---

*Testing analysis: 2026-04-26*
