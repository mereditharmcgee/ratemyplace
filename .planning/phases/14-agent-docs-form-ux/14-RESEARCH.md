# Phase 14: Agent Docs & Form UX - Research

**Researched:** 2026-02-28
**Domain:** API documentation, JSDoc annotations, form submit UX, ESLint setup
**Confidence:** HIGH

## Summary

Phase 14 is a documentation and code quality phase. It has two distinct work streams:

**Stream 1 (Plan 14-01): Documentation.** Two new Astro pages must be created from scratch — `api.html` (actually `src/pages/api-docs.astro` or a static HTML file served from `public/`) and `agent-guide.html`. Neither file exists today. The API routes are all TypeScript files under `src/pages/api/`. Documentation must cover every endpoint's response codes, stored procedure error behavior (Cloudflare D1 throws on UNIQUE constraint failures, FK violations, etc.), plus working Python `requests` and Node `fetch` code snippets.

**Stream 2 (Plan 14-02): Code quality.** ESLint is not installed — it must be added. All Astro-based forms (signin, signup, forgot-password, reset-password) already correctly use `try/catch/finally` blocks to guarantee button re-enable. `DisputeForm.tsx` uses `setLoading(false)` in separate `if/catch` branches without a `finally` — this is the primary fix needed for AGNT-04. `src/lib/auth.ts` has no JSDoc. Several other lib files have partial or no JSDoc coverage.

**Primary recommendation:** Plan 14-01 creates two new Astro/static pages with complete API docs and code examples. Plan 14-02 runs an ESLint setup, fixes DisputeForm's loading state pattern, and adds JSDoc to `src/lib/auth.ts` and the `src/lib/` utility files that lack it.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-01 | api.html documents stored procedure error behavior and response codes for every endpoint | All API routes catalogued; D1 error patterns documented below |
| AGNT-02 | api.html includes working Python `requests` code snippets | Python snippet patterns documented in Code Examples section |
| AGNT-03 | api.html includes working Node `fetch` code snippets | Node snippet patterns documented in Code Examples section |
| AGNT-04 | Every form re-enables submit button after both success and error | Audit complete; DisputeForm.tsx is the primary fix needed |
| AGNT-05 | Every form shows visible success or error message after submission | Audit complete; ReviewForm redirects on success (no message needed); others documented |
| AGNT-06 | ESLint reports zero errors across all JS files in js/ | ESLint not installed; setup pattern documented below |
| AGNT-07 | All public methods in utils.js have JSDoc annotations | Interpreted as src/lib/*.ts utility files; gaps documented |
| AGNT-08 | All public methods in auth.js have JSDoc annotations | auth.ts has zero JSDoc; single exported function `initializeLucia()` |
| AGNT-09 | agent-guide.html reflects the current onboarding path | New file; onboarding path documented from ARCHITECTURE.md and STATE.md |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Astro 5 | 5.16.11 | Page framework for api.html and agent-guide.html | Already in use; static Astro pages are the project standard |
| TypeScript | strict | Language for all lib files requiring JSDoc | Already in use |
| JSDoc | built-in | Inline documentation annotations | No extra dependency needed; works with TypeScript via `/** */` syntax |

### Supporting (ESLint setup)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| eslint | ^9.x | JavaScript/TypeScript linting | AGNT-06 requires zero ESLint errors |
| @eslint/js | ^9.x | ESLint core rules config | Flat config format (ESLint 9 default) |
| typescript-eslint | ^8.x | TypeScript-aware ESLint rules | Required for .ts/.tsx files |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ESLint 9 flat config | ESLint 8 legacy config (.eslintrc) | ESLint 9 is current; flat config is the modern standard as of 2024 |
| Static HTML in public/ | Astro page for api docs | Astro page gets layout/nav; static HTML is simpler if nav not needed |

**Installation (ESLint):**
```bash
npm install --save-dev eslint @eslint/js typescript-eslint
```

## Architecture Patterns

### Key Finding: No js/ Directory Exists

The phase description references "all JS files in js/" and "utils.js" and "auth.js" — these do not correspond to any existing directory or files. The project uses TypeScript throughout. The correct interpretation:

- **AGNT-06** ("ESLint against js/ directory"): Run ESLint against `src/` (all `.ts` and `.tsx` files)
- **AGNT-07** ("utils.js"): Target the utility lib files: `src/lib/api.ts`, `src/lib/db.ts`, `src/lib/validation.ts`, `src/lib/rateLimit.ts`, `src/lib/scoring.ts`, `src/lib/password.ts`, `src/lib/tokens.ts`, `src/lib/disputes.ts`, `src/lib/audit.ts`, `src/lib/email.ts`, `src/lib/logger.ts`, `src/lib/privacy.ts`, `src/lib/storage.ts`
- **AGNT-08** ("auth.js"): Target `src/lib/auth.ts`

### Form Submit Button Pattern Audit

**Astro pages with plain JS submit handlers (already CORRECT):**

| Page | Button Re-Enable | Success Feedback | Error Feedback |
|------|------------------|-----------------|----------------|
| `src/pages/auth/signin.astro` | `finally` block sets `button.disabled = false` | Redirects to `/` | Shows `#error-message` div |
| `src/pages/auth/signup.astro` | `finally` block sets `button.disabled = false` | Redirects to `/` | Shows `#error-message` div |
| `src/pages/auth/forgot-password.astro` | `finally` block sets `button.disabled = false` | Shows `#success-message` div | Shows `#error-message` div |
| `src/pages/auth/reset-password.astro` | `finally` block sets `button.disabled = false` | Shows `#success-container`, hides form | Shows `#error-message` div |

