# Phase 6: Playwright Local Environment — Research

**Phase:** 06-playwright-local-environment
**Researched:** 2026-02-28
**Requirements:** INFRA-04, INFRA-05

---

## What This Phase Builds

Four concrete changes to the test infrastructure:

1. `playwright.config.ts` — rewritten to use local `wrangler pages dev`, `workers: 1`, and a `setup` project dependency
2. `e2e/global.setup.ts` — signs in via the UI form, saves `playwright/.auth/user.json` and `playwright/.auth/admin.json`
3. `e2e/fixtures.ts` — exports `test`, `authedPage`, `adminPage`, and `expect` for downstream phases
4. `package.json` — new `e2e` script that runs `db:setup` then `playwright test`

The existing `navigation.spec.ts` and `pages.spec.ts` must pass unchanged after this phase.

---

## Current State of the Codebase

### Playwright config (must change)

`playwright.config.ts` currently:
- `baseURL` hardcoded to `https://b3b57132.ratemyplace-64y.pages.dev` (production preview)
- No `webServer` config — no local server is started
- No `workers` setting (defaults to multiple workers)
- No auth fixtures, no global setup
- `retries: 1`

```typescript
// Current (to be replaced)
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'https://b3b57132.ratemyplace-64y.pages.dev',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  outputDir: 'test-results/',
  reporter: [['list']],
});
```

### Existing E2E specs

`e2e/navigation.spec.ts` and `e2e/pages.spec.ts` both:
- Import `test, expect` from `@playwright/test` directly
- Use relative paths (`/about`, `/search`, etc.) — compatible with any `baseURL`
- Test only unauthenticated flows (navigation, page rendering, redirects)
- No auth fixtures used

The context decision says to update these imports to `./fixtures` for consistency. That is a small mechanical change that is safe to make.

### Seed users (already in local D1)

Phase 5 seeded these users (confirmed live in `.wrangler/state/v3/d1/`):

| User | Email | Password | is_admin | email_verified |
|------|-------|----------|----------|----------------|
| user-test-01 | `user@test.ratemyplace.local` | `TestPassword123!` | 0 | 1 |
| user-admin-01 | `admin@test.ratemyplace.local` | `TestPassword123!` | 1 | 1 |

Both users have `email_verified = 1` — critical, because the sign-in flow does NOT redirect away from `/` when verification is incomplete (the app sets `window.location.href = '/'` on success). A user with `email_verified = 0` would still land on `/` but might get blocked by other flows.

Password hash in seed: `c2VlZC1kYXRhLWZpeGVkIQ==$zPq112lY6xQgERHp7qyvo1/GPu4jFFXq6S5DOIiupXg=` (PBKDF2-SHA256, fixed salt `seed-data-fixed!`, verified against `verifyPassword()` in `src/lib/password.ts`).

---

## Dev Server: wrangler pages dev

### Why `wrangler pages dev`, not `astro dev`

The context decision specifies `wrangler pages dev`. This is correct because:

- `astro dev` does NOT wire up Cloudflare D1/R2 bindings — the app's auth, reviews, and all DB-dependent pages would return 500s or fail silently
- `wrangler pages dev` emulates the full Cloudflare Pages environment including D1 bindings from `.wrangler/state/v3/d1/` (which already contains seeded data)
- The project's `wrangler.jsonc` already defines the D1 binding name `DB` and database ID `7dd2a722-fdd3-4986-b2f7-6d61d069438e` — wrangler picks this up automatically

### How `wrangler pages dev` works for an Astro SSR app

`wrangler pages dev` for an Astro Cloudflare-adapter project requires the built `dist/` output:

```bash
npx wrangler pages dev ./dist --port 8788
```

**This means the build must happen before Playwright starts the server.** Two options:

**Option A — Build in `webServer.command`:**
```typescript
webServer: {
  command: 'npm run build && npx wrangler pages dev ./dist --port 8788',
  url: 'http://localhost:8788',
  timeout: 120_000,   // build adds ~20-30s; wrangler init adds ~5-10s
  reuseExistingServer: true,
}
```
Downside: Every cold test run rebuilds. Acceptable for local dev since `reuseExistingServer: true` means only the first run rebuilds.

**Option B — Separate `npm run e2e` script:**
```json
"e2e": "npm run db:setup && npm run build && npx playwright test"
```
Then `playwright.config.ts` only runs `wrangler pages dev ./dist --port 8788` in `webServer.command`. This is cleaner because `db:setup` and `build` are clearly separated from Playwright's responsibility.

