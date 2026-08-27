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

For production, use the merged `main` SHA and the canonical production origin.

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
cancellable `production-smoke` concurrency group, then waits for Cloudflare Pages,
verifies that `/api/health` reports the triggering release SHA, and runs the full
read-only smoke suite. A failed post-deploy smoke means the release must not be called
healthy. It does not cause an automatic rollback.

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
