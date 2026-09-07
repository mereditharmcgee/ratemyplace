# Dependency security refresh implementation plan

**Approved:** 2026-08-29

**Branch:** `codex/dependency-security-refresh`

**Base:** `origin/main` at `a18254a89132ff8ed4da4ef4ae40af3677a12795`

## Goal

Remove the critical dependency advisory and most compatible advisory debt without changing intended product behavior, make dependency risk visible in CI, and leave a verified handoff for the separately reviewed Astro 7 migration.

## Global constraints

- Do not change application features, copy, scoring, database schema or data, Cloudflare settings, environment variables, authentication, moderation, or privacy behavior.
- Do not use `npm audit fix --force`, unsupported dependency overrides, or unreviewed broad rewrites.
- Raise direct dependency floors in `package.json` and commit the reproducible `package-lock.json` resolution.
- Astro 5.18.2 is a compatible interim update, not a complete remediation of Astro advisory debt.
- Stage 2 targets Astro 7.2.9. The security floor is 7.1.0; no 7.0.x version is an acceptable stopping point.
- Keep React and React DOM on 18.3.1 in this stage.
- `main` auto-deploys. Do not push, open a PR, or merge without the user's separate approval gates.
- Preserve the user-owned untracked `src/pages/api/admin/verification/[id] (1).ts` in the root checkout; all work occurs in this isolated worktree.

## Task 1: Pages install authority and pre-change baseline

1. Record the Pages install evidence. Cloudflare's documented default installs all dependencies, but the account API token cannot read project configuration. Treat an exact-SHA Pages preview built after reclassification as the authoritative pre-merge proof that build-time devDependencies are installed.
2. Run a clean `npm ci` from the current lockfile.
3. Record the full and `--omit=dev` audit counts.
4. Run `npm run check`, `npm test`, `npm run build`, and `npm run e2e` before dependency changes. Stop on an unexplained failure.

## Task 2: Compatible dependency refresh

1. Raise direct floors to Astro 5.18.2, Vitest 4.1.11, happy-dom 20.11.13, Resend 6.25.0, and `@astrojs/check` 0.9.10.
2. Move `@astrojs/check`, TypeScript, both React type packages, `@tailwindcss/vite`, and Tailwind CSS from `dependencies` to `devDependencies`.
3. Refresh compatible transitive resolutions without `--force` and review the lockfile changes.
4. Reproduce the expected full audit reduction from 29 to approximately 10, with zero critical findings. Record the actual result rather than forcing it to match the simulation.
5. Run check, unit tests, and build after the dependency refresh.

## Task 3: Dependency guardrails

1. Add a failing workflow-contract test that requires CI to run `npm audit --audit-level=critical` after `npm ci` and before check/test/build.
2. Add the minimal CI workflow change that makes the contract pass.
3. Add `.github/dependabot.yml` for grouped monthly npm version updates and grouped advisory-triggered security updates. Do not describe security updates as weekly; GitHub triggers them from advisories.
4. Add contract coverage for the low-noise Dependabot policy where it protects repository-owned behavior rather than merely mirroring arbitrary YAML text.

## Task 4: Residual advisory and Stage 2 handoff

1. Add a dated planning note that records the actual post-Stage-1 full and production-graph audit counts.
2. Name the residual Astro advisories and the current reachability conditions being relied upon: no attacker-controlled dynamic slots, no remote image allowlist or Astro image components, no transition directives or View Transition imports, and no Astro spread attributes.
3. Record that a change to any relied-upon condition advances the Astro 7 migration priority.
4. Record the approved Stage 2 target and checks: Astro 7.2.9, Cloudflare adapter 14.2.5, React adapter 6.0.4, current compatible Workers types, both migration guides, CSRF re-audit, `getEnv`/`ctx.waitUntil`, fail-closed rate limiting, audit-log writes, D1/R2 bindings, auth, SSR, image route, E2E, immutable preview, and production verification.

## Task 5: Final verification and review

1. Run `npm ci`, both audit views, `npm run check`, `npm test`, `npm run build`, and `npm run e2e` from the committed candidate.
2. Review the complete branch diff, including direct version floors, dependency classification, lockfile, workflows, Dependabot policy, tests, and documentation.
3. Obtain a broad whole-branch review and resolve all load-bearing findings.
4. Present the diff and verification evidence for separate push/PR approval. Do not push during implementation.
