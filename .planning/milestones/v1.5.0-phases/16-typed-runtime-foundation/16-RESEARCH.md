# Phase 16: Typed Runtime Foundation - Research

**Researched:** 2026-04-27
**Domain:** Astro 5 / @astrojs/cloudflare adapter — App.Platform typing, runtime locals, TypeScript strict-mode migration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Helper API surface:** New file `src/lib/runtime.ts` with `getEnv(context: APIContext): App.Platform['env']`. Env var access goes through the helper. `ctx` and `cf` accessed directly on `context.locals.runtime.*`.
- **Helper error behavior:** `getEnv(context)` throws `Error("Cloudflare runtime unavailable — are you running in Wrangler?")` when `context.locals.runtime` is undefined. Fail-fast, no silent fallback.
- **db.ts contract:** Refactor `getDB` signature to `getDB(context: APIContext): D1Database`. Internally calls `getEnv(context).DB`.
- **Env var typing:** All 6 Pages secrets typed as `string` (required, not optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`. Existing bindings `DB`, `VERIFICATION_BUCKET`, `TURNSTILE_SECRET_KEY` stay.
- **Cast retirement strategy:** Single mechanical PR, all-or-nothing. Sequence: env.d.ts → runtime.ts → db.ts → middleware.ts → batch find-and-replace remaining files. Verify with `grep -rn "(context.locals as any).runtime" src/` returning zero. Build must pass (`npm run build`) before committing. E2E suite before pushing.

### Claude's Discretion

- Whether to use `sed`, `node`, or a shell script for the batch replacement
- Exact TypeScript wording in the throw message (as long as it's clear and points at the runtime / Wrangler)
- Whether `getEnv(context)` returns `App.Platform['env']` directly or a derived narrow type

### Deferred Ideas (OUT OF SCOPE)

- `getCtx(context)` helper for `waitUntil`
- `getCf(context)` helper for `cf` request properties
- Static type-level enforcement that `wrangler.jsonc` declares all `App.Platform.env` keys
- Migrating unit tests to use mock runtime fixtures
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | All Cloudflare Pages secrets typed in `App.Platform.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`) | env.d.ts declaration pattern verified against @astrojs/cloudflare Runtime<T> generic |
| INFRA-02 | `runtime: App.Platform` declared on `App.Locals`; `getDB` signature updated to consume typed locals | App.Locals extension verified; Runtime<T> shape in handler.d.ts confirms the property name is `runtime` |
| INFRA-03 | All 71 `(context.locals as any).runtime` casts replaced with typed access in single mechanical PR | Actual cast count verified at 70 API/page-level (context) + 1 middleware + 10 Astro-page-level (Astro.locals) + 6 rawLocals patterns = more than 71 total; scope fully enumerated |
</phase_requirements>

---

## Summary

This phase is a pure TypeScript type-correctness migration. No runtime behavior changes. The Cloudflare adapter already populates `context.locals.runtime` at runtime via the `Runtime<T>` interface (from `@astrojs/cloudflare/dist/utils/handler.d.ts`). The problem is that `App.Locals` does not yet declare the `runtime` property, so every access site must cast through `as any` to avoid TypeScript errors.

The fix is three-part: (1) extend `App.Platform.env` with the 6 missing secrets and extend `App.Locals` with `runtime: App.Platform`; (2) create `src/lib/runtime.ts` with `getEnv(context)` and refactor `getDB` to accept context; (3) batch-replace all cast sites. The migration is entirely mechanical once the type declarations are in place.

One critical finding: the CONTEXT.md states 71 casts, but the actual codebase has more patterns to address. The `grep` for `(context.locals as any).runtime` found 70 matches in API routes + middleware. Additionally, there are 10 Astro page-level casts (`(Astro.locals as any).runtime`), 1 component cast (`Header.astro`), and 6 `rawLocals as any` patterns in `disputes.ts` and `disputes/[id].ts`. The planning must account for all cast variants, not just `context.locals as any`.

**Primary recommendation:** Declare types in the required order (env.d.ts first), then write `runtime.ts`, then update `db.ts`, then run a single batch replacement covering all three cast variants: `(context.locals as any)`, `(Astro.locals as any)`, and `rawLocals as any`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@astrojs/cloudflare` | 12.6.12 | Astro adapter; populates `context.locals.runtime` | Already in use — provides the `Runtime<T>` shape |
| `@cloudflare/workers-types` | 4.20260117.0 | TypeScript types for D1Database, R2Bucket, ExecutionContext, IncomingRequestCfProperties | Already imported in env.d.ts |
| TypeScript (strict mode) | via Astro | Enforces the type declarations | Already enabled |

### No New Dependencies
This phase adds zero new packages. All required types are already in `@cloudflare/workers-types`.

---

## Architecture Patterns

### How @astrojs/cloudflare Provides the Runtime

The adapter's `handler.d.ts` exports:

```typescript
// Source: node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts
export interface Runtime<T extends object = object> {
  runtime: {
    env: Env & T;
    cf: Parameters<ExportedHandlerFetchHandler>[0]['cf'];
    caches: CloudflareCacheStorage;
    ctx: ExecutionContext;
  };
}
```

The adapter merges this `runtime` object into `context.locals` at request time. The property name is literally `runtime`. To get TypeScript to know this, you add `runtime: App.Platform` to `App.Locals`.

### Current env.d.ts (what exists today)

```typescript
// src/env.d.ts — CURRENT STATE
declare namespace App {
  interface Platform {
    env: {
      DB: D1Database;
      VERIFICATION_BUCKET: R2Bucket;
      TURNSTILE_SECRET_KEY: string;
    };
    cf: import('@cloudflare/workers-types').IncomingRequestCfProperties;
    ctx: import('@cloudflare/workers-types').ExecutionContext;
  }

  interface Locals {
    user: import('lucia').User | null;
    session: import('lucia').Session | null;
    // MISSING: runtime: App.Platform
  }
}
```

### Target env.d.ts (after this phase)

```typescript
// src/env.d.ts — TARGET STATE
declare namespace App {
  interface Platform {
    env: {
      DB: D1Database;
      VERIFICATION_BUCKET: R2Bucket;
      TURNSTILE_SECRET_KEY: string;
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      GOOGLE_MAPS_API_KEY: string;
      GOOGLE_PLACES_API_KEY: string;
      RESEND_API_KEY: string;
      SITE_URL: string;
    };
    cf: import('@cloudflare/workers-types').IncomingRequestCfProperties;
    ctx: import('@cloudflare/workers-types').ExecutionContext;
  }

  interface Locals {
    user: import('lucia').User | null;
    session: import('lucia').Session | null;
    runtime: App.Platform;
  }
}
```

### New src/lib/runtime.ts

```typescript
// src/lib/runtime.ts — NEW FILE
import type { APIContext } from 'astro';

export function getEnv(context: APIContext): App.Platform['env'] {
  const runtime = context.locals.runtime;
  if (!runtime) {
    throw new Error('Cloudflare runtime unavailable — are you running in Wrangler?');
  }
  return runtime.env;
}
```

### Refactored src/lib/db.ts

```typescript
// src/lib/db.ts — AFTER REFACTOR
import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getEnv } from './runtime';

export function getDB(context: APIContext): D1Database {
  const db = getEnv(context).DB;
  if (!db) {
    throw new Error('D1 Database not found. Make sure you have configured the DB binding.');
  }
  return db;
}
```

### Three Cast Variants to Replace

The codebase has three distinct cast patterns, all of which must be retired:

**Variant A — API routes (context.locals):** 70 occurrences
```typescript
// BEFORE
const db = getDB((context.locals as any).runtime);
const runtime = (context.locals as any).runtime;

// AFTER
const db = getDB(context);
const env = getEnv(context);
```

**Variant B — Astro pages (Astro.locals):** 10 occurrences
```typescript
// BEFORE
const db = getDB((Astro.locals as any).runtime);
const runtime = (Astro.locals as any).runtime;

// AFTER
// NOTE: Astro pages do NOT use APIContext — they use AstroGlobal.
// getDB and getEnv take APIContext. Astro pages must use Astro.locals.runtime directly.
const db = getDB(Astro as any as APIContext);  // NOT correct
// Correct approach: access typed locals directly
const db = Astro.locals.runtime // once runtime is on App.Locals, no cast needed
```

**Variant C — rawLocals patterns:** 6 occurrences in disputes.ts and disputes/[id].ts
```typescript
// BEFORE
export const POST: APIRoute = async ({ request, locals: rawLocals }) => {
  const locals = rawLocals as any;
  const db = getDB(locals.runtime);

// AFTER
export const POST: APIRoute = async (context) => {
  const db = getDB(context);
```

### Astro Page vs API Route Typing Difference

This is a CRITICAL architectural distinction. `getDB(context: APIContext)` works perfectly for `src/pages/api/**/*.ts` files where the handler receives an `APIContext`. However, `.astro` page frontmatter uses `Astro` (type `AstroGlobal`), not `APIContext`.

Once `runtime: App.Platform` is declared on `App.Locals`, `.astro` pages can access it without any cast:
```typescript
// In .astro page frontmatter — no cast needed after INFRA-02
const db = Astro.locals.runtime.env.DB; // typed, no cast
// OR: create a small helper in db.ts for Astro pages OR just inline it
```

For `.astro` pages that call `getDB()`, the planner must decide whether to:
1. Extract the `D1Database` inline: `const db = Astro.locals.runtime.env.DB;` (simpler, no helper needed)
2. Create an overloaded `getDB` that also accepts `AstroGlobal` (more complex, not required by scope)

Given the locked decision that `getDB(context: APIContext)`, the simplest correct approach for `.astro` pages is to drop the helper and access `Astro.locals.runtime.env.DB` directly. This removes the cast without introducing a type mismatch.

Similarly, `Header.astro` (a component, not a page) uses `Astro.locals` — same pattern applies.

### wrangler.jsonc Gap

The current `wrangler.jsonc` only declares `DB` and `VERIFICATION_BUCKET` as D1/R2 bindings. The 6 string secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`) and `TURNSTILE_SECRET_KEY` are NOT declared. Cloudflare Pages secrets managed via the dashboard do not need `wrangler.jsonc` entries — they are injected at runtime. However, for local dev with `wrangler dev`, secrets must be in a `.dev.vars` file (gitignored). This is already the operational pattern; INFRA-01 only changes the TypeScript declarations, not the secret configuration mechanism.

The wrangler.jsonc `vars` block is optional for string secrets in Pages. No `wrangler.jsonc` change is required as part of this phase.

### Middleware Cast (Special Case)

The middleware cast at line 11 of `middleware.ts` is:
```typescript
const runtime = (context.locals as any).runtime;
if (!runtime?.env?.DB) {
  return next();
}
const db = getDB(runtime);
```

After INFRA-02, `context.locals.runtime` is typed (no cast needed). But the middleware uses a defensive null-check guard before calling `getDB`. After the refactor:
```typescript
// No cast needed — runtime is typed on App.Locals
if (!context.locals.runtime?.env?.DB) {
  return next();
}
const db = getDB(context);  // middleware receives APIContext
```

The middleware is a `defineMiddleware` handler which receives `context: APIContext`, so `getDB(context)` works directly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runtime type access | Custom type guard per file | `getEnv(context)` in `runtime.ts` | Centralizes null-check; consistent error message |
| Batch file editing | Manual edit per file | `git ls-files \| xargs sed` or equivalent | 70+ files — scripted replacement is safer than hand-editing |
| New type imports | Import `@cloudflare/workers-types` types in each file | Types flow from `App.Platform` via `App.Locals` | env.d.ts declarations are globally ambient — no per-file import needed |

---

## Common Pitfalls

### Pitfall 1: Astro Page vs APIContext Type Mismatch
**What goes wrong:** `getDB(context: APIContext)` cannot accept `Astro` (type `AstroGlobal`) directly. Attempting `getDB(Astro)` in `.astro` frontmatter produces a TypeScript error even after INFRA-02.
**Why it happens:** `.astro` pages expose `Astro` (AstroGlobal), not `APIContext`. They share `App.Locals` but have different top-level types.
**How to avoid:** For the 10 `.astro` page files and 1 `.astro` component, access `Astro.locals.runtime.env.DB` directly rather than calling `getDB()`. After INFRA-02 declares `runtime` on `App.Locals`, this is fully typed with no cast.
**Warning signs:** TypeScript error "Argument of type 'AstroGlobal' is not assignable to parameter of type 'APIContext'" after INFRA-02.

### Pitfall 2: rawLocals Pattern Missed by grep
**What goes wrong:** The grep pattern `(context.locals as any).runtime` misses the `rawLocals as any` pattern in `disputes.ts` and `disputes/[id].ts`.
**Why it happens:** Those files destructure `{ locals: rawLocals }` then cast the whole locals object: `const locals = rawLocals as any; const db = getDB(locals.runtime);`.
**How to avoid:** The batch replacement grep must also match `rawLocals as any` and `locals.runtime` in disputes files. Refactor those handlers to accept full `context` parameter.
**Warning signs:** Post-migration grep for `as any` still shows hits in `disputes.ts`.

### Pitfall 3: places/autocomplete.ts Uses Fallback Pattern
**What goes wrong:** `autocomplete.ts` and `details.ts` use `runtime?.env?.GOOGLE_PLACES_API_KEY || runtime?.env?.GOOGLE_MAPS_API_KEY` as a fallback. After migration to `getEnv(context)`, the env is not optional — `GOOGLE_PLACES_API_KEY` and `GOOGLE_MAPS_API_KEY` are both typed as `string`.
**Why it happens:** The original code guarded against missing keys with optional chaining. After INFRA-01, both keys are required strings, so the fallback becomes `getEnv(context).GOOGLE_PLACES_API_KEY || getEnv(context).GOOGLE_MAPS_API_KEY` (valid, just unnecessary if `GOOGLE_PLACES_API_KEY` is always configured).
**How to avoid:** Simplify to `getEnv(context).GOOGLE_PLACES_API_KEY` directly. The old fallback pattern was defensive; required typing makes it redundant.
**Warning signs:** TypeScript may not flag this — it's a logic smell, not a type error.

### Pitfall 4: signup.ts Has Duplicate runtime Variable
**What goes wrong:** `signup.ts` declares `const runtime = (context.locals as any).runtime` on line 48, then again on line 112 inside a try block. Both must be replaced.
**Why it happens:** The file was written with a top-level runtime variable that was then shadowed inside an inner scope.
**How to avoid:** The scripted replacement should catch both occurrences. Manual verification of `signup.ts` after replacement is recommended.
**Warning signs:** TypeScript error "Cannot redeclare block-scoped variable 'runtime'" if replacement is inconsistent.

### Pitfall 5: Partial Migration Breaks TypeScript
**What goes wrong:** If `App.Locals` is updated to include `runtime: App.Platform` BEFORE all cast sites are fixed, TypeScript will complain that `as any` is unnecessary. More critically, if some files mix typed and untyped access, type errors cascade.
**Why it happens:** TypeScript sees `context.locals.runtime` is now typed — the `as any` cast becomes an error target in strict mode.
**How to avoid:** The CONTEXT.md sequence is correct and must be followed strictly: declarations first, helpers second, consumers last. All replacements must happen in one PR.

### Pitfall 6: wrangler.jsonc secrets section unnecessary
**What goes wrong:** Adding a `[vars]` section to `wrangler.jsonc` for the 6 string secrets is wrong for Pages secrets. Secrets go in `.dev.vars` for local dev and via the Cloudflare dashboard / `wrangler pages secret put` for production.
**Why it happens:** Confusion between Cloudflare Workers `vars` (for non-secret config) and Pages secrets.
**How to avoid:** Do NOT modify `wrangler.jsonc` for string secrets. Only the TypeScript declaration (`env.d.ts`) changes in this phase.

---

## Code Examples

### Complete env.d.ts After INFRA-01 and INFRA-02

```typescript
/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import('@cloudflare/workers-types').D1Database;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;

declare namespace App {
  interface Platform {
    env: {
      DB: D1Database;
      VERIFICATION_BUCKET: R2Bucket;
      TURNSTILE_SECRET_KEY: string;
      GOOGLE_CLIENT_ID: string;
      GOOGLE_CLIENT_SECRET: string;
      GOOGLE_MAPS_API_KEY: string;
      GOOGLE_PLACES_API_KEY: string;
      RESEND_API_KEY: string;
      SITE_URL: string;
    };
    cf: import('@cloudflare/workers-types').IncomingRequestCfProperties;
    ctx: import('@cloudflare/workers-types').ExecutionContext;
  }

  interface Locals {
    user: import('lucia').User | null;
    session: import('lucia').Session | null;
    runtime: App.Platform;
  }
}
```

### src/lib/runtime.ts (new file)

```typescript
import type { APIContext } from 'astro';

export function getEnv(context: APIContext): App.Platform['env'] {
  const runtime = context.locals.runtime;
  if (!runtime) {
    throw new Error('Cloudflare runtime unavailable — are you running in Wrangler?');
  }
  return runtime.env;
}
```

### src/lib/db.ts (refactored)

```typescript
import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getEnv } from './runtime';

