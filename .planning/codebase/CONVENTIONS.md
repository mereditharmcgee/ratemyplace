# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- Library files: `camelCase.ts` (e.g., `validation.ts`, `rateLimit.ts`, `scoring.ts`)
- React components: `PascalCase.tsx` (e.g., `ReviewForm.tsx`, `AddressAutocomplete.tsx`)
- Test files: `__tests__` directory with `filename.test.ts` or `filename.test.tsx` naming
- Type/interface files: `types.ts` for shared type definitions

**Functions:**
- Library functions: `camelCase` (e.g., `validateReviewForm`, `checkRateLimit`, `calculateOverallScore`)
- React components: `PascalCase` for component names (e.g., `ReviewForm`, `AddressAutocomplete`)
- Helper/utility functions: `camelCase` (e.g., `getClientIP`, `formatScore`, `sanitizeText`)
- Error handler functions: `*Response` pattern (e.g., `jsonResponse`, `errorResponse`, `redirectResponse`)

**Variables:**
- Constants: `UPPER_SNAKE_CASE` (e.g., `ITEM_WEIGHTS`, `ALL_SCORE_FIELDS`, `UNIT_FIELDS`)
- Regular variables: `camelCase` (e.g., `selectedBuilding`, `unitDetails`, `moveInYear`)
- React state: `camelCase` with setter function (e.g., `const [step, setStep] = useState()`)
- Interface/type prefixes: descriptive names without redundant suffixes (e.g., `ValidationError`, `RateLimitResult`)

**Types:**
- Interfaces: `PascalCase` (e.g., `User`, `Building`, `Review`, `ValidationError`)
- Type unions: descriptive string literals or union types (e.g., `type Season = 'winter' | 'spring' | 'summer' | 'fall'`)
- Field names in data models: `snake_case` for database fields (e.g., `building_id`, `move_in_year`, `user_id`, `created_at`)
- Type exports: `export type` and `export interface` explicitly marked
- Const assertions: `.as const` for literal type unions in arrays (e.g., `['winter', 'spring'] as const`)

## Code Style

**Formatting:**
- No explicit linting/formatting tool configured in package.json
- Inferred style from codebase:
  - 2-space indentation (observed in all files)
  - Semicolons at end of statements
  - Single quotes for strings in JS/TS (when applicable), double quotes for HTML attributes
  - Multiline objects/arrays formatted with items on separate lines

**Linting:**
- No `.eslintrc` or `.prettierrc` files present
- TypeScript strict mode enabled via `tsconfig.json` extending `astro/tsconfigs/strict`
- JSX mode enabled with `"jsxImportSource": "react"`

## Import Organization

**Order:**
1. External framework imports (`react`, `vitest`, `lucia`, etc.)
2. Cloudflare/platform-specific imports (`@cloudflare/workers-types`)
3. Internal library imports (`./types`, `./validation`)
4. Component imports (relative paths to components)
5. Type imports explicitly marked with `import type`

**Path Aliases:**
- None detected (no alias configuration in `tsconfig.json`)
- All imports use relative paths (e.g., `../validation`, `../../lib/surveyItems`)

**Example pattern from codebase:**
```typescript
import { describe, it, expect, vi } from 'vitest';
import { getClientIP, checkRateLimit } from '../rateLimit';
```

## Error Handling

**Patterns:**
- Validation functions return error array: `ValidationError[]` with `{ field: string; message: string }` structure (see `src/lib/validation.ts`)
- API responses use dedicated error response functions:
  - `errorResponse(message, status)` for generic errors
  - `ApiErrors` object with predefined error factories (e.g., `ApiErrors.UNAUTHORIZED()`, `ApiErrors.NOT_FOUND()`)
- Try-catch blocks used for async database operations with fallback behavior
  - Example: rate limiting gracefully allows requests if database check fails (`src/lib/rateLimit.ts` lines 66-75)
- Async functions may throw errors or return result objects with error states
- Type-safe error handling with explicit error types in function signatures

## Logging

**Framework:** No dedicated logging library
- Uses `console.error()` for error logging (e.g., `src/lib/rateLimit.ts` line 69)
- Used sparingly, only for unexpected conditions

**Patterns:**
- Log errors that occur in critical operations: `console.error('operation name:', error);`
- No info/debug logging patterns observed

## Comments

**When to Comment:**
- Complex algorithms or weighting systems include detailed JSDoc comments explaining methodology
- External references to research papers included in algorithm documentation
- "How it works" comments for non-obvious logic (e.g., rate limiting key construction)
- Section separators used in test files with visual formatting: `// ═══════════════════════════════════════════════════`

**JSDoc/TSDoc:**
- JSDoc style used for public functions with `@param` and function description tags
- Example pattern from `src/lib/rateLimit.ts`:
```typescript
/**
 * Check and enforce rate limits for an endpoint
 *
 * @param db - D1 database instance
 * @param identifier - Unique identifier (typically IP address)
 * @param endpoint - The endpoint being rate limited (e.g., 'signin', 'signup')
 * @param maxAttempts - Maximum number of attempts allowed in the window
 * @param windowSeconds - Time window in seconds
 */
```

## Function Design

**Size:**
- Most utility functions 20-50 lines (e.g., `validateReviewForm` is 92 lines with multiple validation steps)
- Complex functions may exceed 50 lines when they perform multiple related validations
- React component functions often 100+ lines due to state management and render logic

**Parameters:**
- Explicit, named parameters (avoid positional arguments when multiple params of same type)
- Object parameters used for functions with 3+ boolean/optional parameters
- Type annotations required for all parameters
- Optional parameters marked with `?` in interfaces/function signatures

**Return Values:**
- Explicit return types on all function declarations
- Validation functions return array of errors (empty array = valid)
- Async functions return `Promise<T>` with explicit type
- Database operations return typed result objects
- React components have no explicit return type (inferred as `JSX.Element` from implementation)

## Module Design

**Exports:**
- Named exports preferred (e.g., `export function validateReviewForm()`, `export const ITEM_WEIGHTS`)
- Default exports used only for React components
- Type exports explicitly marked: `export type Season = ...`, `export interface User { ... }`
- Constants and types exported from files alongside implementations

**Barrel Files:**
- Not used - imports reference files directly (e.g., `import { validateReviewForm } from '../validation'`)

## Database Naming Conventions

**Schema:**
- Field names in database records: `snake_case` (e.g., `building_id`, `move_in_year`, `created_at`, `updated_at`)
- Timestamps: stored as Unix epoch seconds (numeric)
- Boolean fields: named with `had_` or `is_` prefix (e.g., `had_pest_issues`, `is_current_tenant`)
- Aggregate/computed fields: `avg_` or `pct_` prefix (e.g., `avg_overall`, `pct_would_recommend`)

---

*Convention analysis: 2026-02-26*