**React components (DisputeForm needs fix):**

| Component | Button Re-Enable | Success Feedback | Error Feedback | Fix Needed? |
|-----------|------------------|-----------------|----------------|-------------|
| `DisputeForm.tsx` | `setLoading(false)` in if/catch branches — NO `finally` | Renders success JSX block | Sets `error` state | YES — add finally |
| `ReviewForm.tsx` | `finally` blocks (3 handlers) | Redirects to building page | Sets `error` state | No |
| `ReviewEditForm.tsx` | `finally` block | Sets `success` state, redirects | Sets `error` state | No |

**DisputeForm.tsx current (broken) pattern:**
```typescript
// handleSubmit in DisputeForm.tsx
try {
  const response = await fetch('/api/disputes', { ... });
  const data = await response.json();

  if (!response.ok) {
    setError(data.error || 'Failed to submit dispute');
    setLoading(false);  // Only set here in error path
    return;             // Early return before finally
  }

  setSuccess(true);
  setLoading(false);  // Only set here in success path
} catch (err) {
  setError('An unexpected error occurred. Please try again.');
  setLoading(false);  // Only set here in catch
}
```

**Correct pattern (use finally):**
```typescript
// Fixed pattern - guarantees button re-enable on ALL exits
try {
  const response = await fetch('/api/disputes', { ... });
  const data = await response.json();

  if (!response.ok) {
    setError(data.error || 'Failed to submit dispute');
    return;
  }

  setSuccess(true);
} catch (err) {
  console.error('Submit error:', err);
  setError('An unexpected error occurred. Please try again.');
} finally {
  setLoading(false);  // Always runs — button always re-enables
}
```

### API Documentation Page Architecture

The phase calls for `api.html` but the project uses Astro. Two approaches:

**Option A: Astro page at `src/pages/api-docs.astro`** — gets the site layout/nav, consistent with all other pages. Route is `/api-docs`. Rename convention matches existing pages.

**Option B: Static file at `public/api.html`** — served as-is at `/api.html`. Simpler but no layout.

**Recommendation: Use Astro page** (`src/pages/api-docs.astro`) — it inherits BaseLayout, stays consistent with methodology.astro pattern. The route `/api-docs` is cleaner than `/api.html` but the success criterion says "api.html" so use `src/pages/api.html.astro` which Astro serves at `/api.html`, OR simply create the Astro page and note the URL. Actually, the simplest approach: create `src/pages/api-guide.astro` (serves at `/api-guide`) OR create the file as a static HTML in `public/api.html`. Given the requirement says "api.html documents...", the intent is the page URL `/api.html` — use `public/api.html` as a self-contained HTML file.

**Agent-guide.html** similarly goes to `public/agent-guide.html` as a self-contained static HTML file describing the onboarding path.

### ESLint Configuration Pattern (ESLint 9 Flat Config)

