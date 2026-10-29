# Release smoke runbook

Use this runbook to verify a known local build, immutable Pages preview, or production
release. The smoke suite is read-only: it does not submit Turnstile, interact with Maps,
create data, or deploy or roll back a release.

## Run a smoke check

Install the locked dependency set before running the commands below. Start the local
server separately when checking a local origin.

```powershell
npm ci
npm run smoke -- --environment local --base-url http://127.0.0.1:8788
```

For an atomic Pages preview, use the deployment URL shown by Cloudflare Pages and the PR
head SHA. The preview hostname must be its current hash-based form, not a mutable branch
alias.

```powershell
npm ci
$previewOrigin = 'https://1a2b3c4d.ratemyplace-64y.pages.dev'
$prHeadSha = (git rev-parse HEAD).Trim()
npm run smoke -- --environment preview --base-url $previewOrigin --expected-release $prHeadSha
```

For an independent manual check of the canonical production domain, use the merged `main`
SHA and the canonical production origin. This is deliberately separate from the automated
exact-release gate.

```powershell
npm ci
git fetch origin main
$mainSha = (git rev-parse origin/main).Trim()
npm run smoke -- --environment production --base-url https://ratemyplace.org --expected-release $mainSha
```

`npm run smoke` deliberately has no default target. A default could hit an obsolete
preview or the wrong release. Targets must be origins only: local accepts `localhost`,
`127.0.0.1`, or `[::1]` over HTTP or HTTPS (with an explicit port if needed); preview
accepts only `https://<8-hex>.ratemyplace-64y.pages.dev`; production accepts only
`https://ratemyplace.org`. Preview and production require a 40-character hexadecimal
`--expected-release` SHA. Local may omit it, though it may be supplied for an exact
build-release check.

## What the smoke checks

Each line of output is `PASS|FAIL <probe> <path> <status> <ms> [detail]`. Every probe after
`health` runs only once health passes (and, with `--expected-release`, reports that SHA).
All requests use `cache: no-store` and `redirect: manual`, and each is bounded by
`--request-timeout-ms`. The source is `src/lib/smoke.ts`.

Release, public, auth and API probes:

- `health`: `/api/health` is the JSON above, with the expected release.
- `home` to `signup`: the nine sitemap pages plus sign-in and sign-up answer 200 HTML with a
  doctype and no error text. `home` also needs the security headers.
- `profile-auth`, `new-review-auth`, `admin-auth`: each redirects to `/auth/signin` on the
  same origin.
- `buildings-search`, `user-reviews-auth`, `admin-reviews-auth`: JSON with the expected status.

Discoverability probes (SEO-07), appended after those so none of them changes:

| Probe | Path | Passes when |
|-------|------|-------------|
| `og-image` | `/brand/social/og-default.png` | 200 `image/png`, a PNG whose IHDR says 1200x630, under 300,000 bytes |
| `robots` | `/robots.txt` | 200 `text/plain`; see the environment table |
| `index-<page>` | each of `STATIC_SITEMAP_PATHS` | one canonical equal to the production URL of the path, `og:url` equal to it, `og:image` the default image on that origin, a `summary_large_image` card, no robots meta, and one JSON-LD block that parses, whose WebPage is the canonical and which carries no rating |
| `noindex-signin`, `noindex-signup`, `noindex-search-query` | `/auth/signin`, `/auth/signup`, `/search?q=__rmp_smoke_no_match__` | `noindex, follow`, and no canonical, `og:url` or JSON-LD |
| `sitemap-index` | `/sitemap.xml` | 200 XML `sitemapindex` listing `static.xml` and at least one `buildings-N.xml`, every loc on the canonical origin |
| `sitemap-static` | `/sitemaps/static.xml` | every `STATIC_SITEMAP_PATHS` page, at least one landlord, nothing else: no query string, no private prefix (admin, api, auth, profile, review, dispute, email-verified, bug-report, owner-of-record, property-manager) |
| `sitemap-buildings` | the first chunk the index names | at least one loc, each `/building/<slug>` |
| `sitemap-building-page`, `sitemap-landlord-page` | the first building and landlord loc | an indexable head whose canonical is exactly the loc, with a JSON-LD breadcrumb ending there |

The chunk and the two entity pages are fetched by path on the target, because a preview's
sitemap names production URLs. The index and robots probes do not assert `Cache-Control`:
production's edge Cache Rule rewrites it (`public, max-age=14400` on the sitemap files).

What each environment must show:

