# Coding Conventions

**Analysis Date:** 2026-05-02

## Naming Patterns

**Files:**
- PascalCase for React components: `BuildingMap.tsx`, `ReviewForm.tsx`, `EmptyState.tsx`
- camelCase for utility/lib files: `scoring.ts`, `validation.ts`, `password.ts`, `audit.ts`
- Hyphenated URLs: `/api/admin/bug-reports`, `/api/reviews`, `/auth/signup`
- Database tables: snake_case: `audit_logs`, `rate_limits`, `reviews`
- Test files: `*.test.ts` or `*.test.tsx` for unit tests; `*.spec.ts` for e2e tests

**Functions:**
- camelCase for all function names: `calculateDomainScores()`, `validateReviewForm()`, `createAuditLog()`, `getScoreColor()`
- Prefix with verb: `get*`, `validate*`, `calculate*`, `create*`, `fetch*`, `sanitize*`
- Arrow functions for callbacks in React: `const handleClick = () => {}`
- Async functions fully spelled out: `async function fetchLogs() { }` or `const fetchLogs = async () => {}`

**Variables:**
- camelCase for all variables: `buildingId`, `totalPages`, `errorMessage`, `adminNotes`
- Boolean variables prefixed with `is` or `has`: `isLoading`, `hasError`, `isCurrentTenant`, `hadPestIssues`
- State setters follow React convention: `const [loading, setLoading]`, `const [error, setError]`
- Abbreviations acceptable for clarity: `params`, `res`, `err`, `db`

**Types & Interfaces:**
- PascalCase for all types: `type Season = 'winter' | 'spring' | 'summer' | 'fall'`
- PascalCase for interfaces: `interface User {}`, `interface ValidationError {}`
- Generic type parameters: `Record<string, number>`, `T extends SomeType`
- Readonly field arrays: `as const` for field definitions (e.g., `UNIT_FIELDS`, `ALL_SCORE_FIELDS`)

**Constants:**
- UPPER_SNAKE_CASE for module-level constants: `ITEM_WEIGHTS`, `ALL_SCORE_FIELDS`, `UNIT_FIELDS`
- Lowercase camelCase for const functions: `generateSessionToken()` (defined as `const`)
- Magic numbers documented in comments with rationale

**API Response Objects:**
- `{ data: T }` for successful responses or direct data object
- `{ error: string, details?: any }` for errors
- `{ success: boolean, ... }` when boolean status needed
- Always include HTTP status code and `Content-Type: application/json` header

## Code Style

**Formatting:**
- No explicit linter/formatter configured (no .eslintrc or .prettierrc)
- 2-space indentation (inferred from codebase)
- Single quotes for strings: `'hello'`, `'world'`
- Semicolons required at end of statements
- Line breaks: separate imports, then blank line before code
- Descriptive headings for logical sections: `// ═══════════════════════════════════════════════════`

**Linting:**
- No active linter configuration
- TypeScript strict mode enabled (`tsconfig.json` extends `astro/tsconfigs/strict`)
- Type imports must use `import type { ... }` when possible to avoid circular dependencies
- Avoid `any` types; define interfaces in `src/lib/types.ts` instead

## Import Organization

**Order:**
1. Standard library imports (none typical in Astro/React)
2. Third-party imports: `react`, `vitest`, `@astrojs/*`, type definitions
3. Local imports: `src/lib/*`, `src/components/*`, relative imports
4. Type imports: `import type { ... }` placed at top of their group

**Path Aliases:**
- None configured; relative paths used throughout (`../lib/`, `../../lib/`)
- Database connection via `getDB(context)` from `src/lib/db.ts`
- Environment variables via `getEnv(context)` from `src/lib/runtime.ts`

**Example pattern:**
```typescript
import { describe, it, expect, vi } from 'vitest';
import type { ValidationError, ReviewFormData } from '../types';
import { validateReviewForm, sanitizeText } from '../validation';
```

## Error Handling

**Patterns:**
- API routes return JSON with explicit status codes (401, 403, 400, 500)
- Validation returns `ValidationError[]` array: `{ field: string, message: string }`
- Database errors: log to console, return 500 with generic message (never leak DB details)
- Best-effort operations (e.g., audit logging) catch errors silently with `console.error()`
- No exceptions thrown from validators; always return error arrays