ESLint 9 uses `eslint.config.js` (flat config format). For a TypeScript + React project:

```javascript
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Project-specific overrides
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**'],
  }
);
```

**Run command:**
```bash
npx eslint src/
```

### JSDoc Pattern for TypeScript

The project already has good examples in `src/lib/rateLimit.ts` and `src/lib/api.ts`:

```typescript
/**
 * Brief description of what the function does.
 *
 * @param paramName - Description of the parameter
 * @returns Description of return value
 */
export function exampleFunction(paramName: string): boolean {
  // ...
}
```

**Files needing JSDoc (AGNT-07/08):**

| File | Exported Functions | JSDoc Status |
|------|-------------------|--------------|
| `src/lib/auth.ts` | `initializeLucia(db)` | NONE — needs JSDoc |
| `src/lib/db.ts` | `getDB(runtime)` | NONE — needs JSDoc |
| `src/lib/validation.ts` | `validateReviewForm(data)`, `sanitizeText(text)` | NONE — needs JSDoc |
| `src/lib/api.ts` | `jsonResponse()`, `errorResponse()`, `redirectResponse()`, `ApiErrors` | Has `/** */` comments — GOOD |
| `src/lib/rateLimit.ts` | `checkRateLimit()`, `getClientIP()` | Has full JSDoc — GOOD |
| `src/lib/scoring.ts` | Multiple exports | Needs audit |
| `src/lib/password.ts` | Exports | Needs audit |
| `src/lib/tokens.ts` | Exports | Needs audit |
| `src/lib/disputes.ts` | Exports | Needs audit |
| `src/lib/audit.ts` | Exports | Needs audit |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ESLint TypeScript support | Custom TS type checker | `typescript-eslint` | Battle-tested, handles TSX, JSX, type-aware rules |
| HTML syntax highlighting in static docs | Custom renderer | Plain HTML with `<pre><code>` blocks | No framework needed for static docs |
| API doc generation | Auto-generate from code | Write manually | Codebase is TypeScript; no JSDoc-to-HTML tooling is set up |

**Key insight:** This phase is documentation and code quality polish, not new functionality. The work is writing/annotating, not building infrastructure.

## Common Pitfalls

### Pitfall 1: AGNT-06 "js/ directory" Misinterpretation
**What goes wrong:** Planner looks for a `js/` directory, finds nothing, declares requirement impossible.
**Why it happens:** The requirement wording references "js/ directory" and "utils.js/auth.js" which don't exist in this TypeScript project.
**How to avoid:** Interpret as `src/` directory targeting `.ts` and `.tsx` files. ESLint with `typescript-eslint` handles these files.
**Warning signs:** If a task says "create js/ directory" — that's wrong.

### Pitfall 2: DisputeForm Loading State Race Condition
**What goes wrong:** Using `return` inside a `try` block before `setLoading(false)` causes stuck buttons if the code path changes.
**Why it happens:** Current DisputeForm.tsx uses early `return` after setting loading false — if a new code path is added that doesn't hit the return, button stays stuck.
**How to avoid:** Always put `setLoading(false)` in `finally {}` block — it runs on every path.
**Warning signs:** Multiple `setLoading(false)` calls scattered through try/catch branches.

### Pitfall 3: ESLint on Astro Files
**What goes wrong:** Running ESLint on `.astro` files fails because ESLint doesn't understand Astro syntax without a plugin.
**Why it happens:** Astro files contain both TypeScript frontmatter and HTML template.
**How to avoid:** Only run ESLint against `src/**/*.{ts,tsx}` files, not `.astro` files. The AGNT-06 requirement says "JS files in js/" — scope to `.ts/.tsx` only.
**Warning signs:** ESLint error about "unexpected token" on frontmatter `---`.

### Pitfall 4: api.html Route Collision
**What goes wrong:** Creating `src/pages/api.html.astro` collides with the `src/pages/api/` directory in some Astro versions.
**Why it happens:** Astro's routing uses the directory name `api` for the API route prefix.
**How to avoid:** Use `public/api.html` (static file served directly) or name the Astro page `api-docs.astro` at route `/api-docs`. The simplest: `public/api.html` avoids all routing conflicts.
**Warning signs:** Build errors about conflicting routes.

