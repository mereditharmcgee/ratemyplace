---
phase: 16-typed-runtime-foundation
plan: "01"
subsystem: infrastructure
tags: [typescript, runtime, cloudflare, types, env]
dependency_graph:
  requires: []
  provides: [typed-runtime, getEnv-helper, getDB-context-signature, cast-detector-script]
  affects: [src/env.d.ts, src/lib/runtime.ts, src/lib/db.ts, scripts/verify-typed-runtime.sh]
tech_stack:
  added: []
  patterns: [typed-platform-env, fail-fast-runtime-guard, phase-gate-script]
key_files:
  created:
    - src/lib/runtime.ts
    - scripts/verify-typed-runtime.sh
  modified:
    - src/env.d.ts
    - src/lib/db.ts
decisions:
  - "runtime: App.Platform declared as non-optional per locked CONTEXT.md decision; middleware guard still handles undefined at runtime"
  - "getDB(context: APIContext) signature change is safe before 16-02 because existing as-any call sites pass any type which is assignable to APIContext"
  - "DO NOT DEPLOY between 16-01 and 16-02 — call sites pass runtime object not context so runtime-fail would occur"
metrics:
  duration_minutes: 2
  tasks_completed: 3
  files_changed: 4
  completed_date: "2026-04-27"
---

# Phase 16 Plan 01: Typed Runtime Foundation — Summary

**One-liner:** Declared all 6 Cloudflare Pages secrets in `App.Platform.env`, added `runtime: App.Platform` to `App.Locals`, created `getEnv(context: APIContext)` helper, refactored `getDB` to accept `APIContext`, and added cast-variant phase gate script.

## What Was Built

### 1. `src/env.d.ts` — Extended with all 6 Pages secrets and `runtime: App.Platform`

Final file content:

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

### 2. `src/lib/runtime.ts` — New getEnv helper

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

### 3. `src/lib/db.ts` — Refactored to accept APIContext

```typescript
import type { APIContext } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { getEnv } from './runtime';

export function getDB(context: APIContext): D1Database {
  const db = getEnv(context).DB;
  if (!db) {
    throw new Error('D1 Database not found. Make sure you have configured the DB binding.');
  }
  return db as D1Database;
}
```

### 4. `scripts/verify-typed-runtime.sh` — Phase gate for Plan 16-02

Greps `src/` for all four known cast variants. Currently exits non-zero (expected: 70+ legacy casts remain pre-16-02).

Patterns detected:
- `(context.locals as any).runtime`
- `(Astro.locals as any).runtime`
- `rawLocals as any`
- `locals as any`

## Verification Results

| Check | Result |
|-------|--------|
| `npm run build` exits 0 | PASS |
| `npm test` — 260 tests | PASS |
| `GOOGLE_CLIENT_ID` count in env.d.ts | 1 |
| `runtime: App.Platform` count in App.Locals | 1 |
| `getEnv` exported from runtime.ts | YES |
| `verify-typed-runtime.sh` exits non-zero | PASS (exit code 1) |

## Critical Note: Do Not Deploy Between 16-01 and 16-02

The `getDB` signature changed from `getDB(runtime: any)` to `getDB(context: APIContext)`. All 70+ legacy call sites pass `(context.locals as any).runtime` (the runtime object) where now a full `APIContext` is expected. These compile cleanly because `as any` is assignable to any type, but at runtime they would fail when `getEnv` tries to access `context.locals.runtime` on the runtime object.

**Plan 16-02 performs the mechanical find-and-replace to retire all casts. Treat 16-01 + 16-02 as one atomic shippable unit.**

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed in sequence with `npm run build` passing after each.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | a827238 | extend env.d.ts with all 6 Pages secrets and App.Locals.runtime |
| Task 2 | 93b5099 | create runtime.ts getEnv helper and refactor getDB to accept APIContext |
| Task 3 | c7cd82d | add cast-variant verification script for phase gate |

## Self-Check: PASSED
