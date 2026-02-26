# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts`
- Environment: `happy-dom` (lightweight DOM implementation for unit tests)

**Assertion Library:**
- Vitest built-in `expect()` API

**Run Commands:**
```bash
npm test              # Run all tests once
npm run test:watch   # Watch mode with re-run on changes
npm run test:watch   # Coverage not configured (no npm command)
```

**Additional Testing:**
- Playwright E2E tests: `npm run e2e`
- Headed E2E tests: `npm run e2e:headed`
- Smoke tests: `npm run smoke`

## Test File Organization

**Location:**
- Tests co-located with code in `__tests__` subdirectories
- Pattern: `src/lib/__tests__/` contains tests for `src/lib/` modules
- Component tests would go in `src/components/__tests__/` (none currently present)

**Naming:**
- `filename.test.ts` for library/utility tests
- `filename.test.tsx` for component tests (pattern, not yet used)

**Structure:**
```
src/
├── lib/
│   ├── validation.ts
│   ├── scoring.ts
│   └── __tests__/
│       ├── validation.test.ts
│       ├── scoring.test.ts
│       ├── password.test.ts
│       ├── rateLimit.test.ts
│       └── formOptions.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from 'vitest';
import { functionName } from '../module';

describe('functionName', () => {
  it('describes expected behavior', () => {
    const result = functionName(input);
    expect(result).toBe(expectedValue);
  });

  it('handles edge case', () => {
    const result = functionName(edgeCase);
    expect(result).toEqual(expectedResult);
  });
});
```

**Patterns:**

1. **Section Headers:** Large visual separators used to organize test groups:
   ```typescript
   // ═══════════════════════════════════════════════════
   // validateReviewForm
   // ═══════════════════════════════════════════════════
   ```

2. **Setup:** Test data created as constants within or before test suites:
   ```typescript
   const validData = {
     building_id: 'building-123',
     move_in_year: 2024,
     move_in_season: 'fall' as const,
     unit_type: '2br' as const,
     is_current_tenant: true,
   };
   ```

3. **Assertions:** Multiple assertion styles used:
   - Equality: `expect(value).toBe(expected)`
   - Array checks: `expect(array).toHaveLength(n)`
   - Existence: `expect(value).toBeDefined()`
   - Type checks: `expect(typeof value).toBe('number')`
   - Array membership: `expect(array.some(e => condition)).toBe(true)`
   - Mathematical: `expect(value).toBeGreaterThan(n)`, `expect(value).toBeLessThanOrEqual(n)`

4. **Teardown:** Not explicitly used (tests are stateless with isolated data)

## Mocking

**Framework:** Vitest `vi` API

**Patterns:**

1. **Function mocking for database operations:**
```typescript
function mockDB(attemptCount: number = 0, shouldError: boolean = false) {
  const runFn = vi.fn().mockResolvedValue({});
  const firstFn = vi.fn().mockResolvedValue({
    attempt_count: attemptCount,
    first_attempt: Math.floor(Date.now() / 1000) - 60,
  });

  if (shouldError) {
    return {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockRejectedValue(new Error('DB error')),
          first: vi.fn().mockRejectedValue(new Error('DB error')),
        }),
      }),
    };
  }

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: runFn,
        first: firstFn,
      }),
    }),
  };
}
```

2. **Object mocking for request context:**
```typescript
function mockContext(headers: Record<string, string | null>) {
  return {
    request: {
      headers: {
        get: (name: string) => headers[name] ?? null,
      },
    },
  };
}
```

**What to Mock:**
- Database interactions (D1 database operations)
- HTTP request context (headers, IP extraction)
- External service calls (if any)
- File system operations (R2 storage)

**What NOT to Mock:**
- Pure utility functions (validation logic, scoring calculations)
- Cryptographic operations (password hashing/verification)
- Data transformation functions (should test with real data)
- Type/constant definitions

## Fixtures and Factories

**Test Data:**

1. **Data builder functions** used to create test objects with default values:
```typescript
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
```

