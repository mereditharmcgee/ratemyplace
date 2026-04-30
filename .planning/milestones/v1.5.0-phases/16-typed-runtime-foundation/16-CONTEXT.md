# Phase 16: Typed Runtime Foundation - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

The Cloudflare runtime is fully typed throughout the codebase. Every Pages secret used by the app is declared in `App.Platform.env`. `App.Locals` carries a typed `runtime` reference. All 71 `(context.locals as any).runtime` casts are eliminated in a single mechanical PR. After this phase, IDE autocomplete works on `context.locals.runtime.env.*` and `getDB(context)` is fully typed.

This phase delivers infrastructure only. It does NOT change runtime behavior, add user-facing features, or modify business logic. Every API route still does what it did before — it's just typed correctly.

</domain>

<decisions>
## Implementation Decisions

### Helper API surface — Mixed (helper for `env`, direct for `ctx`/`cf`)
- New helper: `getEnv(context: APIContext): App.Platform['env']`
- All env var access goes through the helper: `getEnv(context).RESEND_API_KEY`
- `ctx` (waitUntil, passThroughOnException) and `cf` (request properties) accessed directly: `context.locals.runtime.ctx.waitUntil(...)` and `context.locals.runtime.cf.country`
- Rationale: `env` is the most common access pattern (auth, email, maps, places, site URL); a helper saves verbosity in dozens of routes. `ctx` and `cf` are rare enough that a wrapper would be bloat.
- Location: `src/lib/runtime.ts` — new file, future home for any other runtime helpers (e.g., `getCtx(context)` if access gets common, request-property utilities, etc.)

### Helper error behavior — Throw with clear message
- `getEnv(context)` throws `Error("Cloudflare runtime unavailable — are you running in Wrangler?")` when `context.locals.runtime` is undefined
- Mirrors the existing fail-fast pattern in `getDB` (which already throws on missing `runtime?.env?.DB`)
- Rationale: silent fallback masks misconfigurations until a request fails far away from the binding gap. Fail-fast at access time gives a clear error pointing at the runtime, not the consuming route.

### db.ts contract — Refactor to `getDB(context)`
- New signature: `getDB(context: APIContext): D1Database`
- Internally extracts `context.locals.runtime.env.DB` (or delegates to `getEnv(context).DB`)
- All 71 existing call sites change from `getDB((context.locals as any).runtime)` to `getDB(context)` — same scope as just dropping the cast, but cleaner downstream
- Rationale: a future caller writing a new API route shouldn't have to think about the runtime extraction step at all. Pass the context, get a DB. Keeps the abstraction at the lowest level.

