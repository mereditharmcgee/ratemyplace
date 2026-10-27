> **Status 2026-10-27: deferred.** The owner chose to extend the GHSA-26w7-cxv4-gfx2 allowlist entry to 2027-06-30 (PR #41) and do this move before then. Versions, line numbers and wrangler internals below were checked on 2026-10-26; re-verify everything before starting. The "items 1-4" it mentions are the October 2026 fix branches (review funnel, admin alerts, link previews, street-suffix search).

# Item 5: Astro 5 → 7 upgrade by hand (plan v2, revised after review)

**Branches:** `chore/astro-7-prep` (PR-A, ships first on Pages) and `chore/astro-7` (PR-B, the upgrade and the move to Workers).

**Baseline:** `main` at `1b8ca2b`.
- Astro 5.18.2, @astrojs/cloudflare 12.6.13, @astrojs/react 3.6.3 (exact pin)
- React 18.3.1, Vite 6.4.3, TypeScript 5.9.3, Vitest 4.1.11
- wrangler 4.59.2 (transitive only)
- `.node-version` 22.16.0
- Production `/api/health` reported release `1b8ca2bd…` on 2026-10-26.

**Goal:** get Astro to at least 7.2.8, then delete the `GHSA-26w7-cxv4-gfx2` entry from `audit-allowlist.json` before it expires on 2026-12-31. Do not extend the entry.

---

## 0. What changed in v2

The review found no blocking points. Each important and minor point is resolved below. All evidence was gathered on 2026-10-26 from tarballs in the scratch folder, Cloudflare docs, `gh api` and read-only production checks.

| Review point | Resolution | Evidence |
|---|---|---|
| **Cutover gap.** The old step D4 deleted the apex DNS record. Resolvers would then cache NXDOMAIN for up to the SOA minimum. | Never delete the apex record. Attach the Worker custom domain with wrangler's DNS override, using an interactive `npx wrangler deploy --domain ratemyplace.org`. Use whichever variant the R4 drill proves on a throwaway subdomain. | wrangler 4.152 `cli.js` ~164520–164560 (4.153: ~165480–165525) sets `override_existing_dns_record = true` after the "DNS records that conflict… Update them?" prompt. The Workers docs say the dashboard cannot create a Custom Domain over an existing CNAME. The zone SOA default TTL measured 1800 s (`nslookup -type=SOA`). |
| **Unsafe rollback.** Once `routes` are codified, every non-TTY deploy forces the override and takes the domain back. | The custom domain is **not codified in `wrangler.jsonc`** during the rollback window. The old step D6 moves to follow-up F5, after the Pages project is deleted. With no custom-domain routes in config, deploys never touch domains. Rollback still pauses Workers Builds first. PR-A and PR-B must be merged with **"Create a merge commit"**. | In `triggersDeploy`, `publishCustomDomains(...)` is called only `if (customDomainsOnly.length > 0)`. Ruleset 21749328 allows `merge`, `squash` and `rebase`. |
| **Origin inference.** With routes in config, `wrangler dev` infers the origin from the first route, and checkOrigin then 403s the e2e form posts. | Pass `--local-upstream localhost:8788` in the e2e harness and in `.claude/launch.json`, and pin it with an argv test. `--infer-origin-from-routes` exists only from wrangler 4.153, and this plan pins 4.152.0. `npm run dev` is unaffected. | 4.152 `cli.js` line 212893: `hostname: host ?? (inferOriginFromRoutes ?? true ? getInferredHost(...))`. Line 376039: `hostname: args.host ?? args.localUpstream`. `infer-origin-from-routes` has 0 hits in 4.152. `getInferredHost`/`inferOriginFromRoutes` have 0 hits in @cloudflare/vite-plugin 1.65.0. |
| **Node pin in PR-A** was never tested on the Pages build image. | Move the Node pin into PR-B (commit C4). Astro 5 doesn't need it, and PR-B never builds on Pages (steps R0 and R5). | astro 6.4.8 `engines.node >=22.12.0`; astro 7.4.2 `>=22.23.4`. |
| **Item 2 conflict and new secret names.** | Section 12 rewritten. The secret list is derived from `App.CloudflareEnv` by a tested script (C8), then checked against `wrangler secret list` before cutover. | — |
| **`cfContext` silently `any`.** | Add an `ExecutionContext` alias in `src/env.d.ts`, plus a compile-time `IsAny` test that `npm run check` enforces. | adapter 14.4.2 `dist/utils/cf-helpers.d.ts` declares `interface Runtime { cfContext: ExecutionContext }` using a global this repo never declares. `types.d.ts` makes `App.Locals extends Runtime`. |
| **Wrong counts.** | 14 direct reads in 12 `.astro` files. 18 test injection sites in 15 files (including `helpers/adminDb.ts`), plus 3 in `runtime.test.ts`. Re-grep at implementation time; the code wins. | grep, 2026-10-26 |
| **D1 sanity SQL** used `MAX(id)` on random text ids. | Use `COUNT(*)` and `MAX(created_at)`. | `contact.ts:77` and `bug-reports.ts:81` use `generateIdFromEntropySize(10)`. `created_at` is an INTEGER unixepoch (checked on production). |
| **launch.json persistence.** | Add `--persist-to .wrangler/state` and `--local-upstream`. | — |
| **Duplicate wrangler.** | Pin `wrangler` to exactly `4.152.0`. A lockfile test keeps a single copy. | @cloudflare/vite-plugin 1.65.0 depends on exactly `"wrangler": "4.152.0"`. |
| **Dirty local deploy.** | Deploy from a fresh worktree with an empty `git status --porcelain`, and unset `CLOUDFLARE_API_TOKEN` before `wrangler login`. | Untracked `src/pages/api/admin/verification/[id] (1).ts` in the main checkout. |
| **Connecting Workers Builds** starts a build of the old `main`. | Expected and harmless; noted in R6. | wrangler refuses `deploy` on a config with `pages_build_output_dir`. |
| **Production test rows.** | Cleanup step for each row (section 6, step 25). | Bug-report PATCH and review moderation are audited. No admin action exists for contact messages. |
| **Workers Logs and PII.** | Observability **off** (parity with Pages). Turning it on requires the log audit in F7. | `logError(... ip: clientIP)` in 4 auth routes. `email.ts` logs raw Resend error objects at about 14 sites. AGENTS.md: "Don't widen" IP persistence. |
| **Pages previews of the branch.** | R0 excludes `chore/astro-7*` from Pages preview builds before the first push. | — |
| **Parity diff in one directory.** | Use separate worktrees. | `wrangler pages dev` follows `.wrangler/deploy/config.json`. |
| **Path-dependent harness assertion.** | Assert on argv tokens instead. | — |
| **Docs drift.** | C2 documents the seam in PR-A. C10 lists the rest. | — |
| **8-hex preview alias.** | Set `preview_urls: false`. The smoke accepts only the workers.dev production host and the legacy pages.dev pattern. | — |
| **Missing tests.** | All eight added: C2, C5, C6, C7, C8 and the R4 drill. | — |

---

## 1. Scope findings (read first)

1. **Astro 6+ requires `@astrojs/cloudflare` 13+, and that adapter dropped Cloudflare Pages.**
   - The 13.0.0 changelog (PR #15480) says it "Drops official support for Cloudflare Pages in favor of Cloudflare Workers". The integration docs section "Upgrading to v13 and Astro 6 → Removed: Cloudflare Pages support" says the same.
   - Build output becomes `dist/client` plus `dist/server`, with a generated `dist/server/wrangler.json`.
   - **So this upgrade includes moving ratemyplace.org from Cloudflare Pages to a Cloudflare Worker with static assets.** The Worker can keep the name `ratemyplace`: the migration guide says the name "can be the same as your existing Pages project name".

2. **`Astro.locals.runtime` now throws.** In 13.x and 14.4.2, `createLocals()` defines a non-enumerable, non-writable `runtime` whose `env`/`ctx`/`cf`/`caches` getters throw "has been removed in Astro v6". Consequences:
   - All 14 direct reads in `.astro` files fail with a 500.
   - `src/middleware.ts:16` throws inside its try/catch, so every user silently appears logged out.
   - `fireAndForget` throws on `runtime?.ctx`, so every route that sends email returns a 500.
   - A shim can't be assigned, so the app's seam needs a new name: `locals.cfEnv`, plus the adapter's own `locals.cfContext`.

3. **Rollback becomes a domain move, not a revert.**
   - Reverted Astro 5 code can't deploy to the Worker, and Pages auto-deploys are off after R5.
   - Rollback means moving `ratemyplace.org` back to the untouched Pages project (section 8). That is safe only while no `routes` are codified, which is why codifying the domain is deferred to F5.

4. **Dependabot PR #22 can't be salvaged.** Checks `quality` and `Cloudflare Pages` are both FAILURE.
   - It bumps TypeScript to 7.0.2, but `@astrojs/check@0.9.12` has peer `typescript: ^5.0.0 || ^6.0.0`, so `npm ci` fails.
   - Even if it installed, it changes no code. The `locals.runtime` reads, the Pages config, the e2e harness and the container tests would all break.
   - Close it (step C11).

5. **Resource library:** 0 of 449 entries match astro, cloudflare, wrangler, vite or workers. Nothing to apply.

## 2. Primary sources

**Astro docs** (raw.githubusercontent.com/withastro/docs/main/…):
- `upgrade-to/v6.mdx` and `v7.mdx`
- `integrations-guide/cloudflare.mdx`
- `guides/testing.mdx`

**Changelogs** (withastro/astro monorepo): astro (main and `6-legacy`), integrations/cloudflare, integrations/react, language-tools/astro-check.

**Tarballs read:**
- astro 7.4.2 and 6.4.8
- @astrojs/cloudflare 14.4.2 and 13.7.0
- @astrojs/react 7.1.1, @astrojs/check 0.9.12
- wrangler 4.153.0 and **4.152.0**
- @cloudflare/workers-types 5.20261023.1, @cloudflare/vite-plugin 1.65.0

**Cloudflare docs** (cloudflare-docs, production branch):
- `workers/static-assets/migration-guides/migrate-from-pages.mdx`
- `workers/ci-cd/builds/{configuration,build-image,build-branches}.mdx`
- `workers/previews/{index,configuration}.mdx`
- `workers/configuration/routing/custom-domains.mdx`
- `pages/configuration/custom-domains.mdx`
- `pages/platform/known-issues.mdx`

**Facts used below:**

| Fact | Source |
|---|---|
| astro 7.4.2: `engines.node >=22.23.4`, deps `vite ^8.3.4`. astro 6.4.8: node `>=22.12.0`, vite `^7.3.2` | npm view |
| @astrojs/cloudflare 14.4.2: peer `astro ^7.4.0`, `wrangler ^4.125.0`; dep `@cloudflare/vite-plugin ^1.63.1`. 13.7.0: peer `astro ^6.3.0`, `wrangler ^4.83.0`; dep vite-plugin `^1.39.0`. Both resolve vite-plugin 1.65.0 | package.json |
| @cloudflare/vite-plugin 1.65.0: dependency `"wrangler": "4.152.0"` (exact), `miniflare 5.20261019.2-beta`; peer `wrangler ^4.152.0`, `vite ^6.1 \|\| ^7 \|\| ^8` | package.json |
| wrangler 4.152.0 (published 2026-10-22): `engines.node >=22.0.0`, peer `@cloudflare/workers-types ^5.20261019.1` | package.json |
| @astrojs/react 5.0.7 and 7.1.1: peer react 17/18/19, so React 19 is not required. 7.1.1's `oxc-transform-react` peer is optional | npm view, package.json |
| @astrojs/check 0.9.12: peer TS `^5 \|\| ^6`. astro 7.3.4 changelog: "TypeScript 7 is not currently supported" | npm view, changelog |
| @tailwindcss/vite 4.1.18 peer `vite ^5.2\|\|^6\|\|^7`; 4.3.3 adds `^8`. vitest 4.1.12 peer `vite ^6\|\|^7\|\|^8` | npm view |
| GHSA-26w7-cxv4-gfx2 affects astro `<7.2.8`; other astro advisories `<7.3.2`; 7.4.2 clears all of them | `npm audit --json` |
| Astro 6: components can't render in Vitest client environments (happy-dom/jsdom); endpoints with an extension don't answer with a trailing slash; script/style order preserved; route pathnames partially decoded | v6 guide |
| Astro 7: Vite 8; Rust compiler (errors on unclosed tags, no auto-fix of invalid nesting); `compressHTML` default `'jsx'`; `src/fetch.ts` reserved | v7 guide |
| Astro 6.4.8 rejects `session: false`; Astro 7 accepts it | tarballs |
| Astro 7 `isForbiddenCrossOriginRequest`: safe methods pass; a non-form content type passes; `Sec-Fetch-Site` `same-origin`/`none` pass, any other non-empty value fails; with no Sec-Fetch-Site, a missing Origin **passes** and a mismatched Origin fails (403 `Cross-site POST form submissions are forbidden`) | astro 7.4.2 `dist/core/app/origin-check.js` |
| Adapter 14 Wrangler config: `main: "@astrojs/cloudflare/entrypoints/server"`, assets binding `ASSETS` | cloudflare.mdx ~566, ~630 |
| Adapter types: `App.Locals extends Runtime`, `Runtime.cfContext: ExecutionContext` (unresolved global here) | adapter `types.d.ts`, `dist/utils/cf-helpers.d.ts` |
| workers-types v5 `index.ts` exports D1Database, R2Bucket, R2ObjectBody, ScheduledEvent, ExecutionContext and IncomingRequestCfProperties (every type the repo imports). `declare module "cloudflare:workers"` lives only in the global `index.d.ts`, which this repo does not load | tarball |
| Generated config rebases `d1_databases[].migrations_dir` to the output dir | vite-plugin `index.mjs` ~93829 |
| An explicit `--config` bypasses the `.wrangler/deploy/config.json` redirect; local persistence stays relative to the repo-root config | wrangler `findWranglerConfig` / `getLocalPersistencePath` |
| `wrangler dev --var KEY:VALUE` (split on the first `:`) and `--persist-to` exist in 4.152 | 4.152 `cli.js` 192197, 220643 |
| Custom domains: wrangler TTY prompts "You already have DNS records that conflict… Update them to point to this script instead?" and sets `override_existing_dns_record`; non-TTY sets it unconditionally. The dashboard can't create a Custom Domain over an existing CNAME | `cli.js`; custom-domains.mdx line 36 |
| Pages: "It is currently not possible to add a custom domain with … a Worker already routed on that domain." A CNAME to pages.dev with no Pages association answers 522 | pages known-issues line 45; pages custom-domains line 47 |
| `wrangler secret list` defaults to `--format json` | 4.152 `cli.js` |
| Workers Builds sets `WORKERS_CI_COMMIT_SHA`; its image preinstalls Node 22.23.4 and honours `.node-version` | CF docs |
| No `src/fetch.ts`, content collections, `.md` pages, `prerender`, `Astro.glob`, ViewTransitions, astro:assets or zod | grep |
| Production slugs: 0 of 38,301 buildings and 0 landlords have characters outside `[a-z0-9-]` | read-only D1 SELECT |
| Production `/robots.txt` is `cf-cache-status: HIT`: the zone Cache Rule caches it in front of Pages | curl |
| Required status check is only `quality`; all three merge methods are allowed | `gh api …/rulesets/21749328` |
| www.ratemyplace.org answers 301 to the apex (zone redirect rule) | curl |
| SOA default TTL (negative caching) is 1800 s | `nslookup -type=SOA ratemyplace.org` |

## 3. Target versions

Hold everything that doesn't need to move: React 18.3.1, TypeScript 5.9.3, Vitest 4.x, happy-dom 20.x, Playwright 1.58.

Final `package.json` after C6:

```jsonc
"engines": { "node": ">=22.23.4" },
"dependencies": {
  "@astrojs/cloudflare": "^14.4.2",
  "@astrojs/react": "^7.1.1",          // was exact "3.6.3" (Jan 2026 React-19/MessageChannel workaround; no longer needed)
  "@googlemaps/markerclusterer": "~2.6.2",
  "@lucia-auth/adapter-sqlite": "^3.0.2",
  "@oslojs/crypto": "^1.0.1",
  "@oslojs/encoding": "^1.1.0",
  "astro": "^7.4.2",
  "lucia": "^3.2.2",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "resend": "^6.25.0"
},
"devDependencies": {
  "@astrojs/check": "^0.9.12",
  "@cloudflare/workers-types": "^5.20261023.1",
  "@playwright/test": "^1.58.2",
  "@tailwindcss/vite": "^4.3.3",
  "@testing-library/react": "^16.3.2",
  "@testing-library/user-event": "^14.6.1",
  "@types/google.maps": "^3.66.5",
  "@types/react": "^18.3.0",
  "@types/react-dom": "^18.3.0",
  "happy-dom": "^20.11.13",
  "tailwindcss": "^4.3.3",
  "tsx": "^4.21.0",
  "typescript": "^5.9.3",              // @astrojs/check accepts ^5 || ^6; hold 5.9 (TS 6 = F2)
  "vitest": "^4.1.12",
  "wrangler": "4.152.0"                // EXACT: equals @cloudflare/vite-plugin's exact dependency, so one wrangler/miniflare copy
}
```

- `.node-version` changes from `22.16.0` to `22.23.4` (C4, in PR-B). CI's setup-node and Workers Builds both read it.
- Never use `--legacy-peer-deps` or `--force`. If npm raises ERESOLVE, fix the range instead.

## 4. Impact map (grep evidence; re-grep at implementation time)

| Area | Evidence | Action |
|---|---|---|
| Runtime env access | `src/lib/runtime.ts:6-12` (getEnv reads `locals.runtime`), `:47-66` (fireAndForget reads `locals.runtime?.ctx`), `src/lib/db.ts:5`, `src/middleware.ts:16` | Seam `locals.cfEnv` (C2, C5) |
| Direct reads in `.astro` (14 in 12 files) | `components/BuildingRecords.astro:63,73`; `components/layout/Header.astro:7`; `pages/admin/contact.astro:16`; `pages/admin/index.astro:12`; `pages/building/[slug].astro:53`; `pages/landlord/[slug].astro:21`; `pages/map.astro:5`; `pages/profile.astro:13`; `pages/property-manager/[slug].astro:21`; `pages/review/edit/[id].astro:14`; `pages/review/new.astro:19,40`; `pages/search.astro:12` | `getDB(Astro)` / `getEnv(Astro)` (C2) |
| Types | `src/env.d.ts:31-52` declares `App.Platform` and `Locals.runtime`; workers-types imported only through `import()` aliases | Rewrite (C5) |
| Test injections (18 sites in 15 files) | `adminNamedPartyRoutes.test.ts:18`, `buildingRecordsRender.test.ts:103`, `namedPartySsrVisibility.test.ts:121`, `publicNamedPartyRoutes.test.ts:20`, `recordsApprovalEnqueue.test.ts:23`, `recordsBuildingsRoute.test.ts:13,160`, `recordsCorrectionAdminRoutes.test.ts:100` (multi-line), `recordsCorrectionsRoute.test.ts:44`, `recordsFollowerEnqueue.test.ts:17`, `recordsPullRoute.test.ts:62`, `recordsQueueAdminRoutes.test.ts:62`, `recordsRequestRoute.test.ts:45`, `recordsSitemap.test.ts:138,225,248`, `verificationRoute.test.ts:56` (multi-line), `helpers/adminDb.ts:62`. Plus `runtime.test.ts:27,54,62` | Rename to `cfEnv` (C2); `runtime.test.ts` changes in C5 |
| Container API tests under happy-dom | `authPageHeadings`, `buildingRecordsRender`, `namedPartySsrVisibility`, `reviewCardHeaderLayout` (all use `document.createElement('div')`) | Node environment + happy-dom `Window` helper + sentinel (C5) |
| `vitest.config.ts` | `getViteConfig(…, { configFile: false, integrations: [react()] })`; Astro 6 needs Vitest ≥ 4.1 | Add `compressHTML: true` (C6) |
| Adapter config | `astro.config.mjs:19-20` (`output:'server'`, `adapter: cloudflare()`). Adapter 13+ auto-adds a SESSION KV binding (the build warning) and an IMAGES binding | `imageService:'passthrough'` (C5), `session:false` (C6) |
| Pages config | `wrangler.jsonc:3` `pages_build_output_dir` | Workers config (C5) |
| e2e server | `e2e/test-harness.ts:157-169` (`wrangler pages dev dist --binding=…`); `playwright.config.ts:2,17`; `executeLocalD1` uses the root `wrangler.jsonc` + `--persist-to` (stays valid) | `wrangler dev --config dist/server/wrangler.json --local-upstream …` (C5) |
| Local D1 scripts | `scripts/db-fresh.ts:46`, `db-migrate.ts:38`, `db-seed.ts:46` run bare `npx wrangler d1 … --local`. After a build they follow the redirect to the generated config (same DB binding, `migrations_dir` rebased, persistence at the root) | No change; documented trap (C10) |
| Release id | `astro.config.mjs:11-15` reads `CF_PAGES_COMMIT_SHA ?? GITHUB_SHA` (`??` doesn't skip empty strings) | `releaseCandidateFromEnv` (C7) |
| Post-deploy smoke | `.github/workflows/post-deploy-smoke.yml:54-60`, `scripts/pages-deployment-url.ts`, `src/lib/pagesDeployment.ts`, `src/lib/smoke.ts:54` (`PREVIEW_HOST`), `:121`; contract `src/lib/__tests__/workflowContracts.test.ts:422-468` (also bans `wrangler`, `d1`/`r2`, `secrets.` in workflow text) | C7 |
| CI | `.github/workflows/ci.yml` (quality: npm ci → audit → check → test → build); contract `workflowContracts.test.ts:338-351` + `assertCiAuditGate` | Add "Verify server build output" step (C6) |
| records-scheduler Worker | `workers/records-scheduler/src/index.ts` imports `src/lib/email.ts` and `src/lib/records/*`, not runtime.ts or middleware. Deployed from its own config with an explicit `--config`. Already `observability.enabled: true` (no request PII; structured lines) | No code change; dry-run bundle; comment-only doc tweak; **do not redeploy** |
| CSP | `src/middleware.ts:64-78`, with `'unsafe-inline'` | No change; don't enable `security.csp` |
| Client directives / scripts | 23 `client:load`, 2 `client:visible`; one processed `<script>` per file | No change |
| Static control files | `public/_headers` (served by Workers assets for static files, as on Pages); `public/.assetsignore` (harmless) | No change |
| React 19 patterns (follow-up only) | 3 `useRef<NodeJS.Timeout>()`: `AddressAutocomplete.tsx:60,61`, `HomeSearch.tsx:42` | F1 |
| Env names the site reads | DB, VERIFICATION_BUCKET, TURNSTILE_SECRET_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_MAPS_API_KEY, GOOGLE_PLACES_API_KEY, RESEND_API_KEY, SITE_URL (plus anything items 1–4 add) | `App.CloudflareEnv` → secret list (C8) |
| Logging that would persist PII on Workers Logs | `logError('rate_limit_db_failure', { ip: clientIP })` in `auth/forgot-password.ts:33`, `resend-verification.ts:42`, `signin.ts:66`, `signup.ts:80`; `console.error('Resend error:', error)` in `email.ts` | Observability off (C5); F7 audit |

## 5. Commit plan (TDD: the test comes first in every commit)

Commits are renumbered in execution order. Mapping from v1: old C2→C1, C3→C2, C4→C3, C1→C4, C5–C7 unchanged, new C8, old C8→C9, C9→C10, C10→C11.

**Gate for every commit:** `npm test`, `npm run check` and `npm run build` are green. The only exception is C5, an intermediate state that is never deployed.

**Before starting, record baselines on `main` in the PR-A description:**
- `npm test` count
- `npm run check` diagnostics count (0)
- `dist` sizes
- the read-only D1 sanity SELECT (section 6, step 20)

### PR-A `chore/astro-7-prep` (Astro 5, Pages; deployable now)

#### C1 `chore(deps): tailwindcss and @tailwindcss/vite 4.3.3`
- Run `npm install -D tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3`. It is still on Vite 6, and 4.3.3 is the first line that accepts Vite 8.
- Verify: build, then a visual check of `/`, `/search?q=lanark`, a building page and `/methodology` at 375, 768 and 1280 against production.

#### C2 `refactor(runtime): every Cloudflare env read goes through getEnv/getDB via locals.cfEnv`

**Tests first:**
- New `src/lib/__tests__/cloudflareRuntimeBoundary.test.ts`, a source scan in the style of `recordsPanelCopy.test.ts`. It walks `src/**/*.{ts,tsx,astro,mjs}` and skips `__tests__` and `*.d.ts`.
  - `reads locals.runtime only in src/lib/runtime.ts and src/middleware.ts`: regex `/locals\??\.runtime\b/` with that two-file allowlist. C5 shrinks the allowlist to zero.
  - `imports cloudflare:workers nowhere but src/middleware.ts`.
  - `reads locals.cfEnv only in src/lib/runtime.ts and src/middleware.ts`: pages and components must call `getEnv`/`getDB`.
  - `src/middleware.ts assigns locals.cfEnv before its first getDB(`: compare string indexes.
- `src/lib/__tests__/runtime.test.ts`, add:
  - `getEnv returns locals.cfEnv`
  - `getEnv throws an error naming src/middleware.ts when locals.cfEnv is missing`
  - `getEnv accepts any { locals } object (the Astro global shape)`
- Rename the 18 injection sites listed in section 4 from `runtime: { env: X }` to `cfEnv: X`. Leave the three `runtime.ctx` cases in `runtime.test.ts` for C5.

**Code:**
- `src/lib/runtime.ts`:
  - Add `export type LocalsContext = { locals: App.Locals };`.
  - `getEnv(context: LocalsContext): App.Platform['env']` returns `context.locals.cfEnv`. If it is missing, it throws `new Error('Cloudflare env unavailable: locals.cfEnv is set by src/middleware.ts. Are you running under workerd/wrangler?')`.
  - `fireAndForget(context: LocalsContext & { url: URL }, promise: Promise<unknown>): void`: the body is unchanged and still reads `locals.runtime?.ctx` in this commit.
- `src/lib/db.ts:5`: change the signature to `getDB(context: LocalsContext)`.
- `src/env.d.ts`, in `App.Locals`: add `cfEnv?: App.Platform['env'];` with a doc comment saying middleware sets it and code reads it through getEnv/getDB.
- `src/middleware.ts`:
  - The first statement in `onRequest` becomes `context.locals.cfEnv = context.locals.runtime?.env;`.
  - Line 16 becomes `if (!context.locals.cfEnv?.DB) {`.
- Replace the 14 reads with `getDB(Astro)`. Use `getEnv(Astro).GOOGLE_MAPS_API_KEY || ''` at `map.astro:5` and `const env = getEnv(Astro);` at `review/new.astro:40`. Import from the correct relative path. `BuildingRecords.astro:63,73` stay inside their try blocks; `Header.astro:7` stays inside `if (user)`.
- **Docs in PR-A**, because parallel branches read them before PR-B lands:
  - `AGENTS.md:73-74`: getEnv/getDB take any `{ locals }`; never read `locals.runtime` or `locals.cfEnv` directly.
  - The "Getting the database" section (`AGENTS.md:147-157`): `.astro` pages use `getDB(Astro)`; API routes use `getDB(context)`.
  - The `runtime.ts` section of `src/lib/AGENTS.md` (`:81-90`).

**Verify:** unit tests, check and build, then `npm run e2e` (still `wrangler pages dev`).

#### C3 `test(e2e): pin the CSRF origin-check behaviour before the Astro major`
AGENTS.md:232 lists "Re-audit triggers: Astro major upgrade".

In `e2e/security.spec.ts`, add `test.describe('CSRF origin check (re-audited for Astro 7)')`. All four tests pass on Astro 5 now and on Astro 7 later:
1. **`cross-origin form POST is refused by the framework`.**
   `request.post('/api/contact', { headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/x-www-form-urlencoded' }, data: 'name=x&email=x%40example.com&message=hello' })` returns 403, with a body containing `Cross-site POST form submissions are forbidden`.
2. **`cross-site Sec-Fetch-Site + cross origin form POST is refused`.** The same request plus `Sec-Fetch-Site: cross-site` returns 403.
3. **`same-origin form POST reaches the handler`.**
   - Call `clearRateLimits()` first.
   - POST `/api/bug-reports` with `Origin: BASE_URL` and form content.
   - The response content-type is `application/json` with an `error` key (400, the Turnstile check), never the plain-text 403.
4. **`cross-origin JSON POST is not stopped by checkOrigin (documented gap) and is refused by the content-type guard`.** POST `/api/contact` with `Origin: https://attacker.example` and `Content-Type: application/json` returns 415.

Also update the comment at `security.spec.ts:104` to "Astro's checkOrigin rejects form POSTs whose Origin does not match".

**End of PR-A:**
- Merge with **"Create a merge commit"**; Pages deploys it.
- Verify on production without creating rows:
  - home, a building page and `/map` load
  - Turnstile renders on `/auth/signin` and `/contact`
  - the owner signs in with their own account, and the header shows the signed-in state, which proves middleware and `Header.astro` on the seam
  - `/api/health` reports the merge SHA

### PR-B `chore/astro-7` (the upgrade and the Workers move)

**Owner step R0 must happen before the first push of this branch.** It is listed in section 7.

#### C4 `chore: pin Node 22.23.4`
- `.node-version`: change `22.16.0` to `22.23.4`. This is Astro 7.4's minimum.
- Verify: CI green. Locally, `node -v` must be at least 22.23.4; the owner's machine has 24.12.0.

#### C5 `chore(deps)!: Astro 6, @astrojs/cloudflare 13, @astrojs/react 5; target Cloudflare Workers` (never deployed)

```
npm install astro@^6.4.8 @astrojs/cloudflare@^13.7.0 @astrojs/react@^5.0.7
npm install -D --save-exact wrangler@4.152.0
npm install -D @cloudflare/workers-types@^5.20261023.1 @astrojs/check@^0.9.12 vitest@^4.1.12
```

**Tests first:**

- **`src/lib/__tests__/runtime.test.ts`:** `makeContext` injects `cfContext` instead of `runtime`. Add:
  - `fireAndForget registers with locals.cfContext.waitUntil`
  - `fireAndForget falls back to void-scheduling when cfContext is absent`
  - **Regression for the exact production failure:** `getEnv and fireAndForget never touch locals.runtime`.
    - Build locals as `Object.defineProperty({ cfEnv: { DB: {} }, cfContext: { waitUntil: spy } }, 'runtime', { enumerable: false, value: { get env() { throw new Error('removed'); }, get ctx() { throw new Error('removed'); } } })`.
    - Expect no throw, the spy called once, and getEnv returning cfEnv.
    - Run it with a **rejecting** promise as well: the `.catch` path logs and never throws. This also covers any failure-recording path item 2 adds there.
- **`cloudflareRuntimeBoundary.test.ts`:** the allowlist becomes empty, so there are zero `locals.runtime` reads anywhere in `src/`.
- **New `src/lib/__tests__/localsTypes.test.ts`** (compile-time, enforced by `npm run check`, since `tsconfig.json` includes `**/*` and excludes only `dist` and `e2e`):
  ```ts
  type IsAny<T> = 0 extends 1 & T ? true : false;
  // npm run check fails here if the adapter's ExecutionContext global is unresolved (cfContext would degrade to any).
  const cfContextIsAny: IsAny<App.Locals['cfContext']> = false;
  const waitUntilIsAny: IsAny<App.Locals['cfContext']['waitUntil']> = false;
  const cfEnvIsAny: IsAny<NonNullable<App.Locals['cfEnv']>> = false;
  ```
  Add a trivial runtime `it(...)` that asserts the three constants are `false`. **Red step:** write the file before adding the alias below and confirm `npm run check` reports a type error on `cfContextIsAny`.
- **New `src/lib/__tests__/platformConfigContract.test.ts`.** It parses `wrangler.jsonc` with `ts.parseConfigFileTextToJson` from `import * as ts from 'typescript'`, which handles comments. It asserts:
  - there is no `pages_build_output_dir`
  - `name === 'ratemyplace'` and `main === '@astrojs/cloudflare/entrypoints/server'`
  - `compatibility_date === '2024-12-01'` and `compatibility_flags` deep-equals `['nodejs_compat']`
  - `workers_dev === true` and `preview_urls === false`
  - there is no `routes` or `route` key. The test comment says F5 adds `routes` only after the Pages rollback window closes.
  - there is no `vars` key, and the file text has no `SITE_URL` key and no `secrets`
  - `observability` deep-equals `{ enabled: false }`. The comment says that turning it on requires F7's log audit, with `logs.invocation_logs: false` and `redact_query_string: true`.
  - there is no `previews` key (F6 decides)
  - there are no `kv_namespaces` and no `images`
  - `d1_databases` deep-equals `[{ binding: 'DB', database_name: 'ratemyplace-db', database_id: '7dd2a722-fdd3-4986-b2f7-6d61d069438e' }]`
  - `r2_buckets` deep-equals `[{ binding: 'VERIFICATION_BUCKET', bucket_name: 'ratemyplace-verification' }]`
  - `astro.config.mjs` (source text) contains `imageService: 'passthrough'`
  - **Lockstep:** `package-lock.json` has exactly one `node_modules/…/wrangler` package entry. Root `devDependencies.wrangler` is an exact version equal to `packages['node_modules/@cloudflare/vite-plugin'].dependencies.wrangler`. This fails a Dependabot PR that bumps wrangler alone.
- **`e2e/test-harness.spec.ts`**, new test `local server runs wrangler dev on the generated Worker config, pinned to the local origin`. Add a local `valueAfter(args, flag)` helper; export `PROJECT_ROOT` and `WRANGLER_ENTRY` from the harness if needed. Assertions on `buildLocalWorkerArgs()` (argv tokens, so they don't depend on the path):
  - `args[0] === WRANGLER_ENTRY` and `args[1] === 'dev'`
  - `args` does not contain `'pages'`
  - `valueAfter(args,'--config') === path.join(PROJECT_ROOT,'dist','server','wrangler.json')`
  - `valueAfter(args,'--port') === '8788'`
  - `valueAfter(args,'--persist-to') === path.join(PROJECT_ROOT,'.wrangler','state')`
  - `valueAfter(args,'--local-upstream') === new URL(LOCAL_E2E_ORIGIN).host` (`localhost:8788`)
  - `valueAfter(args,'--var') === 'TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA'`
- **Container tests:**
  - Add `// @vitest-environment node` as line 1 of `authPageHeadings.test.ts`, `buildingRecordsRender.test.ts`, `namedPartySsrVisibility.test.ts` and `reviewCardHeaderLayout.test.ts`.
  - In each, add a sentinel: `it('runs in the node environment (Astro 6+ container rendering)', () => { expect(typeof document).toBe('undefined'); });`.
  - Replace `document.createElement('div')` plus innerHTML with `htmlFragment(html)` at `authPageHeadings.test.ts:15`, `namedPartySsrVisibility.test.ts:165`, `reviewCardHeaderLayout.test.ts:40,96` and `buildingRecordsRender.test.ts:110`.
  - Do not change any `expect` in these files. Keep `@astrojs/react/server.js`, which 5.x and 7.x still export.
  - New `src/lib/__tests__/helpers/htmlFragment.ts`:
    ```ts
    import { Window } from 'happy-dom';
    export function htmlFragment(html: string): HTMLElement {
      const window = new Window();
      const div = window.document.createElement('div');
      div.innerHTML = html;
      return div as unknown as HTMLElement;
    }
    ```

**Code:**

`wrangler.jsonc` replaces the Pages file entirely:
```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  // Cloudflare Worker with static assets (not Pages): @astrojs/cloudflare 13+ only targets Workers.
  // `astro build` writes dist/server/wrangler.json + .wrangler/deploy/config.json, so a bare
  // `npx wrangler <cmd>` in the repo root after a build reads the GENERATED config; `--config` bypasses it.
  // Production deploys come from Workers Builds on main. On Workers, `wrangler deploy` == production:
  // never run it for the site outside docs/runbooks/workers-cutover.md.
  "name": "ratemyplace",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2024-12-01",          // unchanged; do not bump in this PR
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,                          // staging + post-deploy smoke target
  "preview_urls": false,                        // no per-version URLs (they would run with production secrets)
  // Off = parity with Pages (nothing persisted). Enabling needs the F7 log audit: logError calls
  // carry client IPs and email.ts logs raw Resend errors. See platformConfigContract.test.ts.
  "observability": { "enabled": false },
  "d1_databases": [{ "binding": "DB", "database_name": "ratemyplace-db", "database_id": "7dd2a722-fdd3-4986-b2f7-6d61d069438e" }],
  "r2_buckets": [{ "binding": "VERIFICATION_BUCKET", "bucket_name": "ratemyplace-verification" }]
  // No `routes`: the ratemyplace.org custom domain is attached at cutover (runbook R8) and codified
  // only after the Pages rollback target is deleted (F5). A codified custom domain is re-asserted by
  // every non-interactive deploy, which would undo a rollback.
  // Secrets: run `npx tsx scripts/worker-secrets.ts` for the list; set each with `npx wrangler secret put NAME`.
}
```

`astro.config.mjs`:
- Change to `adapter: cloudflare({ imageService: 'passthrough' })`.
- Comment: the app uses no astro:assets, so there is no IMAGES binding and no Sharp.
- Don't set `session` yet: Astro 6 rejects `false`.

`src/env.d.ts` (it stays a script file with no top-level import or export):
- `type ExecutionContext = import('@cloudflare/workers-types').ExecutionContext;`. Comment: this satisfies the global that `@astrojs/cloudflare/types.d.ts` references for `App.Locals['cfContext']`; `localsTypes.test.ts` pins it.
- In `namespace App`, replace `Platform` with `interface CloudflareEnv { DB: D1Database; VERIFICATION_BUCKET: R2Bucket; TURNSTILE_SECRET_KEY: string; GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string; GOOGLE_MAPS_API_KEY: string; GOOGLE_PLACES_API_KEY: string; RESEND_API_KEY: string; SITE_URL: string; }`.
- In `Locals`, delete `runtime` and keep `user`, `session` and `cfEnv?: CloudflareEnv`. Comment: `cfContext` comes from @astrojs/cloudflare; `runtime` is the adapter's throwing trap.
- `import('@cloudflare/workers-types')` loads only the module types, so `cloudflare:workers` won't resolve. Expect TS2307, and add `declare module 'cloudflare:workers' { export const env: unknown; }`.
- **Decision rule:** if `npm run check` instead reports a duplicate `ExecutionContext` or `cloudflare:workers`, some package has loaded the workers-types globals. In that case, delete both local declarations and augment `declare namespace Cloudflare { interface Env extends App.CloudflareEnv {} }`.
- Do not add `wrangler types` output: its globals clash with lib.dom in the React islands.

`src/middleware.ts`:
- `import { env as cloudflareEnv } from 'cloudflare:workers';`
- The first statement becomes `context.locals.cfEnv = cloudflareEnv as App.CloudflareEnv;`. This is the single typed boundary, and the boundary test pins it.

`src/lib/runtime.ts`:
- getEnv returns `App.CloudflareEnv`.
- fireAndForget uses `const ctx: Pick<ExecutionContext, 'waitUntil'> | undefined = context.locals.cfContext;` and never `runtime`.
- Update the doc comments, including `runtime.ts:34`.

`e2e/test-harness.ts:157`:
- Replace `buildLocalPagesCommand` with `buildLocalWorkerArgs(): string[]`, which returns `[WRANGLER_ENTRY, 'dev', '--config', path.join(PROJECT_ROOT,'dist','server','wrangler.json'), '--port', '8788', '--persist-to', WRANGLER_PERSISTENCE, '--local-upstream', new URL(LOCAL_E2E_ORIGIN).host, '--var', 'TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA']`.
- Add `buildLocalWorkerCommand(): string`, which returns `[process.execPath, ...buildLocalWorkerArgs()].map(quoteShellArgument).join(' ')`.
- **Fallback:** if wrangler rejects `--var` for a generated config (check `npx wrangler dev --help` first), the harness writes a gitignored `dist/server/.dev.vars` instead, and the test asserts that file's content.

Other files:
- `playwright.config.ts:2,17`: use `buildLocalWorkerCommand()`.
- `.gitignore`: add `.dev.vars*`.
- `tsconfig.json` `exclude`: add `".wrangler"`.

**Verify:** `npm test`, `npm run check`, `npm run build`, `npm run e2e`. The SESSION KV build notice is expected at C5.

#### C6 `chore(deps)!: Astro 7, @astrojs/cloudflare 14, @astrojs/react 7; drop the AVIF allowlist entry`

```
npm install astro@^7.4.2 @astrojs/cloudflare@^14.4.2 @astrojs/react@^7.1.1
```

Add the `engines` field. Then run `rm -rf node_modules && npm ci` to prove the lock installs cleanly; this is where PR #22 died. Check `npm ls wrangler` shows exactly one 4.152.0.

**Tests first:**
- `audit-allowlist.json` becomes `[]`.
- `workflowContracts.test.ts`, in `assertAuditAllowlist`: add `expect(entries.map((e) => e.id)).not.toContain('GHSA-26w7-cxv4-gfx2')` so the entry can't come back.
- `node scripts/audit-critical.mjs` must print "no unlisted critical advisories". A new critical gets its own assessment; the AVIF entry is never re-added.
- `platformConfigContract.test.ts`: `astro.config.mjs` contains `session: false` and `compressHTML: true`; `vitest.config.ts` contains `compressHTML: true`.
- New `src/lib/__tests__/buildOutputContract.test.ts` for `serverConfigProblems(config)`:
  - accepts a minimal valid generated config (`name`, `assets.binding: 'ASSETS'`, DB, VERIFICATION_BUCKET)
  - flags a missing DB, a missing VERIFICATION_BUCKET and a missing ASSETS
  - flags `kv_namespaces: [{ binding: 'SESSION' }]`
  - flags `images: { binding: 'IMAGES' }`
  - flags any `routes`
  - flags `vars.SITE_URL`
- `workflowContracts.test.ts`: the `quality` run commands include `npx tsx scripts/check-build-output.ts`, positioned after `npm run build`. Extend `assertCiAuditGate`'s ordered list.
- `e2e/security.spec.ts`: add three Astro 7-only cases to the C3 describe block. They can't pass on Astro 5, which refused a missing Origin.
  5. `same-site Sec-Fetch-Site form POST is refused`: `/api/contact`, `Origin: BASE_URL`, `Sec-Fetch-Site: same-site`, form content type. Expect 403 and the plain-text body.
  6. `form POST with neither Origin nor Sec-Fetch-Site reaches the handler (Astro 7 loosening; only non-browser clients can send this)`: `clearRateLimits()`, then POST `/api/bug-reports` with form content and no Origin. Expect a JSON `{ error }` response (400), not the plain-text 403.
  7. `Sec-Fetch-Site: same-origin is trusted over a mismatched Origin`: `/api/bug-reports`, `Origin: https://attacker.example`, `Sec-Fetch-Site: same-origin`. Expect a JSON `{ error }` response. A browser sets this header and web content can't forge it; the audit records this.

**Code:**
- `astro.config.mjs`:
  - `session: false`. Comment: auth is Lucia on D1, and Astro sessions would auto-provision a SESSION KV namespace.
  - `compressHTML: true`. Comment: Astro 7 defaults to `'jsx'`, which strips inter-element whitespace; keep what the templates were written against (F3).
- `vitest.config.ts`: the inline config becomes `{ configFile: false, compressHTML: true, integrations: [react()] }`.
- New `src/lib/buildOutputContract.ts`:
  - `export interface GeneratedWorkerConfig { name?: string; assets?: { binding?: string }; d1_databases?: Array<{ binding: string }>; r2_buckets?: Array<{ binding: string }>; kv_namespaces?: unknown[]; images?: unknown; routes?: unknown[]; vars?: Record<string, unknown> }`
  - `export function serverConfigProblems(config: GeneratedWorkerConfig): string[]`
- New `scripts/check-build-output.ts`:
  - It reads `dist/server/wrangler.json`, prints each problem and exits 1 if there are any.
  - It also checks that `dist/client/_headers` contains `X-Frame-Options: DENY`.
- `.github/workflows/ci.yml`: after `- name: Production build`, add
  ```yaml
        - name: Verify server build output
          run: npx tsx scripts/check-build-output.ts
  ```
  The step name avoids the banned words `wrangler`, `d1` and `r2`.
- Fix any Rust-compiler build errors (unclosed tags). List each file:line in the commit message, and don't restructure markup beyond the fix.

**Verify:** the full list in section 6.

#### C7 `ci: release identity and post-deploy smoke for the Worker`

**Tests first:**
- New `src/lib/__tests__/releaseSource.test.ts`:
  - `prefers WORKERS_CI_COMMIT_SHA`
  - `falls back to CF_PAGES_COMMIT_SHA then GITHUB_SHA`
  - `skips empty and whitespace values`
  - `returns '' when none is set`
- `platformConfigContract.test.ts`: `astro.config.mjs` contains `releaseCandidateFromEnv(process.env)` and no longer contains `process.env.CF_PAGES_COMMIT_SHA` or `process.env.GITHUB_SHA`.
- `smoke.test.ts`:
  - `preview` accepts `https://ratemyplace.<SUB>.workers.dev` and the existing `https://1a2b3c4d.ratemyplace-64y.pages.dev`. The pages.dev pattern stays until the Pages project is deleted (F5), because it is the rollback target.
  - `preview` rejects:
    - `https://ratemyplace.other.workers.dev`
    - `https://evil-ratemyplace.<SUB>.workers.dev`
    - `https://1a2b3c4d-ratemyplace.<SUB>.workers.dev` (version previews are off)
    - `https://chore-astro-7-ratemyplace.<SUB>.workers.dev`
    - explicit ports `:443`/`:8443`, credentials and paths
  - `WORKERS_DEV_SUBDOMAIN matches /^[a-z0-9-]+$/`. This fails while the placeholder is still in place, so the owner value from R1 must land before merge.
- `workflowContracts.test.ts:422-468`, replacing the smoke expectations:
  - the smoke command is `npm run smoke -- --environment preview --base-url https://ratemyplace.<SUB>.workers.dev --expected-release ${{ github.event.workflow_run.head_sha }} --wait-for-release-ms 600000`
  - no `pages-deployment-url`, no `GITHUB_TOKEN`, and still no `--base-url https://ratemyplace.org`
  - `assertLeastPrivilege(post-deploy-smoke, ['contents'])` (drop `checks`)
  - the bans on `wrangler`, `d1`/`r2` and `secrets.` stay, and workflow comments avoid those words

**Code:**
- New `src/lib/releaseSource.ts`:
  ```ts
  const RELEASE_ENV_KEYS = ['WORKERS_CI_COMMIT_SHA', 'CF_PAGES_COMMIT_SHA', 'GITHUB_SHA'] as const;
  export function releaseCandidateFromEnv(env: Record<string, string | undefined>): string {
    for (const key of RELEASE_ENV_KEYS) { const value = env[key]?.trim(); if (value) return value; }
    return '';
  }
  ```
- `astro.config.mjs:11-12` becomes `const releaseCandidate = releaseCandidateFromEnv(process.env);`, importing from `./src/lib/releaseSource.ts`. Astro loads its config through Vite, so a TS import works; if it doesn't, ship the helper as `.mjs` with JSDoc types. Keep the `COMMIT_SHA` normalisation.
- `src/lib/smoke.ts:54`: replace `PREVIEW_HOST` with two exact patterns:
  - one built from `WORKER_NAME = 'ratemyplace'` and `WORKERS_DEV_SUBDOMAIN = '<R1 value>'`, with dots escaped
  - the existing pages.dev pattern

  At `:121`, `isPreview` tests either pattern.
- `.github/workflows/post-deploy-smoke.yml`:
  - top level: `permissions: contents: read` only
  - the smoke job's last step becomes `name: Smoke the Worker once its workers.dev host serves this release`, running the command above with no GITHUB_TOKEN env
  - the sentinel message reads "Workers Builds may still have deployed it." instead of "Pages may still have attempted deployment."
  - Why workers.dev: Bot Fight Mode on the zone challenges GitHub runners at ratemyplace.org, and the release-SHA wait keeps the gate exact.
- Delete `src/lib/pagesDeployment.ts`, `src/lib/__tests__/pagesDeployment.test.ts` and `scripts/pages-deployment-url.ts`.
- `src/pages/robots.txt.ts:10`: comment only, "Preview hosts (*.workers.dev, formerly *.pages.dev)".
- `recordsSitemap.test.ts:217`: add a workers.dev preview case next to the pages.dev one.

#### C8 `chore(ops): derive the Worker secret list from App.CloudflareEnv`

**Tests first:** new `src/lib/__tests__/workerSecrets.test.ts`.
- `requiredWorkerSecretNames(read of src/env.d.ts)` returns exactly the sorted string-typed keys: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `SITE_URL`, `TURNSTILE_SECRET_KEY`. If items 1–4 add names, update the expectation on purpose.
- It excludes binding-typed keys (`DB: D1Database`, `VERIFICATION_BUCKET: R2Bucket`).
- It accepts optional keys (`NAME?: string`).
- It throws `CloudflareEnv interface not found in src/env.d.ts` on input without the interface.
- `diffSecretNames(required, listed)` returns `{ missing, unexpected }` for a `wrangler secret list` JSON array of `{ name, type }`.

**Code:**
- New `src/lib/workerSecrets.ts` exporting those two pure functions.
- New `scripts/worker-secrets.ts`:
  - With no arguments, it prints the required names one per line.
  - With `--check <file.json>` (the output of `npx wrangler secret list --name ratemyplace`), it prints missing and unexpected names and exits 1 if any are missing.

#### C9 `chore(dependabot): framework majors arrive one at a time; hold TypeScript 7`

`.github/dependabot.yml`:
- Under the npm entry, add the following, with the comment "@astrojs/check accepts TypeScript ^5 || ^6 only":
  ```yaml
  ignore:
    - dependency-name: "typescript"
      update-types: ["version-update:semver-major"]
  ```
- Add `update-types: ["minor", "patch"]` to the `version-updates` group, keeping `patterns: ["*"]`.

Contract tests:
- `keeps npm version and security updates separately grouped` and the related cases must stay green.
- Add an assertion that the TypeScript major ignore is present.

#### C10 `docs: Workers hosting, locals.cfEnv seam, Astro 7`

**`AGENTS.md`:**
- Stack table (`:62-63`): "Astro 7 SSR + React 18 islands"; Hosting is "Cloudflare Worker (static assets), deployed by Workers Builds from `main`".
- Commands: `npm run dev` runs workerd. Agents set `ASTRO_DEV_BACKGROUND=0` or use `astro dev stop`. `npm run preview` runs the built Worker.
- Traps:
  - (a) `Astro.locals.runtime` throws; use getEnv/getDB and `locals.cfContext`.
  - (b) After a build, a bare `wrangler` (including `db:*` scripts) uses the generated config; `--config` bypasses it.
  - (c) `wrangler deploy` of the site is a production deploy.
  - (d) Rollback is a domain move, not a revert, until the Pages project is deleted. Never add `routes` to `wrangler.jsonc` before F5.
  - (e) Preview hosts are workers.dev; Turnstile and the map still can't be exercised there (rewrite of `:286-289`).
  - (f) The Astro 7 checkOrigin semantics.
  - (g) `wrangler` is pinned exactly, in lockstep with @cloudflare/vite-plugin.
  - (h) Observability is off until F7.
- CSRF section (`:210-222`): the new `checkOrigin` description.
- The second-deployable trap (`:255-262`): replace "Pages has no cron triggers" with "the site Worker's deploys never touch this Worker".

**`src/lib/AGENTS.md:81-90`:** the cfEnv set from `cloudflare:workers` in middleware, and cfContext.

**`CLAUDE.md:29-30`:** `pages.dev` becomes `workers.dev`.

**Other docs:**
- `README.md:22`
- `ARCHITECTURE.md:56,493-506`
- `SECURITY.md:96`
- `docs/runbooks/release-smoke.md` (Workers targets, the resolver removed)
- `docs/runbooks/records-scheduler.md:10,60`
- `workers/records-scheduler/wrangler.jsonc` lines 1-3: a **comment-only** edit with no redeploy

**`src/middleware.ts` CSRF comment (lines 6-9):** cite `.planning/audits/csrf-2026-10-astro7.md`.

**`.claude/launch.json`:** the `wrangler` entry becomes `["wrangler","dev","--config","dist/server/wrangler.json","--port","8788","--persist-to",".wrangler/state","--local-upstream","localhost:8788"]`.

**New `docs/runbooks/workers-cutover.md`:** sections 7 and 8 of this plan, plus the measured R4 drill results (variant, prompts verbatim, gap in seconds), committed to PR-B before merge.

**New `.planning/audits/csrf-2026-10-astro7.md`:**
- Layers 1 and 2 are unchanged.
- Layer 3 now refuses form posts with `Sec-Fetch-Site: same-site|cross-site`, trusts `same-origin`/`none`, and allows a form post with no Origin and no Sec-Fetch-Site. Only non-browser clients can send that, so it is not a CSRF vector; Turnstile and the rate limits still apply.
- JSON still bypasses checkOrigin.
- Evidence: e2e cases 1–7.

#### C11 (after PR-B is open) close Dependabot PR #22
`gh pr close 22 --comment "Superseded by #<PR-B>: Astro 7 needs @astrojs/cloudflare 14 (Workers, not Pages) and code changes; TypeScript 7 is outside @astrojs/check's peer range (^5 || ^6)."`

## 6. Verification

### Local, on the final PR-B head
1. `rm -rf node_modules && npm ci`: no ERESOLVE, no `--legacy-peer-deps`.
2. `npm ls astro @astrojs/cloudflare @astrojs/react vite @cloudflare/vite-plugin wrangler typescript react` shows:
   - astro 7.4.x, adapter 14.4.x, react integration 7.1.x
   - a single vite 8.x
   - **exactly one wrangler 4.152.0**
   - TypeScript 5.9.3 and react 18.3.1
3. `node scripts/audit-critical.mjs` with `audit-allowlist.json` set to `[]`: prints "no unlisted critical advisories".
4. `npm run check`: 0 errors. `localsTypes.test.ts` type-checks; its red step was observed in C5. Grep the diff for `: any` / `as any`: none added.
5. `npm test`: everything passes. The count is at least baseline, minus the deleted pagesDeployment tests, plus the new ones.
6. `npm run build`, then `npx tsx scripts/check-build-output.ts`:
   - no SESSION or IMAGES notices
   - `dist/server/wrangler.json` has DB, VERIFICATION_BUCKET and ASSETS, and no `kv_namespaces`, `images` or `routes`
   - `dist/client/_headers` contains our rules plus the `/_astro/*` immutable rule
7. `npx wrangler deploy --dry-run --outdir <scratch>/site`: record the gzip size. It must be under 3 MiB on Workers Free (10 MiB on Paid).
8. `npx wrangler deploy --dry-run --config workers/records-scheduler/wrangler.jsonc --outdir <scratch>/scheduler` succeeds. Do not deploy the scheduler.
9. `npm run e2e`: the whole Playwright suite is green on `wrangler dev`, including CSRF cases 1–7, the existing rate-limit tests and the harness argv test.
10. Release id:
    - `GITHUB_SHA=$(git rev-parse HEAD) npm run build`
    - start the server with `buildLocalWorkerCommand()`
    - `npm run smoke -- --environment local --base-url http://localhost:8788 --expected-release $(git rev-parse HEAD)`
11. **HTML parity diff in two separate worktrees.** Run `git worktree add <scratch>/wt-main origin/main` and `git worktree add <scratch>/wt-b chore/astro-7`, then in each worktree run `npm ci`.
    - In `wt-main`, run `npm run db:setup`, then copy its `.wrangler/state` into `wt-b`, so both serve identical data.
    - Serve `wt-main` with `npx wrangler pages dev dist --port 8790 --persist-to .wrangler/state --binding=TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`.
    - Serve `wt-b` with `npx wrangler dev --config dist/server/wrangler.json --port 8791 --persist-to .wrangler/state --local-upstream localhost:8791 --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA`.
    - Fetch the public pages: `/`, `/search?q=lanark`, one seeded building, one landlord, one property manager, `/methodology`, `/about`, `/privacy`, `/terms`, `/guidelines`, `/contact`, `/dispute`, `/bug-report`, `/map`, `/auth/signin`, `/auth/signup`, `/auth/forgot-password`, `/nope-404`, `/robots.txt`, `/sitemap.xml`.
    - Fetch the signed-in pages: `/profile`, `/review/new` and `/admin`, using a session cookie from the seeded e2e admin's sign-in POST with the dummy Turnstile token.
    - Normalise hashed `/_astro/*` names, `astro-island uid`, `data-astro-cid-*` and whitespace runs, then run `git diff --no-index`.
    - Every structural difference (element nesting, missing spaces between inline elements) is explained or fixed.
12. Manual `npm run dev` (workerd): home, search, a building page with the records panel, review-form step navigation and the admin pages render, islands hydrate, and there are no console errors.

### Staging on workers.dev (after R2)
13. `npm run smoke -- --environment preview --base-url https://ratemyplace.<SUB>.workers.dev --expected-release <PR head SHA>`.
14. Check by hand:
    - `/robots.txt` is `Disallow: /` (host differs from SITE_URL)
    - `/scoring` returns 301 to `/methodology`, and `/review` redirects to `/review/new`
    - `/api/health` reports the SHA
    - security headers and CSP are present on HTML
    - `/sitemap.xml/` (with a trailing slash) now returns 404; nothing links to it
    - a building page shows the same review count and score as ratemyplace.org (same D1)
    - Turnstile and the map can't be exercised on workers.dev. A failure there is expected, not a bug.

### Drill (R4) results
These must be recorded before R5:
- the variant that worked
- prompts, verbatim
- the probe gap for the cutover and for the rollback
- confirmation that a non-interactive deploy without `routes` did not re-take the drill hostname

### After merge, before the domain moves
15. The post-deploy smoke workflow is green against the workers.dev host for the merge SHA.

### Production, after cutover (R8)
16. `curl -sD- https://ratemyplace.org/api/health` reports the merge SHA.
17. From a home network: `npm run smoke -- --environment production --base-url https://ratemyplace.org --expected-release <merge SHA>`.
18. `nslookup -type=MX ratemyplace.org` and `nslookup -type=TXT ratemyplace.org` match the values recorded at R5 (Email Routing MX/SPF and both `google-site-verification` TXT records). Then send a test email to any `@ratemyplace.org` address and confirm it is forwarded. If MX is missing, re-add it from Email → Email Routing → Settings.
19. Owner flows on production, all on the owner's own or test account:
    - password sign-in (Turnstile) and Google OAuth sign-in
    - **bug report**: submit "[cutover test <date>] please ignore"; it appears in `/admin/bug-reports`
    - **contact form**: name `Cutover test`, message "[cutover test <date>] please ignore"; it appears in `/admin/contact`
    - a password-reset email to the owner's own account arrives, which proves `cfContext.waitUntil`
    - the map loads with clustered markers
    - an existing verification image opens in admin (R2)
    - the records panel renders, and pressing "request records" enqueues (Turnstile). Use a Boston building the owner chooses; this is real product behaviour.
    - **review round trip** on a test account, from any existing building's "Write a review" link (`/review/new?building=<id>`), leaving the landlord and manager fields blank. It stays `pending`, so it is not public. Then edit it once.
20. **Read-only D1 sanity**, run before R8 and after step 19. Counts should match except for the step-19 rows:
    ```
    npx wrangler d1 execute ratemyplace-db --remote --json --command "SELECT (SELECT COUNT(*) FROM reviews WHERE status='approved') AS approved_reviews, (SELECT COUNT(*) FROM reviews) AS all_reviews, (SELECT MAX(created_at) FROM reviews) AS last_review_at, (SELECT COUNT(*) FROM contact_messages) AS contacts, (SELECT MAX(created_at) FROM contact_messages) AS last_contact_at, (SELECT COUNT(*) FROM bug_reports) AS bugs, (SELECT MAX(created_at) FROM bug_reports) AS last_bug_at, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM buildings) AS buildings"
    ```
    The 2026-10-26 baseline was 53 approved, 55 total reviews, 1 contact message, 133 users and 38,301 buildings.
21. `curl -sD- https://ratemyplace.org/robots.txt | grep -i cf-cache-status`. A missing value or DYNAMIC means the zone Cache Rule no longer applies (expected; F4).
22. Run `/qa` (`.claude/commands/qa.md`) against production: all five categories, with layouts at 375, 768 and 1280.
23. For the first hour, run `npx wrangler tail ratemyplace --format pretty` live. It is not persisted; don't save the output, which contains request metadata. Then, over 24 hours, watch Worker errors and CPU in the dashboard, D1 metrics, records-scheduler cron invocations (independent of this change) and Search Console for crawl errors.
24. The post-deploy smoke for the next merge to `main` (items 1–4) is green.
25. **Cleanup of test rows:**
    - Bug report: set it to `wont_fix` in `/admin/bug-reports` (audited, `bug_report_updated`).
    - Test review: reject it in `/admin/reviews` (audited, `review_rejected`). This also sends the rejection email to the test account, which is a second fireAndForget proof. Neither status touches `buildings.updated_at` or sitemap lastmod: `src/lib/sitemap.ts:52,68` counts approved reviews only.
    - Password-reset token: expires on its own.
    - Contact message: no admin action exists. Either leave it (it is labelled) or run the optional owner SQL in data_ops.
    - With item 2 live, these rows also trigger owner alert emails. That is expected, and it verifies item 2 on the Worker.

## 7. Cutover runbook (E = engineer, O = owner)

HARD GATES are marked.

**R0 (O), before the first push of `chore/astro-7`:**
- Pages project → Settings → Builds → Branch control: preview branches become "Custom branches", excluding `chore/astro-7*`.
- Items 1–4 keep their Pages previews. Without this, Pages would build Workers output for the branch and publish `dist/` statically on pages.dev.

**R1 (O):** note the workers.dev subdomain (Workers & Pages → Account details). E puts it into `src/lib/smoke.ts` and the smoke workflow (C7).

**R2 (O, staging deploy of the PR-B head):**
1. Create a clean worktree:
   ```
   git fetch origin
   git worktree add ../rmp-stage origin/chore/astro-7
   cd ../rmp-stage
   git status --porcelain
   ```
   The status output must be empty. Never deploy from the main checkout, which holds an untracked route file.
2. Log in: `unset CLOUDFLARE_API_TOKEN` (PowerShell: `Remove-Item Env:CLOUDFLARE_API_TOKEN`), then `npx wrangler login` and `npx wrangler whoami`. The D1-only token can't deploy Workers or attach domains.
3. Build and deploy: `npm ci && GITHUB_SHA=$(git rev-parse HEAD) npm run build && npx wrangler deploy`. This creates the Worker `ratemyplace` on workers.dev only: there are no routes and no `--domain`.
4. Set secrets:
   - `npx tsx scripts/worker-secrets.ts` prints the list.
   - For each name, run `npx wrangler secret put <NAME>` and enter the value at the prompt (`SITE_URL` = `https://ratemyplace.org`).
   - Cross-check the names against the Pages project (Settings → Variables and Secrets, Production and Preview, or `npx wrangler pages secret list --project-name ratemyplace`).
   - Then run `npx wrangler secret list --name ratemyplace > <scratch>/secrets.json` and `npx tsx scripts/worker-secrets.ts --check <scratch>/secrets.json`. It must exit 0.

**R3 (E):** verification steps 13–14.

**R4 (O+E): cutover and rollback drill** on `cutover-drill.ratemyplace.org`, about 30 minutes.
1. **Pages domain.** In the Pages project → Custom domains, set up `cutover-drill.ratemyplace.org` and Activate (Pages creates a proxied CNAME). `curl https://cutover-drill.ratemyplace.org/api/health` shows the Pages release.
2. **Probe.** E starts a probe from a scratch script outside the repo: one GET per second to `/api/health`, logging the time, status, `release` and DNS errors.
3. **Variant A (preferred, no detach).** In `../rmp-stage`, in an interactive terminal (not piped), run `npx wrangler deploy --domain cutover-drill.ratemyplace.org`.
   - Record every prompt verbatim.
   - Answer `y` to "You already have DNS records that conflict… Update them to point to this script instead?".
   - Answer `y` to a "Custom Domains already exist" prompt only if it names the drill hostname.
   - Expected: the probe flips release with zero non-200 responses.
   - Then remove the drill domain in Pages → Custom domains, and confirm the probe still shows the Worker (removing it in Pages did not delete the Worker's record).
4. **Variant B (only if A is refused).** Remove the domain in Pages first, but keep its CNAME and decline any offer to delete it. Rerun the deploy and accept the DNS override. Record the 522 window from the probe.
5. **Rollback rehearsal.** In Worker → Settings → Domains & Routes, remove `cutover-drill.ratemyplace.org`, then immediately set it up again in Pages → Custom domains. Pages refuses while a Worker holds the domain, so the order is forced. Record the gap and the time to the first Pages 200.
6. **Re-take check.** Run `npx wrangler deploy < /dev/null | cat` (no `--domain`, non-TTY, config without `routes`). The probe must stay on the Pages release.
7. **Cleanup.** Remove the drill domain in Pages, delete the `cutover-drill` DNS record, and confirm the Worker lists only its workers.dev route.
8. **Record.** E records the results in `docs/runbooks/workers-cutover.md` on PR-B.

**R5 (O), HARD GATE, immediately before merging PR-B, in the same sitting as R6–R8:**
1. Record the current Pages production deployment ID and commit, plus `nslookup -type=MX` and `-type=TXT` for `ratemyplace.org`.
2. Pages → Settings → Builds: disable automatic production deployments, and set preview deployments to None.

If this is skipped, the merge makes Pages publish Astro 7 output (there is no Pages worker in it) to ratemyplace.org. Between R5 and R8, merges to `main` reach only workers.dev; they go live at R8.

**R6 (O):** Worker → Settings → Builds → connect the GitHub repo.
- Production branch `main`, build command `npm run build`, deploy command `npx wrangler deploy`.
- **Non-production branch builds off.**
- If Cloudflare starts a build of the current `main` when you connect, it fails at `npx wrangler deploy` (the Pages config). That is harmless: nothing deploys.
- No ruleset change is needed: only `quality` is a required check.

**R7 (O merges PR-B with "Create a merge commit"; E watches):** CI `quality` passes, Workers Builds deploys the merge SHA, and the post-deploy smoke is green (verification 15).

**R8 (O), HARD GATE, low-traffic window:**
1. Run `git worktree add ../rmp-cutover <merge SHA>`; `git status --porcelain` must be empty. Then `npm ci && GITHUB_SHA=<merge SHA> npm run build` (the same code Workers Builds deployed).
2. E starts the probe against `https://ratemyplace.org/api/health`.
3. O runs the variant proven in R4 with `npx wrangler deploy --domain ratemyplace.org`, interactive, giving the same answers. If it was variant A, remove `ratemyplace.org` from Pages → Custom domains afterwards.
4. Never delete the apex DNS record by hand: the SOA minimum is 1800 s, so resolvers would cache NXDOMAIN for up to 30 minutes.
5. Leave `www` on its zone redirect rule.

**R9 (O+E):** verification 16–25.

**Schedule:**
- R2–R4 in the first half of November.
- R5–R8 by about December 5, leaving time to roll back and fix before the December 31 allowlist expiry.
- Optional: if the zone's DNS settings offer a custom SOA record, lowering its minimum TTL to 60 s the day before R8 shortens any negative caching from the rollback path.

## 8. Rollback

**Before R8:** production is untouched (Pages). Fix forward on the branch, or re-enable Pages automatic deployments if PR-B is reverted before R8.

**After R8, while the Pages project exists (keep it for at least 30 days).** The custom domain is never codified in this window, so no deploy can re-take it.
1. Pause Workers Builds: Worker → Settings → Builds, disconnect the repository or turn off automatic builds for `main`.
2. Worker → Settings → Domains & Routes → `ratemyplace.org` → Remove.
3. **Immediately** set up `ratemyplace.org` in Pages → Custom domains and Activate. Pages refuses while a Worker holds the domain, so steps 2 and 3 can't be swapped. Expect the gap measured in R4. Resolvers that query during it may cache NXDOMAIN for up to 1800 s.
4. Check that `/api/health` reports the commit recorded at R5, and that sign-in loads.
5. On a branch, run `git revert -m 1 <PR-B merge commit>`; if PR-B was squashed, `git revert <squash commit>`.
   - Before F5 nothing else edits `wrangler.jsonc`, so that file reverts cleanly to the Pages version.
   - Resolve other conflicts by restoring PR-B's files while keeping items 1–4's changes. PR-A's seam (`getDB(Astro)`, the `cfEnv` assigned from `runtime?.env`) is valid on Astro 5, which keeps this clean.
6. Merge the revert PR (CI `quality` on Astro 5). The revert also restores the Pages smoke workflow.
7. Re-enable Pages automatic production deployments. Confirm Pages builds the revert and `/api/health` reports the revert SHA.
8. Keep the Worker (workers.dev) for diagnosis; don't delete it.

D1 is shared and nothing changed the schema, so data stays consistent.

**A bad later Worker deploy:** run `npx wrangler rollback <version-id>` or use Dashboard → Deployments → Rollback. Earlier versions exist from R2, R7 and R8.

**Not a rollback:** "revert the merge and Pages redeploys". Pages auto-deploy is off after R5, and the reverted code can't deploy to the Worker.

## 9. What NOT to change
- Scoring (`ITEM_WEIGHTS`, `RECENCY_BANDS`, aggregation), `privacy.ts`, survey items or methodology.
- The D1 schema and migrations. There are none in this PR. Never run `migrations apply --remote`.
- `compatibility_date` (2024-12-01) and `nodejs_compat`. Neither adapter enforces a minimum date; if a tool demands one, bump it in its own commit with the full suite.
- CSP content and `'unsafe-inline'`. Don't enable `security.csp`, don't set `security.allowedDomains`, and keep `checkOrigin` at its default.
- Turnstile flows: no `turnstile.reset()` from a submitting callback, and the sitekey is unchanged.
- Versions: React 18 (no 19), TS 5.9 (no 6 or 7), Vitest 4, happy-dom 20, Playwright.
- records-scheduler code, deployment and config (except the comment in C10).
- The Vite `.tmp.driveupload` watch ignore, the `redirects` config, slugs, `buildings.updated_at`, and robots and sitemap logic.
- `wrangler.jsonc`:
  - no secrets or `SITE_URL` in it, no `vars`
  - **no `routes`/custom domain before F5**
  - no `previews` and no observability until F6/F7
  - `preview_urls` stays `false`
- Don't delete the Pages project or the pages.dev smoke pattern yet.
- Don't extend the audit allowlist entry. Don't add `wrangler` to GitHub workflows (the contract test forbids it).
- No direct `locals.cfEnv` reads outside `runtime.ts` and `middleware.ts`. No unpinned `wrangler` version.

## 10. What preview and workers.dev can't exercise
- **Turnstile:** the sitekey is not allowlisted off ratemyplace.org.
- **The map:** the Maps key is referrer-restricted, and previews have no key.
- **Google OAuth:** it redirects to SITE_URL, so a session can't be completed on workers.dev.

Verify all three on production only, per AGENTS.md.

## 11. Follow-ups (separate PRs)
- **F1 `chore/react-19`:** react and react-dom ^19.3.1, @types ^19.3.0.
  - Fix the 3 `useRef<NodeJS.Timeout>()` sites to `useRef<ReturnType<typeof setTimeout> | undefined>(undefined)`.
  - Verify SSR in workerd with `npm run preview` and e2e, and confirm react-dom's `workerd` (server.edge) build (the January 2026 MessageChannel failure).
- **F2:** TypeScript 6.x, Vitest 5, happy-dom 21.0.4 (closes a high dev-only advisory), Playwright.
- **F3:** consider `compressHTML: 'jsx'` with a whitespace audit.
- **F4:** edge caching for `/sitemap.xml`, `/sitemaps/*` and `/robots.txt` through the Cache API in those routes.
- **F5:** after at least 30 days stable:
  - delete the Pages project
  - remove the pages.dev smoke pattern and the `CF_PAGES_COMMIT_SHA` fallback
  - then, optionally, codify `"routes": [{ "pattern": "ratemyplace.org", "custom_domain": true }]`. `--local-upstream` already protects e2e and local runs. Flip the contract test deliberately, and note that every non-interactive deploy then re-asserts the domain.
  - point `www` at a proxied `AAAA 100::` record
- **F6:** Worker Previews with a separate preview D1, if PR previews are wanted back. Today previews are off, and Pages previews shared production D1.
- **F7:** logging audit before enabling Workers Logs:
  - drop `ip` from the `logError` calls in the 4 auth routes
  - log Resend failures as code plus `recipientHash` instead of raw error objects
  - then enable `observability` with `logs.invocation_logs: false` and `redact_query_string: true`

## 12. Coordination with items 1–4
- **Order:** land PR-A early. Items 1–4 then write against `getDB(context)` / `getDB(Astro)` / `getEnv(...)`, and their tests inject `cfEnv`. If any item lands before PR-A, C2's rename re-greps and includes its tests.
- **Item 1** edits `src/pages/review/new.astro`. PR-A rewrites lines 19 and 40 of it, so expect a small textual conflict. Item 1's new code must use `getDB(Astro)` and `getEnv(Astro)`; the boundary test enforces this.
- **Item 2** ("record failed emails so they can't vanish silently") will most likely change `fireAndForget`'s `.catch` path in `src/lib/runtime.ts` and write to D1 there. That is the same function C2 and C5 touch: a **direct conflict**, not just a widened signature. The rule for whichever lands second:
  - Item 2's persistence uses `getDB(context)`, which goes through `getEnv` and `cfEnv`.
  - Only the `ctx` source line changes in C5 (`locals.cfContext`).
  - The C5 trap-object regression test runs the reject path, so item 2's recorder must work there without touching `locals.runtime`.
  - Item 2's `email.ts` changes also ship to the records-scheduler on its next manual deploy (AGENTS.md second-deployable trap).
- **New env names** (for example an alert recipient):
  - each must be added to `App.CloudflareEnv` (C5), which makes C8's test fail until the list is updated on purpose
  - set it as a Pages secret by the item's own owner step (production is still Pages)
  - set it as a Worker secret at R2, or before R8 if it lands later
  - `npx tsx scripts/worker-secrets.ts --check` must pass before R8
- `astro check` (with `runtime` removed from `App.Locals`) and `cloudflareRuntimeBoundary.test.ts` both fail if a rebased branch reintroduces `locals.runtime`.
- Rebase PR-B last, after the other items, and keep the R5–R8 window short: merges in that window go live only at R8.
