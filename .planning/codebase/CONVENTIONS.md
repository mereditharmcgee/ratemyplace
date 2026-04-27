# Coding Conventions

**Analysis Date:** 2026-04-26

## Naming Patterns

**Files:**
- API routes: kebab-case (e.g., `admin-actions.ts`, `bug-reports.ts`, `pending-verifications.ts`)
- Components: PascalCase (e.g., `ReviewForm.tsx`, `ContactForm.tsx`, `BuildingMap.tsx`)
- Library files: camelCase (e.g., `scoring.ts`, `validation.ts`, `logger.ts`, `notifications.ts`)
- Test files: `__tests__` directory with `[name].test.ts` pattern (e.g., `src/lib/__tests__/scoring.test.ts`)
- E2E tests: `e2e/[feature].spec.ts` (e.g., `review.spec.ts`, `auth.spec.ts`)

**Functions:**
- Exported utility functions: camelCase with verb prefixes (e.g., `calculateDomainScores`, `validateReviewForm`, `createAuditLog`, `humanize`)
- React components: PascalCase named exports (e.g., `export default function ReviewForm(...)`)
- Callback/handler functions in components: camelCase with `handle` prefix (e.g., `handlePlaceSelect`, `handleSubmit`)
- Helper functions: camelCase, descriptive names (e.g., `getRecencyWeight`, `extractReviewIdFromUrl`)
- Mocking functions in tests: camelCase with semantic names (e.g., `mockDB()`, `rateAllItemsInStep()`)

**Variables:**
- State variables: camelCase (e.g., `selectedBuilding`, `fieldErrors`, `privacyAcknowledged`)
- Constants: UPPER_SNAKE_CASE (e.g., `ITEM_WEIGHTS`, `UNIT_FIELDS`, `EVENT_MESSAGES`, `DISPUTE_REASONS`)
- Type unions/discriminators: camelCase (e.g., `eventType: NotificationEventType`)
- Database columns: snake_case (e.g., `user_id`, `building_id`, `created_at`, `is_admin`)

**Types:**
- Interfaces: PascalCase (e.g., `User`, `Building`, `Review`, `ValidationError`, `AuditLogEntry`)
- Type aliases: PascalCase (e.g., `Season`, `UnitType`, `ReviewStatus`)
- Branded types: PascalCase with context suffix (e.g., `ReviewFormData`, `PlaceDetails`, `CreateNotificationParams`)
- Database result types: PascalCase with semantic naming (e.g., `BuildingScores`, `LandlordScores`)

## Code Style

**Formatting:**
- No explicit linter/formatter configured in repo (ESLint/Prettier absent)
- Indentation: 2 spaces (standard across all files)
- Line length: No hard limit enforced, but generally kept reasonable
- Trailing commas: Used in multi-line objects/arrays

**TypeScript:**
- Strict mode enabled via `astro/tsconfigs/strict`
- JSX: `react-jsx` (automatic JSX transform)
- No use of `any` type except in required contexts (e.g., `db: any` for D1Database binding)
- Always export types for consumers (e.g., `export interface ValidationError`)
- Union types for discriminated variants (e.g., `ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged'`)

**File Organization:**
- Single responsibility principle: One main export per file
- Export types alongside implementation
- Import order: external packages first, then relative imports from `lib/`, then components

## Import Organization

**Order:**
1. External packages from `node_modules` (e.g., `import { useState } from 'react'`, `import { describe, it, expect } from 'vitest'`)
2. Cloudflare/Framework types (e.g., `import type { APIContext } from 'astro'`, `import type { D1Database } from '@cloudflare/workers-types'`)
3. Internal lib files (e.g., `import { getDB } from '../../lib/db'`)
4. Components (e.g., `import { ContactForm } from '../contact/ContactForm'`)
5. Types (e.g., `import type { ReviewFormData } from '../../lib/types'`)

**Path Aliases:**
- No path aliases configured; relative paths used throughout (e.g., `../../lib/db`, `./form-steps`)

## Error Handling

**Patterns:**
- API endpoints: Return JSON with `error` field and appropriate HTTP status codes
  - 401 for missing auth: `{ error: 'Authentication required' }`
  - 403 for insufficient permissions: `{ error: 'Admin access required' }`
  - 400 for validation: `{ error: 'Validation failed', details: errors }`
  - 500 for server errors: `{ error: 'Failed to [action]' }`