2. **Constants for valid test data** stored at top of test suite:
```typescript
const validData = {
  building_id: 'building-123',
  move_in_year: 2024,
  move_in_season: 'fall' as const,
  unit_type: '2br' as const,
  is_current_tenant: true,
};
```

**Location:**
- Inline within test files in `src/lib/__tests__/`
- No separate fixtures directory
- Test data builders defined as top-level functions in test files

## Coverage

**Requirements:** None enforced

**Current Coverage Areas:**
- Library functions: `src/lib/__tests__/` covers:
  - Validation (`validation.test.ts` - 50+ test cases)
  - Scoring algorithms (`scoring.test.ts` - 50+ test cases)
  - Password hashing (`password.test.ts` - 6 test cases)
  - Rate limiting (`rateLimit.test.ts` - 8 test cases)
  - Form options (`formOptions.test.ts` - 15+ test cases)
- React components: No unit tests present (E2E/smoke tests handle component testing)

## Test Types

**Unit Tests:**
- Framework: Vitest
- Scope: Individual functions and business logic
- Approach: Test with isolated test data, mock external dependencies (DB, context)
- Location: `src/lib/__tests__/*.test.ts`
- Example: `validateReviewForm` tested with valid/invalid data, edge cases, boundary conditions
- Coverage: All validation rules, scoring algorithms, utility functions

**Integration Tests:**
- Not explicitly separated from unit tests
- Some tests validate multiple related functions working together
- Example: `calculateAggregatedScores` tests recency weighting applied correctly

**E2E Tests:**
- Framework: Playwright
- Scope: Full application workflows
- Location: Tests configured in `playwright.config.ts` (implementation files not shown in this analysis)
- Run: `npm run e2e` or `npm run e2e:headed`
- Coverage: User journeys, form submissions, authentication, page navigation

**Smoke Tests:**
- Framework: Custom script using tsx
- Location: `scripts/smoke-test.ts`
- Run: `npm run smoke`
- Coverage: Health checks, basic functionality verification

## Common Patterns

**Async Testing:**
```typescript
it('returns a string in salt$hash format', async () => {
  const hash = await hashPassword('testpassword');
  expect(hash).toContain('$');
});

it('returns true for correct password', async () => {
  const hash = await hashPassword('mypassword123');
  const result = await verifyPassword('mypassword123', hash);
  expect(result).toBe(true);
});
```

**Error Testing:**
```typescript
it('blocks requests at the limit', async () => {
  const db = mockDB(5); // 5 attempts, limit is 5
  const result = await checkRateLimit(db, '1.2.3.4', 'signin', 5, 900);
  expect(result.allowed).toBe(false);
  expect(result.remaining).toBe(0);
});

it('gracefully handles database errors', async () => {
  const db = mockDB(0, true); // shouldError = true
  const result = await checkRateLimit(db, '1.2.3.4', 'signin', 5, 900);
  expect(result.allowed).toBe(true); // Should allow when DB fails
});
```

**Data Iteration Testing:**
```typescript
it('accepts all valid seasons', () => {
  for (const season of ['winter', 'spring', 'summer', 'fall'] as const) {
    const errors = validateReviewForm({ ...validData, move_in_season: season });
    expect(errors.some(e => e.field === 'move_in_season')).toBe(false);
  }
});
```

**Property-Based Testing (implicit):**
```typescript
it('accepts valid integer scores 1-5', () => {
  for (let score = 1; score <= 5; score++) {
    const errors = validateReviewForm({
      ...validData,
      scores: { building_quality: score },
    });
    expect(errors.some(e => e.field.startsWith('scores.'))).toBe(false);
  }
});
```

## Test Statistics

**Coverage by module:**
- `src/lib/validation.ts`: 171 lines of test (50+ test cases)
- `src/lib/scoring.ts`: 423 lines of test (60+ test cases)
- `src/lib/password.ts`: 72 lines of test (6 test cases)
- `src/lib/rateLimit.ts`: 130 lines of test (8 test cases)
- `src/lib/formOptions.ts`: 95 lines of test (15+ test cases)

**Total unit tests:** 122+ tests (as noted in recent commit)

---

*Testing analysis: 2026-02-26*