### Pitfall 5: JSDoc on TypeScript Already-Typed Functions
**What goes wrong:** Writing JSDoc `@param {string}` type annotations on TypeScript functions that already have types.
**Why it happens:** Copy-paste from JavaScript JSDoc examples.
**How to avoid:** In TypeScript, JSDoc `@param` does NOT need the type in curly braces — just write `@param paramName - description`. The TypeScript type declaration IS the type annotation.

```typescript
// WRONG in TypeScript:
/** @param {string} name - The name */
export function greet(name: string): string { }

// CORRECT in TypeScript:
/** @param name - The name to greet */
export function greet(name: string): string { }
```

## Code Examples

### DisputeForm Fix (AGNT-04)
```typescript
// src/components/disputes/DisputeForm.tsx — handleSubmit fix
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!validateForm()) {
    return;
  }

  setLoading(true);
  setError(null);

  try {
    const response = await fetch('/api/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewUrl,
        landlordName,
        landlordEmail,
        landlordPhone,
        disputeReasons,
        disputeExplanation: disputeExplanation || undefined,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || 'Failed to submit dispute');
      return;
    }

    setSuccess(true);
  } catch (err) {
    console.error('Submit error:', err);
    setError('An unexpected error occurred. Please try again.');
  } finally {
    setLoading(false);  // Guaranteed to run — button always re-enables
  }
};
```

### JSDoc for auth.ts (AGNT-08)
```typescript
// src/lib/auth.ts
/**
 * Initialize a Lucia auth instance configured for Cloudflare D1.
 * Creates an adapter for the `users` and `sessions` tables and
 * exposes typed user attributes (email, isAdmin, etc.) via getUserAttributes.
 *
 * @param db - The Cloudflare D1 database instance
 * @returns Configured Lucia instance for the application
 */
export function initializeLucia(db: D1Database) {
  // ...
}
```

### JSDoc for db.ts (AGNT-07)
```typescript
// src/lib/db.ts
/**
 * Extract the D1 database instance from the Cloudflare Workers runtime context.
 * Throws if the DB binding is not configured in wrangler.jsonc.
 *
 * @param runtime - The Cloudflare runtime object from `context.locals.runtime`
 * @returns The D1 database instance bound as `DB`
 * @throws Error if the DB binding is missing from the runtime environment
 */
export function getDB(runtime: any): D1Database {
  // ...
}
```

### Python requests snippet pattern (AGNT-02)
```python
import requests

BASE_URL = "https://ratemyplace.org"

# POST /api/disputes — submit a dispute (no auth required)
response = requests.post(
    f"{BASE_URL}/api/disputes",
    json={
        "reviewUrl": "https://ratemyplace.org/building/123-main-st-boston?review=abc123",
        "landlordName": "John Smith",
        "landlordEmail": "john@example.com",
        "landlordPhone": "617-555-0100",
        "disputeReasons": ["The review contains false information"],
        "disputeExplanation": "The reviewer was never a tenant at this property."
    }
)
# 201: { "success": true, "disputeId": "uuid" }
# 400: { "error": "Missing required fields" }
# 404: { "error": "Review not found. Please check the URL and try again." }
# 409: { "error": "A dispute already exists for this review." }
# 500: { "error": "Failed to submit dispute" }
print(response.status_code, response.json())
```

### Node fetch snippet pattern (AGNT-03)
```javascript
// POST /api/disputes — submit a dispute (no auth required)
const response = await fetch('https://ratemyplace.org/api/disputes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    reviewUrl: 'https://ratemyplace.org/building/123-main-st-boston?review=abc123',
    landlordName: 'John Smith',
    landlordEmail: 'john@example.com',
    landlordPhone: '617-555-0100',
    disputeReasons: ['The review contains false information'],
    disputeExplanation: 'The reviewer was never a tenant at this property.'
  })
});
// 201: { success: true, disputeId: "uuid" }
// 400: { error: "Missing required fields" }
// 409: { error: "A dispute already exists for this review." }
const data = await response.json();
console.log(response.status, data);
```

## API Endpoint Inventory (for AGNT-01)

Every endpoint the planner must document in api.html:

### Public Endpoints (no auth required)
| Method | Path | Request | Response Codes | D1 Error Cases |
|--------|------|---------|----------------|----------------|
| POST | `/api/disputes` | JSON body | 201 success, 400 missing fields, 400 invalid URL, 404 review not found, 409 UNIQUE constraint (duplicate dispute), 500 DB error | UNIQUE constraint on `review_id` → 409; any other DB error → 500 |
| GET | `/api/buildings` | `?placeId=` query param | 200 with building or null, 500 | - |
| GET | `/api/buildings/map` | None | 200 array, 500 | - |
| GET | `/api/places/autocomplete` | `?input=` query param | 200 results, 500 | - |
| GET | `/api/places/details` | `?placeId=` query param | 200 details, 500 | - |
| POST | `/api/auth/signup` | FormData (email, password) | 200 success, 400 validation, 409 duplicate email, 500 | UNIQUE on email → 409 |
| POST | `/api/auth/signin` | FormData (email, password) | 200 success, 400 missing fields, 401 invalid credentials, 429 rate limited, 500 | Rate limit DB fail → 503 (fail-closed) |
| POST | `/api/auth/signout` | None | 200 | - |
| GET | `/api/auth/google` | None | 302 redirect to Google | - |
| GET | `/api/auth/google/callback` | OAuth callback | 302 redirect to home or error | - |
| POST | `/api/auth/forgot-password` | FormData (email) | 200 success (always, even if email not found), 429 rate limited | - |
| POST | `/api/auth/reset-password` | FormData (token, password) | 200 success, 400 invalid/expired token, 429 rate limited | - |
| GET | `/api/auth/verify-email` | `?token=` query param | 302 redirect | - |
| POST | `/api/auth/resend-verification` | None (auth required) | 200, 401, 429 | - |

### Auth-Required Endpoints
| Method | Path | Auth | Request | Response Codes |
|--------|------|------|---------|----------------|
| POST | `/api/reviews` | User | FormData (27 fields) | 200 success, 400 missing building_id, 401 not authed, 404 building not found, 500 |
| GET | `/api/reviews/user` | User | None | 200 array, 401 |
| PATCH | `/api/reviews/[id]` | User (own review) | JSON body | 200, 401, 403, 404, 500 |

### Admin-Only Endpoints
| Method | Path | Request | Response Codes |
|--------|------|---------|----------------|
| GET | `/api/admin/reviews` | None | 200 array, 401, 403 |
| PATCH | `/api/admin/reviews/[id]` | JSON `{ status }` | 200, 400 invalid status, 401, 403, 404, 500 |
| DELETE | `/api/admin/reviews/[id]` | None | 200, 401, 403, 404, 500 |
| GET | `/api/admin/users` | None | 200 array, 401, 403 |
| GET/PATCH | `/api/admin/users/[id]` | JSON for PATCH | 200, 401, 403, 404, 500 |
| GET | `/api/admin/disputes` → via `/api/disputes` GET | None | 200 array, 401, 403 |
| PATCH | `/api/disputes/[id]` | JSON `{ resolutionOutcome, resolutionNotes }` | 200, 401, 403, 404, 500 |
| GET | `/api/admin/audit` | None | 200 array, 401, 403 |
| GET/POST | `/api/admin/buildings/...` | Various | 200, 401, 403, 404, 500 |
| GET/PATCH/DELETE | `/api/admin/landlords/[id]` | Various | 200, 401, 403, 404, 500 |
| GET/POST/DELETE | `/api/admin/managers/...` | Various | 200, 401, 403, 404, 500 |
| GET | `/api/admin/pending-verifications` | None | 200 array, 401, 403 |
| POST | `/api/admin/verification/[id]` | JSON `{ action }` | 200, 401, 403, 404, 500 |
| POST | `/api/verification/upload` | FormData (file) | 200, 400, 401, 413, 500 |

### D1 Stored Procedure Error Behavior (AGNT-01 critical detail)

Cloudflare D1 executes SQL directly — there are no stored procedures. However, D1 throws JavaScript errors when SQL constraints are violated. All endpoints catch these and return appropriate HTTP status codes:

| D1 Error Type | When It Occurs | HTTP Response |
|---------------|----------------|---------------|
| `UNIQUE constraint failed` | Duplicate email on signup; duplicate dispute for a review | 409 Conflict with `{ error: "..." }` |
| `FOREIGN KEY constraint failed` | Insert references non-existent parent record | 500 (falls to catch block) |
| D1 binding missing | `DB` not configured in wrangler.jsonc | 500 (getDB throws) |
| Network timeout | D1 edge timeout | 500 (falls to catch block) |
| Rate limit DB error | D1 unavailable during rate check | 503 or 429 (fail-closed: denied) |