- Try-catch with console.error logging (best-effort pattern for non-critical operations like audit logs and notifications)
- Error responses always include `Content-Type: application/json` header
- Best-effort logging: Database operations like audit logs and notifications catch errors but don't throw

**Example:**
```typescript
// API route auth check
if (!context.locals.user) {
  return new Response(JSON.stringify({ error: 'Authentication required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Best-effort operation
try {
  await db.prepare(...).bind(...).run();
} catch (error) {
  console.error('Failed to create audit log:', error);
  // Don't throw - let the primary action succeed
}
```

## Logging

**Framework:** `console.error()` and `console.log()` via `logError()` helper for structured JSON logging

**Patterns:**
- Structured JSON logs: `logError(event: string, context: LogContext)` in `src/lib/logger.ts`
- Request tracking: Every error log includes `request_id` (auto-generated UUID if not provided)
- Context fields: `endpoint`, `ip`, `error`, and arbitrary key-value pairs
- Cloudflare automatically indexes JSON-formatted logs

**Example:**
```typescript
import { logError } from '../../lib/logger';

logError('review_submission_failed', {
  endpoint: '/api/reviews/submit',
  ip: context.clientAddress,
  building_id: building.id,
  error: error.message
});
```

## Comments

**When to Comment:**
- File-level JSDoc for critical modules (e.g., `/**\n * Scoring System for RateMyPlace\n * Methodology based on housing quality research...\n */`)
- Function-level comments for non-obvious logic (e.g., recency weight calculations, complex filtering)
- Inline comments for "why" not "what" (explain the intent, not the code)
- Section headers in tests using visual separators (e.g., `// ═══════════════════════════════════════════════════`)

**JSDoc/TSDoc:**
- Function parameters documented with JSDoc for public APIs
- Example from `scoring.ts`:
```typescript
/**
 * Calculate weighted score for a set of items
 */
function calculateWeightedScore(
  scores: Record<string, number | null | undefined>,
  fields: readonly string[]
): WeightedScoreResult | null { ... }
```

## Function Design

**Size:** 
- Functions generally 15-40 lines in utility files
- Component functions (React) may be longer due to state/hooks
- Test helper functions kept small and focused (5-15 lines)

**Parameters:**
- Prefer object parameters for functions with 3+ arguments (destructuring)
- Use readonly arrays for field lists to prevent mutation
- Type all parameters explicitly

**Return Values:**
- Functions return `null` for "no data" scenarios (e.g., `calculateWeightedScore() => WeightedScoreResult | null`)
- API routes return `Response` objects with JSON bodies and proper headers
- Most utility functions return typed objects or primitives, never `undefined` (prefer `null`)

**Example:**
```typescript
export function calculateWeightedScore(
  scores: Record<string, number | null | undefined>,
  fields: readonly string[]
): WeightedScoreResult | null {
  let weightedSum = 0;
  let totalWeight = 0;
  let itemCount = 0;

  for (const field of fields) {
    const value = scores[field];
    if (value !== null && value !== undefined && typeof value === 'number') {
      const weight = ITEM_WEIGHTS[field as ScoreFieldName] || 1.0;
      weightedSum += value * weight;
      totalWeight += weight;
      itemCount++;
    }
  }

  if (itemCount === 0) return null;
  return { score: weightedSum / totalWeight, weightedSum, totalWeight, itemCount };
}
```

## Module Design

**Exports:**
- Each library file exports a primary function or interface set
- Always export types alongside implementation (e.g., `export interface ValidationError`, `export type NotificationEventType`)
- Constants exported (e.g., `export const ITEM_WEIGHTS: Record<ScoreFieldName, number> = {...}`)

**Barrel Files:**
- Not used in this codebase; imports use direct file paths

**Single Responsibility:**
- `scoring.ts`: All scoring calculations (weights, domain scores, aggregation)
- `validation.ts`: All input validation and sanitization
- `audit.ts`: Audit log creation (immutable trail)
- `logger.ts`: Structured JSON logging helper
- `notifications.ts`: User notification creation

---

*Convention analysis: 2026-04-26*