| | Production | Preview | Local |
|---|---|---|---|
| Canonical, `og:url`, `og:image`, sitemap locs | `https://ratemyplace.org` | `https://ratemyplace.org` (SITE_URL is production's) | production's or the local origin |
| `robots.txt` | `Allow: /`, `Disallow:` lines for `/admin`, `/api`, `/auth`, `/profile`, `/review`, and `Sitemap: https://ratemyplace.org/sitemap.xml` | exactly `User-agent: *` / `Disallow: /` (not the canonical host) | either; disallow-all passes with the detail `Disallow-all: not the canonical host` |
| Sitemap with no building chunk or no landlord | FAIL `Sitemap degraded: static only` / `no landlord URLs` | FAIL, the same | PASS with that detail (a fresh local database may be empty) |

A degraded sitemap is the D1-outage answer: `/sitemap.xml` names only `static.xml` and
`static.xml` lists only the allowlisted pages, each sent from the origin with
`Cache-Control: public, max-age=60`. The edge Cache Rule showed `max-age=14400` on these
files in October 2026; whether it also holds a degraded answer at the edge for four hours is
an open dashboard check (read-only) for the owner. That fallback is
tested on its own in `src/lib/__tests__/recordsSitemap.test.ts`; the smoke only tells the
two states apart, and fails a release whose sitemap is degraded. Preview passes the healthy
check today because preview deployments share the production D1 binding. If SAFE-10 removes
that binding, the preview expectation becomes "degraded" and this table and `smoke.ts`
change with it.

## What the health check means

The public `GET /api/health` response is non-sensitive and is exactly:

```json
{ "status": "ok", "release": "<release identifier>" }
```

`HEAD /api/health` returns the same successful headers without a body. The route handler
does no D1 work. Cookie-free monitor and smoke requests take middleware's no-session path,
so they do not perform Lucia session validation. That independence is intentionally
narrow: an unrelated caller that sends a session cookie can still cause the normal
middleware session validation and its D1 lookup before the route handler runs.

This input-free, read-only `GET`/`HEAD` endpoint is the sole exception to the usual
D1-backed application rate limit. Keeping it free of an application limiter prevents the
cookie-free release monitor from depending on D1. It does not relax rate-limit expectations
for any other public endpoint. Cloudflare's ordinary edge protections remain in front of
the route; a custom edge rate rule is a separate configuration change that requires its
own approval.

## CI and post-deploy contract

The stable GitHub check name is **`quality`**. CI runs locked installation, diagnostics,
unit tests, and a production build for pull requests and `main` pushes. This workflow
exists in the repository, but this runbook does not claim that a `main` ruleset or required
check has been activated; that is an external verification and approval task.

For every qualifying internal `main` CI completion, the post-deploy workflow runs a
non-cancellable `sentinel` job. A non-successful CI completion explicitly makes that job
red; a successful completion explicitly passes it. The sentinel has no checkout,
dependency installation, or smoke step, so failed CI never performs those actions.

Only the separate, success-gated `smoke` job needs the passing sentinel. It alone owns the
cancellable `production-smoke` concurrency group. Using the built-in GitHub token with
read-only `checks: read`, it polls the triggering commit's GitHub check runs for exactly
one successful `Cloudflare Pages` check from `cloudflare-workers-and-pages`. The resolver
accepts only the immutable `https://<8-hex>.ratemyplace-64y.pages.dev` origin advertised by
that check, then verifies `/api/health` reports the triggering release SHA and runs the
full read-only smoke suite there. It fails closed for an untrusted, ambiguous, incomplete,
or malformed resolution and never deploys, rolls back, mutates Cloudflare configuration, or
uses a Cloudflare credential.

Cloudflare Free-plan Bot Fight Mode may managed-challenge GitHub-hosted runners at the
canonical `/api/health` route. It remains unchanged: the automated exact-release gate uses
the trusted immutable Pages deployment instead. After an automated pass, perform the
separate manual canonical-domain command above from an independent network when the
canonical routing check is needed. Cloudflare synthetic monitoring may be added later as
auxiliary availability monitoring, but it is not an exact-release gate.

Keep the machine-health boundary narrow: this release smoke proves public responses from a
specific immutable deployment. Any future machine-health endpoint or synthetic monitor must
be designed and documented as separate availability telemetry, not treated as evidence that
the canonical domain served a particular release.

A failed post-deploy smoke means the release must not be called healthy. It does not cause
an automatic rollback.

## Failure triage and approval boundary

Keep investigation read-only and work in this order:

1. Compare the expected release SHA with the actual `/api/health` release.
2. Inspect the corresponding Cloudflare Pages deployment.
3. Inspect the failed probe and its response class.
4. Re-run the same read-only smoke command against the explicit target.
5. Request separate approval before any rollback.

SAFE-09 is only partially addressed here. A GitHub failure notification is best-effort
until Phase 22B adds independent counters, an outbox, webhook delivery, and machine-only
health. This release does not provide custom alerts, independent machine health, or
automatic rollback.