export function getDB(context: APIContext): D1Database {
  const db = getEnv(context).DB;
  if (!db) {
    throw new Error('D1 Database not found. Make sure you have configured the DB binding.');
  }
  return db;
}
```

### Typical API Route After Migration

```typescript
// BEFORE
export async function GET(context: APIContext): Promise<Response> {
  const db = getDB((context.locals as any).runtime);
  ...
}

// AFTER
export async function GET(context: APIContext): Promise<Response> {
  const db = getDB(context);
  ...
}
```

### Env-only Access in API Route After Migration

```typescript
// BEFORE (e.g., contact.ts)
const runtime = (context.locals as any).runtime;
const resendApiKey = runtime.env.RESEND_API_KEY;

// AFTER
import { getEnv } from '../../lib/runtime';
const resendApiKey = getEnv(context).RESEND_API_KEY;
```

### Astro Page After Migration (no getDB helper)

```typescript
// BEFORE (e.g., src/pages/admin/index.astro)
const db = getDB((Astro.locals as any).runtime);

// AFTER — Astro.locals.runtime is typed once INFRA-02 is done
// Option 1: access DB directly (simplest, avoids APIContext mismatch)
const db = Astro.locals.runtime.env.DB;

// Option 2: keep getDB import but pass runtime directly  
// NOT recommended — getDB now takes APIContext, not the runtime object
```

### rawLocals Refactor (disputes.ts)

```typescript
// BEFORE
export const POST: APIRoute = async ({ request, locals: rawLocals }) => {
  const locals = rawLocals as any;
  const db = getDB(locals.runtime);

// AFTER
export const POST: APIRoute = async (context) => {
  const db = getDB(context);
```

### Middleware After Migration

```typescript
// BEFORE
const runtime = (context.locals as any).runtime;
if (!runtime?.env?.DB) {
  return next();
}
const db = getDB(runtime);

// AFTER
if (!context.locals.runtime?.env?.DB) {
  return next();
}
const db = getDB(context);
```

### Verification Script

```bash
# Run after replacement — must return zero matches
grep -rn "(context.locals as any).runtime" src/
grep -rn "(Astro.locals as any).runtime" src/
grep -rn "rawLocals as any" src/
grep -rn "locals as any" src/
```

---

## Cast Inventory (Complete)

Based on actual codebase grep:

| Pattern | Count | Files |
|---------|-------|-------|
| `(context.locals as any).runtime` in API routes | 70 | 47 API .ts files |
| `(Astro.locals as any).runtime` in .astro pages | 9 | admin/contact.astro, admin/index.astro, building/[slug].astro, landlord/[slug].astro, map.astro, profile.astro, property-manager/[slug].astro, review/edit/[id].astro, review/new.astro, search.astro |
| `(Astro.locals as any).runtime` in .astro components | 1 | Header.astro |
| `rawLocals as any` + `locals.runtime` (disputes) | 6 | disputes.ts (3), disputes/[id].ts (3) |
| **Total unique cast sites to eliminate** | **~86** | Across all file types |

Note: The CONTEXT.md stated 71; this is the count from `grep -rn "(context.locals as any).runtime" src/` (API routes + middleware only). The Astro page-level and rawLocals patterns are additional. The plan must address all variants.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `context.locals as any` to access runtime | `context.locals.runtime` typed via `App.Locals` | This phase | IDE autocomplete works; TypeScript catches missing bindings |
| `getDB(runtime)` — pass the runtime object | `getDB(context)` — pass the full context | This phase | Callers don't need to think about runtime extraction |

---

## Open Questions

1. **Astro page getDB signature**
   - What we know: `getDB(context: APIContext)` works for API routes but not `.astro` pages (different type)
   - What's unclear: Whether the planner wants to overload `getDB` or simply inline `Astro.locals.runtime.env.DB` in page frontmatter
   - Recommendation: Inline `Astro.locals.runtime.env.DB` in the 10 `.astro` files. No overload needed — the access is typed without the helper. This is the simplest correct solution.

2. **SITE_URL fallback in signup.ts**
   - What we know: `signup.ts` line 115 uses `runtime.env.SITE_URL || context.url.origin` as a fallback
   - What's unclear: Whether to keep the fallback with typed access
   - Recommendation: Keep the fallback. Even though `SITE_URL` is typed as `string`, the runtime may return an empty string in edge cases. The fallback is defensive and harmless: `getEnv(context).SITE_URL || context.url.origin`.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit) + Playwright (e2e) |
| Config file | `vitest.config.*` (auto-detected by Astro), `playwright.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm run e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | All 6 secrets typed in App.Platform.env | type-check (build) | `npm run build` | N/A — build gate |
| INFRA-02 | runtime on App.Locals; getDB takes context | type-check (build) | `npm run build` | N/A — build gate |
| INFRA-03 | Zero remaining `as any` casts on runtime | grep assertion + build | `grep -rn "(context.locals as any).runtime" src/ && npm run build` | ❌ Wave 0 script |

INFRA-01/02/03 are type-correctness requirements. The primary verification mechanism is TypeScript compilation (`npm run build`). Grep assertions confirm zero residual casts. E2E tests confirm no runtime regression.

### Sampling Rate
- **Per task commit:** `npm run build` (zero TypeScript errors)
- **Per wave merge:** `npm test && npm run build`
- **Phase gate:** `npm run build` clean + `npm test` all green + zero grep hits before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Verification script for cast elimination: `scripts/verify-typed-runtime.sh` — grep pattern covering all three cast variants, exits non-zero on any match

*(Existing unit tests are pure-function and don't access runtime — no fixture changes needed. E2E tests exercise all auth/admin/contact routes that call `getDB` — full regression coverage without changes.)*

---

## Sources

### Primary (HIGH confidence)
- `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts` — confirms `Runtime<T>` interface shape with `runtime.env`, `runtime.ctx`, `runtime.cf`, `runtime.caches`
- `node_modules/@astrojs/cloudflare/dist/index.d.ts` — confirms adapter version 12.6.12 and `Runtime` export
- `src/env.d.ts` — current state: missing secrets, missing `runtime` on `App.Locals`
- `src/lib/db.ts` — current `getDB(runtime: any)` signature and fail-fast throw pattern
- `src/middleware.ts` — single cast on line 11; receives `APIContext`

### Secondary (MEDIUM confidence)
- Actual grep output across all 47 API .ts files — 70 occurrences of `(context.locals as any).runtime`
- Actual grep output across `.astro` files — 10 page + 1 component cast
- `disputes.ts` and `disputes/[id].ts` — 6 rawLocals cast patterns verified by direct inspection

### Tertiary (LOW confidence)
- None — all findings are from direct codebase inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; verified against installed adapter types
- Architecture: HIGH — handler.d.ts confirms Runtime<T> shape; env.d.ts confirms current gap; all cast sites enumerated by grep
- Pitfalls: HIGH — Astro page vs APIContext mismatch verified by type inspection; rawLocals pattern verified by grep; partial migration risk documented in CONTEXT.md

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable — @astrojs/cloudflare 12.x API unlikely to change)