**Decision from context: the single `npm run e2e` command handles db:fresh, seed, and playwright test.**
This maps to Option B. The `playwright.config.ts` `webServer.command` only needs to start wrangler after build has already run.

### Port 8788 — why this port

- Wrangler Pages default port is 8788
- Astro dev server uses 4321 — no conflict when both run
- Port 8788 is what the context specifies

### `reuseExistingServer: true`

The context decision says: "if wrangler dev is already running, use it; otherwise start fresh." This is the Playwright `reuseExistingServer: true` setting. It allows developers to pre-start `wrangler pages dev` in a separate terminal and skip the startup delay when running `playwright test` directly.

**Note:** When using `npm run e2e` (which does `db:setup` first), `reuseExistingServer: true` is safe because the DB is always freshly seeded before Playwright runs.

### 120-second timeout

The context specifies 120 seconds. This accommodates:
- `npm run build` (Astro build ~10-20s)
- `wrangler pages dev` startup (5-15s including D1 init)
- Buffer for slow machines

---

## Auth Fixture Design

### Sign-in flow mechanics

The sign-in page (`/auth/signin`) uses a React-free form with vanilla JS:
- Form `id="signin-form"` with `input[name="email"]` and `input[name="password"]`
- Submit handler calls `POST /api/auth/signin` with FormData
- On `response.ok`, redirects to `window.location.href = '/'`
- The button text changes to "Signing in..." while in-flight

`global.setup.ts` must handle:
1. Navigate to `/auth/signin`
2. Fill `input[name="email"]`
3. Fill `input[name="password"]`
4. Click `button[type="submit"]`
5. Wait for navigation (the JS does `window.location.href = '/'`)
6. Save storage state

The wait strategy: `page.waitForURL('/')` after clicking submit is the right pattern. The sign-in API returns JSON and the JS handler calls `window.location.href` on success — Playwright's `waitForURL` catches this redirect.

### What happens on auth success

The sign-in API (`/api/auth/signin`) returns `{ success: true }` with a `Set-Cookie` header containing the Lucia session cookie (name managed by Lucia internally, typically `auth_session`). The JS then does `window.location.href = '/'`. So after sign-in, the browser lands on `/`.

Admin redirect: The context originally says `waitForURL('/admin')` in some prior research, but looking at the actual sign-in JS — it always redirects to `/`, not `/admin`. So `global.setup.ts` should `waitForURL('/')` for both user and admin setup.

### Where auth files go

```
playwright/.auth/user.json    # Regular user session
playwright/.auth/admin.json   # Admin user session
```

The `playwright/` directory does not currently exist. It must be created. The `.auth/` subdirectory is created automatically by Playwright when `storageState({ path: ... })` is called.

Add to `.gitignore`:
```
playwright/.auth/
```

The current `.gitignore` does not include this — it must be added.

### Fixtures structure

```typescript
// e2e/fixtures.ts
import { test as base, expect } from '@playwright/test';
import path from 'path';

const USER_AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');
const ADMIN_AUTH_FILE = path.join(__dirname, '../playwright/.auth/admin.json');

export const test = base.extend<{
  authedPage: import('@playwright/test').Page;
  adminPage: import('@playwright/test').Page;
}>({
  authedPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: USER_AUTH_FILE,
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

export { expect };
```

The `path.join(__dirname, '../playwright/.auth/...')` pattern works because `fixtures.ts` is in `e2e/` and `playwright/.auth/` is at the project root.

---

## playwright.config.ts: Final Shape

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,          // No retries locally — fail fast
  workers: 1,          // Required: shared local D1 cannot handle parallel writes
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8788',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx wrangler pages dev ./dist --port 8788',
    url: 'http://localhost:8788',
    timeout: 120_000,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      dependencies: ['setup'],
    },
  ],
  outputDir: 'test-results/',
  reporter: [['list']],
});
```

**Key decisions baked in:**
- `workers: 1` — SQLite cannot handle concurrent writers; parallel Playwright contexts against local D1 cause `SQLITE_BUSY` errors
- `retries: 0` — locally, retries mask real failures. The prior config had `retries: 1`; the context says tests should fail fast
- `webServer.reuseExistingServer: true` — allows running `playwright test` directly when wrangler is already running
- `baseURL` still overridable by `BASE_URL` env var — preserves ability to run against remote URLs in future
- `testMatch: /global\.setup\.ts/` — Playwright matches setup file by regex. The setup project only runs `global.setup.ts`

---

## global.setup.ts: Implementation Details

```typescript
import { test as setup } from '@playwright/test';
import path from 'path';