The `checkRateLimit()` function in `src/lib/rateLimit.ts` is fail-closed: if the D1 call to check the rate limit table fails, it returns `allowed: false` with a 60-second retry window.

## Agent Onboarding Path (AGNT-09)

`agent-guide.html` must reflect the current onboarding path for a developer or AI agent starting on this codebase:

1. **Read `CLAUDE.md`** — coding conventions, patterns, security checklist
2. **Read `CLAUDE_CONTEXT.md`** — project mission, scoring methodology, all key context
3. **Read `ARCHITECTURE.md`** — tech stack, project structure, database schema, API endpoints
4. **Read `src/lib/scoring.ts`** — critical scoring logic with weights
5. **Run `npm run db:fresh && npm run db:seed`** — reset local D1 and populate test data
6. **Run `npm test`** — verify unit tests pass (vitest)
7. **Run `npm run e2e`** — run full Playwright E2E suite (requires local dev server)
8. **Deployment**: `git push origin main` auto-deploys to Cloudflare Pages

Current milestone: v1.3.0 "Battle Tested" — Phase 8 in progress (Admin and Disputes E2E).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.eslintrc.json` config | `eslint.config.js` flat config | ESLint 9.0 (2024) | Must use flat config for ESLint 9 |
| `@typescript-eslint/eslint-plugin` separate | `typescript-eslint` unified package | typescript-eslint v8 (2024) | Single package replaces parser + plugin |
| JSDoc type annotations `{string}` in TypeScript | Type-only JSDoc descriptions (no type braces) | TypeScript adoption | TypeScript types are the source of truth |

**Deprecated/outdated:**
- `.eslintrc.json`: Legacy format, ESLint 9 uses flat config by default
- `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` separately: Replaced by the unified `typescript-eslint` package

## Open Questions

1. **api.html file location — Astro page vs. static HTML**
   - What we know: Success criterion says "api.html"; the project has no existing equivalent
   - What's unclear: Whether the URL must be `/api.html` or if `/api-docs` is acceptable
   - Recommendation: Use `public/api.html` (static file) to ensure the URL is exactly `/api.html` without routing conflicts with `src/pages/api/` directory

2. **Scope of JSDoc for AGNT-07**
   - What we know: Requirement says "all public methods in utils.js" — no utils.js exists
   - What's unclear: Whether ALL lib files need JSDoc or just the most important ones
   - Recommendation: Focus on `src/lib/auth.ts`, `src/lib/db.ts`, `src/lib/api.ts`, `src/lib/validation.ts`, `src/lib/rateLimit.ts` (already has JSDoc) — the core utility files

3. **ESLint errors in existing codebase**
   - What we know: ESLint is not installed; the codebase has `any` types and some patterns that may trigger rules
   - What's unclear: How many pre-existing lint violations exist before fixing
   - Recommendation: Install ESLint with lenient initial config; run once to assess; fix violations or configure rules to match project conventions (e.g., allow `any` where `context.locals.runtime` is used)

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — all source files read directly
- `src/pages/api/**/*.ts` — complete API route inventory
- `src/components/**/*.tsx` — complete form component audit
- `src/pages/auth/**/*.astro` — complete auth form audit

### Secondary (MEDIUM confidence)
- ESLint 9 documentation (flat config) — based on knowledge of ESLint 9 release in 2024
- typescript-eslint v8 unified package — based on knowledge of 2024 consolidation

### Tertiary (LOW confidence)
- None — all research is from direct source inspection

## Metadata

**Confidence breakdown:**
- Form audit (AGNT-04/05): HIGH — read every form file directly
- API endpoint inventory (AGNT-01/02/03): HIGH — read all API route files
- JSDoc gaps (AGNT-07/08): HIGH — read all lib files
- ESLint setup (AGNT-06): MEDIUM — ESLint 9 flat config knowledge from training, should be verified against current ESLint docs
- File placement (api.html, agent-guide.html): MEDIUM — routing conflict risk documented

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable project conventions)