**API Error Response Pattern:**
```typescript
if (!context.locals.user) {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Validation Error Pattern:**
```typescript
const errors: ValidationError[] = [];
if (!data.field) {
  errors.push({ field: 'field', message: 'Field is required' });
}
return errors;
```

## Logging

**Framework:** `console` (no dedicated logger library)

**Patterns:**
- `console.error()` only — no debug, info, or warn logging
- Error messages include context: `console.error('Failed to create audit log:', error)`
- Best-effort operations log errors but don't throw
- Network/async errors logged before returning 500 response

**Example:**
```typescript
try {
  await createAuditLog(db, entry);
} catch (error) {
  console.error('Failed to create audit log:', error);
  // Don't throw — audit failures don't block the main action
}
```

## Comments

**When to Comment:**
- Explain *why*, not *what* — code shows what it does
- Document methodology with academic citations: `Based on epidemiological evidence: Krieger & Higgins (2002)`
- Mark reserved test data: `// Test-only building: building-e2e-01`
- Flag implementation choices that diverge from obvious approaches
- Do NOT comment obvious statements like `const x = 1; // Set x to 1`

**JSDoc/TSDoc:**
- Used sparingly for exported functions and types
- Required for public library functions: `scoring.ts`, `validation.ts`, `audit.ts`
- Not required for internal component functions or test suites

**Example:**
```typescript
/**
 * Health/Safety Weights
 *
 * Based on epidemiological evidence:
 * - Pests: 1.5x - Strong allergen/disease vector evidence (Krieger 2002)
 * - Mold: 1.5x - OR 1.5-3.5 for respiratory illness (Jacobs 2009)
 */
```

## Function Design

**Size:** 
- Keep functions under 50 lines when possible
- Complex validation logic extracted to dedicated functions (see `validateReviewForm`, `validateDisputeForm`)
- API route handlers may reach 100+ lines if building dynamic queries

**Parameters:**
- Destructure object parameters in signatures: `{ buildingId, filter }` rather than passing wrapper objects
- Use optional chaining for nested properties: `const name = data?.landlordName`
- Nullable values acceptable: `field?: number`, `field: number | null`

**Return Values:**
- Single responsibility: return only what the function name promises
- Arrays preferred over single items when result could be 0+ items
- `null` for "no result" (not `undefined` in object returns)
- Always return consistent types (no function returning `string | null | undefined`)

**Example:**
```typescript
export function validateReviewForm(
  data: Partial<ReviewFormData & { move_in_month?: number }>
): ValidationError[] {
  // Returns array — always consistent, never null
}
```

## Module Design

**Exports:**
- One main export per file preferred (exception: related utility functions)
- Always export type interfaces alongside implementations
- Re-export from barrel files (`index.ts`) only when building public APIs

**Barrel Files:**
- Minimal use; most imports are direct to source files
- Example: `src/lib/db.ts` exports `getDB()` function
- No wildcard exports (`export * from`)

**File Organization:**
- Imports at top
- Type/interface definitions
- Constants and configuration
- Main functions in logical order (public before private)
- Tests in `__tests__/` subdirectory next to source files

## Astro/React Patterns

**Astro Pages:**
- SSR by default; minimal JavaScript unless `client:load` directive used
- Dynamic routes use `Astro.params.slug` to access route parameter
- Admin pages always check `context.locals.user?.isAdmin` before rendering

**React Components:**
- Client-side only — instantiated with `client:load` directive in Astro pages
- Export as default: `export default function ComponentName() {}`
- Props interface defined at top: `interface Props { ... }`
- Hooks: `useState`, `useEffect`, `useCallback`, `useRef`
- No custom hooks library; hooks defined inline when needed

**Example Astro + React Island:**
```astro
---
// Astro component (SSR)
---
<div>
  <h1>{building.name}</h1>
  <ReviewForm client:load buildingId={building.id} />
</div>
```

## Database

**Query Patterns:**
- Always use parameterized queries: `.bind(userId)` not string interpolation
- Single row: `.first<Type>()`
- Multiple rows: `.all<Type>()` returns `{ results: T[] }`
- Timestamps: Use `unixepoch()` not `datetime('now')`

**Example:**
```typescript
const user = await db.prepare('SELECT * FROM users WHERE id = ?')
  .bind(userId)
  .first<User>();
```

## Scoring System (Critical)

**Modifying Weights:**
1. Edit `ITEM_WEIGHTS` in `src/lib/scoring.ts`
2. Document with academic citation
3. Update `src/pages/methodology.astro`

**Score Fields:**
- 27 total fields across three domains (unit, building, landlord)
- Defined in `src/lib/scoring.ts` as `UNIT_FIELDS`, `BUILDING_FIELDS`, `LANDLORD_FIELDS`
- Type safety: `type ScoreFieldName = typeof ALL_SCORE_FIELDS[number]`

**Colors:**
- Single source of truth: `src/lib/scoring-colors.ts`
- Use helper functions: `getScoreColor()`, `getScoreTextColor()`, `getScoreBgTint()`
- Never hardcode color values like `text-teal-600` or `bg-orange-500` for score display

---

*Convention analysis: 2026-05-02*