const USER_AUTH_FILE = path.join(__dirname, '../playwright/.auth/user.json');
const ADMIN_AUTH_FILE = path.join(__dirname, '../playwright/.auth/admin.json');

setup('sign in as regular user', async ({ page }) => {
  await page.goto('/auth/signin');
  await page.fill('input[name="email"]', 'user@test.ratemyplace.local');
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  await page.context().storageState({ path: USER_AUTH_FILE });
});

setup('sign in as admin', async ({ page }) => {
  await page.goto('/auth/signin');
  await page.fill('input[name="email"]', 'admin@test.ratemyplace.local');
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  await page.context().storageState({ path: ADMIN_AUTH_FILE });
});
```

**Wait strategy:** `waitForURL('/')` waits for the JavaScript `window.location.href = '/'` redirect to complete. The sign-in form uses async fetch, not a native form submit, so there is no page-level navigation until the JS handler fires. `waitForURL` is the correct primitive — it polls until the URL matches.

**Fail-fast behavior:** The context says "if global setup auth login fails, fail the entire test run." This is the default Playwright behavior — if a setup project fails, all dependent projects are skipped and the overall run exits with a non-zero code. No extra configuration needed.

**Credentials hardcoded:** The context explicitly permits this — "local-only seed data, no secrets to protect."

---

## package.json Script

The context decision: `npm run e2e` should be a single command that handles db:fresh, seed, and playwright test automatically.

Currently `package.json` has:
```json
"e2e": "npx playwright test"
```

Change to:
```json
"e2e": "npm run db:setup && npm run build && npx playwright test"
```

`db:setup` is already defined as `npm run db:fresh && npm run db:seed`.

So the full chain becomes:
```
npm run e2e
  → npm run db:fresh  (reset + migrate + verify schema)
  → npm run db:seed   (insert 8 users, 10 landlords, 30 buildings, 128 reviews, 10 disputes)
  → npm run build     (Astro build → ./dist/)
  → npx playwright test
      → webServer starts: npx wrangler pages dev ./dist --port 8788
      → setup project: global.setup.ts
      → chromium project: all .spec.ts files
```

The `e2e:headed` script should also be updated:
```json
"e2e:headed": "npm run db:setup && npm run build && npx playwright test --headed"
```

---

## Updating Existing Spec Files

The context says to update `navigation.spec.ts` and `pages.spec.ts` to import from `./fixtures` for consistency.

Current:
```typescript
import { test, expect } from '@playwright/test';
```

New:
```typescript
import { test, expect } from './fixtures';
```

This is a two-line mechanical change per file. The fixtures `test` is built with `base.extend()` which preserves the default `page` fixture — existing tests that use `{ page }` continue to work with zero changes to test bodies.

---

## Known Risks and Mitigations

### Risk 1: Build step required before wrangler pages dev

`wrangler pages dev` serves `./dist/` — there is no hot-reload for E2E purposes. The `npm run e2e` script explicitly runs `npm run build` first. If a developer runs `npx playwright test` directly (bypassing `npm run e2e`), the dist must already be up to date or `reuseExistingServer: true` must find a running wrangler instance.

Mitigation: Document this in the phase. The `reuseExistingServer: true` setting handles the common case where a developer has wrangler already running.

### Risk 2: Rate limiting blocks sign-in in global.setup.ts

The app rate-limits sign-in at 5 attempts per 15 minutes per IP. During a test run, `global.setup.ts` makes 2 sign-in calls (user + admin). After 5 failed or 5 total attempts from `127.0.0.1`, subsequent sign-ins return 429.

`npm run db:setup` (which runs `db:fresh`) drops and recreates the `rate_limits` table via migrations — so the rate limit state is cleared before every test run. This is automatic.

For multiple runs in quick succession without `npm run e2e` (e.g., running `npx playwright test` repeatedly during debugging), rate limits could accumulate. Phase 7 can address this; for Phase 6 it is acceptable risk since `global.setup.ts` only makes 2 sign-in calls.

### Risk 3: `playwright/.auth/` directory must pre-exist

`page.context().storageState({ path: ... })` creates the JSON file, but the `playwright/.auth/` directory must exist first or the write fails.

Mitigation: Create the directory explicitly in `global.setup.ts`:
```typescript
import { mkdir } from 'fs/promises';
await mkdir(path.join(__dirname, '../playwright/.auth'), { recursive: true });
```

Or create it manually once and add a `.gitkeep`. The `{ recursive: true }` option on `mkdir` is idempotent and the safer choice.

### Risk 4: Session cookie behavior in local vs production

Lucia's session cookie is set with `secure: import.meta.env.PROD`. In production, `secure: true` means the cookie only transmits over HTTPS. In local development (`import.meta.env.PROD === false`), `secure: false` — the cookie transmits over HTTP on `localhost`. This is the correct behavior for `http://localhost:8788`.