### Env var typing — Required strings
- All 6 Pages secrets typed as `string` in `App.Platform.env` (no `string | undefined`)
- Existing bindings stay: `DB: D1Database`, `VERIFICATION_BUCKET: R2Bucket`, `TURNSTILE_SECRET_KEY: string`
- New required additions: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`
- Rationale: required typing forces correctness — code doesn't get to be optimistic about whether a secret is configured. If a binding is missing in `wrangler.jsonc` or Cloudflare Pages settings, the runtime errors at first access (and `getEnv` rethrows from the runtime root). Mixed-mode (some required, some optional) defeats half the migration's value because every call site reverts to `?.X` access.
- Important constraint: TypeScript only enforces "if you access this, it's a string" — it cannot verify that `wrangler.jsonc` actually configures the binding. Build-time enforcement is at deploy when Cloudflare validates bindings. Runtime enforcement is via `getEnv()` throw.

### Cast retirement strategy — Single PR find-and-replace
- One mechanical PR retires all 71 `(context.locals as any).runtime` casts
- Sequence inside the PR (file order matters for TypeScript to compile cleanly along the way):
  1. `src/env.d.ts` — declare all 6 secrets in `App.Platform.env`; add `runtime: App.Platform` to `App.Locals`
  2. `src/lib/runtime.ts` — new file: `getEnv(context)` with throw-on-undefined behavior
  3. `src/lib/db.ts` — refactor `getDB` signature to take `context`; throw if `getEnv(context).DB` missing
  4. `src/middleware.ts` — replace its single cast (line 11) with typed access
  5. Batch find-and-replace across all 70 remaining API route files using `git ls-files | xargs sed` or equivalent
  6. Run `npm run build` to verify zero TypeScript errors before committing
  7. Run E2E suite (`npm run test:e2e`) before pushing — covers regression on auth/admin/contact routes that all use `getDB(context)`
- Rationale (per PITFALLS.md): partial migration is worse than none. Mixed `as any` and typed access in the same codebase invites people to hand-edit one or the other and re-introduce drift. All-or-nothing keeps the find-and-replace clean.
- Verification: `grep -rn "(context.locals as any).runtime" src/` must return zero matches before merge.

### Claude's Discretion
- Whether to use `sed`, `node`, or a shell script for the batch replacement (mechanical detail; doesn't affect outcome)
- Exact TypeScript wording in the throw message (as long as it's clear and points at the runtime / Wrangler)
- Whether `getEnv(context)` returns `App.Platform['env']` directly or a derived narrow type (return type can evolve in future phases)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/db.ts` — current `getDB(runtime: any)` is the model for fail-fast pattern; the throw on missing DB will move into `getEnv` indirectly
- `App.Platform` declaration in `src/env.d.ts` already typed for `cf` and `ctx` — only `env` needs expansion
- `@cloudflare/workers-types` already imported for `D1Database`, `R2Bucket`, `ExecutionContext`, `IncomingRequestCfProperties` — no new dependencies

### Established Patterns
- All API routes follow `getDB((context.locals as any).runtime)` then `db.prepare(...).bind(...).first()/all()/run()` — this pattern is uniform, so the find-and-replace is mechanical
- Env vars currently accessed via `(context.locals as any).runtime?.env?.RESEND_API_KEY` (with optional chain) in 20+ sites — these all collapse to `getEnv(context).RESEND_API_KEY` after migration
- `src/middleware.ts` is the one file that does the cast for auth purposes — it gets the same treatment as API routes

### Integration Points
- `wrangler.jsonc` must declare all 9 bindings (3 existing + 6 new secrets). Confirm before merge.
- Cloudflare Pages dashboard must have the 6 secret values configured in production. Confirm with `wrangler pages secret list ratemyplace` before merge.
- `e2e/` tests use Playwright against local Wrangler dev — runtime is available, so `getEnv(context)` returns successfully. Unit tests in `src/lib/__tests__/` are pure-function only, don't need runtime, so no fixture changes needed.

</code_context>

<specifics>
## Specific Ideas

- The throw message should be diagnostic, not generic: "Cloudflare runtime unavailable — are you running in Wrangler?" tells the developer exactly what's missing and where to look. Compare to `getDB`'s current message which is similarly diagnostic ("D1 Database not found. Make sure you have configured the DB binding.").
- `getEnv(context)` is the right name because it mirrors `getDB(context)` — the API is consistent: pass context, get the typed thing you want.

</specifics>

<deferred>
## Deferred Ideas

- A `getCtx(context)` helper for `waitUntil` — currently rare access (used only in Phase 18 for fire-and-forget email), can be added when a second consumer materializes
- A `getCf(context)` helper for `cf` request properties — rate limiting uses `cf-connecting-ip` indirectly through `getClientIP()`; no other consumers today
- Static type-level enforcement that `wrangler.jsonc` declares all `App.Platform.env` keys — this would require a build-time custom check (not standard TypeScript). Out of scope; runtime throw via `getEnv` is sufficient.
- Migrating tests to use mock runtime fixtures — current unit tests don't access runtime, so this is unnecessary; if Phase 18's `waitUntil` work introduces runtime-dependent tests, those will need a fixture (deferred to that phase).

</deferred>

---

*Phase: 16-typed-runtime-foundation*
*Context gathered: 2026-04-27*
