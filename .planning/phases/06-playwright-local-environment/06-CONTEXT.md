# Phase 6: Playwright Local Environment - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Configure Playwright to run entirely against the local dev server with reusable authenticated sessions. No production URL contact. Existing navigation/pages specs must pass against local. Auth fixtures provide `authedPage` and `adminPage` for downstream phases (7-10).

</domain>

<decisions>
## Implementation Decisions

### Database state strategy
- Fresh seed every run — run `db:fresh` + seed before each `npm run e2e`
- Tests can freely create data (reviews, signups); the next run resets everything — no cleanup logic in tests
- Use existing seed users directly (e.g., user-01, admin-01) with the known password `TestPassword123!` — no separate E2E users needed
- `npm run e2e` should be a single command that handles db:fresh, seed, and playwright test automatically

### Auth session design
- Auth state files in `playwright/.auth/` (standard Playwright convention, gitignored) — `user.json` and `admin.json`
- Fixtures named `authedPage` and `adminPage` — matches roadmap success criteria
- If global setup auth login fails, fail the entire test run — fail fast, something is broken
- Test credentials hardcoded in setup file — these are local-only seed data, no secrets to protect

### Test organization
- Flat file structure in `e2e/` — one file per feature domain (auth.spec.ts, reviews.spec.ts, admin.spec.ts, security.spec.ts)
- Fixtures and global setup co-located with tests: `e2e/fixtures.ts` + `e2e/global.setup.ts`
- Update existing test files (navigation.spec.ts, pages.spec.ts) to import from `./fixtures` for consistency — single import pattern across all specs
- Use both file-level separation and `test.describe` blocks within files — matches existing convention

### Dev server startup
- Use `wrangler pages dev` via Playwright's `webServer` config — full Cloudflare Pages environment with D1 bindings
- Port 8788 (wrangler default) — avoids conflict with Astro dev on 4321
- `reuseExistingServer: true` — if wrangler dev is already running, use it; otherwise start fresh
- 120-second timeout for server readiness — wrangler + D1 can be slow on first start

### Claude's Discretion
- Exact wrangler pages dev command flags
- Global setup implementation details (selectors, wait strategies)
- How to structure the single `npm run e2e` script (package.json script vs. shell script)
- Playwright config projects structure (setup project dependencies)

</decisions>

<specifics>
## Specific Ideas

- Existing tests in `navigation.spec.ts` and `pages.spec.ts` currently point at a Cloudflare Pages preview URL — these need to work against local with zero test logic changes
- Seed data already has deterministic password hash for `TestPassword123!` computed via PBKDF2-SHA256 — auth fixtures should use this exact password
- Config currently has `workers: 1` not set — roadmap requires it
- `baseURL` currently hardcoded to `https://b3b57132.ratemyplace-64y.pages.dev` — needs to become `http://localhost:8788`

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-playwright-local-environment*
*Context gathered: 2026-02-28*