No extra Playwright cookie configuration needed — the browser will accept `Set-Cookie` without `Secure` flag on HTTP localhost.

### Risk 5: wrangler pages dev and Windows paths

The project runs on Windows (Windows 11, shell: bash). `wrangler pages dev ./dist` with forward slashes works on Windows via npm/npx — wrangler handles path normalization internally. This was verified in Phase 4/5 where similar wrangler commands ran successfully on Windows.

---

## What the Plan Does NOT Need to Do

- **No `.env.test` file** — test credentials are hardcoded directly in `global.setup.ts` (context decision)
- **No teardown file** — no test cleanup needed since `db:fresh` resets everything on next run (context decision)
- **No separate auth spec files in Phase 6** — auth E2E tests are Phase 7; Phase 6 only creates the infrastructure (fixtures, global setup, config)
- **No `faker-js` or other packages** — no new npm packages needed for this phase
- **No Google OAuth automation** — explicitly out of scope (REQUIREMENTS.md)
- **No changes to Vitest** — unit tests are unaffected

---

## Files to Create or Modify

| File | Action | Notes |
|------|--------|-------|
| `playwright.config.ts` | Modify | Replace baseURL, add webServer, add projects, add workers: 1 |
| `e2e/global.setup.ts` | Create | Two setup blocks: user + admin sign-in |
| `e2e/fixtures.ts` | Create | authedPage and adminPage fixtures + re-export expect |
| `e2e/navigation.spec.ts` | Modify | Change import to `./fixtures` |
| `e2e/pages.spec.ts` | Modify | Change import to `./fixtures` |
| `package.json` | Modify | Update `e2e` and `e2e:headed` scripts |
| `.gitignore` | Modify | Add `playwright/.auth/` |
| `playwright/.auth/` | Create dir | Created by global.setup.ts (mkdir with recursive) |

Total files: 8. All existing test logic is preserved — only imports and config change.

---

## Success Verification

After implementation, run `npm run e2e` and verify:
1. `db:setup` completes without error (Phase 5 infrastructure)
2. `npm run build` produces `./dist/`
3. `wrangler pages dev ./dist --port 8788` starts and serves `http://localhost:8788`
4. `global.setup.ts` creates `playwright/.auth/user.json` and `playwright/.auth/admin.json`
5. All tests in `navigation.spec.ts` (7 tests) and `pages.spec.ts` (12 tests) pass
6. No requests go to `ratemyplace.boston` or `b3b57132.ratemyplace-64y.pages.dev`

INFRA-04 satisfied: Playwright runs against local dev server.
INFRA-05 satisfied: Auth fixtures create reusable sessions for user and admin.

---

## Sources

- `playwright.config.ts` — current config inspected directly
- `e2e/navigation.spec.ts`, `e2e/pages.spec.ts` — existing specs inspected directly
- `src/pages/auth/signin.astro` — sign-in form structure and JS redirect behavior
- `src/pages/api/auth/signin.ts` — API response and cookie behavior
- `scripts/db-seed.ts` — seed users, emails, password hash
- `.planning/research/ARCHITECTURE.md` — webServer + wrangler pages dev pattern, fixtures pattern
- `.planning/research/PITFALLS.md` — Pitfall 1 (production URL), Pitfall 9 (rate limits), Pitfall 10 (React island hydration)
- `.planning/research/STACK.md` — storageState pattern, wrangler pages dev rationale
- `.planning/codebase/INTEGRATIONS.md` — Lucia session cookie behavior
- Live D1 query confirming seed users exist with correct emails and is_admin values
- Wrangler version 4.50.0 confirmed via `npx wrangler --version`
- Playwright version 1.58.2 confirmed via `npx playwright --version`
